#!/bin/sh
# Restaure une sauvegarde de la base (ATTENTION : remplace toutes les données actuelles).
#   docker compose -f docker-compose.prod.yml stop app
#   docker compose -f docker-compose.prod.yml run --rm -v "$PWD/restore.sh:/restore.sh:ro" backup /bin/sh /restore.sh /backups/groupdeals-AAAAMMJJ-HHMM.dump
#   docker compose -f docker-compose.prod.yml start app
set -eu
FILE="${1:?Indiquez le fichier de sauvegarde, par exemple /backups/groupdeals-20261012-0200.dump}"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$FILE"
echo "Base restaurée depuis $FILE."
