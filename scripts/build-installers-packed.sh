#!/usr/bin/env bash
# Build GoonCitizen installers against packed copies of the local @fabric
# checkouts, then put the installed copies back.
#
#   npm run build:installers:packed [-- <npm build script>]   (default build:installers)
#
# Packs `FABRIC_CORE`, `FABRIC_HTTP`, `FABRIC_HUB` (default the sibling
# ../fabric-clean, ../fabric-http, ../hub.fabric.pub) with `npm pack` file
# lists, so the installers carry what each package publishes, not a symlinked
# working tree (a linked Hub would pack its binaries and its own node_modules).
# A package whose checkout is missing keeps the installed copy. The checkouts
# are only read. The build runs without the operator identity in its env.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCOPE="$ROOT/node_modules/@fabric"
TARGET=${1:-build:installers}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/gooncitizen-packed.XXXXXX")
TAG='[BUILD:PACKED]'

declare -a NAMES=() SOURCES=()
add () { # <name> <source dir>
  if [ -f "$2/package.json" ]; then
    NAMES+=("$1")
    SOURCES+=("$(cd "$2" && pwd)")
  else
    echo "$TAG no checkout at $2; keeping installed @fabric/$1"
  fi
}
add core "${FABRIC_CORE:-$ROOT/../fabric-clean}"
add http "${FABRIC_HTTP:-$ROOT/../fabric-http}"
add hub "${FABRIC_HUB:-$ROOT/../hub.fabric.pub}"

pack () { # <name> <source dir>
  local name=$1 src=$2
  (cd "$src" && npm pack --dry-run --json --ignore-scripts 2>/dev/null) > "$WORK/$name-pack.json"
  node -e "
const out = require(process.argv[1]);
const entry = Array.isArray(out) ? out[0] : Object.values(out)[0];
require('fs').writeFileSync(process.argv[2], entry.files.map((f) => f.path).join('\n') + '\n');
console.log('$TAG @fabric/$name', entry.version || '', entry.files.length + ' files from $src');
" "$WORK/$name-pack.json" "$WORK/$name-files.txt"
  mkdir -p "$WORK/$name"
  rsync -a --files-from="$WORK/$name-files.txt" "$src/" "$WORK/$name/"
}

declare -a SWAPPED=() ADDED=()
restore () {
  for name in ${SWAPPED[@]+"${SWAPPED[@]}"}; do
    rm -rf "${SCOPE:?}/$name"
    mv "$SCOPE/.$name-installed" "$SCOPE/$name"
    echo "$TAG restored installed @fabric/$name"
  done
  for name in ${ADDED[@]+"${ADDED[@]}"}; do
    rm -rf "${SCOPE:?}/$name"
  done
  rm -rf "$WORK"
}
trap restore EXIT

for i in ${NAMES[@]+"${!NAMES[@]}"}; do
  pack "${NAMES[$i]}" "${SOURCES[$i]}"
done

mkdir -p "$SCOPE"
for name in ${NAMES[@]+"${NAMES[@]}"}; do
  if [ -e "$SCOPE/.$name-installed" ] || [ -L "$SCOPE/.$name-installed" ]; then
    echo "$TAG refusing: $SCOPE/.$name-installed exists (an earlier build did not restore it)" >&2
    exit 1
  fi
  if [ -e "$SCOPE/$name" ] || [ -L "$SCOPE/$name" ]; then
    mv "$SCOPE/$name" "$SCOPE/.$name-installed"
    SWAPPED+=("$name")
  else
    ADDED+=("$name")
  fi
  cp -R "$WORK/$name" "$SCOPE/$name"
done

cd "$ROOT"
env -u FABRIC_MNEMONIC -u FABRIC_XPRV -u FABRIC_SEED node -e "
require('./services/LiveRelay');
for (const m of ['bulkSecurityAdvisory', 'identityCluster', 'peerIdentity']) require('@fabric/hub/functions/' + m);
require('@fabric/http/functions/fabricLocalSigner');
console.log('$TAG LiveRelay loads against the packed @fabric packages');
"
env -u FABRIC_MNEMONIC -u FABRIC_XPRV -u FABRIC_SEED CSC_IDENTITY_AUTO_DISCOVERY=false npm run "$TARGET"
