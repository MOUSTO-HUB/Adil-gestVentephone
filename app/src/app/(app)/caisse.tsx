import {
  bilanCaisse,
  type CaisseSync,
  ecartsCaisse,
  erreurCloture,
  formaterMontant,
  LIBELLES_MOYENS,
  type Montants,
  montantsVides,
  MOYENS_REMBOURSEMENT,
  peutGererSessions,
  totalMontants,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { caisseOuverte, mouvementsCaisse } from '@/lib/caisse-session';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

const STATUTS: Record<CaisseSync['statut'], string> = {
  OUVERTE: 'Ouverte',
  CLOTUREE: 'À valider',
  VALIDEE: 'Validée',
};

const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return propre === '' ? 0 : /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};
const avecSigne = (v: number, monnaie?: string) =>
  `${v > 0 ? '+' : ''}${formaterMontant(v, monnaie)}`;

/**
 * Caisse du jour : ouverture avec fond de caisse, suivi de ce qui est encaissé,
 * clôture par comptage de chaque moyen de paiement. Fonctionne hors ligne.
 */
export default function Caisse() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const boutiqueId = boutique?.id ?? '';
  const gestion = !!profil && peutGererSessions(profil.role);
  const [fond, setFond] = useState('');
  const [comptage, setComptage] = useState<Record<string, string>>({});
  const [commentaire, setCommentaire] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (b) => {
      const ouverte = profil ? await caisseOuverte(b, boutiqueId, profil.id) : null;
      return {
        ouverte,
        bilan: ouverte ? bilanCaisse(await mouvementsCaisse(b, ouverte.id)) : null,
        historique: await b.tous<{
          id: string;
          vendeur: string;
          statut: CaisseSync['statut'];
          ouverteLe: string;
          ecart: number | null;
        }>(
          `SELECT id, vendeur, statut, ouverteLe, ecart FROM caisse
            WHERE boutiqueId = ? AND (? = 1 OR utilisateurId = ?)
            ORDER BY (statut = 'CLOTUREE') DESC, ouverteLe DESC LIMIT 30`,
          [boutiqueId, gestion ? 1 : 0, profil?.id ?? ''],
        ),
      };
    },
    [boutiqueId, profil?.id, gestion],
  );

  if (!profil || !boutique || !donnees) {
    return (
      <Ecran titre="Caisse" enHaut>
        {null}
      </Ecran>
    );
  }
  const { ouverte, bilan, historique } = donnees;

  const ouvrir = async () => {
    setMessage(null);
    const montant = entier(fond);
    if (Number.isNaN(montant)) return setMessage('Fond de caisse : nombre entier attendu.');
    setEnvoi(true);
    try {
      await enregistrer({
        type: 'CAISSE_OUVRIR',
        boutiqueId,
        contenu: {
          id: Crypto.randomUUID(),
          ouverteLe: new Date().toISOString(),
          fondInitial: montant,
        },
      });
      setFond('');
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const compte: Montants = montantsVides();
  for (const k of MOYENS_REMBOURSEMENT) compte[k] = entier(comptage[k] ?? '');
  const comptageValide = MOYENS_REMBOURSEMENT.every((k) => !Number.isNaN(compte[k]));
  // L'écart s'affiche dès que le comptage commence (un moyen laissé vide compte pour 0).
  const comptageCommence = MOYENS_REMBOURSEMENT.some((k) => (comptage[k] ?? '') !== '');
  const ecarts =
    bilan && comptageValide && comptageCommence ? ecartsCaisse(bilan.theorique, compte) : null;

  const cloturer = async () => {
    if (!ouverte || !bilan) return;
    setMessage(null);
    if (!comptageCommence) return setMessage('Saisissez le montant compté de chaque moyen.');
    if (!comptageValide || !ecarts) return setMessage('Comptage : nombres entiers attendus.');
    const erreur = erreurCloture(ecarts.parMoyen, commentaire);
    if (erreur) return setMessage(erreur);
    if (
      !(await confirmer(
        `Clôturer la caisse ? Écart : ${avecSigne(ecarts.total, monnaie)}.`,
        'Clôturer',
      ))
    ) {
      return;
    }
    setEnvoi(true);
    try {
      await enregistrer({
        type: 'CAISSE_CLOTURER',
        boutiqueId,
        contenu: {
          caisseId: ouverte.id,
          clotureeLe: new Date().toISOString(),
          comptage: compte,
          commentaire: commentaire.trim() || null,
        },
      });
      setComptage({});
      setCommentaire('');
      router.push({ pathname: '/caisse/[id]', params: { id: ouverte.id } });
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const saisie = [
    styles.saisie,
    { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
  ];

  return (
    <Ecran titre="Caisse" sousTitre={`${boutique.nom} · ${profil.nom}`} enHaut>
      {!ouverte ? (
        <Carte>
          <Texte gras>Ouvrir la caisse du jour</Texte>
          <Texte discret>Comptez l’argent présent dans le tiroir avant la première vente.</Texte>
          <Champ
            libelle="Fond de caisse (espèces)"
            value={fond}
            onChangeText={setFond}
            keyboardType="number-pad"
            placeholder="0"
          />
          <Bouton titre="Ouvrir la caisse" chargement={envoi} onPress={() => void ouvrir()} />
        </Carte>
      ) : null}

      {ouverte && bilan ? (
        <>
          <Carte>
            <Texte gras>
              Caisse ouverte le{' '}
              {new Date(ouverte.ouverteLe).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </Texte>
            <Texte>
              Fond : {formaterMontant(ouverte.fondInitial, monnaie)} · {bilan.nombreVentes} vente(s)
            </Texte>
            {MOYENS_REMBOURSEMENT.map((k) =>
              bilan.encaisse[k] || bilan.rembourse[k] || bilan.depense[k] || bilan.theorique[k] ? (
                <Texte key={k} discret>
                  {LIBELLES_MOYENS[k]} : encaissé {formaterMontant(bilan.encaisse[k], monnaie)}
                  {bilan.rembourse[k]
                    ? ` · remboursé ${formaterMontant(bilan.rembourse[k], monnaie)}`
                    : ''}
                  {bilan.depense[k]
                    ? ` · dépenses ${formaterMontant(bilan.depense[k], monnaie)}`
                    : ''}
                  {` · attendu ${formaterMontant(bilan.theorique[k], monnaie)}`}
                </Texte>
              ) : null,
            )}
          </Carte>

          <Carte>
            <Texte gras>Clôture : comptez chaque moyen de paiement</Texte>
            {MOYENS_REMBOURSEMENT.map((k) => (
              <View key={k} style={styles.ligne}>
                <Text style={{ color: colors.text, width: 120 }}>{LIBELLES_MOYENS[k]}</Text>
                <TextInput
                  value={comptage[k] ?? ''}
                  onChangeText={(v) => setComptage((c) => ({ ...c, [k]: v }))}
                  keyboardType="number-pad"
                  placeholder={String(bilan.theorique[k])}
                  placeholderTextColor="#8a8a8a"
                  accessibilityLabel={`Montant compté en ${LIBELLES_MOYENS[k]}`}
                  style={[saisie, { flex: 1, minWidth: 110 }]}
                />
                {ecarts && comptage[k] !== undefined && comptage[k] !== '' ? (
                  <Text
                    style={{
                      color: ecarts.parMoyen[k] ? colors.notification : colors.text,
                      fontWeight: '700',
                      minWidth: 90,
                      textAlign: 'right',
                    }}
                  >
                    {avecSigne(ecarts.parMoyen[k], monnaie)}
                  </Text>
                ) : null}
              </View>
            ))}
            <Texte gras>
              Attendu : {formaterMontant(totalMontants(bilan.theorique), monnaie)}
              {ecarts ? ` · compté ${formaterMontant(totalMontants(compte), monnaie)}` : ''}
            </Texte>
            {ecarts ? <Texte gras>Écart : {avecSigne(ecarts.total, monnaie)}</Texte> : null}
            <Champ
              libelle="Commentaire (obligatoire en cas d’écart)"
              value={commentaire}
              onChangeText={setCommentaire}
            />
            <Bouton
              titre="Clôturer la caisse"
              variante="danger"
              chargement={envoi}
              onPress={() => void cloturer()}
            />
          </Carte>
        </>
      ) : null}
      <Message texte={message} />

      {historique.length ? <Texte gras>Caisses</Texte> : null}
      {historique.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/caisse/[id]', params: { id: c.id } })}
          style={[styles.historique, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {new Date(c.ouverteLe).toLocaleDateString('fr-FR')} · {c.vendeur}
            </Text>
            <Text style={{ color: colors.text, opacity: 0.65 }}>{STATUTS[c.statut]}</Text>
          </View>
          {c.ecart !== null ? (
            <Text style={{ color: c.ecart ? colors.notification : colors.text, fontWeight: '700' }}>
              {avecSigne(c.ecart, monnaie)}
            </Text>
          ) : null}
        </Pressable>
      ))}
      <Bouton titre="Dépenses" variante="secondaire" onPress={() => router.push('/depenses')} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  historique: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
});
