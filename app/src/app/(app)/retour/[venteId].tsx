import {
  bilanRetour,
  controlerPaiements,
  DESTINATIONS_RETOUR,
  type DestinationRetour,
  erreurConditionsRetour,
  ETATS_RETOUR,
  type EtatRetour,
  formaterMontant,
  LIBELLES_DESTINATIONS,
  LIBELLES_ETATS_RETOUR,
  LIBELLES_MOYENS,
  LIBELLES_TYPES_RETOUR,
  MOYENS_REMBOURSEMENT,
  type MoyenRemboursement,
  moyenAvecReference,
  quantiteRetournable,
  TYPES_RETOUR,
  type TypeRetour,
  valeurRetour,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChoixArticles } from '@/components/choix-articles';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { caisseOuverte } from '@/lib/caisse-session';
import { type ArticlePanier, prixDuPanier, prochainNumeroFacture } from '@/lib/panier';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface LigneVendue {
  id: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  imei: string | null;
  quantite: number;
  prixUnitaire: number;
  finGarantie: string | null;
  dejaRendu: number;
}

interface Rendu {
  quantite: number;
  destination: DestinationRetour;
  prixRevente: string;
}

const DELAI_PAR_DEFAUT = 7;
const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return propre === '' ? 0 : /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};
const options = <T extends string>(valeurs: readonly T[], libelles: Record<T, string>) =>
  valeurs.map((id) => ({ id, nom: libelles[id] }));

/**
 * Retour ou échange d'articles d'une vente : articles rendus et leur devenir, état de
 * l'appareil, remboursement, avoir ou échange (différence payée ou rendue). Un vendeur
 * fait valider par le PIN du gérant.
 */
