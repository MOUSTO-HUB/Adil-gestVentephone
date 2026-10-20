import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCouleurs } from '@/lib/theme';

export interface Option {
  id: string;
  nom: string;
}

/**
 * Choix dans une courte liste (pastilles), avec ajout d'une nouvelle valeur.
 * `multiple` : plusieurs valeurs (ex. modèles compatibles).
 */
export function Choix({
  libelle,
  options,
  valeurs,
  surChoix,
  surAjout,
  multiple = false,
  aucun,
}: {
  libelle: string;
  options: Option[];
  valeurs: string[];
  surChoix: (valeurs: string[]) => void;
  /** Ajout d'une valeur absente de la liste (nom saisi). */
  surAjout?: (nom: string) => void;
  multiple?: boolean;
  /** Libellé de la pastille « aucune valeur » (choix simple facultatif). */
  aucun?: string;
}) {
  const c = useCouleurs();
  const [nouveau, setNouveau] = useState('');

  const basculer = (id: string) => {
    if (multiple) {
      surChoix(valeurs.includes(id) ? valeurs.filter((v) => v !== id) : [...valeurs, id]);
    } else {
      surChoix([id]);
    }
  };

  const pastille = (id: string, nom: string, active: boolean, surAppui: () => void) => (
    <Pressable
      key={id}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={multiple ? { checked: active } : { selected: active }}
      onPress={surAppui}
      style={[
        styles.pastille,
        {
          borderColor: active ? c.bouton : c.bordure,
          backgroundColor: active ? c.bouton : c.carte,
        },
      ]}
    >
      <Text
        style={{
          color: active ? '#ffffff' : c.texte,
          fontSize: 15,
          fontWeight: active ? '700' : '500',
        }}
      >
        {nom}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.bloc}>
      <Text style={[styles.libelle, { color: c.texteDiscret }]}>{libelle}</Text>
      <View style={styles.liste} accessibilityRole={multiple ? undefined : 'radiogroup'}>
        {aucun ? pastille('', aucun, valeurs.length === 0, () => surChoix([])) : null}
        {options.map((o) => pastille(o.id, o.nom, valeurs.includes(o.id), () => basculer(o.id)))}
      </View>
      {surAjout ? (
        <View style={styles.ajout}>
          <TextInput
            value={nouveau}
            onChangeText={setNouveau}
            placeholder="Ajouter…"
            placeholderTextColor={c.texteDiscret}
            accessibilityLabel={`Ajouter : ${libelle}`}
            style={[
              styles.saisie,
              { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
            ]}
            onSubmitEditing={() => {
              if (!nouveau.trim()) return;
              surAjout(nouveau.trim());
              setNouveau('');
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!nouveau.trim()}
            onPress={() => {
              surAjout(nouveau.trim());
              setNouveau('');
            }}
            style={[
              styles.boutonAjout,
              { backgroundColor: c.fondPrimaire, opacity: nouveau.trim() ? 1 : 0.4 },
            ]}
          >
            <Text style={{ color: c.primaire, fontWeight: '700' }}>Ajouter</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: 8 },
  libelle: { fontSize: 14, fontWeight: '600' },
  liste: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pastille: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  ajout: { flexDirection: 'row', gap: 8 },
  saisie: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  boutonAjout: {
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
});
