import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  nomPropose,
  normaliserRecherche,
  type ProduitSaisi,
  schemaProduit,
} from '@gestvente/commun';
import ExcelJS from 'exceljs';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JournalService } from '../sync/journal.service.js';
import {
  type ContexteCatalogue,
  enregistrerCategorie,
  enregistrerMarque,
  enregistrerModele,
  enregistrerProduit,
} from './catalogue.ecritures.js';

export const LIGNES_IMPORT_MAX = 5000;

/** Colonnes du fichier, dans l'ordre du modèle. */
export const COLONNES_IMPORT = [
  'Type',
  'Catégorie',
  'Marque',
  'Modèle',
  'Nom',
  'Capacité',
  'Couleur',
  'État',
  'Code-barres',
  'Garantie (mois)',
  'Prix d’achat',
  'Prix de détail',
  'Prix de gros',
  'Seuil de gros',
] as const;
type Colonne = (typeof COLONNES_IMPORT)[number];

export interface ErreurLigne {
  ligne: number;
  messages: string[];
}

export interface RapportImport {
  simulation: boolean;
  lignes: number;
  crees: number;
  modifies: number;
  erreurs: ErreurLigne[];
}

/** Annule la transaction d'une simulation, une fois le rapport établi. */
class FinSimulation extends Error {
  constructor(readonly rapport: RapportImport) {
    super('simulation');
  }
}

const cle = (texte: string) => normaliserRecherche(texte);

function texteCellule(valeur: ExcelJS.CellValue): string {
  if (valeur === null || valeur === undefined) return '';
  if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
  if (typeof valeur === 'object') {
    if ('text' in valeur && typeof valeur.text === 'string') return valeur.text.trim();
    if ('result' in valeur) return texteCellule(valeur.result as ExcelJS.CellValue);
    if ('richText' in valeur)
      return valeur.richText
        .map((r) => r.text)
        .join('')
        .trim();
    // Erreur de formule ou cellule non reconnue : considérée vide.
    return '';
  }
  return String(valeur).trim();
}

function entier(texte: string, nom: string, erreurs: string[], obligatoire = true): number | null {
  if (!texte) {
    if (obligatoire) erreurs.push(`${nom} manquant.`);
    return null;
  }
  const nombre = Number(texte.replace(/[\s ]/g, '').replace(',', '.'));
  if (!Number.isInteger(nombre)) {
    erreurs.push(`${nom} : nombre entier attendu (« ${texte} »).`);
    return null;
  }
  return nombre;
}

