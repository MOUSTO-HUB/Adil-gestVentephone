import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { normaliserImei } from '@gestvente/commun';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

class EvenementImeiDto {
  @ApiProperty() date: Date;
  @ApiProperty({
    enum: [
      'ACHAT',
      'VENTE',
      'ANNULATION_VENTE',
      'RETOUR',
      'TROC_ENTREE',
      'TRANSFERT_SORTIE',
      'TRANSFERT_ENTREE',
      'AJUSTEMENT',
      'REBUT',
    ],
  })
  type: string;
  @ApiProperty() boutique: string;
  @ApiProperty({ description: 'Description lisible de l’événement.' }) detail: string;
  @ApiPropertyOptional({ nullable: true, type: String }) utilisateur: string | null;
}

class FicheImeiDto {
  @ApiProperty() id: string;
  @ApiProperty() imei: string;
  @ApiPropertyOptional({ nullable: true, type: String }) imei2: string | null;
  @ApiProperty() produit: string;
  @ApiProperty() boutique: string;
  @ApiProperty() statut: string;
  @ApiProperty() origine: string;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Masqué aux vendeurs.' })
  prixAchat: number | null;
  @ApiPropertyOptional({
    nullable: true,
    type: Date,
    description: 'Fin de garantie de la dernière vente.',
  })
  finGarantie: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String }) client: string | null;
  @ApiProperty({ type: [EvenementImeiDto] }) evenements: EvenementImeiDto[];
}

const date = (d: Date) => d.toLocaleDateString('fr-FR');

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('articles')
export class ArticlesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fiche d'un téléphone par son IMEI : achat, boutique, ventes, clients, retours,
   * troc, mouvements de stock. Fournisseur et prix d'achat réservés à la gestion.
   */
  @Get('imei/:imei')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @ApiOkResponse({ type: FicheImeiDto })
  async fiche(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('imei') saisi: string,
  ): Promise<FicheImeiDto> {
    const imei = normaliserImei(saisi);
    const article = await this.prisma.article.findFirst({
      where: { commerceId: utilisateur.commerceId, OR: [{ imei }, { imei2: imei }] },
      include: {
        produit: { select: { nom: true } },
        boutique: { select: { nom: true } },
        ligneAchat: { include: { achat: { include: { fournisseur: { select: { nom: true } } } } } },
        lignesVente: { include: { vente: { include: { client: true, boutique: true } } } },
        lignesRetour: { include: { retour: { include: { boutique: true } } } },
        troc: { include: { client: true, boutique: true } },
        mouvementsStock: { include: { boutique: true }, orderBy: { creeLe: 'asc' } },
      },
    });
    if (!article) throw new NotFoundException('Aucun téléphone avec cet IMEI.');
    const gestion = utilisateur.role !== Role.VENDEUR;
    const auteurs = new Map(
      (
        await this.prisma.utilisateur.findMany({
          where: {
            id: {
              in: article.mouvementsStock.flatMap((m) =>
                m.utilisateurId ? [m.utilisateurId] : [],
              ),
            },
          },
          select: { id: true, nom: true },
        })
      ).map((u) => [u.id, u.nom]),
    );

    const evenements: EvenementImeiDto[] = article.mouvementsStock.map((m) => {
      let detail = m.motif ?? '';
      if (m.type === 'ACHAT' && article.ligneAchat) {
        const achat = article.ligneAchat.achat;
        detail = `Bon ${achat.numero} du ${date(achat.dateAchat)}${gestion ? ` · ${achat.fournisseur.nom}` : ''}`;
      }
      if (m.type === 'TROC_ENTREE' && article.troc) {
        detail = `Repris à ${article.troc.client.nom}`;
      }
      return {
        date: m.creeLe,
        type: m.type,
        boutique: m.boutique.nom,
        detail,
        utilisateur: m.utilisateurId ? (auteurs.get(m.utilisateurId) ?? null) : null,
      };
    });
    for (const l of article.lignesVente) {
      evenements.push({
        date: l.vente.dateVente,
        type: l.vente.statut === 'ANNULEE' ? 'ANNULATION_VENTE' : 'VENTE',
        boutique: l.vente.boutique.nom,
        detail: `Facture ${l.vente.numero}${l.vente.client ? ` · ${l.vente.client.nom}` : ''}`,
        utilisateur: null,
      });
    }
    for (const l of article.lignesRetour) {
      evenements.push({
        date: l.retour.creeLe,
        type: 'RETOUR',
        boutique: l.retour.boutique.nom,
        detail: l.retour.motif,
        utilisateur: null,
      });
    }
    // Les ventes, retours et trocs ont aussi un mouvement de stock : une seule ligne par date et type.
    const vus = new Set<string>();
    const uniques = evenements
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .filter((e) => {
        const cle = `${e.type}:${e.date.toISOString().slice(0, 16)}`;
        if (vus.has(cle) && !e.detail) return false;
        vus.add(cle);
        return true;
      });

    const derniereVente = [...article.lignesVente]
      .filter((l) => l.vente.statut === 'VALIDEE')
      .sort((a, b) => b.vente.dateVente.getTime() - a.vente.dateVente.getTime())[0];
    return {
      id: article.id,
      imei: article.imei,
      imei2: article.imei2,
      produit: article.produit.nom,
      boutique: article.boutique.nom,
      statut: article.statut,
      origine: article.origine,
      prixAchat: gestion ? Number(article.prixAchat) : null,
      finGarantie: derniereVente?.finGarantie ?? null,
      client: derniereVente?.vente.client?.nom ?? null,
      evenements: uniques,
    };
  }
}
