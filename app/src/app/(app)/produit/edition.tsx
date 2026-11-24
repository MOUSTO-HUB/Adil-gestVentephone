import {
  type CategorieSync,
  type FournisseurSync,
  nomPropose,
  type ProduitSync,
  schemaFournisseur,
  schemaProduit,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Choix } from '@/components/choix';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Carte, Champ, Ecran, ListeDeroulante, Message, Texte } from '@/components/ui';
import { numeroAchat } from '@/lib/achats';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

type Type = 'TELEPHONE' | 'ACCESSOIRE';

interface Donnees {
  produit: ProduitSync | null;
  compatibles: string[];
  categories: CategorieSync[];
  marques: { id: string; nom: string }[];
  modeles: { id: string; marqueId: string; nom: string; marque: string }[];
}

/** Création (sans id) ou modification d'une fiche produit ; propriétaire et gérants. */
export default function EditionProduit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const donnees = useLecture<Donnees>(
    async (base) => ({
      produit: id
        ? await base.premier<ProduitSync>('SELECT * FROM produit WHERE id = ?', [id])
        : null,
      compatibles: id
        ? (
            await base.tous<{ modeleId: string }>(
              'SELECT modeleId FROM compatibilite WHERE accessoireId = ?',
              [id],
            )
          ).map((c) => c.modeleId)
        : [],
      categories: await base.tous<CategorieSync>('SELECT * FROM categorie ORDER BY nom'),
      marques: await base.tous('SELECT id, nom FROM marque ORDER BY nom'),
      modeles: await base.tous(
        'SELECT m.id, m.marqueId, m.nom, ma.nom AS marque FROM modele m JOIN marque ma ON ma.id = m.marqueId ORDER BY ma.nom, m.nom',
      ),
    }),
    [id],
  );

  if (!donnees) {
    return (
      <Ecran titre="Fiche produit" enHaut>
        <Texte discret>Chargement…</Texte>
      </Ecran>
    );
  }
  if (id && !donnees.produit) {
    return (
      <Ecran titre="Fiche produit" enHaut>
        <Message texte="Produit introuvable." />
      </Ecran>
    );
  }
  return <Formulaire donnees={donnees} />;
}

const texte = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Nombre entier saisi (espaces de milliers acceptés) ; null si vide ; NaN si invalide. */
function lireEntier(valeur: string): number | null {
  const propre = valeur.replace(/[\s ]/g, '');
  if (!propre) return null;
  return /^-?\d+$/.test(propre) ? Number(propre) : Number.NaN;
}

const NOUVEAU = '__nouveau__';

