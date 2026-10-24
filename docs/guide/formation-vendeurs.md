# Formation des vendeurs (1 heure)

Objectif : à la fin, chaque vendeur sait **vendre**, **faire un troc**, **encaisser une
tranche**, **tenir sa caisse** et **travailler sans Internet**, seul et sans hésiter.

## Préparer la séance (formateur)

- Utilisez **les données de démonstration**, jamais la boutique réelle : un serveur de test
  rempli par `pnpm db:seed` (boutique « Adil Phone Madina »).
- Un téléphone ou un ordinateur par vendeur (ou par binôme), connecté avec `vendeur1` ou
  `vendeur2`, code PIN 2580.
- Une imprimante de reçus si la boutique en a une.
- Imprimez l'[aide-mémoire](aide-memoire.md), un par vendeur.

## Déroulé

| Durée  | Sujet                                                               | Fiche                                          |
| ------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| 5 min  | Se connecter, le code PIN, le bandeau « En ligne »                  | [Guide](README.md)                             |
| 5 min  | Ouvrir sa caisse                                                    | [Caisse](vendeur/04-caisse.md)                 |
| 15 min | Vendre : recherche, filtres, IMEI, paiement, reçu — exercices 1 à 3 | [Vendre](vendeur/01-vendre.md)                 |
| 10 min | Faire un troc — exercice 4                                          | [Troc](vendeur/02-troc.md)                     |
| 10 min | Vente à crédit et encaissement d'une tranche — exercices 5 et 6     | [Tranche](vendeur/03-encaisser-une-tranche.md) |
| 10 min | Hors ligne, puis clôture de caisse — exercices 7 et 8               | [Hors ligne](vendeur/05-hors-ligne.md)         |
| 5 min  | Questions, aide-mémoire                                             | [Aide-mémoire](aide-memoire.md)                |

Montrez une fois au vidéoprojecteur (ou sur votre écran), puis laissez chaque vendeur
faire l'exercice lui-même. Ne faites pas à sa place.

## Exercices

### Exercice 1 — Une vente simple (3 min)

Un client achète une **coque pour Galaxy A15** et paie en espèces avec un billet de
50 000 GNF.

_Attendu :_ coque à 35 000 GNF, monnaie à rendre **15 000 GNF**, reçu imprimé ou affiché.

### Exercice 2 — Trouver vite (4 min)

Sans faire défiler la liste, trouvez :

1. tous les accessoires du **Samsung S22 Ultra** (pastilles Accessoires → Samsung → S22 Ultra) ;
2. un **iPhone en 128 Go** (tapez « iphone 128 ») ;
3. le téléphone dont l'IMEI se termine par celui que le formateur vous lit (tapez
   l'IMEI complet).

_Attendu :_ chaque recherche en moins de 10 secondes ; « Rupture » repéré sur les
produits sans stock.

### Exercice 3 — Téléphone, accessoire et deux moyens de paiement (5 min)

Le client **Ibrahima Sow** achète un **Samsung Galaxy A15 128 Go Noir** et un **verre
trempé**. Il paie 1 000 000 GNF en espèces et le reste par **Orange Money** (référence
« OM-TEST-1 »). Envoyez-lui la facture par SMS.

_Attendu :_ total 1 920 000 GNF ; Orange Money 920 000 GNF avec sa référence ; l'IMEI
choisi n'apparaît plus dans le stock ; un message part au client (en démonstration, il
est seulement journalisé).

### Exercice 4 — Un troc (10 min)

**Mamadou Diallo** achète un **Galaxy A25 128 Go Bleu** et donne son **iPhone 11
128 Go** : écran bon, batterie moyenne, boîtier bon, il fonctionne. IMEI à saisir :
celui donné par le formateur. Il veut 1 200 000 GNF pour son téléphone.

_Attendu :_ état global « Bon » ; valeur proposée affichée ; 1 200 000 dépasse la limite
du vendeur → le formateur (gérant) valide avec son code PIN ; l'iPhone part « À revendre »
avec un prix de revente ; le client paie la différence. Vérifiez ensuite l'écran
**Trocs**.

_Variante :_ saisissez l'IMEI que le formateur a signalé **volé** : la reprise est refusée.

### Exercice 5 — Une vente à crédit (5 min)

**Kadiatou Soumah** achète un **Tecno Spark 20** à crédit : apport 400 000 GNF,
3 tranches mensuelles.

_Attendu :_ plafond, encours et échéancier affichés avant l'encaissement ; la dernière
tranche ajuste le total au franc près ; le **contrat** s'imprime depuis la fiche du crédit.

_Variante :_ essayez avec **Fatoumata Camara** : refusé, elle n'a pas de plafond de crédit.

### Exercice 6 — Encaisser une tranche (5 min)

Kadiatou revient payer **200 000 GNF** en espèces.

_Attendu :_ paiement partiel accepté ; le reste dû diminue de 200 000 ; reçu de tranche
avec le reste dû et la date de la prochaine tranche.

### Exercice 7 — Sans Internet (5 min)

Coupez le Wi-Fi et les données (mode avion). Faites une vente d'accessoire.

_Attendu :_ le bandeau passe à « Hors ligne », la vente est enregistrée, « 1 opération en
attente ». Rallumez le réseau : l'opération part toute seule, le bandeau redevient vert.

### Exercice 8 — Clôturer sa caisse (5 min)

Comptez l'argent « fictif » de la séance et clôturez. Le formateur glisse 5 000 GNF de
moins dans les espèces comptées.

_Attendu :_ écart de −5 000 GNF affiché ; impossible de clôturer sans commentaire ; ticket
de clôture imprimé.

## Vérifier les acquis

Chaque vendeur, seul, en moins de 5 minutes : une vente avec téléphone et accessoire,
un troc simple, un encaissement de tranche. Le formateur coche :

- [ ] retrouve un produit par les filtres et par l'IMEI ;
- [ ] encaisse avec deux moyens de paiement et la référence ;
- [ ] fait un troc avec la fiche du client complète ;
- [ ] encaisse une tranche et remet le reçu ;
- [ ] sait quoi faire hors ligne et qui prévenir en cas de refus ;
- [ ] clôture sa caisse et explique un écart.
