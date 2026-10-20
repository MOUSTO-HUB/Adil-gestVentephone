import {
  formaterMontant,
  LIBELLES_MOYENS,
  LIBELLES_TYPES_RETOUR,
  type RetourSync,
  type PaiementVenteSync,
  peutGererSessions,
  type VenteSync,
} from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { DocumentsVente } from '@/components/documents-vente';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { confirmer } from '@/lib/confirmer';
import { chargerDocument, lireReglagesImpression } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface Ligne {
  id: string;
  nom: string;
  imei: string | null;
  quantite: number;
  tarif: string;
  prixUnitaire: number;
  total: number;
  finGarantie: string | null;
}

/** Détail d'une vente ; annulation par le gérant ou le propriétaire, avec motif. */
export default function DetailVente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const monnaie = profil?.commerce.monnaie;
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);

  const donnees = useLecture(
    async (b) => ({
      vente: await b.premier<VenteSync & { client: string | null }>(
        'SELECT v.*, c.nom AS client FROM vente v LEFT JOIN client c ON c.id = v.clientId WHERE v.id = ?',
        [id],
      ),
      lignes: await b.tous<Ligne>(
        `SELECT l.id, p.nom, a.imei, l.quantite, l.tarif, l.prixUnitaire, l.total, l.finGarantie
           FROM ligneVente l JOIN produit p ON p.id = l.produitId LEFT JOIN article a ON a.id = l.articleId
          WHERE l.venteId = ?`,
        [id],
      ),
      paiements: await b.tous<PaiementVenteSync>('SELECT * FROM paiementVente WHERE venteId = ?', [
        id,
      ]),
      document:
        profil && boutique
          ? await chargerDocument(b, id, {
              commerce: profil.commerce.nom,
              boutique,
              monnaie: profil.commerce.monnaie,
              fuseau: profil.commerce.fuseau,
            })
          : null,
      reglages: await lireReglagesImpression(b),
      retours: await b.tous<RetourSync & { numeroEchange: string | null }>(
        `SELECT r.*, e.numero AS numeroEchange FROM retour r LEFT JOIN vente e ON e.id = r.venteEchangeId
          WHERE r.venteId = ? ORDER BY r.dateRetour`,
        [id],
      ),
      origine: await b.premier<{ venteId: string; numero: string }>(
        'SELECT r.venteId, v.numero FROM retour r JOIN vente v ON v.id = r.venteId WHERE r.venteEchangeId = ?',
        [id],
      ),
    }),
    [id, profil, boutique],
  );
  if (!donnees)
    return (
      <Ecran titre="Vente" enHaut>
        {null}
      </Ecran>
    );
  const { vente, lignes, paiements, document, reglages, retours, origine } = donnees;
  if (!vente || !boutique) {
    return (
      <Ecran titre="Vente" enHaut>
        <Message texte="Vente introuvable." />
      </Ecran>
    );
  }

  const annuler = async () => {
    setMessage(null);
    if (motif.trim().length < 3) {
      setMessage({ texte: 'Indiquez le motif de l’annulation.', type: 'erreur' });
      return;
    }
    if (
      !(await confirmer(
        `Annuler la vente ${vente.numero} ? Les produits reviennent en stock.`,
        'Annuler la vente',
      ))
    ) {
      return;
    }
    try {
      await enregistrer({
        type: 'VENTE_ANNULER',
        boutiqueId: boutique.id,
        contenu: { venteId: vente.id, motif: motif.trim() },
      });
      setMessage({ texte: 'Vente annulée : les produits sont revenus en stock.', type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    }
  };

  return (
    <Ecran titre={`Facture ${vente.numero}`} sousTitre={vente.client ?? 'Client de passage'} enHaut>
      <Carte>
        <Texte discret>
          {new Date(vente.dateVente).toLocaleString('fr-FR', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
        </Texte>
        {vente.statut === 'ANNULEE' ? (
          <Message texte={`Annulée${vente.motifAnnulation ? ` : ${vente.motifAnnulation}` : ''}`} />
        ) : null}
      </Carte>
      {lignes.map((l) => (
        <Carte key={l.id}>
          <Texte gras>
            {l.quantite} × {l.nom}
          </Texte>
          {l.imei ? <Texte discret>IMEI {l.imei}</Texte> : null}
          <Texte>
            {formaterMontant(l.prixUnitaire, monnaie)}
            {l.tarif === 'GROS' ? ' (gros)' : ''} · {formaterMontant(l.total, monnaie)}
          </Texte>
          {l.finGarantie ? (
            <Texte discret>
              Garantie jusqu’au {new Date(l.finGarantie).toLocaleDateString('fr-FR')}
            </Texte>
          ) : null}
        </Carte>
      ))}
      <Carte>
        {vente.remise > 0 || vente.reprise > 0 ? (
          <Texte>Sous-total : {formaterMontant(vente.sousTotal, monnaie)}</Texte>
        ) : null}
        {vente.remise > 0 ? (
          <Texte>Remise : − {formaterMontant(vente.remise, monnaie)}</Texte>
        ) : null}
        {vente.reprise > 0 ? (
          <Texte>Reprise (échange) : − {formaterMontant(vente.reprise, monnaie)}</Texte>
        ) : null}
        <Texte gras>Total : {formaterMontant(vente.total, monnaie)}</Texte>
        {paiements.map((p) => (
          <Texte key={p.id} discret>
            {LIBELLES_MOYENS[p.moyen]} : {formaterMontant(p.montant, monnaie)}
            {p.reference ? ` (réf. ${p.reference})` : ''}
          </Texte>
        ))}
        {vente.renduMonnaie > 0 ? (
          <Texte discret>Monnaie rendue : {formaterMontant(vente.renduMonnaie, monnaie)}</Texte>
        ) : null}
      </Carte>
      {origine ? (
        <Carte>
          <Texte>Échange de la facture {origine.numero}.</Texte>
          <Bouton
            titre="Voir la vente d’origine"
            variante="secondaire"
            onPress={() =>
              router.push({ pathname: '/vente/[id]', params: { id: origine.venteId } })
            }
          />
        </Carte>
      ) : null}
      {retours.map((r) => (
        <Carte key={r.id}>
          <Texte gras>
            {LIBELLES_TYPES_RETOUR[r.type]} du {new Date(r.dateRetour).toLocaleDateString('fr-FR')}
          </Texte>
          <Texte discret>{r.motif}</Texte>
          <Texte>Valeur rendue : {formaterMontant(r.valeur, monnaie)}</Texte>
          {r.montantRembourse > 0 ? (
            <Texte>
              Remboursé : {formaterMontant(r.montantRembourse, monnaie)}
              {r.moyenRemboursement ? ` (${LIBELLES_MOYENS[r.moyenRemboursement]})` : ''}
            </Texte>
          ) : null}
          {r.avoir > 0 ? <Texte>Avoir : {formaterMontant(r.avoir, monnaie)}</Texte> : null}
          {r.venteEchangeId ? (
            <Bouton
              titre={`Vente d’échange ${r.numeroEchange ?? ''}`}
              variante="secondaire"
              onPress={() =>
                router.push({ pathname: '/vente/[id]', params: { id: r.venteEchangeId! } })
              }
            />
          ) : null}
        </Carte>
      ))}
      {vente.statut === 'VALIDEE' ? (
        <Bouton
          titre="Retour ou échange"
          variante="secondaire"
          onPress={() =>
            router.push({ pathname: '/retour/[venteId]', params: { venteId: vente.id } })
          }
        />
      ) : null}
      {document ? <DocumentsVente document={document} reglages={reglages} /> : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
      {gestion && vente.statut === 'VALIDEE' && !retours.length && !origine ? (
        <Carte>
          <Champ
            libelle="Motif de l’annulation"
            value={motif}
            onChangeText={setMotif}
            placeholder="Erreur de saisie…"
          />
          <Bouton titre="Annuler la vente" variante="danger" onPress={() => void annuler()} />
        </Carte>
      ) : null}
    </Ecran>
  );
}
