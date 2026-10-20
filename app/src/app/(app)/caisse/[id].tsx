import { lignesRapportCaisse, peutGererSessions } from '@gestvente/commun';
import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { ImpressionCaisse } from '@/components/impression-caisse';
import { Bouton, Carte, Champ, Ecran, Message } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { lireCaisse, rapportCaisse } from '@/lib/caisse-session';
import { FUSEAU_PAR_DEFAUT, lireReglagesImpression } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

/** Rapport d'une caisse (aperçu du ticket), impression et validation par la gestion. */
export default function DetailCaisse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const [commentaire, setCommentaire] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);

  const donnees = useLecture(
    async (b) => {
      const caisse = await lireCaisse(b, id);
      return {
        caisse,
        rapport:
          caisse && profil && boutique
            ? await rapportCaisse(b, caisse, {
                commerce: profil.commerce.nom,
                boutique: boutique.nom,
                monnaie: profil.commerce.monnaie,
                fuseau: profil.commerce.fuseau ?? FUSEAU_PAR_DEFAUT,
              })
            : null,
        reglages: await lireReglagesImpression(b),
      };
    },
    [id, profil, boutique],
  );
  if (!donnees) {
    return (
      <Ecran titre="Caisse" enHaut>
        {null}
      </Ecran>
    );
  }
  const { caisse, rapport, reglages } = donnees;
  if (!caisse || !rapport || !boutique) {
    return (
      <Ecran titre="Caisse" enHaut>
        <Message texte="Caisse introuvable." />
        <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      </Ecran>
    );
  }

  const valider = async () => {
    setMessage(null);
    try {
      await enregistrer({
        type: 'CAISSE_VALIDER',
        boutiqueId: boutique.id,
        contenu: { caisseId: caisse.id, commentaire: commentaire.trim() || null },
      });
      setMessage({ texte: 'Caisse validée.', type: 'info' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  return (
    <Ecran titre="Caisse" sousTitre={caisse.vendeur} enHaut>
      <Carte>
        <View accessibilityLabel="Aperçu du ticket de clôture">
          {lignesRapportCaisse(rapport, 80).map((l, i) => (
            <Text
              key={i}
              style={[
                styles.ticket,
                {
                  color: colors.text,
                  textAlign: l.centre ? 'center' : 'left',
                  fontWeight: l.gras ? '700' : '400',
                },
              ]}
            >
              {l.texte || ' '}
            </Text>
          ))}
        </View>
      </Carte>
      {caisse.statut !== 'OUVERTE' ? (
        <ImpressionCaisse rapport={rapport} reglages={reglages} />
      ) : null}
      {gestion && caisse.statut === 'CLOTUREE' ? (
        <Carte>
          <Champ
            libelle="Remarque (facultatif)"
            value={commentaire}
            onChangeText={setCommentaire}
            placeholder="Écart retenu sur la paie…"
          />
          <Bouton titre="Valider la caisse" onPress={() => void valider()} />
        </Carte>
      ) : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ticket: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
  },
});
