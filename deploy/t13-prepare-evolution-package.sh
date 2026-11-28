#!/bin/bash
# Run as the dedicated rootless Docker account, never root or the internal FM user.
set -euo pipefail
umask 077
[[ $# == 1 && $EUID != 0 ]] || { echo EVOLUTION_METADATA_ARGUMENT_OR_UID_INVALID >&2; exit 1; }
[[ "$(id -un)" == atendevende_t13 && "${DOCKER_HOST:-}" == unix:///run/t13-docker/docker.sock ]] ||
 { echo EVOLUTION_METADATA_DOCKER_SCOPE_INVALID >&2; exit 1; }
docker info --format '{{json .SecurityOptions}}' | grep -q rootless
image=atendevende/evolution-commercial-candidate:2.3.8-security-v4-runtime-20261125
test "$(docker image inspect --format '{{.Id}}' "$image")" = sha256:77f29e7130a58874ad44b346f26a233329b82a8925061f82ee2851e087b46ba3
home=$(realpath -e "$HOME")
parent=$(realpath -e "$(dirname -- "$1")")
[[ "$parent" == "$home" || "$parent" == "$home/"* ]] || { echo EVOLUTION_METADATA_PATH_INVALID >&2; exit 1; }
dest="$parent/$(basename -- "$1")"
[[ ! -e "$dest" && ! -L "$dest" ]] || { echo EVOLUTION_METADATA_PATH_EXISTS >&2; exit 1; }
mkdir -m 0700 -- "$dest"
ok=0
cleanup() {
 if (( ! ok )); then
  rm -f -- "$dest/package.json" "$dest/package.json.tmp"
  rmdir -- "$dest"
 fi
}
trap cleanup EXIT
docker run --rm --pull never --network none --read-only --cap-drop ALL --cap-add CHOWN \
 --security-opt no-new-privileges --user 0:0 --mount "type=bind,src=$dest,dst=/prepared" \
 --entrypoint /bin/sh "$image" -ec '
  umask 077
  test -f /evolution/package.json && test ! -L /evolution/package.json
  echo "00560ed4b68ce149ebc65a2cf2633c492b837f6567e3256c255f531e9a1c1f76  /evolution/package.json" | sha256sum -c -
  test ! -e /prepared/package.json && test ! -e /prepared/package.json.tmp
  cp /evolution/package.json /prepared/package.json.tmp
  echo "00560ed4b68ce149ebc65a2cf2633c492b837f6567e3256c255f531e9a1c1f76  /prepared/package.json.tmp" | sha256sum -c -
  chmod 0400 /prepared/package.json.tmp
  chown 1000:1000 /prepared/package.json.tmp
  mv /prepared/package.json.tmp /prepared/package.json
 '
docker run --rm --pull never --network none --read-only --cap-drop ALL \
 --security-opt no-new-privileges --user 1000:1000 --mount "type=bind,src=$dest/package.json,dst=/evolution/package.json,readonly" \
 --entrypoint /bin/sh "$image" -ec '
  test "$(stat -c "%a %u:%g" /evolution/package.json)" = "400 1000:1000"
  test ! -w /evolution/package.json
  echo "00560ed4b68ce149ebc65a2cf2633c492b837f6567e3256c255f531e9a1c1f76  /evolution/package.json" | sha256sum -c -
 '
ok=1
printf 'EVOLUTION_V4_PACKAGE_MANIFEST_PREPARED=%s\n' "$dest/package.json"
