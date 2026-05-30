#!/usr/bin/env bash
#
# build-native-pawncc.sh — build a native pawncc (macOS or Linux) that emits AMX
# magic 0xF1E0, which the open.mp server accepts. This removes the need to run
# the Windows pawncc.exe under Wine/CrossOver.
#
# The official pawn-lang macOS release ships a 32-bit i386 binary that cannot
# run on macOS 10.15+ (Apple dropped 32-bit support). Building from source with
# the default 32-bit *cell* size (PAWN_CELL_SIZE=32, the compiler default) gives
# a native 64-bit executable whose AMX output still uses 4-byte cells -> 0xF1E0.
#
# Windows users do NOT need this script: pawncc.exe is a native PE binary and is
# already bundled under bin/win32-x64/.
#
# Usage:
#   scripts/build-native-pawncc.sh [DEST_DIR]
# DEST_DIR defaults to the extension's bin/<platform> subfolder (so a freshly
# built binary is picked up by the bundled-compiler fallback). The script copies
# pawncc + its shared lib there and (on macOS) patches the rpath so pawncc finds
# the dylib in its own directory.
set -euo pipefail

OS="$(uname -s)"
ARCH="${PAWNCC_ARCH:-$(uname -m)}"   # arm64 or x86_64
REPO="https://github.com/pawn-lang/compiler.git"
EXT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Map host -> the bin/<platform> subdir the extension probes (see compiler.ts).
case "$OS" in
  Darwin) PLATFORM="darwin-$([[ "$ARCH" == arm64 ]] && echo arm64 || echo x64)" ; LIB="libpawnc.dylib" ;;
  Linux)  PLATFORM="linux-x64" ; LIB="libpawnc.so" ;;
  *)      echo "Unsupported OS for native build: $OS (Windows uses bundled pawncc.exe)" >&2; exit 1 ;;
esac
DEST="${1:-$EXT_ROOT/bin/$PLATFORM}"

NEED=(git cmake make)
[[ "$OS" == Darwin ]] && NEED+=(install_name_tool)
for tool in "${NEED[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▶ Cloning pawn-lang/compiler…"
git clone --depth 1 "$REPO" "$WORK/compiler" >/dev/null 2>&1

BUILD="$WORK/compiler/source/compiler/build"
mkdir -p "$BUILD"

echo "▶ Configuring (os=$OS arch=$ARCH, 32-bit cells)…"
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
[[ "$OS" == Darwin ]] && CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES="$ARCH")
cmake -S "$WORK/compiler/source/compiler" -B "$BUILD" "${CMAKE_ARGS[@]}" >/dev/null

echo "▶ Building pawncc…"
cmake --build "$BUILD" --target pawncc >/dev/null

mkdir -p "$DEST"
cp "$BUILD/pawncc" "$DEST/pawncc"
cp "$BUILD/$LIB" "$DEST/$LIB"
chmod +x "$DEST/pawncc"

if [[ "$OS" == Darwin ]]; then
  # Let pawncc resolve @rpath/libpawnc.dylib from its own folder.
  install_name_tool -add_rpath @loader_path "$DEST/pawncc" 2>/dev/null || true
fi
# On Linux the CMake build already sets an $ORIGIN rpath, so the .so beside the
# binary is found without extra patching.

echo "▶ Verifying AMX magic…"
SRC="$WORK/probe.pwn"; OUT="$WORK/probe.amx"
printf 'main(){new x=1;x++;}\n' > "$SRC"
"$DEST/pawncc" "$SRC" "-o$OUT" >/dev/null 2>&1 || true
if [[ -f "$OUT" ]]; then
  MAGIC="$(xxd -s 4 -l 2 "$OUT" | awk '{print $2}')"   # bytes 04-05, little-endian
  if [[ "$MAGIC" == "e0f1" ]]; then
    echo "✓ Native pawncc built at: $DEST/pawncc  (AMX magic 0xF1E0 — open.mp compatible)"
    echo "  Platform subdir: bin/$PLATFORM"
  else
    echo "⚠ Built, but AMX magic is unexpected ($MAGIC). open.mp expects e0f1 (0xF1E0)." >&2
    exit 2
  fi
else
  echo "✗ pawncc did not produce an .amx during verification." >&2
  exit 1
fi
