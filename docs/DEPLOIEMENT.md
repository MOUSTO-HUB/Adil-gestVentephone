# Mise en production

Ce guide installe GestVente Phone sur un serveur (VPS) : le site installable pour
les ordinateurs, l'API, PostgreSQL, Redis et une sauvegarde chiffrée chaque nuit.
Les applications Android et iOS sont construites avec EAS (partie 7).

```text
Internet ──► Caddy (HTTPS, 80/443) ──► /api/* ──► API NestJS ──► PostgreSQL
                    │                                   └──────► Redis
                    └──► site installable (fichiers de l'export web)
Sauvegarde : chaque nuit, base + photos chiffrées dans ./sauvegardes (14 jours)
```

## 1. Ce qu'il faut

- Un VPS Ubuntu 24.04 : 2 processeurs, 4 Go de mémoire, 40 Go de disque.
- Un nom de domaine (ex. `gestvente.exemple.com`) dont l'enregistrement **A** pointe
  vers l'adresse IP du serveur.
- Sur votre ordinateur : une clé SSH (`ssh-keygen -t ed25519`).

## 2. Préparer le serveur

Connectez-vous (`ssh root@ADRESSE_IP`), puis :

```bash
# Utilisateur d'administration, connexion par clé uniquement
adduser gestvente && usermod -aG sudo gestvente
mkdir -p /home/gestvente/.ssh && cp ~/.ssh/authorized_keys /home/gestvente/.ssh/
chown -R gestvente:gestvente /home/gestvente/.ssh
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Pare-feu : SSH, HTTP, HTTPS seulement
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker gestvente
```

Reconnectez-vous ensuite avec `ssh gestvente@ADRESSE_IP`.

## 3. Récupérer et configurer

```bash
git clone https://github.com/MOUSTO-HUB/Adil-gestVentephone.git
cd Adil-gestVentephone
cp deploy/production.env.example .env.prod
```

Dans `.env.prod`, renseignez le domaine, l'adresse e-mail et générez chaque secret
avec `openssl rand -base64 48` (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SAUVEGARDE_CLE`).

> **Gardez `SAUVEGARDE_CLE` ailleurs que sur le serveur** (gestionnaire de mots de
> passe) : sans elle, les sauvegardes ne peuvent pas être restaurées.

## 4. Démarrer

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl https://gestvente.exemple.com/api/sante
```

La première construction prend 5 à 10 minutes. Caddy obtient seul le certificat
HTTPS ; les migrations de la base s'appliquent à chaque démarrage de l'API.

## 5. Créer le commerce et le propriétaire

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node dist/cli/initialiser.js
```

La commande demande le nom du commerce, la première boutique (et son préfixe de
facture), le nom et l'identifiant du propriétaire, puis affiche **une seule fois**
le mot de passe provisoire. Le code PIN est choisi à la première connexion.

## 6. Installer le site sur les ordinateurs

Ouvrez `https://gestvente.exemple.com` dans Chrome ou Edge (Windows, Mac), puis
**Installer** (icône dans la barre d'adresse). L'application s'ouvre ensuite dans sa
propre fenêtre et fonctionne hors ligne ; les ventes partent au retour du réseau.
Sur Safari (Mac) : **Fichier › Ajouter au Dock**.

## 7. Applications Android et iOS (EAS)

Sur votre ordinateur, dans le dossier `app` :

```bash
npm install -g eas-cli
eas login
eas init                 # crée le projet Expo et inscrit son identifiant dans app.json
eas update:configure     # adresse des mises à jour (EAS Update)
```

Remplacez `https://gestvente.exemple.com/api` par votre domaine dans `eas.json`
(`build.base.env.EXPO_PUBLIC_API_URL`), puis :

| Besoin                                     | Commande                                           |
| ------------------------------------------ | -------------------------------------------------- |
| APK à installer directement sur Android    | `eas build -p android --profile preview`           |
| AAB pour le Play Store                     | `eas build -p android --profile production`        |
| iOS (App Store / TestFlight)               | `eas build -p ios --profile production`            |
| Envoi au Play Store (piste interne)        | `eas submit -p android --profile production`       |
| Correctif sans réinstallation (JS, écrans) | `eas update --channel production -m "Description"` |

Une mise à jour EAS Update est téléchargée au lancement suivant de l'application.
Elle ne s'applique qu'aux versions qui partagent la même `version` de `app.json` :
changez cette version (nouvelle construction) quand une bibliothèque native est ajoutée.

## 8. Mettre à jour le serveur

```bash
cd ~/Adil-gestVentephone
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 9. Sauvegardes

Chaque nuit (02:00 UTC par défaut), le service `sauvegarde` écrit dans
`./sauvegardes` la base (`base-…dump.enc`) et les photos et justificatifs
(`fichiers-…tar.gz.enc`), chiffrés en AES-256, et supprime ceux de plus de 14 jours.

```bash
# Sauvegarde immédiate
docker compose -f docker-compose.prod.yml --env-file .env.prod exec sauvegarde sh /sauvegarde.sh maintenant

# Copie hors du serveur (depuis votre ordinateur)
scp -r gestvente@ADRESSE_IP:~/Adil-gestVentephone/sauvegardes ./sauvegardes-gestvente
```

Copiez régulièrement les sauvegardes hors du serveur : une panne du disque les
emporterait avec la base.

### Restaurer

```bash
source .env.prod
F=sauvegardes/base-AAAAMMJJ-HHMMSS.dump.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE -in "$F" -out /tmp/base.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < /tmp/base.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod start api
rm /tmp/base.dump
```

Pour les fichiers : déchiffrez `fichiers-….tar.gz.enc` de la même façon, puis
décompressez l'archive dans le volume `stockage` (`docker run --rm -v
gestvente-prod_stockage:/s -v /tmp:/t alpine tar -xzf /t/fichiers.tar.gz -C /s`).

## 10. Surveiller et dépanner

| Situation                     | Commande ou vérification                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| État des services             | `docker compose -f docker-compose.prod.yml --env-file .env.prod ps`                            |
| Journaux de l'API             | `… logs -f api`                                                                                |
| Certificat HTTPS refusé       | Le domaine pointe-t-il vers le serveur ? Les ports 80 et 443 sont-ils ouverts ? `… logs caddy` |
| Sauvegarde de la nuit absente | `… logs sauvegarde`, espace disque (`df -h`)                                                   |
| Appareil volé ou perdu        | Écran **Appareils connectés** de l'application : déconnecter l'appareil                        |

La CI (`.github/workflows/ci.yml`) vérifie chaque envoi sur GitHub : lint, types,
format, tests unitaires et de bout en bout, compilation, export web, images Docker.
