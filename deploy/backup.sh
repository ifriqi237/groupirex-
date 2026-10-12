#!/bin/sh
# Sauvegarde de la base PostgreSQL et des médias (photos, vidéos) dans deploy/backups/.
#   sh backup.sh          une sauvegarde maintenant
#   sh backup.sh loop     une sauvegarde par jour à 2 h (utilisé par le service « backup »)
# Les sauvegardes de plus de KEEP_DAYS jours (14 par défaut) sont supprimées.
# Copiez régulièrement deploy/backups/ HORS du serveur (autre machine, stockage en ligne).
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"
DIR="${BACKUP_DIR:-/backups}"

run() {
  stamp=$(date -u +%Y%m%d-%H%M)
  mkdir -p "$DIR"
  pg_dump --format=custom --no-owner --file="$DIR/groupdeals-$stamp.dump"
  if [ -d /data/uploads ]; then tar -czf "$DIR/medias-$stamp.tar.gz" -C /data uploads; fi
  find "$DIR" -type f \( -name 'groupdeals-*.dump' -o -name 'medias-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
  echo "Sauvegarde $stamp terminée : $(ls -1 "$DIR" | wc -l) fichier(s) conservé(s)."
}

if [ "${1:-}" = "loop" ]; then
  run
  while true; do
    # Attendre jusqu'à 2 h (UTC) le lendemain.
    now=$(date -u +%s); next=$(( (now / 86400 + 1) * 86400 + 7200 ))
    sleep $(( next - now ))
    run || echo "Échec de la sauvegarde : nouvel essai dans 24 h."
  done
else
  run
fi
