#!/bin/sh
# Construit dist/CanapeTV.wgt.
#  - Avec Tizen Studio (commande « tizen » dans le PATH) et un profil de certificat Samsung :
#      PROFILE=MonProfil ./tools/build-wgt.sh      -> paquet signé, installable sur la TV
#  - Sans Tizen Studio : simple archive non signée (le script d'installation Windows la signera).
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/*.wgt
if [ -n "$PROFILE" ] && command -v tizen >/dev/null 2>&1; then
  BUILD=$(mktemp -d)
  cp -r app/. "$BUILD/"
  tizen package -t wgt -s "$PROFILE" -o dist -- "$BUILD"
  rm -rf "$BUILD"
  mv dist/*.wgt dist/CanapeTV.wgt
else
  (cd app && zip -q -r -X ../dist/CanapeTV.wgt . -x '.*')
  echo "Paquet NON signé (à signer avec Tizen Studio avant installation)."
fi
ls -la dist