function Formulaire({ donnees }: { donnees: Donnees }) {
  const { boutique } = useSession();
  const { enregistrer } = useSync();
  const p = donnees.produit;
  const [type, setType] = useState<Type>(p?.type ?? 'TELEPHONE');
  const [categories, setCategories] = useState(donnees.categories);
  const [marques, setMarques] = useState(donnees.marques);
  const [modeles, setModeles] = useState(donnees.modeles);
  const [nouveaux, setNouveaux] = useState<
    { type: 'CATEGORIE' | 'MARQUE' | 'MODELE'; id: string }[]
  >([]);
  const [categorieId, setCategorieId] = useState(p?.categorieId ?? '');
  const [marqueId, setMarqueId] = useState(p?.marqueId ?? '');
  const [modeleId, setModeleId] = useState(p?.modeleId ?? '');
  const [nom, setNom] = useState(p?.nom ?? '');
  const [nomModifie, setNomModifie] = useState(!!p);
  const [capacite, setCapacite] = useState(p?.capacite ?? '');
  const [couleur, setCouleur] = useState(p?.couleur ?? '');
  const [etat, setEtat] = useState<'NEUF' | 'OCCASION'>(p?.etat ?? 'NEUF');
  const [codeBarres, setCodeBarres] = useState(p?.codeBarres ?? '');
  const [garantie, setGarantie] = useState(texte(p?.garantieMois ?? (p ? 0 : 6)));
  const [prixAchat, setPrixAchat] = useState(texte(p?.prixAchat));
  const [prixDetail, setPrixDetail] = useState(texte(p?.prixDetail));
  const [prixGros, setPrixGros] = useState(texte(p?.prixGros));
  const [seuilGros, setSeuilGros] = useState(texte(p?.seuilGros));
  const [archive, setArchive] = useState(p?.archive ?? false);
  const [compatibles, setCompatibles] = useState(donnees.compatibles);
  const [scanner, setScanner] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Nouveau produit : stock de départ (facultatif) et son fournisseur, enregistrés ensemble.
  const fournisseurs = useLecture(
    (b) => b.tous<FournisseurSync>('SELECT * FROM fournisseur WHERE archive = 0 ORDER BY nom'),
    [],
  );
  const [stockDepart, setStockDepart] = useState('');
  const [fournisseurId, setFournisseurId] = useState('');
  const [nouveauFournisseur, setNouveauFournisseur] = useState<string | null>(null);

  const marqueNom = marques.find((m) => m.id === marqueId)?.nom;
  const modeleNom = modeles.find((m) => m.id === modeleId)?.nom;
  // Nom proposé tant que l'utilisateur ne l'a pas changé lui-même.
  const nomAffiche = nomModifie
    ? nom
    : nomPropose({
        marque: marqueNom,
        modele: type === 'TELEPHONE' ? modeleNom : null,
        capacite,
        couleur,
      });

  const ajouter = (genre: 'CATEGORIE' | 'MARQUE' | 'MODELE', nomNouveau: string) => {
    const nouvelId = Crypto.randomUUID();
    setNouveaux((n) => [...n, { type: genre, id: nouvelId }]);
    if (genre === 'CATEGORIE') {
      setCategories((c) => [...c, { id: nouvelId, nom: nomNouveau, type }]);
      setCategorieId(nouvelId);
    } else if (genre === 'MARQUE') {
      setMarques((m) => [...m, { id: nouvelId, nom: nomNouveau }]);
      setMarqueId(nouvelId);
      setModeleId('');
    } else if (marqueId) {
      setModeles((m) => [
        ...m,
        { id: nouvelId, marqueId, nom: nomNouveau, marque: marqueNom ?? '' },
      ]);
      setModeleId(nouvelId);
    }
  };

  const enregistrerFiche = async () => {
    setErreur(null);
    const montants = { prixAchat, prixDetail, prixGros };
    const nombres = Object.fromEntries(
      Object.entries(montants).map(([cle, valeur]) => [cle, lireEntier(valeur)]),
    ) as Record<keyof typeof montants, number | null>;
    if (Object.values(nombres).some((n) => n === null || Number.isNaN(n))) {
      setErreur('Les trois prix sont obligatoires, en nombres entiers.');
      return;
    }
    const quantiteDepart = p ? null : lireEntier(stockDepart);
    if (quantiteDepart !== null && (!Number.isInteger(quantiteDepart) || quantiteDepart < 0)) {
      setErreur('Stock de départ : nombre entier attendu.');
      return;
    }
    if (quantiteDepart && nouveauFournisseur === null && !fournisseurId) {
      setErreur('Stock de départ : choisissez le fournisseur (ou « Nouveau fournisseur »).');
      return;
    }
    if (quantiteDepart && nouveauFournisseur !== null && nouveauFournisseur.trim().length < 2) {
      setErreur('Stock de départ : nom du nouveau fournisseur trop court.');
      return;
    }
    const saisie = schemaProduit.safeParse({
      id: p?.id ?? Crypto.randomUUID(),
      type,
      categorieId,
      marqueId: marqueId || null,
      modeleId: type === 'TELEPHONE' ? modeleId || null : null,
      nom: nomAffiche,
      capacite: capacite.trim() || null,
      couleur: couleur.trim() || null,
      etat,
      codeBarres: codeBarres.trim() || null,
      garantieMois: lireEntier(garantie) ?? 0,
      ...nombres,
      seuilGros: lireEntier(seuilGros),
      archive,
      compatibles: type === 'ACCESSOIRE' ? compatibles : [],
    });
    if (!categorieId) {
      setErreur('Choisissez ou ajoutez une catégorie.');
      return;
    }
    if (!saisie.success) {
      setErreur(saisie.error.issues.map((i) => i.message).join('\n'));
      return;
    }
    if (!boutique) return;
    setEnvoi(true);
    try {
      // D'abord les catégories, marques et modèles ajoutés, utilisés par la fiche.
      for (const n of nouveaux) {
        if (n.type === 'CATEGORIE' && n.id === categorieId) {
          const c = categories.find((x) => x.id === n.id)!;
          await enregistrer({ type: 'CATEGORIE_ENREGISTRER', boutiqueId: boutique.id, contenu: c });
        }
        if (n.type === 'MARQUE' && n.id === marqueId) {
          const m = marques.find((x) => x.id === n.id)!;
          await enregistrer({ type: 'MARQUE_ENREGISTRER', boutiqueId: boutique.id, contenu: m });
        }
        if (n.type === 'MODELE' && n.id === modeleId) {
          const m = modeles.find((x) => x.id === n.id)!;
          await enregistrer({
            type: 'MODELE_ENREGISTRER',
            boutiqueId: boutique.id,
            contenu: { id: m.id, marqueId: m.marqueId, nom: m.nom },
          });
        }
      }
      setNouveaux([]);
      await enregistrer({
        type: 'PRODUIT_ENREGISTRER',
        boutiqueId: boutique.id,
        contenu: saisie.data,
      });
      if (quantiteDepart && quantiteDepart > 0) {
        // Stock de départ : bon d'achat reçu aussitôt (IMEI facultatifs), au prix d'achat saisi.
        let idFournisseur = fournisseurId;
        if (nouveauFournisseur !== null) {
          const fiche = schemaFournisseur.parse({
            id: Crypto.randomUUID(),
            nom: nouveauFournisseur,
            telephone: null,
            adresse: null,
            note: null,
            archive: false,
          });
          await enregistrer({
            type: 'FOURNISSEUR_ENREGISTRER',
            boutiqueId: boutique.id,
            contenu: fiche,
          });
          idFournisseur = fiche.id;
        }
        const achatId = Crypto.randomUUID();
        const ligneId = Crypto.randomUUID();
        await enregistrer({
          type: 'ACHAT_ENREGISTRER',
          boutiqueId: boutique.id,
          contenu: {
            id: achatId,
            fournisseurId: idFournisseur,
            numero: numeroAchat(boutique.prefixe, new Date()),
            dateAchat: new Date().toISOString().slice(0, 10),
            note: 'Stock de départ du produit',
            lignes: [
              {
                id: ligneId,
                produitId: saisie.data.id,
                quantite: quantiteDepart,
                prixAchat: saisie.data.prixAchat ?? 0,
              },
            ],
          },
        });
        await enregistrer({
          type: 'ACHAT_RECEVOIR',
          boutiqueId: boutique.id,
          contenu: { achatId, lignes: [{ ligneId, quantite: quantiteDepart }] },
        });
      }
      router.replace({ pathname: '/produit/[id]', params: { id: saisie.data.id } });
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  };

  const categoriesDuType = categories.filter((c) => c.type === type);
  const modelesDeLaMarque = modeles.filter((m) => m.marqueId === marqueId);

  return (
    <Ecran titre={p ? 'Modifier la fiche' : 'Nouveau produit'} enHaut>
      {!p ? (
        <Choix
          libelle="Type"
          options={[
            { id: 'TELEPHONE', nom: 'Téléphone (suivi par IMEI)' },
            { id: 'ACCESSOIRE', nom: 'Accessoire (suivi en quantité)' },
          ]}
          valeurs={[type]}
          surChoix={([t]) => {
            if (!t) return;
            setType(t as Type);
            setCategorieId('');
          }}
        />
      ) : (
        <Texte discret>
          {type === 'TELEPHONE' ? 'Téléphone (suivi par IMEI)' : 'Accessoire (suivi en quantité)'}
        </Texte>
      )}
      <Choix
        libelle="Catégorie"
        options={categoriesDuType}
        valeurs={categorieId ? [categorieId] : []}
        surChoix={([c]) => c && setCategorieId(c)}
        surAjout={(n) => ajouter('CATEGORIE', n)}
      />
      <Choix
        libelle="Marque"
        options={marques}
        valeurs={marqueId ? [marqueId] : []}
        aucun="Sans marque"
        surChoix={([m]) => {
          setMarqueId(m ?? '');
          setModeleId('');
        }}
        surAjout={(n) => ajouter('MARQUE', n)}
      />
      {type === 'TELEPHONE' && marqueId ? (
        <Choix
          libelle="Modèle"
          options={modelesDeLaMarque}
          valeurs={modeleId ? [modeleId] : []}
          aucun="Aucun"
          surChoix={([m]) => setModeleId(m ?? '')}
          surAjout={(n) => ajouter('MODELE', n)}
        />
      ) : null}
      <Champ libelle="Capacité" value={capacite} onChangeText={setCapacite} placeholder="128 Go" />
      <Champ libelle="Couleur" value={couleur} onChangeText={setCouleur} placeholder="Noir" />
      <Champ
        libelle="Nom affiché"
        value={nomAffiche}
        onChangeText={(t) => {
          setNomModifie(true);
          setNom(t);
        }}
      />
      <Choix
        libelle="État"
        options={[
          { id: 'NEUF', nom: 'Neuf' },
          { id: 'OCCASION', nom: 'Occasion' },
        ]}
        valeurs={[etat]}
        surChoix={([e]) => e && setEtat(e as 'NEUF' | 'OCCASION')}
      />
      <Champ
        libelle="Code-barres"
        value={codeBarres}
        onChangeText={setCodeBarres}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Scannez ou saisissez"
      />
      {scannerDisponible ? (
        <Bouton
          titre="Scanner le code-barres"
          variante="secondaire"
          onPress={() => setScanner(true)}
        />
      ) : null}
      <Champ
        libelle="Garantie (mois)"
        value={garantie}
        onChangeText={setGarantie}
        keyboardType="number-pad"
      />
      <Champ
        libelle="Prix d’achat"
        value={prixAchat}
        onChangeText={setPrixAchat}
        keyboardType="number-pad"
      />
      <Champ
        libelle="Prix de détail"
        value={prixDetail}
        onChangeText={setPrixDetail}
        keyboardType="number-pad"
      />
      <Champ
        libelle="Prix de gros"
        value={prixGros}
        onChangeText={setPrixGros}
        keyboardType="number-pad"
      />
      <Champ
        libelle="Prix de gros à partir de (quantité, facultatif)"
        value={seuilGros}
        onChangeText={setSeuilGros}
        keyboardType="number-pad"
      />
      {type === 'ACCESSOIRE' ? (
        <Choix
          libelle="Compatible avec"
          options={modeles.map((m) => ({ id: m.id, nom: `${m.marque} ${m.nom}` }))}
          valeurs={compatibles}
          surChoix={setCompatibles}
          multiple
        />
      ) : null}
      {p ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: archive }}
          onPress={() => setArchive((a) => !a)}
        >
          <Texte>{archive ? '☑' : '☐'} Archivé (n’apparaît plus dans les recherches)</Texte>
        </Pressable>
      ) : null}
      {!p ? (
        <Carte titre="Stock de départ (facultatif)" icone="cube">
          <Texte discret>
            Quantité déjà en boutique : un bon d’achat reçu est créé avec le prix d’achat ci-dessus.
            Les IMEI ne sont pas obligatoires.
          </Texte>
          <Champ
            libelle="Quantité en stock"
            value={stockDepart}
            onChangeText={setStockDepart}
            keyboardType="number-pad"
            placeholder="0"
          />
          {lireEntier(stockDepart) ? (
            nouveauFournisseur !== null ? (
              <>
                <Champ
                  libelle="Nom du nouveau fournisseur"
                  value={nouveauFournisseur}
                  onChangeText={setNouveauFournisseur}
                  placeholder="Ex. Madina Télécom, Achat divers"
                />
                {fournisseurs?.length ? (
                  <Bouton
                    titre="Choisir un fournisseur existant"
                    variante="secondaire"
                    onPress={() => setNouveauFournisseur(null)}
                  />
                ) : null}
              </>
            ) : (
              <ListeDeroulante
                libelle="Fournisseur"
                indication="Choisir le fournisseur…"
                options={[
                  ...(fournisseurs ?? []).map((f) => ({ valeur: f.id, libelle: f.nom })),
                  { valeur: NOUVEAU, libelle: '＋ Nouveau fournisseur' },
                ]}
                valeur={fournisseurId || null}
                surChoix={(v) => (v === NOUVEAU ? setNouveauFournisseur('') : setFournisseurId(v))}
              />
            )
          ) : null}
        </Carte>
      ) : null}
      <Message texte={erreur} />
      <Bouton titre="Enregistrer" onPress={() => void enregistrerFiche()} chargement={envoi} />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
      <Scanner visible={scanner} surCode={setCodeBarres} fermer={() => setScanner(false)} />
    </Ecran>
  );
}