export default function NouveauRetour() {
  const { venteId } = useLocalSearchParams<{ venteId: string }>();
  const { colors } = useTheme();
  const { profil, boutique, api } = useSession();
  const { base, enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const boutiqueId = boutique?.id ?? '';
  const [rendus, setRendus] = useState<Record<string, Rendu>>({});
  const [etat, setEtat] = useState<EtatRetour>('INTACT');
  const [type, setType] = useState<TypeRetour>('REMBOURSEMENT');
  const [motif, setMotif] = useState('');
  const [moyen, setMoyen] = useState<MoyenRemboursement>('ESPECES');
  const [reference, setReference] = useState('');
  const [articles, setArticles] = useState<ArticlePanier[]>([]);
  const [moyenPaiement, setMoyenPaiement] = useState<MoyenRemboursement>('ESPECES');
  const [montantPaye, setMontantPaye] = useState('');
  const [referencePaiement, setReferencePaiement] = useState('');
  const [gerantId, setGerantId] = useState('');
  const [gerantPin, setGerantPin] = useState('');
  const [validation, setValidation] = useState<{ jeton: string; gerant: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (b) => ({
      vente: await b.premier<{
        numero: string;
        dateVente: string;
        statut: string;
        sousTotal: number;
        remise: number;
        clientId: string | null;
        clientNom: string | null;
        clientType: string | null;
      }>(
        `SELECT v.numero, v.dateVente, v.statut, v.sousTotal, v.remise, v.clientId,
                c.nom AS clientNom, c.type AS clientType
           FROM vente v LEFT JOIN client c ON c.id = v.clientId WHERE v.id = ?`,
        [venteId],
      ),
      caisse: profil ? await caisseOuverte(b, boutiqueId, profil.id) : null,
      lignes: await b.tous<LigneVendue>(
        `SELECT l.id, p.nom, p.type, a.imei, l.quantite, l.prixUnitaire, l.finGarantie,
                (SELECT COALESCE(SUM(r.quantite), 0) FROM ligneRetour r WHERE r.ligneVenteId = l.id) AS dejaRendu
           FROM ligneVente l JOIN produit p ON p.id = l.produitId LEFT JOIN article a ON a.id = l.articleId
          WHERE l.venteId = ? ORDER BY p.type DESC, p.nom`,
        [venteId],
      ),
    }),
    [venteId, boutiqueId, profil?.id],
  );

  if (!profil || !boutique || !base || !donnees) {
    return (
      <Ecran titre="Retour" enHaut>
        {null}
      </Ecran>
    );
  }
  const { vente, lignes, caisse } = donnees;
  if (!vente || vente.statut !== 'VALIDEE') {
    return (
      <Ecran titre="Retour" enHaut>
        <Message texte="Vente introuvable ou annulée." />
      </Ecran>
    );
  }

  const maintenant = new Date();
  const choisies = lignes.filter((l) => rendus[l.id]);
  const valeur = choisies.reduce((t, l) => t + valeurRetour(l, rendus[l.id]!.quantite, vente), 0);
  const sousGarantie = choisies.every(
    (l) => l.finGarantie !== null && new Date(l.finGarantie) >= maintenant,
  );
  const delaiJours = profil.commerce.delaiRetourJours ?? DELAI_PAR_DEFAUT;
  const condition = choisies.length
    ? erreurConditionsRetour({
        dateVente: new Date(vente.dateVente),
        dateRetour: maintenant,
        delaiJours,
        etat,
        type,
        sousGarantie,
      })
    : null;
  const echange = prixDuPanier(articles, vente.clientType === 'GROSSISTE', 0);
  const bilan = bilanRetour(type, valeur, type === 'ECHANGE' ? echange.total : 0);
  const vendeur = profil.role === 'VENDEUR';
  const types = TYPES_RETOUR.filter((t) => t !== 'AVOIR' || vente.clientId);

  const basculer = (l: LigneVendue) =>
    setRendus((r) => {
      const { [l.id]: present, ...autres } = r;
      return present
        ? autres
        : {
            ...r,
            [l.id]: {
              quantite: quantiteRetournable(l.quantite, l.dejaRendu),
              destination: etat === 'INTACT' ? 'REMISE_EN_STOCK' : 'REBUT',
              prixRevente: '',
            },
          };
    });
  const modifier = (id: string, changement: Partial<Rendu>) =>
    setRendus((r) => ({ ...r, [id]: { ...r[id]!, ...changement } }));

  const faireValider = async () => {
    setMessage(null);
    try {
      setValidation(
        await api.requete<{ jeton: string; gerant: string }>('/ventes/autorisations-retour', {
          methode: 'POST',
          corps: { boutiqueId, identifiant: gerantId, pin: gerantPin, venteId },
        }),
      );
      setGerantPin('');
    } catch (e) {
      setMessage(messageErreur(e));
    }
  };

  const valider = async () => {
    setMessage(null);
    if (!choisies.length) return setMessage('Choisissez les articles rendus.');
    if (!caisse) return setMessage('Ouvrez votre caisse avant un retour ou un échange.');
    if (condition) return setMessage(condition);
    if (motif.trim().length < 3) return setMessage('Indiquez le motif du retour.');
    for (const l of choisies) {
      const r = rendus[l.id]!;
      if (r.destination === 'OCCASION' && !(entier(r.prixRevente) > 0)) {
        return setMessage(`« ${l.nom} » : indiquez le prix de revente d’occasion.`);
      }
    }
    if (type === 'ECHANGE' && !articles.length) {
      return setMessage('Échange : ajoutez les articles remis au client.');
    }
    if (bilan.aRendre > 0 && moyenAvecReference(moyen) && !reference.trim()) {
      return setMessage(`${LIBELLES_MOYENS[moyen]} : saisissez la référence du remboursement.`);
    }
    const paiements =
      bilan.aPayer > 0
        ? [
            {
              moyen: moyenPaiement,
              montant: entier(montantPaye || String(bilan.aPayer)),
              reference: referencePaiement.trim() || null,
            },
          ]
        : [];
    if (paiements.some((p) => Number.isNaN(p.montant))) {
      return setMessage('Montant payé : nombre entier attendu.');
    }
    const controle = controlerPaiements(bilan.aPayer, paiements);
    if (!controle.ok) return setMessage(controle.motif);
    if (vendeur && !validation) {
      return setMessage('Un gérant doit valider ce retour avec son code PIN.');
    }
    setEnvoi(true);
    try {
      const echangeContenu =
        type === 'ECHANGE'
          ? {
              id: Crypto.randomUUID(),
              numero: await prochainNumeroFacture(
                base,
                boutique.prefixe,
                profil.appareilId,
                profil.dernierOrdreFacture,
              ),
              dateVente: maintenant.toISOString(),
              clientId: vente.clientId,
              lignes: echange.lignes.map((l) => ({
                id: Crypto.randomUUID(),
                produitId: l.produitId,
                articleId: l.articleId,
                quantite: l.quantite,
                tarif: l.tarif,
                prixUnitaire: l.prixUnitaire,
              })),
              remise: 0,
              paiements: paiements.map((p) => ({ ...p, id: Crypto.randomUUID() })),
              autorisationRemise: null,
              caisseId: caisse.id,
            }
          : null;
      await enregistrer({
        type: 'RETOUR_ENREGISTRER',
        boutiqueId,
        contenu: {
          id: Crypto.randomUUID(),
          venteId,
          dateRetour: maintenant.toISOString(),
          type,
          etatAppareil: etat,
          motif: motif.trim(),
          lignes: choisies.map((l) => {
            const r = rendus[l.id]!;
            return {
              id: Crypto.randomUUID(),
              ligneVenteId: l.id,
              quantite: r.quantite,
              destination: r.destination,
              prixRevente: r.destination === 'OCCASION' ? entier(r.prixRevente) : null,
            };
          }),
          remboursement: bilan.aRendre > 0 ? { moyen, reference: reference.trim() || null } : null,
          echange: echangeContenu,
          autorisation: validation?.jeton ?? null,
          caisseId: caisse.id,
        },
      });
      router.replace({
        pathname: '/vente/[id]',
        params: { id: echangeContenu?.id ?? venteId },
      });
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
    <Ecran
      titre="Retour ou échange"
      sousTitre={`Facture ${vente.numero} · ${vente.clientNom ?? 'client de passage'}`}
      enHaut
    >
      <Texte discret>
        Vendue le {new Date(vente.dateVente).toLocaleDateString('fr-FR')} · délai de retour :{' '}
        {delaiJours} jours.
      </Texte>

      <Carte>
        <Texte gras>Articles rendus</Texte>
        {lignes.map((l) => {
          const restant = quantiteRetournable(l.quantite, l.dejaRendu);
          const r = rendus[l.id];
          return (
            <View key={l.id} style={styles.article}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!r, disabled: restant === 0 }}
                disabled={restant === 0}
                onPress={() => basculer(l)}
                style={[
                  styles.case,
                  {
                    borderColor: colors.primary,
                    backgroundColor: r ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: r ? '#ffffff' : colors.primary, fontWeight: '700' }}>
                  {r ? '✓' : ''}
                </Text>
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: '600', opacity: restant ? 1 : 0.5 }}>
                  {l.quantite} × {l.nom} · {formaterMontant(l.prixUnitaire, monnaie)}
                </Text>
                {l.imei ? <Texte discret>IMEI {l.imei}</Texte> : null}
                {l.dejaRendu ? <Texte discret>Déjà rendu : {l.dejaRendu}</Texte> : null}
                {r ? (
                  <>
                    {l.type === 'ACCESSOIRE' && restant > 1 ? (
                      <View style={styles.quantite}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Un de moins"
                          onPress={() => modifier(l.id, { quantite: Math.max(1, r.quantite - 1) })}
                        >
                          <Text style={[styles.bouton, { color: colors.primary }]}>−</Text>
                        </Pressable>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{r.quantite}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Un de plus"
                          onPress={() =>
                            modifier(l.id, { quantite: Math.min(restant, r.quantite + 1) })
                          }
                        >
                          <Text style={[styles.bouton, { color: colors.primary }]}>+</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    <Choix
                      libelle="Devenir"
                      options={options(
                        DESTINATIONS_RETOUR.filter(
                          (d) => d !== 'OCCASION' || l.type === 'TELEPHONE',
                        ),
                        LIBELLES_DESTINATIONS,
                      )}
                      valeurs={[r.destination]}
                      surChoix={([d]) =>
                        d && modifier(l.id, { destination: d as DestinationRetour })
                      }
                    />
                    {r.destination === 'OCCASION' ? (
                      <TextInput
                        value={r.prixRevente}
                        onChangeText={(prixRevente) => modifier(l.id, { prixRevente })}
                        keyboardType="number-pad"
                        placeholder="Prix de revente d’occasion"
                        placeholderTextColor="#8a8a8a"
                        accessibilityLabel={`Prix de revente d’occasion de ${l.nom}`}
                        style={saisie}
                      />
                    ) : null}
                    <Texte discret>
                      Valeur rendue : {formaterMontant(valeurRetour(l, r.quantite, vente), monnaie)}
                    </Texte>
                  </>
                ) : null}
              </View>
            </View>
          );
        })}
      </Carte>

      <Choix
        libelle="État de l’appareil"
        options={options(ETATS_RETOUR, LIBELLES_ETATS_RETOUR)}
        valeurs={[etat]}
        surChoix={([e]) => e && setEtat(e as EtatRetour)}
      />
      <Choix
        libelle="Le client reçoit"
        options={options(types, LIBELLES_TYPES_RETOUR)}
        valeurs={[type]}
        surChoix={([t]) => t && setType(t as TypeRetour)}
      />
      <Champ
        libelle="Motif"
        value={motif}
        onChangeText={setMotif}
        placeholder="Écran défectueux, erreur de modèle…"
      />
      <Message texte={condition} />

      {type === 'ECHANGE' ? (
        <ChoixArticles
          boutiqueId={boutiqueId}
          monnaie={monnaie}
          articles={articles}
          setArticles={setArticles}
          lignes={echange.lignes}
          titre="Articles remis au client"
        />
      ) : null}

      <Carte>
        <Texte gras>Valeur des articles rendus : {formaterMontant(valeur, monnaie)}</Texte>
        {type === 'ECHANGE' ? (
          <Texte>Nouveaux articles : {formaterMontant(echange.total, monnaie)}</Texte>
        ) : null}
        {bilan.avoir > 0 ? (
          <Texte gras>
            Avoir pour {vente.clientNom} : {formaterMontant(bilan.avoir, monnaie)}
          </Texte>
        ) : null}
        {bilan.aPayer > 0 ? (
          <>
            <Texte gras>Le client paie : {formaterMontant(bilan.aPayer, monnaie)}</Texte>
            <Choix
              libelle="Paiement"
              options={options(MOYENS_REMBOURSEMENT, LIBELLES_MOYENS)}
              valeurs={[moyenPaiement]}
              surChoix={([m]) => m && setMoyenPaiement(m as MoyenRemboursement)}
            />
            <TextInput
              value={montantPaye}
              onChangeText={setMontantPaye}
              keyboardType="number-pad"
              placeholder={String(bilan.aPayer)}
              placeholderTextColor="#8a8a8a"
              accessibilityLabel="Montant payé par le client"
              style={saisie}
            />
            {moyenAvecReference(moyenPaiement) ? (
              <TextInput
                value={referencePaiement}
                onChangeText={setReferencePaiement}
                placeholder="Référence de la transaction"
                placeholderTextColor="#8a8a8a"
                style={saisie}
              />
            ) : null}
          </>
        ) : null}
        {bilan.aRendre > 0 ? (
          <>
            <Texte gras>À rendre au client : {formaterMontant(bilan.aRendre, monnaie)}</Texte>
            <Choix
              libelle="Remboursé en"
              options={options(MOYENS_REMBOURSEMENT, LIBELLES_MOYENS)}
              valeurs={[moyen]}
              surChoix={([m]) => m && setMoyen(m as MoyenRemboursement)}
            />
            {moyenAvecReference(moyen) ? (
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="Référence du remboursement"
                placeholderTextColor="#8a8a8a"
                style={saisie}
              />
            ) : null}
          </>
        ) : null}
      </Carte>

      {vendeur ? (
        <Carte>
          <Texte gras>Validation du gérant</Texte>
          {validation ? (
            <Texte>Validé par {validation.gerant}.</Texte>
          ) : (
            <>
              <Texte discret>Le gérant saisit son code PIN (connexion nécessaire).</Texte>
              <TextInput
                value={gerantId}
                onChangeText={setGerantId}
                placeholder="Identifiant du gérant"
                placeholderTextColor="#8a8a8a"
                autoCapitalize="none"
                style={saisie}
              />
              <TextInput
                value={gerantPin}
                onChangeText={setGerantPin}
                placeholder="Code PIN du gérant"
                placeholderTextColor="#8a8a8a"
                keyboardType="number-pad"
                secureTextEntry
                style={saisie}
              />
              <Bouton
                titre="Faire valider"
                variante="secondaire"
                onPress={() => void faireValider()}
              />
            </>
          )}
        </Carte>
      ) : null}

      {!caisse ? (
        <Carte>
          <Texte gras>Caisse fermée</Texte>
          <Bouton titre="Ouvrir la caisse" onPress={() => router.push('/caisse')} />
        </Carte>
      ) : null}
      <Message texte={message} />
      <Bouton
        titre="Valider le retour"
        chargement={envoi}
        desactive={!choisies.length || !!condition}
        onPress={() => void valider()}
      />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  article: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6 },
  case: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantite: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bouton: { fontSize: 24, fontWeight: '700', paddingHorizontal: 6 },
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
});
