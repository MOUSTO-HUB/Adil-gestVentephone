import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bouton,
  Champ,
  Ecran,
  GrandeTuile,
  Grille,
  Indicateur,
  Message,
  Section,
  Texte,
} from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { BadgeAbonnement, BadgeStatut, dateCourte } from '@/components/plateforme';
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
  // Deuxième étape : code à 6 chiffres de l'application d'authentification.
  const [etape, setEtape] = useState<'mot-de-passe' | 'code'>('mot-de-passe');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valider = async () => {
    if (!identifiant.trim() || !motDePasse.trim()) {
      setErreur('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    if (etape === 'code' && !/^\d{6}$/.test(code.trim())) {
      setErreur('Saisissez les 6 chiffres affichés par l’application.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const resultat = await connexion(
        identifiant.trim(),
        motDePasse.trim(),
        etape === 'code' ? code.trim() : undefined,
      );
      if (resultat === 'code') {
        setEtape('code');
        setEnvoi(false);
      }
    } catch (e) {
      setErreur(messageErreur(e));
      setCode('');
      setEnvoi(false);
    }
  };

  if (etape === 'code') {
    return (
      <Ecran titre="Code de vérification" sousTitre="Double authentification du concepteur">
        <Message
          type="info"
          texte="Ouvrez Google Authenticator (ou votre application d’authentification) et saisissez le code à 6 chiffres de « Gestion vente Phone »."
        />
        <Champ
          libelle="Code à 6 chiffres"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          onSubmitEditing={valider}
        />
        <Message texte={erreur} />
        <Bouton titre="Valider" icone="shield-checkmark" onPress={valider} chargement={envoi} />
        <Bouton
          titre="Revenir"
          variante="secondaire"
          onPress={() => {
            setEtape('mot-de-passe');
            setCode('');
            setErreur(null);
          }}
        />
        <Texte discret>
          Téléphone perdu ? Un autre concepteur peut retirer votre double authentification (Comptes
          › votre compte › Aider à se reconnecter).
        </Texte>
      </Ecran>
    );
  }

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
  const { session, requete } = usePlateforme();
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

  // Mot de passe provisoire : il se change avant tout le reste.
  if (session?.doitChangerMotDePasse) return <Redirect href="/plateforme/compte" />;

  return (
    <Ecran enHaut large retour={false} titre="Espace concepteur" sousTitre={session?.nom}>
      {session && !session.doubleAuth ? (
        <>
          <Message texte="Protégez votre compte : activez la double authentification (code de Google Authenticator à chaque connexion)." />
          <Bouton
            titre="Activer la double authentification"
            icone="shield-checkmark"
            variante="secondaire"
            onPress={() => router.push('/plateforme/compte')}
          />
        </>
      ) : null}
      <Grille>
        <Indicateur
          compact
          libelle="Commerçants"
          valeur={String(total.length)}
          icone="storefront"
        />
        <Indicateur compact libelle="Boutiques" valeur={String(boutiques)} icone="business" />
        <Indicateur
          compact
          libelle="Actifs (30 j)"
          valeur={String(actifs)}
          icone="trending-up"
          couleur={c.succes}
        />
      </Grille>

      <Section titre="Que voulez-vous faire ?" icone="hand-left" />
      <Grille>
        <GrandeTuile
          titre="Nouveau commerçant"
          icone="add-circle"
          couleur={c.accent}
          plein
          onPress={() => router.push('/plateforme/nouveau')}
        />
        <GrandeTuile
          titre="Tableau de bord"
          icone="stats-chart"
          couleur={c.primaire}
          onPress={() => router.push('/plateforme/tableau')}
        />
      </Grille>

      <Section titre="Commerçants abonnés" icone="storefront" />
      <Champ
        libelle="Rechercher un commerce"
        value={recherche}
        onChangeText={setRecherche}
        placeholder="Nom du commerce…"
        autoCorrect={false}
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
            {x.statut === 'ACTIF' ? <BadgeAbonnement {...x.abonnement} /> : null}
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
            {x.abonnementJusquAu ? `jusqu’au ${dateCourte(x.abonnementJusquAu)}` : 'sans échéance'}
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
