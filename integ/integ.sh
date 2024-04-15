#!/usr/bin/env bash

set -e

cd $(dirname $0)

rm -rf package.json
npm init --yes
npm link ../core ../cli

set -x

export AILLY_ENGINE=noop

echo "basic"
npx ailly --root 01_basic
[ -f 01_basic/basic.ailly.md ]
rm 01_basic/basic.ailly.md

echo "combined"
npx ailly --root 02_combined --combined
[ ! -f 02_combined/combined.ailly.md ]

echo "edit"
AILLY_NOOP_RESPONSE="Edited" npx ailly --root 04_edit --edit file --lines 2:4 --prompt "edit" --yes
grep -q 'Edited' 04_edit/file
