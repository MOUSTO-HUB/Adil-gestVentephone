import {
  COEFFICIENTS_REPRISE,
  ETATS_REPRISE,
  type EtatReprise,
  formaterMontant,
  LIBELLES_ETATS_REPRISE,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';
import { montantSaisi } from '@/lib/troc';

interface Modele {
  id: string;
  nom: string;
  lignes: number;
}

const TOUTES = '__toutes__';
const VIDES = Object.fromEntries(ETATS_REPRISE.map((e) => [e, ''])) as Record<EtatReprise, string>;

/**
 * Grille de reprise (propriétaire) : valeur d'un modèle selon son état, pour une
 * capacité ou toutes. Sans grille, le troc propose une part du prix du neuf.
 */
export default function GrilleReprise() {
  const c = useCouleurs();
  const { profil } = useSession();
  const { enregistrer } = useSync();
  const boutiqueId = useSession().boutique?.id ?? '';
  const [recherche, setRecherche] = useState('');
  const [modele, setModele] = useState<{ id: string; nom: string } | null>(null);
  const [capacite, setCapacite] = useState(TOUTES);
  const [valeurs, setValeurs] = useState(VIDES);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);

  const modeles = useLecture(
    (b) =>
      b.tous<Modele>(
        `SELECT mo.id, ma.nom || ' ' || mo.nom AS nom,
                (SELECT COUNT(*) FROM grilleReprise g WHERE g.modeleId = mo.id) AS lignes
           FROM modele mo JOIN marque ma ON ma.id = mo.marqueId
          WHERE ? = '' OR LOWER(ma.nom || ' ' || mo.nom) LIKE ?
          ORDER BY lignes DESC, ma.nom, mo.nom
          LIMIT 30`,
        [recherche.trim(), `%${recherche.trim().toLowerCase()}%`],
      ),
    [recherche],
  );
  const capacites = useLecture(
    async (b) =>
      modele
        ? (
            await b.tous<{ capacite: string }>(
              `SELECT DISTINCT capacite FROM produit
                WHERE modeleId = ? AND type = 'TELEPHONE' AND capacite IS NOT NULL
                ORDER BY capacite`,
              [modele.id],
            )
          ).map((x) => x.capacite)
        : [],
    [modele?.id],
  );
  const choisie = capacite === TOUTES ? null : capacite;
  const lecture = useLecture(
    async (b) => {
      if (!modele) return null;
      const lignes = await b.tous<{ etat: EtatReprise; valeur: number }>(
        `SELECT etat, valeur FROM grilleReprise
          WHERE modeleId = ? AND (capacite = ? OR (capacite IS NULL AND ? IS NULL))`,
        [modele.id, choisie, choisie],
      );
      const prix = await b.premier<{ prixDetail: number }>(
        `SELECT MAX(prixDetail) AS prixDetail FROM produit
          WHERE modeleId = ? AND type = 'TELEPHONE' AND (? IS NULL OR capacite = ?)`,
        [modele.id, choisie, choisie],
      );
      return { lignes, prixNeuf: prix?.prixDetail ?? null, cle: `${modele.id}|${choisie}` };
    },
    [modele?.id, choisie],
  );
  // Les valeurs enregistrées remplissent le formulaire quand on change de modèle ou de capacité.
  const [chargee, setChargee] = useState<string | null>(null);
  if (lecture && lecture.cle !== chargee) {
    setChargee(lecture.cle);
    setValeurs({
      ...VIDES,
      ...Object.fromEntries(lecture.lignes.map((l) => [l.etat, String(l.valeur)])),
    });
  }

  if (!profil)
    return (
      <Ecran titre="Grille de reprise" enHaut>
        {null}
      </Ecran>
    );
  if (profil.role !== 'PROPRIETAIRE') {
    return (
      <Ecran titre="Grille de reprise" enHaut>
        <Message texte="La grille de reprise est fixée par le propriétaire." />
      </Ecran>
    );
  }
  const monnaie = profil.commerce.monnaie;

  const enregistrerGrille = async () => {
    setMessage(null);
    if (!modele) return;
    const lignes = ETATS_REPRISE.flatMap((etat) => {
      const valeur = montantSaisi(valeurs[etat]);
      return valeur > 0 ? [{ id: Crypto.randomUUID(), etat, valeur }] : [];
    });
    if (ETATS_REPRISE.some((etat) => Number.isNaN(montantSaisi(valeurs[etat])))) {
      return setMessage({ texte: 'Montants : nombres entiers attendus.', type: 'erreur' });
    }
    try {
      await enregistrer({
        type: 'GRILLE_REPRISE_ENREGISTRER',
        boutiqueId,
        contenu: { modeleId: modele.id, capacite: choisie, lignes },
      });
      setMessage({
        texte: lignes.length
          ? `Grille de ${modele.nom}${choisie ? ` ${choisie}` : ''} enregistrée.`
          : 'Grille effacée : la reprise sera estimée sur le prix du neuf.',
        type: 'info',
      });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Ecran titre="Grille de reprise" sousTitre="Valeur des téléphones repris en troc" enHaut>
      <Message texte={message?.texte ?? null} type={message?.type} />
      {modele ? (
        <Carte titre={modele.nom} icone="phone-portrait">
          <Choix
            libelle="Capacité"
            options={[
              { id: TOUTES, nom: 'Toutes' },
              ...(capacites ?? []).map((x) => ({ id: x, nom: x })),
            ]}
            valeurs={[capacite]}
            surChoix={([v]) => v && setCapacite(v)}
          />
          {lecture?.prixNeuf ? (
            <Texte discret>
              Prix du neuf : {formaterMontant(lecture.prixNeuf, monnaie)}. Sans grille, la reprise
              proposée est de 60 % (excellent) à 15 % (mauvais) de ce prix.
            </Texte>
          ) : null}
          {ETATS_REPRISE.map((etat) => (
            <View key={etat} style={styles.ligne}>
              <Text style={[styles.etat, { color: c.texte }]}>{LIBELLES_ETATS_REPRISE[etat]}</Text>
              <TextInput
                value={valeurs[etat]}
                onChangeText={(texte) => setValeurs((v) => ({ ...v, [etat]: texte }))}
                placeholder={
                  lecture?.prixNeuf
                    ? `≈ ${Math.floor((lecture.prixNeuf * COEFFICIENTS_REPRISE[etat]) / 5000) * 5000}`
                    : 'Valeur'
                }
                placeholderTextColor={c.texteDiscret}
                keyboardType="number-pad"
                accessibilityLabel={`Valeur de reprise, état ${LIBELLES_ETATS_REPRISE[etat].toLowerCase()}`}
                style={[saisie, { flex: 1 }]}
              />
            </View>
          ))}
          <Texte discret>Laissez vide un état pour l’estimer sur le prix du neuf.</Texte>
          <Bouton
            titre="Enregistrer la grille"
            icone="save"
            onPress={() => void enregistrerGrille()}
          />
          <Bouton
            titre="Choisir un autre modèle"
            variante="secondaire"
            onPress={() => {
              setModele(null);
              setCapacite(TOUTES);
              setChargee(null);
            }}
          />
        </Carte>
      ) : (
        <Carte titre="Modèle" icone="search">
          <TextInput
            value={recherche}
            onChangeText={setRecherche}
            placeholder="Ex. iPhone 13, Samsung A10, Tecno Camon…"
            placeholderTextColor={c.texteDiscret}
            accessibilityLabel="Rechercher un modèle"
            style={saisie}
          />
          {modeles?.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              onPress={() => setModele({ id: m.id, nom: m.nom })}
              style={[styles.resultat, { borderColor: c.bordure }]}
            >
              <Texte>{m.nom}</Texte>
              {m.lignes ? <Texte discret>{m.lignes} valeur(s) fixée(s)</Texte> : null}
            </Pressable>
          ))}
        </Carte>
      )}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etat: { width: 90, fontWeight: '600' },
  resultat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingVertical: 10,
    gap: 8,
  },
});
