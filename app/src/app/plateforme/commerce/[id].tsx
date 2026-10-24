import Ionicons from '@expo/vector-icons/Ionicons';
import {
  FORMULES_ABONNEMENT,
  type FormuleAbonnement,
  formaterMontant,
  GRACE_JOURS,
  LIBELLES_FORMULES,
  LIBELLES_MOYENS,
  LIBELLES_ROLES,
  type Role,
} from '@gestvente/commun';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choix } from '@/components/choix';
import { BadgeAbonnement, BadgeStatut, dateCourte } from '@/components/plateforme';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur, type Options } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import {
  type AccesProvisoire,
  dateSaisie,
  type DetailCommerce,
  type MoyenAbonnement,
  type StatutCommerce,
  usePlateforme,
} from '@/lib/plateforme';
import { useCouleurs } from '@/lib/theme';

type Boutique = DetailCommerce['boutiques'][number];

const MOYENS: MoyenAbonnement[] = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'VIREMENT'];
const PAIEMENT_VIDE = {
  formule: 'MENSUELLE' as FormuleAbonnement,
  periodes: '1',
  moyen: 'ORANGE_MONEY' as MoyenAbonnement,
  reference: '',
  montant: '',
};

export default function FicheCommercant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCouleurs();
  const { requete } = usePlateforme();
  const [commerce, setCommerce] = useState<DetailCommerce | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [acces, setAcces] = useState<AccesProvisoire | null>(null);
  const [motif, setMotif] = useState('');
  const [abonnement, setAbonnement] = useState('');
  const [nouvelle, setNouvelle] = useState({ nom: '', prefixe: '', adresse: '' });
  const [paiement, setPaiement] = useState(PAIEMENT_VIDE);

  const charger = useCallback(
    () =>
      requete<DetailCommerce>(`/commerces/${id}`).then(
        (r) => {
          setCommerce(r);
          setAbonnement(r.abonnementJusquAu ? dateCourte(r.abonnementJusquAu) : '');
        },
        (e: unknown) => setErreur(messageErreur(e)),
      ),
    [requete, id],
  );

  useEffect(() => {
    void charger();
  }, [charger]);

  /** Action sur le serveur, puis rechargement de la fiche. */
  const agir = async <T,>(
    cle: string,
    chemin: string,
    options: Options,
    succes: string | ((r: T) => string),
  ): Promise<T | undefined> => {
    setEnCours(cle);
    setErreur(null);
    setInfo(null);
    try {
      const r = await requete<T>(chemin, options);
      setInfo(typeof succes === 'string' ? succes : succes(r));
      await charger();
      return r;
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  if (!commerce) {
    return (
      <Ecran enHaut titre="Commerçant">
        <Message texte={erreur} />
        {!erreur ? <Texte discret>Chargement…</Texte> : null}
      </Ecran>
    );
  }

  const changerStatut = async (statut: StatutCommerce, question: string, succes: string) => {
    if (!(await confirmer(question))) return;
    await agir(
      statut,
      `/commerces/${id}/statut`,
      { methode: 'POST', corps: { statut, motif: motif.trim() || undefined } },
      succes,
    );
    setMotif('');
  };

  const modifierBoutique = async (b: Boutique, corps: object, question: string, succes: string) => {
    if (!(await confirmer(question))) return;
    await agir(`b-${b.id}`, `/boutiques/${b.id}`, { methode: 'PATCH', corps }, succes);
  };

  const enregistrerAbonnement = async () => {
    const jusquAu = abonnement.trim() ? dateSaisie(abonnement) : null;
    if (abonnement.trim() && !jusquAu) return setErreur('Date au format JJ/MM/AAAA.');
    await agir(
      'abonnement',
      `/commerces/${id}/abonnement`,
      { methode: 'PATCH', corps: { jusquAu } },
      jusquAu
        ? `Abonnement enregistré jusqu’au ${abonnement.trim()}.`
        : 'Date d’abonnement effacée.',
    );
  };

  const periodes = Number(paiement.periodes) || 0;
  const tarif = commerce.tarifs[paiement.formule] * periodes;

  const enregistrerPaiement = async () => {
    if (!Number.isInteger(periodes) || periodes < 1 || periodes > 24) {
      return setErreur('Nombre de périodes : de 1 à 24.');
    }
    if (paiement.moyen !== 'ESPECES' && !paiement.reference.trim()) {
      return setErreur('La référence de la transaction est obligatoire pour ce moyen.');
    }
    const montant = paiement.montant.trim() ? Number(paiement.montant) : undefined;
    if (montant !== undefined && (!Number.isInteger(montant) || montant < 0)) {
      return setErreur('Montant en GNF, sans décimale.');
    }
    const r = await agir<{ montant: number; jusquAu: string }>(
      'paiement',
      `/commerces/${id}/paiements`,
      {
        methode: 'POST',
        corps: {
          formule: paiement.formule,
          periodes,
          moyen: paiement.moyen,
          reference: paiement.reference.trim() || undefined,
          montant,
        },
      },
      (x) =>
        `${formaterMontant(x.montant, 'GNF')} enregistrés : accès ouvert jusqu’au ${dateCourte(x.jusquAu)}.`,
    );
    if (r) setPaiement(PAIEMENT_VIDE);
  };

  const ajouterBoutique = async () => {
    if (!nouvelle.nom.trim() || !/^[A-Za-z]{2,5}$/.test(nouvelle.prefixe.trim())) {
      return setErreur('Nom de la boutique et préfixe des factures (2 à 5 lettres) obligatoires.');
    }
    const r = await agir(
      'ajout',
      `/commerces/${id}/boutiques`,
      {
        methode: 'POST',
        corps: {
          nom: nouvelle.nom.trim(),
          prefixe: nouvelle.prefixe.trim().toUpperCase(),
          adresse: nouvelle.adresse.trim() || undefined,
        },
      },
      `Boutique « ${nouvelle.nom.trim()} » ajoutée.`,
    );
    if (r) setNouvelle({ nom: '', prefixe: '', adresse: '' });
  };

  const installerCatalogue = async () => {
    if (
      !(await confirmer(
        'Ajouter les articles de base manquants ? Les articles existants et leurs prix ne sont pas modifiés.',
        'Installer',
      ))
    )
      return;
    await agir<{ produits: number; marques: number; modeles: number }>(
      'catalogue',
      `/commerces/${id}/catalogue`,
      { methode: 'POST' },
      (r) =>
        r.produits
          ? `${r.produits} article(s), ${r.marques} marque(s) et ${r.modeles} modèle(s) ajoutés.`
          : 'Le catalogue de base est déjà complet.',
    );
  };

  const reinitialiser = async () => {
    if (!(await confirmer('Créer un nouveau mot de passe provisoire pour le propriétaire ?')))
      return;
    const r = await agir<AccesProvisoire>(
      'mdp',
      `/commerces/${id}/proprietaire/mot-de-passe`,
      { methode: 'POST' },
      'Nouveau mot de passe créé. Ses anciennes sessions sont fermées.',
    );
    if (r) setAcces(r);
  };

  const boutiquesVisibles = commerce.boutiques.filter((b) => !b.supprimeeLe);
  const boutiquesRetirees = commerce.boutiques.filter((b) => b.supprimeeLe);

  return (
    <Ecran
      enHaut
      titre={commerce.nom}
      sousTitre={`${commerce.telephone} · client depuis le ${dateCourte(commerce.creeLe)}`}
    >
      <View style={styles.ligne}>
        <BadgeStatut statut={commerce.statut} />
        <Texte discret>
          {commerce.produits} articles · {commerce.clients} clients · {commerce.utilisateurs.length}{' '}
          comptes
        </Texte>
      </View>
      {commerce.motifStatut && commerce.statut !== 'ACTIF' ? (
        <Message type="info" texte={`Motif : ${commerce.motifStatut}`} />
      ) : null}
      <Message texte={erreur} />
      <Message type="succes" texte={info} />
      {acces ? (
        <Carte titre="Nouvel accès du propriétaire" icone="key">
          <Texte>Identifiant : {acces.identifiant}</Texte>
          <Texte gras>Mot de passe provisoire : {acces.motDePasse}</Texte>
          <Texte discret>Affiché une seule fois : notez-le avant de quitter l’écran.</Texte>
        </Carte>
      ) : null}

      <Carte titre={`Boutiques (${boutiquesVisibles.length})`} icone="business">
        {boutiquesVisibles.map((b) => (
          <View key={b.id} style={[styles.boutique, { borderColor: c.bordure }]}>
            <View style={styles.ligne}>
              <Ionicons
                name={b.verrouillee ? 'lock-closed' : 'lock-open-outline'}
                size={18}
                color={b.verrouillee ? c.alerte : c.succes}
              />
              <Text style={[styles.nomBoutique, { color: c.texte }]}>
                {b.nom} ({b.prefixe})
              </Text>
            </View>
            <Texte discret>
              {b.verrouillee ? 'Verrouillée : ventes et connexions bloquées' : 'Ouverte'}
              {b.adresse ? ` · ${b.adresse}` : ''}
            </Texte>
            <View style={styles.ligne}>
              {b.verrouillee ? (
                <Bouton
                  titre="Déverrouiller"
                  icone="lock-open"
                  variante="secondaire"
                  chargement={enCours === `b-${b.id}`}
                  onPress={() =>
                    void modifierBoutique(
                      b,
                      { verrouillee: false },
                      `Déverrouiller « ${b.nom} » ?`,
                      `« ${b.nom} » est déverrouillée.`,
                    )
                  }
                />
              ) : (
                <Bouton
                  titre="Verrouiller"
                  icone="lock-closed"
                  variante="accent"
                  chargement={enCours === `b-${b.id}`}
                  onPress={() =>
                    void modifierBoutique(
                      b,
                      { verrouillee: true },
                      `Verrouiller « ${b.nom} » ? Plus personne ne pourra y vendre ni s’y connecter.`,
                      `« ${b.nom} » est verrouillée.`,
                    )
                  }
                />
              )}
              <Bouton
                titre="Supprimer"
                icone="trash-outline"
                variante="danger"
                desactive={enCours === `b-${b.id}`}
                onPress={() =>
                  void modifierBoutique(
                    b,
                    { supprimee: true },
                    `Supprimer « ${b.nom} » ? Elle disparaît pour le commerçant ; ses ventes et son historique sont conservés et elle reste restaurable.`,
                    `« ${b.nom} » est supprimée (restaurable).`,
                  )
                }
              />
            </View>
          </View>
        ))}
        {boutiquesRetirees.length ? (
          <>
            <Texte gras>Boutiques supprimées</Texte>
            {boutiquesRetirees.map((b) => (
              <View key={b.id} style={styles.ligne}>
                <View style={{ flex: 1 }}>
                  <Texte discret>
                    {b.nom} ({b.prefixe}) · supprimée le {dateCourte(b.supprimeeLe!)}
                  </Texte>
                </View>
                <Bouton
                  titre="Restaurer"
                  icone="refresh"
                  variante="secondaire"
                  chargement={enCours === `b-${b.id}`}
                  onPress={() =>
                    void modifierBoutique(
                      b,
                      { supprimee: false },
                      `Restaurer « ${b.nom} » ?`,
                      `« ${b.nom} » est restaurée.`,
                    )
                  }
                />
              </View>
            ))}
          </>
        ) : null}
      </Carte>

      <Carte titre="Ajouter une boutique" icone="add-circle">
        <Champ
          libelle="Nom de la boutique"
          value={nouvelle.nom}
          onChangeText={(nom) => setNouvelle((n) => ({ ...n, nom }))}
        />
        <Champ
          libelle="Préfixe des factures (2 à 5 lettres)"
          value={nouvelle.prefixe}
          autoCapitalize="characters"
          maxLength={5}
          onChangeText={(prefixe) => setNouvelle((n) => ({ ...n, prefixe }))}
        />
        <Champ
          libelle="Adresse (facultatif)"
          value={nouvelle.adresse}
          onChangeText={(adresse) => setNouvelle((n) => ({ ...n, adresse }))}
        />
        <Bouton
          titre="Ajouter la boutique"
          icone="add"
          onPress={() => void ajouterBoutique()}
          chargement={enCours === 'ajout'}
        />
      </Carte>

      <Carte titre="Abonnement" icone="calendar">
        <View style={styles.ligne}>
          <BadgeAbonnement {...commerce.abonnement} />
          <Texte discret>
            {commerce.abonnementJusquAu
              ? `Échéance : ${dateCourte(commerce.abonnementJusquAu)}`
              : 'Accès sans limite de date'}
            {commerce.essaiJusquAu ? ` · essai jusqu’au ${dateCourte(commerce.essaiJusquAu)}` : ''}
          </Texte>
        </View>
        <Texte discret>
          Tarif ({boutiquesVisibles.length} boutique{boutiquesVisibles.length > 1 ? 's' : ''}) :{' '}
          {formaterMontant(commerce.tarifs.MENSUELLE, 'GNF')} par mois ou{' '}
          {formaterMontant(commerce.tarifs.ANNUELLE, 'GNF')} par an. Après l’échéance, l’accès reste
          ouvert {GRACE_JOURS} jours puis il est coupé (données conservées).
        </Texte>
        <Choix
          libelle="Formule"
          options={FORMULES_ABONNEMENT.map((f) => ({ id: f, nom: LIBELLES_FORMULES[f] }))}
          valeurs={[paiement.formule]}
          surChoix={([formule]) =>
            setPaiement((p) => ({ ...p, formule: formule as FormuleAbonnement }))
          }
        />
        <Champ
          libelle={paiement.formule === 'MENSUELLE' ? 'Nombre de mois' : 'Nombre d’années'}
          value={paiement.periodes}
          keyboardType="number-pad"
          onChangeText={(periodes) => setPaiement((p) => ({ ...p, periodes }))}
        />
        <Choix
          libelle="Moyen de paiement"
          options={MOYENS.map((m) => ({ id: m, nom: LIBELLES_MOYENS[m] }))}
          valeurs={[paiement.moyen]}
          surChoix={([moyen]) => setPaiement((p) => ({ ...p, moyen: moyen as MoyenAbonnement }))}
        />
        {paiement.moyen !== 'ESPECES' ? (
          <Champ
            libelle="Référence de la transaction"
            value={paiement.reference}
            onChangeText={(reference) => setPaiement((p) => ({ ...p, reference }))}
          />
        ) : null}
        <Champ
          libelle={`Montant payé (vide : ${formaterMontant(tarif, 'GNF')})`}
          value={paiement.montant}
          keyboardType="number-pad"
          onChangeText={(montant) => setPaiement((p) => ({ ...p, montant }))}
        />
        <Bouton
          titre="Enregistrer le paiement"
          icone="cash"
          onPress={() => void enregistrerPaiement()}
          chargement={enCours === 'paiement'}
        />
        {commerce.paiements.length ? <Texte gras>Paiements reçus</Texte> : null}
        {commerce.paiements.map((p) => (
          <Texte key={p.id} discret>
            {dateCourte(p.creeLe)} · {formaterMontant(p.montant, 'GNF')} ·{' '}
            {LIBELLES_FORMULES[p.formule]} × {p.periodes} · {LIBELLES_MOYENS[p.moyen]}
            {p.reference ? ` (${p.reference})` : ''} · du {dateCourte(p.periodeDu)} au{' '}
            {dateCourte(p.periodeAu)}
          </Texte>
        ))}
        <Texte gras>Corriger l’échéance</Texte>
        <Champ
          libelle="Accès ouvert jusqu’au (vide : sans échéance)"
          value={abonnement}
          onChangeText={setAbonnement}
          placeholder="JJ/MM/AAAA"
        />
        <Bouton
          titre="Enregistrer la date"
          icone="save"
          variante="secondaire"
          onPress={() => void enregistrerAbonnement()}
          chargement={enCours === 'abonnement'}
        />
      </Carte>

      <Carte titre="Comptes du commerce" icone="people">
        {commerce.utilisateurs.map((u) => (
          <Texte key={u.id} discret={!u.actif}>
            {u.nom} · {u.identifiant} · {LIBELLES_ROLES[u.role as Role] ?? u.role}
            {u.actif ? '' : ' (désactivé)'}
            {u.derniereConnexion ? ` · vu le ${dateCourte(u.derniereConnexion)}` : ''}
          </Texte>
        ))}
        <Bouton
          titre="Nouveau mot de passe du propriétaire"
          icone="key-outline"
          variante="secondaire"
          onPress={() => void reinitialiser()}
          chargement={enCours === 'mdp'}
        />
      </Carte>

      <Carte titre="Catalogue de base" icone="phone-portrait">
        <Texte discret>
          Téléphones et accessoires courants en Guinée (sans photo). Les articles déjà présents ou
          modifiés par le commerçant ne sont pas touchés.
        </Texte>
        <Bouton
          titre="Installer les articles manquants"
          icone="download-outline"
          variante="secondaire"
          onPress={() => void installerCatalogue()}
          chargement={enCours === 'catalogue'}
        />
      </Carte>

      <Carte titre="Accès du commerce" icone="shield-checkmark">
        <Champ
          libelle="Motif montré au commerçant (facultatif)"
          value={motif}
          onChangeText={setMotif}
          placeholder="Abonnement impayé"
        />
        {commerce.statut === 'ACTIF' ? (
          <Bouton
            titre="Suspendre le commerce"
            icone="pause-circle"
            variante="accent"
            chargement={enCours === 'SUSPENDU'}
            onPress={() =>
              void changerStatut(
                'SUSPENDU',
                `Suspendre « ${commerce.nom} » ? Toutes ses sessions seront refusées.`,
                'Commerce suspendu.',
              )
            }
          />
        ) : (
          <Bouton
            titre="Réactiver le commerce"
            icone="play-circle"
            chargement={enCours === 'ACTIF'}
            onPress={() =>
              void changerStatut('ACTIF', `Réactiver « ${commerce.nom} » ?`, 'Commerce réactivé.')
            }
          />
        )}
        {commerce.statut !== 'SUPPRIME' ? (
          <Bouton
            titre="Supprimer le commerce"
            icone="trash"
            variante="danger"
            chargement={enCours === 'SUPPRIME'}
            onPress={() =>
              void changerStatut(
                'SUPPRIME',
                `Supprimer « ${commerce.nom} » ? Il n’a plus accès et disparaît de la liste ; ses données sont conservées et il reste restaurable (filtre « Retirés »).`,
                'Commerce supprimé (restaurable).',
              )
            }
          />
        ) : null}
      </Carte>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  boutique: { borderTopWidth: 1, paddingTop: 10, gap: 6 },
  nomBoutique: { fontSize: 16, fontWeight: '700' },
});
