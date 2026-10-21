#!/bin/sh
# Sauvegarde quotidienne chiffrée de PostgreSQL et des fichiers (photos, justificatifs).
# Chiffrement AES-256 (openssl, clé SAUVEGARDE_CLE) ; les sauvegardes de plus de
# SAUVEGARDE_JOURS jours sont supprimées. « sauvegarde.sh maintenant » : une sauvegarde
# immédiate. Restauration : voir docs/DEPLOIEMENT.md.
set -eu

: "${SAUVEGARDE_CLE:?SAUVEGARDE_CLE manquante}"
: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${PGPASSWORD:?}"
HEURE="${SAUVEGARDE_HEURE:-02}"
JOURS="${SAUVEGARDE_JOURS:-14}"
DOSSIER=/sauvegardes

command -v openssl >/dev/null || apk add --no-cache openssl >/dev/null

chiffrer() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:SAUVEGARDE_CLE -in "$1" -out "$2"
}

sauvegarder() {
  horodatage=$(date -u +%Y%m%d-%H%M%S)
  temporaire=$(mktemp -d)
  pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom -f "$temporaire/base.dump"
  chiffrer "$temporaire/base.dump" "$DOSSIER/base-$horodatage.dump.enc"
  tar -C /stockage -czf "$temporaire/fichiers.tar.gz" .
  chiffrer "$temporaire/fichiers.tar.gz" "$DOSSIER/fichiers-$horodatage.tar.gz.enc"
  rm -rf "$temporaire"
  find "$DOSSIER" -name '*.enc' -mtime +"$JOURS" -delete
  echo "Sauvegarde $horodatage terminée ($(du -sh "$DOSSIER" | cut -f1) au total)."
}

if [ "${1:-}" = "maintenant" ]; then
  sauvegarder
  exit 0
fi

echo "Sauvegarde chaque jour à ${HEURE}:00 UTC, conservée ${JOURS} jours."
while true; do
  maintenant=$(date -u +%s)
  cible=$(date -u -d "$(date -u +%Y-%m-%d) ${HEURE}:00:00" +%s)
  [ "$cible" -le "$maintenant" ] && cible=$((cible + 86400))
  sleep $((cible - maintenant))
  sauvegarder || echo "Échec de la sauvegarde : nouvel essai demain." >&2
done