/**
 * Import du catalogue depuis un fichier Excel. Une ligne par produit ; catégories,
 * marques et modèles sont créés au besoin. Un produit existant est retrouvé par
 * son code-barres, sinon par son nom : il est mis à jour. Les lignes en erreur
 * sont listées et ignorées. En simulation, rien n'est enregistré.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  async importer(
    utilisateur: UtilisateurConnecte,
    fichier: Buffer,
    simulation: boolean,
  ): Promise<RapportImport> {
    const lignes = await this.lire(fichier);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.journal.verrouiller(tx, utilisateur.commerceId);
          const rapport = await this.traiter(
            { tx, utilisateur, journal: this.journal, audit: this.audit },
            lignes,
          );
          rapport.simulation = simulation;
          if (simulation) throw new FinSimulation(rapport);
          await this.audit.journaliser(
            {
              commerceId: utilisateur.commerceId,
              action: ACTIONS_AUDIT.IMPORT_CATALOGUE,
              utilisateurId: utilisateur.id,
              appareilId: utilisateur.appareilId,
              details: {
                crees: rapport.crees,
                modifies: rapport.modifies,
                erreurs: rapport.erreurs.length,
              },
            },
            tx,
          );
          return rapport;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (erreur) {
      if (erreur instanceof FinSimulation) return erreur.rapport;
      throw erreur;
    }
  }

  /** Lignes du premier onglet, repérées par l'intitulé des colonnes (ligne 1). */
  private async lire(
    fichier: Buffer,
  ): Promise<{ numero: number; valeurs: Record<Colonne, string> }[]> {
    const classeur = new ExcelJS.Workbook();
    try {
      await classeur.xlsx.load(fichier as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Fichier illisible : envoyez un classeur Excel (.xlsx).');
    }
    const feuille = classeur.worksheets[0];
    if (!feuille) throw new BadRequestException('Le classeur est vide.');

    const positions = new Map<Colonne, number>();
    feuille.getRow(1).eachCell((cellule, numero) => {
      const intitule = cle(texteCellule(cellule.value));
      const colonne = COLONNES_IMPORT.find((c) => cle(c) === intitule);
      if (colonne) positions.set(colonne, numero);
    });
    const manquantes = [
      'Type',
      'Catégorie',
      'Prix d’achat',
      'Prix de détail',
      'Prix de gros',
    ].filter((c) => !positions.has(c as Colonne));
    if (manquantes.length) {
      throw new BadRequestException(`Colonnes manquantes : ${manquantes.join(', ')}.`);
    }

    const lignes: { numero: number; valeurs: Record<Colonne, string> }[] = [];
    feuille.eachRow({ includeEmpty: false }, (ligne, numero) => {
      if (numero === 1) return;
      const valeurs = Object.fromEntries(
        COLONNES_IMPORT.map((c) => {
          const position = positions.get(c);
          return [c, position ? texteCellule(ligne.getCell(position).value) : ''];
        }),
      ) as Record<Colonne, string>;
      if (Object.values(valeurs).some(Boolean)) lignes.push({ numero, valeurs });
    });
    if (lignes.length > LIGNES_IMPORT_MAX) {
      throw new BadRequestException(`Trop de lignes : ${LIGNES_IMPORT_MAX} au plus par fichier.`);
    }
    return lignes;
  }

  private async traiter(
    ctx: ContexteCatalogue,
    lignes: { numero: number; valeurs: Record<Colonne, string> }[],
  ): Promise<RapportImport> {
    const rapport: RapportImport = {
      simulation: false,
      lignes: lignes.length,
      crees: 0,
      modifies: 0,
      erreurs: [],
    };
    for (const { numero, valeurs } of lignes) {
      const messages = await this.ligne(ctx, valeurs);
      if (messages === 'cree') rapport.crees++;
      else if (messages === 'modifie') rapport.modifies++;
      else rapport.erreurs.push({ ligne: numero, messages });
    }
    return rapport;
  }

  private async ligne(
    ctx: ContexteCatalogue,
    v: Record<Colonne, string>,
  ): Promise<'cree' | 'modifie' | string[]> {
    const { tx, utilisateur } = ctx;
    const commerceId = utilisateur.commerceId;
    const erreurs: string[] = [];

    const typeSaisi = cle(v.Type);
    const type = typeSaisi.startsWith('tel')
      ? 'TELEPHONE'
      : typeSaisi.startsWith('acc')
        ? 'ACCESSOIRE'
        : null;
    if (!type) erreurs.push('Type : « Téléphone » ou « Accessoire ».');
    if (!v.Catégorie) erreurs.push('Catégorie manquante.');
    const etatSaisi = cle(v.État);
    const etat =
      !etatSaisi || etatSaisi.startsWith('neu')
        ? 'NEUF'
        : etatSaisi.startsWith('occ')
          ? 'OCCASION'
          : null;
    if (!etat) erreurs.push('État : « Neuf » ou « Occasion ».');
    if (v.Modèle && !v.Marque) erreurs.push('Un modèle a besoin de sa marque.');
    if (v.Modèle && type === 'ACCESSOIRE') {
      erreurs.push(
        'Un accessoire n’a pas de modèle (ses compatibilités se règlent dans l’application).',
      );
    }
    const prixAchat = entier(v['Prix d’achat'], 'Prix d’achat', erreurs);
    const prixDetail = entier(v['Prix de détail'], 'Prix de détail', erreurs);
    const prixGros = entier(v['Prix de gros'], 'Prix de gros', erreurs);
    const garantie = entier(v['Garantie (mois)'], 'Garantie', erreurs, false) ?? 0;
    const seuilGros = entier(v['Seuil de gros'], 'Seuil de gros', erreurs, false);
    const nom =
      v.Nom ||
      nomPropose({ marque: v.Marque, modele: v.Modèle, capacite: v.Capacité, couleur: v.Couleur });
    if (!nom) erreurs.push('Nom manquant (ou marque et modèle).');
    if (erreurs.length || !type || !etat) return erreurs;

    // Catégorie, marque et modèle : retrouvés par leur nom, créés au besoin.
    const categorieId = await this.trouverOuCreer(
      () =>
        tx.categorie.findFirst({
          where: { commerceId, nom: { equals: v.Catégorie, mode: 'insensitive' } },
        }),
      (id) => enregistrerCategorie(ctx, { id, nom: v.Catégorie, type }),
      erreurs,
    );
    const categorie =
      categorieId && (await tx.categorie.findUnique({ where: { id: categorieId } }));
    if (categorie && categorie.type !== type) {
      erreurs.push(
        `La catégorie « ${categorie.nom} » est réservée aux ${categorie.type === 'TELEPHONE' ? 'téléphones' : 'accessoires'}.`,
      );
    }
    const marqueId = v.Marque
      ? await this.trouverOuCreer(
          () =>
            tx.marque.findFirst({
              where: { commerceId, nom: { equals: v.Marque, mode: 'insensitive' } },
            }),
          (id) => enregistrerMarque(ctx, { id, nom: v.Marque }),
          erreurs,
        )
      : null;
    const modeleId =
      v.Modèle && marqueId
        ? await this.trouverOuCreer(
            () =>
              tx.modele.findFirst({
                where: { marqueId, nom: { equals: v.Modèle, mode: 'insensitive' } },
              }),
            (id) => enregistrerModele(ctx, { id, marqueId, nom: v.Modèle }),
            erreurs,
          )
        : null;
    if (erreurs.length || !categorieId) return erreurs;

    // Produit existant : par code-barres, sinon par nom (même type).
    const codeBarres = v['Code-barres'] || null;
    const existant =
      (codeBarres && (await tx.produit.findFirst({ where: { commerceId, codeBarres } }))) ||
      (await tx.produit.findFirst({
        where: { commerceId, type, nom: { equals: nom, mode: 'insensitive' } },
      }));
    const compatibles = existant
      ? (await tx.compatibilite.findMany({ where: { accessoireId: existant.id } })).map(
          (c) => c.modeleId,
        )
      : [];

    const saisie = schemaProduit.safeParse({
      id: existant?.id ?? randomUUID(),
      type,
      categorieId,
      marqueId,
      modeleId,
      nom,
      capacite: v.Capacité || null,
      couleur: v.Couleur || null,
      etat,
      codeBarres,
      garantieMois: garantie,
      prixAchat,
      prixDetail,
      prixGros,
      seuilGros,
      archive: existant?.archive ?? false,
      compatibles,
    } satisfies Record<keyof ProduitSaisi, unknown>);
    if (!saisie.success) return saisie.error.issues.map((i) => i.message);
    const resultat = await enregistrerProduit(ctx, saisie.data);
    if (!resultat.ok) return [resultat.motif];
    return resultat.cree ? 'cree' : 'modifie';
  }

  private async trouverOuCreer(
    trouver: () => Promise<{ id: string } | null>,
    creer: (id: string) => Promise<{ ok: boolean; motif?: string }>,
    erreurs: string[],
  ): Promise<string | null> {
    const trouve = await trouver();
    if (trouve) return trouve.id;
    const id = randomUUID();
    const resultat = await creer(id);
    if (!resultat.ok) {
      erreurs.push(resultat.motif ?? 'Erreur.');
      return null;
    }
    return id;
  }

  /** Classeur modèle : intitulés et deux lignes d'exemple. */
  async modele(): Promise<Buffer> {
    const classeur = new ExcelJS.Workbook();
    const feuille = classeur.addWorksheet('Catalogue');
    feuille.addRow([...COLONNES_IMPORT]);
    feuille.addRow([
      'Téléphone',
      'Téléphones',
      'Samsung',
      'Galaxy A15',
      '',
      '128 Go',
      'Noir',
      'Neuf',
      '',
      12,
      1600000,
      1900000,
      1780000,
      5,
    ]);
    feuille.addRow([
      'Accessoire',
      'Coques',
      '',
      '',
      'Coque anti-casse Galaxy A15',
      '',
      '',
      'Neuf',
      '6200001234567',
      0,
      15000,
      35000,
      27000,
      10,
    ]);
    feuille.getRow(1).font = { bold: true };
    feuille.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await classeur.xlsx.writeBuffer());
  }
}
