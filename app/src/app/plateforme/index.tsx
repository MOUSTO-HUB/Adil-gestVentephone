import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Bouton, Champ, Ecran, Indicateur, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { BadgeStatut, dateCourte } from '@/components/plateforme';
import { type ResumeCommerce, usePlateforme } from '@/lib/plateforme';
import { ombre, useCouleurs } from '@/lib/theme';

export default function AccueilPlateforme() {
  const { session } = usePlateforme();
  return session ? <Commerces /> : <ConnexionConcepteur />;
}

function ConnexionConcepteur() {
  const { connexion } = usePlateforme();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valider = async () => {
    if (!identifiant.trim() || !motDePasse) {
      setErreur('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await connexion(identifiant.trim(), motDePasse);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  };

  return (
    <Ecran titre="Espace concepteur" sousTitre="Gestion des commerçants abonnés à la plateforme.">
      <Champ
        libelle="Identifiant"
        value={identifiant}
        onChangeText={setIdentifiant}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
      />
      <Champ
        libelle="Mot de passe"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={valider}
      />
      <Message texte={erreur} />
      <Bouton titre="Se connecter" onPress={valider} chargement={envoi} />
      <Bouton
        titre="Retour à la connexion commerçant"
        variante="secondaire"
        icone="arrow-back"
        onPress={() => router.replace('/connexion')}
      />
    </Ecran>
  );
}

const FILTRES = [
  { valeur: '', libelle: 'En service' },
  { valeur: 'SUSPENDU', libelle: 'Suspendus' },
  { valeur: 'SUPPRIME', libelle: 'Retirés' },
] as const;

function Commerces() {
  const c = useCouleurs();
  const { session, requete, deconnexion } = usePlateforme();
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<string>('');
  const [liste, setListe] = useState<ResumeCommerce[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    const params = new URLSearchParams();
    if (recherche.trim()) params.set('recherche', recherche.trim());
    if (statut) params.set('statut', statut);
    const suite = params.size ? `?${params}` : '';
    return requete<ResumeCommerce[]>(`/commerces${suite}`).then(
      (r) => {
        setListe(r);
        setErreur(null);
      },
      (e: unknown) => setErreur(messageErreur(e)),
    );
  }, [requete, recherche, statut]);

  useEffect(() => {
    const minuterie = setTimeout(() => void charger(), 250);
    return () => clearTimeout(minuterie);
  }, [charger]);

  const total = liste ?? [];
  const boutiques = total.reduce((t, x) => t + x.boutiques, 0);
  const actifs = total.filter((x) => x.ventes30Jours > 0).length;

  return (
    <Ecran enHaut retour={false} titre="Espace concepteur" sousTitre={session?.nom}>
      <View style={styles.ligne}>
        <View style={{ flex: 1 }}>
          <Bouton
            titre="Nouveau commerçant"
            icone="add-circle"
            onPress={() => router.push('/plateforme/nouveau')}
          />
        </View>
        <Bouton
          titre="Quitter"
          variante="secondaire"
          icone="log-out-outline"
          onPress={() => void deconnexion()}
        />
      </View>
      <View style={styles.ligne}>
        <Indicateur libelle="Commerçants" valeur={String(total.length)} icone="storefront" />
        <Indicateur libelle="Boutiques" valeur={String(boutiques)} icone="business" />
        <Indicateur
          libelle="Actifs (30 j)"
          valeur={String(actifs)}
          icone="trending-up"
          couleur={c.succes}
        />
      </View>
      <TextInput
        value={recherche}
        onChangeText={setRecherche}
        placeholder="Rechercher un commerce…"
        placeholderTextColor={c.texteDiscret}
        style={[
          styles.recherche,
          { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
        ]}
      />
      <View style={styles.ligne}>
        {FILTRES.map((f) => {
          const choisi = statut === f.valeur;
          return (
            <Pressable
              key={f.valeur}
              accessibilityRole="button"
              accessibilityState={{ selected: choisi }}
              onPress={() => setStatut(f.valeur)}
              style={[
                styles.pastille,
                {
                  borderColor: choisi ? c.primaire : c.bordure,
                  backgroundColor: choisi ? c.fondPrimaire : c.carte,
                },
              ]}
            >
              <Text style={{ color: choisi ? c.primaire : c.texte, fontWeight: '600' }}>
                {f.libelle}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Message texte={erreur} />
      {liste && liste.length === 0 ? <Texte discret>Aucun commerce.</Texte> : null}
      {total.map((x) => (
        <Pressable
          key={x.id}
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/plateforme/commerce/[id]', params: { id: x.id } })
          }
          style={({ pressed }) => [
            styles.carte,
            ombre(c.ombre, 1),
            { backgroundColor: c.carte, borderColor: c.bordure, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View style={styles.ligneTitre}>
            <Text style={[styles.nom, { color: c.texte }]} numberOfLines={1}>
              {x.nom}
            </Text>
            <BadgeStatut statut={x.statut} />
          </View>
          <Texte discret>
            {x.proprietaire
              ? `${x.proprietaire.nom} (${x.proprietaire.identifiant})`
              : 'Sans propriétaire'}
            {x.telephone ? ` · ${x.telephone}` : ''}
          </Texte>
          <View style={styles.chiffres}>
            <Chiffre
              icone="business-outline"
              texte={`${x.boutiques} boutique${x.boutiques > 1 ? 's' : ''}`}
            />
            {x.boutiquesVerrouillees ? (
              <Chiffre
                icone="lock-closed"
                texte={`${x.boutiquesVerrouillees} verrouillée(s)`}
                couleur={c.alerte}
              />
            ) : null}
            <Chiffre icone="people-outline" texte={`${x.utilisateurs} compte(s)`} />
            <Chiffre icone="cube-outline" texte={`${x.produits} articles`} />
            <Chiffre icone="receipt-outline" texte={`${x.ventes30Jours} ventes (30 j)`} />
          </View>
          <Texte discret>
            Abonnement :{' '}
            {x.abonnementJusquAu ? `jusqu’au ${dateCourte(x.abonnementJusquAu)}` : 'non renseigné'}
            {x.derniereVente ? ` · dernière vente le ${dateCourte(x.derniereVente)}` : ''}
          </Texte>
        </Pressable>
      ))}
    </Ecran>
  );
}

function Chiffre({
  icone,
  texte,
  couleur,
}: {
  icone: 'cube-outline' | 'business-outline' | 'lock-closed' | 'people-outline' | 'receipt-outline';
  texte: string;
  couleur?: string;
}) {
  const c = useCouleurs();
  return (
    <View style={styles.chiffre}>
      <Ionicons name={icone} size={14} color={couleur ?? c.texteDiscret} />
      <Text style={{ color: couleur ?? c.texteDiscret, fontSize: 13 }}>{texte}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  recherche: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  pastille: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  carte: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  ligneTitre: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nom: { flex: 1, fontSize: 17, fontWeight: '700' },
  chiffres: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chiffre: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
