#!/bin/bash
# Mise à jour de GestVente Phone sur l'hébergement o2switch, en une commande :
#   ~/gestvente/scripts/mettre-a-jour.sh          API puis site
#   ~/gestvente/scripts/mettre-a-jour.sh api      API seule
#   ~/gestvente/scripts/mettre-a-jour.sh site     site seul
#
# API : sauvegarde, git pull, dépendances, construction, migrations, redémarrage.
# Site : récupère la branche « site-en-ligne » construite par GitHub
# (.github/workflows/site.yml) et la copie dans le dossier du sous-domaine app,
# sans toucher au .htaccess.
#
# Tout le script est entre accolades : bash le lit en entier avant de
# l'exécuter, donc le « git pull » peut le modifier sans risque.
{
  set -euo pipefail

  QUOI="${1:-tout}"
  case "$QUOI" in
    tout | api | site) ;;
    *)
      echo "Usage : $0 [api|site]" >&2
      exit 2
      ;;
  esac

  SOURCE="${GESTVENTE_SOURCE:-$HOME/gestvente/source}"
  ENV_API="$SOURCE/api/.env"
  ATTENTE_MAX="${ATTENTE_SITE:-900}" # secondes d'attente de la construction GitHub

  etape() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
  erreur() {
    printf '\033[31mERREUR : %s\033[0m\n' "$*" >&2
    exit 1
  }
  # Valeur d'une variable du .env (dernière occurrence, sans guillemets).
  lire_env() { sed -n "s/^$1=//p" "$ENV_API" | tail -n 1 | tr -d '\r"'"'"; }

  [ -d "$SOURCE/.git" ] || erreur "dépôt introuvable : $SOURCE"
  [ -f "$ENV_API" ] || erreur "fichier introuvable : $ENV_API"

  URL_API="$(lire_env URL_PUBLIQUE)"
  URL_SITE="$(lire_env APP_ORIGIN | cut -d, -f1)"
  URL_SITE="${URL_SITE%/}"
  [ -n "$URL_API" ] || erreur "URL_PUBLIQUE absente de $ENV_API"
  [ -n "$URL_SITE" ] || erreur "APP_ORIGIN absente de $ENV_API"
  DOSSIER_SITE="${GESTVENTE_DOSSIER_SITE:-$HOME/${URL_SITE#https://}}"

  cd "$SOURCE"

  etape "Récupération du code"
  git fetch -q origin
  AVANT="$(git rev-parse HEAD)"
  git pull -q --ff-only
  APRES="$(git rev-parse HEAD)"
  if [ "$AVANT" = "$APRES" ]; then
    echo "Code déjà à jour ($(git log -1 --format='%h %s'))."
  else
    git --no-pager log --oneline "$AVANT..$APRES"
  fi

  # ── API ──────────────────────────────────────────────────────────────────
  # Version du code de la dernière API construite (hors dépôt).
  VERSION_API="$(dirname "$SOURCE")/.version-api"
  if [ "$QUOI" != site ]; then
    if [ "$QUOI" = tout ] && [ -f api/dist/main.js ] &&
      [ "$(cat "$VERSION_API" 2>/dev/null)" = "$APRES" ]; then
      etape "API : déjà construite pour cette version, étape passée"
    else
      ACTIVER="$(ls -d "$HOME"/nodevenv/gestvente/source/api/*/bin/activate 2>/dev/null | sort -V | tail -n 1)"
      [ -n "$ACTIVER" ] || erreur "environnement Node.js introuvable (Setup Node.js App, étape 17)"
      # Le script d'activation de CloudLinux lit des variables non définies : « set -u » suspendu.
      set +u
      # shellcheck disable=SC1090
      source "$ACTIVER"
      set -u

      etape "API 1/4 : sauvegarde de la base"
      if [ -x "$HOME/gestvente/scripts/sauvegarde.sh" ]; then
        "$HOME/gestvente/scripts/sauvegarde.sh"
      else
        echo "Pas encore de script de sauvegarde (étape 30) : étape passée."
      fi

      etape "API 2/4 : dépendances et construction"
      if [ -L api/node_modules ]; then rm api/node_modules; fi
      NODE_ENV=development pnpm install --frozen-lockfile --filter "@gestvente/api..."
      pnpm --filter @gestvente/commun build
      pnpm --filter @gestvente/api build

      etape "API 3/4 : migrations de la base"
      (cd api && pnpm exec prisma migrate deploy)

      etape "API 4/4 : redémarrage"
      mkdir -p api/tmp && touch api/tmp/restart.txt
      for essai in 1 2 3 4 5 6; do
        sleep 5
        if curl -fsS "$URL_API/api/sante" >/dev/null 2>&1; then break; fi
        [ "$essai" = 6 ] && erreur "l'API ne répond pas : tail -n 50 ~/gestvente/journaux/api.log"
      done
      echo "API en service : $(curl -fsS "$URL_API/api/sante")"
      echo "$APRES" >"$VERSION_API"
    fi
  fi

  # ── Site ─────────────────────────────────────────────────────────────────
  if [ "$QUOI" != api ]; then
    etape "Site : récupération de la version construite par GitHub"
    [ -d "$DOSSIER_SITE" ] || erreur "dossier du site introuvable : $DOSSIER_SITE"
    ATTENDU="$(git rev-parse HEAD)"
    attendu_depuis=0
    while :; do
      git fetch -q origin site-en-ligne ||
        erreur "branche site-en-ligne absente : vérifiez l'onglet Actions du dépôt GitHub"
      CONSTRUIT="$(git show FETCH_HEAD:version-source.txt 2>/dev/null | tr -d '[:space:]')"
      [ "$CONSTRUIT" = "$ATTENDU" ] && break
      if [ "$attendu_depuis" -ge "$ATTENTE_MAX" ]; then
        erreur "le site construit (${CONSTRUIT:0:7}) ne correspond pas au code (${ATTENDU:0:7}) : construction GitHub en échec ? (onglet Actions)"
      fi
      [ "$attendu_depuis" = 0 ] && echo "Construction du site en cours sur GitHub, attente (jusqu'à $((ATTENTE_MAX / 60)) min)…"
      sleep 30
      attendu_depuis=$((attendu_depuis + 30))
    done

    TEMP="$(mktemp -d)"
    trap 'rm -rf "$TEMP"' EXIT
    git archive FETCH_HEAD | tar -x -C "$TEMP"
    [ -f "$TEMP/index.html" ] || erreur "la version construite ne contient pas index.html"

    etape "Site : copie dans $DOSSIER_SITE"
    # Anciennes versions retirées ; .htaccess, .well-known et cgi-bin conservés.
    find "$DOSSIER_SITE" -mindepth 1 -maxdepth 1 \
      ! -name .htaccess ! -name .well-known ! -name cgi-bin -exec rm -rf {} +
    cp -R "$TEMP"/. "$DOSSIER_SITE"/
    find "$DOSSIER_SITE" -type d -exec chmod 755 {} +
    find "$DOSSIER_SITE" -type f -exec chmod 644 {} +
    [ -f "$DOSSIER_SITE/.htaccess" ] || echo "Attention : pas de .htaccess dans $DOSSIER_SITE (étape 28)."

    CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL_SITE/" || true)"
    [ "$CODE" = 200 ] || erreur "le site répond $CODE au lieu de 200 : $URL_SITE"
    echo "Site en ligne : version ${ATTENDU:0:7}."
  fi

  etape "Mise à jour terminée"
  exit 0
}
