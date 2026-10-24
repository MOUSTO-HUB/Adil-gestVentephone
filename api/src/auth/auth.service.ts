import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { erreurNouveauPin, etatAbonnement, ordreFacture } from '@gestvente/commun';
import { hash, verify } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';
import type { AppareilDto, ProfilDto, ResultatPinDto, SessionDto } from './auth.dto.js';
import { parametresDe } from '../credits/parametres.js';
import { BOUTIQUE_OUVERTE, refusCommerce } from './acces.regles.js';
import type { ChargeJeton, UtilisateurConnecte } from './auth.types.js';
import {
  creerJetonRafraichissement,
  DUREE_RAFRAICHISSEMENT_MS,
  empreinte,
  lireJetonRafraichissement,
} from './jetons.js';

const MESSAGE_ECHEC = 'Identifiant ou mot de passe incorrect.';
const MESSAGE_SESSION = 'Session expirée ou fermée. Reconnectez-vous.';

interface CompteSession {
  id: string;
  nom: string;
  role: Role;
  commerceId: string;
}

/** Identifiants de connexion insensibles à la casse et aux espaces autour. */
export const normaliserIdentifiant = (identifiant: string) => identifiant.trim().toLowerCase();

@Injectable()
export class AuthService {
  // Hash calculé une fois pour vérifier un mot de passe même quand l'identifiant est inconnu :
  // le temps de réponse ne révèle pas si un compte existe.
  private hashFactice?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly limiteur: LimiteurService,
  ) {}

  /** Connexion par identifiant et mot de passe : ouvre une session liée à un nouvel appareil. */
  async connexion(
    identifiantSaisi: string,
    motDePasse: string,
    appareil: AppareilDto,
  ): Promise<SessionDto> {
    const identifiant = normaliserIdentifiant(identifiantSaisi);
    await this.limiteur.verifier(LIMITES.connexionIdentifiant, identifiant);
    const compte = await this.prisma.utilisateur.findUnique({ where: { identifiant } });

    this.hashFactice ??= hash('mot-de-passe-factice');
    const valide = await verify(compte?.motDePasseHash ?? (await this.hashFactice), motDePasse);
    if (!compte || !valide) {
      if (compte) {
        await this.audit.journaliser({
          commerceId: compte.commerceId,
          action: ACTIONS_AUDIT.CONNEXION_ECHEC,
          utilisateurId: compte.id,
        });
      }
      throw new UnauthorizedException(MESSAGE_ECHEC);
    }
    if (!compte.actif) {
      throw new ForbiddenException('Ce compte est désactivé. Adressez-vous au propriétaire.');
    }
    const commerce = await this.prisma.commerce.findUniqueOrThrow({
      where: { id: compte.commerceId },
    });
    const refus = refusCommerce(commerce);
    if (refus) throw new ForbiddenException(refus);

    const nouvelAppareil = await this.prisma.appareil.create({
      data: {
        commerceId: compte.commerceId,
        utilisateurId: compte.id,
        nom: appareil.nom,
        plateforme: appareil.plateforme,
      },
    });
    const session = await this.emettreJetons(compte, nouvelAppareil.id);
    await this.prisma.utilisateur.update({
      where: { id: compte.id },
      data: { derniereConnexion: new Date() },
    });
    await this.limiteur.reinitialiser(LIMITES.connexionIdentifiant, identifiant);
    await this.audit.journaliser({
      commerceId: compte.commerceId,
      action: ACTIONS_AUDIT.CONNEXION,
      utilisateurId: compte.id,
      appareilId: nouvelAppareil.id,
      details: { appareil: appareil.nom, plateforme: appareil.plateforme },
    });
    return session;
  }

  /**
   * Nouveau couple de jetons ; le jeton présenté ne sert qu'une fois. Un ancien
   * jeton qui revient a pu être volé : la session de l'appareil est fermée.
   */
  async rafraichir(jeton: string): Promise<SessionDto> {
    const lu = lireJetonRafraichissement(jeton);
    if (!lu) throw new UnauthorizedException(MESSAGE_SESSION);
    const appareil = await this.prisma.appareil.findUnique({
      where: { id: lu.appareilId },
      include: { utilisateur: true, commerce: true },
    });
    if (!appareil || appareil.revoqueLe || !appareil.jetonHash) {
      throw new UnauthorizedException(MESSAGE_SESSION);
    }

    const hashPresente = empreinte(lu.secret);
    if (hashPresente !== appareil.jetonHash) {
      await this.revoquer(appareil.id, null);
      await this.audit.journaliser({
        commerceId: appareil.commerceId,
        action: ACTIONS_AUDIT.JETON_REUTILISE,
        utilisateurId: appareil.utilisateurId,
        appareilId: appareil.id,
      });
      throw new UnauthorizedException(MESSAGE_SESSION);
    }
    const refus = refusCommerce(appareil.commerce);
    if (refus) throw new ForbiddenException(refus);
    if (
      !appareil.utilisateur.actif ||
      !appareil.jetonExpireLe ||
      appareil.jetonExpireLe < new Date()
    ) {
      throw new UnauthorizedException(MESSAGE_SESSION);
    }
    return this.emettreJetons(appareil.utilisateur, appareil.id, hashPresente);
  }

  /** Ferme la session de l'appareil courant. */
  async deconnexion(utilisateur: UtilisateurConnecte): Promise<void> {
    await this.revoquer(utilisateur.appareilId, utilisateur.id);
    await this.audit.journaliser({
      commerceId: utilisateur.commerceId,
      action: ACTIONS_AUDIT.DECONNEXION,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
    });
  }

  async profil(utilisateur: UtilisateurConnecte): Promise<ProfilDto> {
    const compte = await this.prisma.utilisateur.findUniqueOrThrow({
      where: { id: utilisateur.id },
      include: { commerce: true },
    });
    const boutiques = await this.prisma.boutique.findMany({
      where: { id: { in: utilisateur.boutiqueIds }, actif: true, ...BOUTIQUE_OUVERTE },
      select: { id: true, nom: true, prefixe: true, adresse: true, telephone: true },
      orderBy: { nom: 'asc' },
    });
    const { commerce } = compte;
    // Les numéros d'ordre croissent : la dernière vente de l'appareil porte le plus grand.
    const derniere = await this.prisma.vente.findFirst({
      where: { appareilId: utilisateur.appareilId },
      orderBy: { creeLe: 'desc' },
      select: { numero: true },
    });
    return {
      id: compte.id,
      nom: compte.nom,
      identifiant: compte.identifiant,
      role: compte.role,
      appareilId: utilisateur.appareilId,
      pinDefini: compte.pinHash !== null,
      dernierOrdreFacture: derniere ? (ordreFacture(derniere.numero) ?? 0) : 0,
      commerce: {
        id: commerce.id,
        nom: commerce.nom,
        monnaie: commerce.monnaie,
        indicatif: commerce.indicatif,
        fuseau: commerce.fuseau,
        remiseMaxVendeur: commerce.remiseMaxVendeur,
        remiseMaxGerant: commerce.remiseMaxGerant,
        delaiRetourJours: commerce.delaiRetourJours,
        repriseMaxVendeur: commerce.repriseMaxVendeur,
        rappels: parametresDe(commerce),
        abonnement: {
          ...etatAbonnement(commerce.abonnementJusquAu, commerce.essaiJusquAu, new Date()),
          jusquAu: commerce.abonnementJusquAu?.toISOString() ?? null,
        },
      },
      boutiques,
    };
  }

  /** Définit ou change le code PIN du compte (changement : mot de passe exigé). */
  async definirPin(utilisateur: UtilisateurConnecte, pin: string, motDePasse?: string) {
    const erreur = erreurNouveauPin(pin);
    if (erreur) throw new BadRequestException(erreur);
    const compte = await this.prisma.utilisateur.findUniqueOrThrow({
      where: { id: utilisateur.id },
    });
    if (compte.pinHash) {
      if (!motDePasse) {
        throw new BadRequestException('Saisissez votre mot de passe pour changer le code PIN.');
      }
      await this.limiteur.verifier(LIMITES.connexionIdentifiant, compte.identifiant);
      if (!(await verify(compte.motDePasseHash, motDePasse))) {
        throw new UnauthorizedException('Mot de passe incorrect.');
      }
    }
    await this.prisma.utilisateur.update({
      where: { id: compte.id },
      data: { pinHash: await hash(pin) },
    });
    await this.audit.journaliser({
      commerceId: compte.commerceId,
      action: ACTIONS_AUDIT.PIN_DEFINI,
      utilisateurId: compte.id,
      appareilId: utilisateur.appareilId,
    });
  }

  /**
   * Vérifie le code PIN auprès du serveur (nouvel appareil) ; ensuite l'application
   * le vérifie localement, même hors ligne. 5 essais par quart d'heure.
   */
  async verifierPin(utilisateur: UtilisateurConnecte, pin: string): Promise<ResultatPinDto> {
    await this.limiteur.verifier(LIMITES.pinUtilisateur, utilisateur.id);
    const compte = await this.prisma.utilisateur.findUniqueOrThrow({
      where: { id: utilisateur.id },
      select: { pinHash: true },
    });
    if (!compte.pinHash) throw new BadRequestException("Aucun code PIN n'est défini.");
    const valide = await verify(compte.pinHash, pin);
    if (valide) await this.limiteur.reinitialiser(LIMITES.pinUtilisateur, utilisateur.id);
    return { valide };
  }

  /**
   * Émet un jeton d'accès et un jeton de rafraîchissement pour l'appareil.
   * `hashPrecedent` : rotation, appliquée une seule fois même en cas d'appels simultanés.
   */
  private async emettreJetons(
    compte: CompteSession,
    appareilId: string,
    hashPrecedent?: string,
  ): Promise<SessionDto> {
    const { jeton, secret } = creerJetonRafraichissement(appareilId);
    const { count } = await this.prisma.appareil.updateMany({
      where: {
        id: appareilId,
        revoqueLe: null,
        ...(hashPrecedent ? { jetonHash: hashPrecedent } : {}),
      },
      data: {
        jetonHash: empreinte(secret),
        jetonExpireLe: new Date(Date.now() + DUREE_RAFRAICHISSEMENT_MS),
        dernierAcces: new Date(),
      },
    });
    if (count === 0) throw new UnauthorizedException(MESSAGE_SESSION);

    const charge: ChargeJeton = { sub: compte.id, commerceId: compte.commerceId, appareilId };
    return {
      jetonAcces: await this.jwt.signAsync(charge),
      jetonRafraichissement: jeton,
      appareilId,
      utilisateur: {
        id: compte.id,
        nom: compte.nom,
        role: compte.role,
        commerceId: compte.commerceId,
      },
    };
  }

  /** Ferme la session d'un appareil (son jeton de rafraîchissement ne vaut plus rien). */
  async revoquer(appareilId: string, parId: string | null): Promise<void> {
    await this.prisma.appareil.updateMany({
      where: { id: appareilId, revoqueLe: null },
      data: { revoqueLe: new Date(), revoqueParId: parId, jetonHash: null },
    });
  }
}
