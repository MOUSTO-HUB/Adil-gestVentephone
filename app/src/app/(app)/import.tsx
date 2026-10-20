import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';

const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Rapport {
  simulation: boolean;
  lignes: number;
  crees: number;
  modifies: number;
  erreurs: { ligne: number; messages: string[] }[];
}

interface Fichier {
  nom: string;
  uri: string;
  web?: File;
}

/**
 * Import du catalogue depuis Excel (en ligne) : un premier envoi vérifie le fichier
 * sans rien enregistrer, puis l'utilisateur confirme l'import.
 */
export default function ImportCatalogue() {
  const { api } = useSession();
  const { synchroniser } = useSync();
  const [fichier, setFichier] = useState<Fichier | null>(null);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const choisir = async () => {
    setErreur(null);
    setRapport(null);
    const resultat = await DocumentPicker.getDocumentAsync({
      type: [TYPE_XLSX],
      copyToCacheDirectory: true,
    });
    if (resultat.canceled || !resultat.assets[0]) return;
    const a = resultat.assets[0];
    const choisi = { nom: a.name, uri: a.uri, web: a.file };
    setFichier(choisi);
    await envoyer(choisi, true);
  };

  const envoyer = async (f: Fichier, simulation: boolean) => {
    setEnvoi(true);
    setErreur(null);
    try {
      const formulaire = new FormData();
      if (f.web) formulaire.append('fichier', f.web, f.nom);
      else
        formulaire.append('fichier', {
          uri: f.uri,
          name: f.nom,
          type: TYPE_XLSX,
        } as unknown as Blob);
      const r = await api.requete<Rapport>(`/catalogue/import?simulation=${simulation}`, {
        methode: 'POST',
        corps: formulaire,
      });
      setRapport(r);
      if (!simulation) synchroniser();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const telechargerModele = async () => {
    try {
      const blob = await api.requete<Blob>('/catalogue/import/modele', { fichier: true });
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(blob);
      lien.download = 'modele-catalogue.xlsx';
      lien.click();
      URL.revokeObjectURL(lien.href);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  return (
    <Ecran
      titre="Importer le catalogue"
      sousTitre="Un classeur Excel (.xlsx), une ligne par produit. Nécessite Internet."
      enHaut
    >
      <Carte>
        <Texte gras>Colonnes</Texte>
        <Texte discret>
          Type (Téléphone ou Accessoire), Catégorie, Marque, Modèle, Nom, Capacité, Couleur, État
          (Neuf ou Occasion), Code-barres, Garantie (mois), Prix d’achat, Prix de détail, Prix de
          gros, Seuil de gros.
        </Texte>
        <Texte discret>
          Un produit existant (même code-barres, sinon même nom) est mis à jour. Les catégories,
          marques et modèles manquants sont créés.
        </Texte>
      </Carte>
      {Platform.OS === 'web' ? (
        <Bouton
          titre="Télécharger le modèle"
          variante="secondaire"
          onPress={() => void telechargerModele()}
        />
      ) : null}
      <Bouton
        titre={fichier ? 'Choisir un autre fichier' : 'Choisir le fichier'}
        onPress={() => void choisir()}
        chargement={envoi && !rapport}
      />
      {fichier ? <Texte discret>Fichier : {fichier.nom}</Texte> : null}
      <Message texte={erreur} />

      {rapport ? (
        <Carte>
          <Texte gras>
            {rapport.simulation ? 'Vérification (rien n’est encore enregistré)' : 'Import terminé'}
          </Texte>
          <Texte>
            {rapport.lignes} ligne(s) : {rapport.crees} produit(s){' '}
            {rapport.simulation ? 'à créer' : 'créé(s)'}, {rapport.modifies}{' '}
            {rapport.simulation ? 'à mettre à jour' : 'mis à jour'}, {rapport.erreurs.length} en
            erreur.
          </Texte>
          {rapport.erreurs.slice(0, 50).map((e) => (
            <Message key={e.ligne} texte={`Ligne ${e.ligne} : ${e.messages.join(' ')}`} />
          ))}
          {rapport.erreurs.length > 50 ? (
            <Texte discret>… et {rapport.erreurs.length - 50} autres.</Texte>
          ) : null}
        </Carte>
      ) : null}
      {rapport?.simulation && fichier && rapport.crees + rapport.modifies > 0 ? (
        <Bouton
          titre={`Importer ${rapport.crees + rapport.modifies} produit(s)${rapport.erreurs.length ? ' (lignes en erreur ignorées)' : ''}`}
          onPress={() => void envoyer(fichier, false)}
          chargement={envoi}
        />
      ) : null}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
