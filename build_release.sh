#!/bin/bash
# Deprecated forwarding stub. The release build moved to scripts/release/build-release.sh.
# This stub will be removed in a future release; use `pnpm release` instead.
echo "warning: build_release.sh has moved to scripts/release/build-release.sh. Use: pnpm release" >&2
exec bash "$(dirname "$0")/scripts/release/build-release.sh" "$@"
