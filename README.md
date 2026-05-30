# Pawn — open.mp / SA-MP (Pawno · Qawno replacement)

Full **Pawn** language support for **SA-MP** and **open.mp** inside VS Code
(and Cursor, VSCodium, Gitpod) — a modern, cross-platform replacement for
**Pawno** and **Qawno**. Works on **Windows, macOS (Apple Silicon & Intel),
and Linux**, with **no Wine on the Mac**.

## Features

- **Syntax highlighting** — Pawno-equivalent colors for keywords, tags,
  natives, directives, `%`-format placeholders, and escapes.
- **Snippets** — `OnPlayerConnect`, `OnPlayerCommandText`, `enum`+data array,
  dialogs, timers, `stock`/`public`/`forward`, and more.
- **IntelliSense** — autocomplete, hovers, signature help, go-to-definition,
  and document/workspace symbols, indexed live from your `.inc` / `.pwn` files.
- **Folding & formatting** — fold braces / `//#region` / block comments, and a
  dependency-free document formatter (no `astyle` WASM, so no host crashes).
- **Native compiler** — bundled `pawncc` per platform, errors/warnings in the
  **Problems** panel, compile-on-save, and a `Cmd/Ctrl+Shift+B` build task.
- **No Wine on macOS** — compiles in ~0.2s natively, output the open.mp
  server accepts (AMX magic `0xF1E0`).

## How it compares

vs. the established **Pawn Development Tool** (`openmp.pawn-development`):

| Feature | Pawn Development Tool | This extension |
| --- | :---: | :---: |
| Syntax highlighting | ✅ | ✅ |
| Snippets | ✅ | ✅ |
| Autocomplete / IntelliSense | ✅ | ✅ |
| Hover · Go-to-definition | ✅ | ✅ |
| Document / workspace symbols | ✅ | ✅ |
| Code folding | ✅ | ✅ |
| Document formatter | ✅ (`astyle` WASM) | ✅ (dependency-free, no host crashes) |
| Build task → `pawncc` | ✅ | ✅ |
| Problems-panel diagnostics | partial | ✅ |
| **Bundles a compiler** | ❌ (bring your own) | ✅ **Windows · macOS · Linux** |
| **Native macOS — no Wine** | ❌ | ✅ |

The two can coexist, but running both at once may produce duplicate
autocomplete/hovers — this extension will offer to help you disable the other.

## Platform support

| Platform | Bundled compiler | Wine needed? |
| --- | --- | --- |
| macOS arm64 (Apple Silicon) | ✅ native `pawncc` (built, ships in `.vsix`) | No |
| macOS x64 (Intel) | build locally via the script below | No |
| Windows (10/11, x64) | ✅ native `pawncc.exe` (ships in `.vsix`) | No (runs directly) |
| Linux x64 | build locally via the script below | No |

On Windows, `pawncc.exe` is a native PE binary — it runs directly, faster than
the Mac path, and the bundled copy works out of the box. The extension picks the
right binary for the host automatically from `bin/<platform>/`. You can always
override with `pawnOmp.compilerPath`.

## Why this exists

The official `pawn-lang/compiler` macOS release ships a **32-bit i386** binary
that **cannot run** on macOS 10.15+ (Apple dropped 32-bit support). The usual
workaround is to run the Windows `pawncc.exe` under Wine/CrossOver, because the
native macOS pawncc people *could* run tended to emit AMX magic `0xF1E1`, which
the open.mp server rejects (`Invalid/unsupported P-code file format`).

It turns out you don't need Wine at all. Building `pawn-lang/compiler` from
source as a **native 64-bit binary with the default 32-bit *cell* size** yields
a pawncc that:

- runs natively (`Mach-O 64-bit executable arm64`), and
- emits AMX magic **`0xF1E0`** — exactly what open.mp expects.

On a real gamemode this compiles in ~0.2s versus several seconds of Wine
startup per build.

## Setup

On **Windows** and **macOS arm64** the extension already bundles a working
compiler — nothing to install. On **Intel Mac / Linux**, build one once:

```bash
./scripts/build-native-pawncc.sh          # -> bin/<platform>/ (auto-picked up)
# or target your server tree directly:
./scripts/build-native-pawncc.sh /path/to/server/qawno/native
```

The script clones the compiler, builds it natively for the host, installs
`pawncc` + its shared library, fixes the rpath, and verifies the `0xF1E0` magic.

### Compiler discovery order

1. `pawnOmp.compilerPath` (if set)
2. `<workspace>/qawno/native/<pawncc>`
3. `<workspace>/qawno/<pawncc>`
4. `<workspace>/pawno/<pawncc>`
5. `<pawncc>` on `PATH` (honors `PATHEXT` on Windows)
6. The extension's **bundled** `bin/<platform>/<pawncc>`
7. A Wine wrapper (macOS/Linux only): `pawnOmp.wineWrapperPath`, or
   `qawno/pawn-cc.sh` / `run-pawncc-wine.sh` in the workspace

(`<pawncc>` is `pawncc.exe` on Windows, `pawncc` elsewhere.)

Run **`Pawn: Show Compiler Info`** from the Command Palette to see which
compiler resolved and confirm its AMX magic.

## Usage

- **`Cmd+Shift+B`** (with a `.pwn` focused) — compile the current file.
- **`Pawn: Compile Main Script`** — compile `pawnOmp.mainScript`
  (e.g. `gamemodes/survival.pwn`) regardless of the focused file.
- Enable **`pawnOmp.compileOnSave`** to build automatically on save.
- Errors/warnings appear in the **Problems** panel; the full compiler log is in
  **Output → Pawn**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `pawnOmp.compilerPath` | `""` | Absolute path to a native `pawncc`. Empty = auto-discover. |
| `pawnOmp.wineWrapperPath` | `""` | Wine `pawn-cc.sh` wrapper, used only if no native compiler is found. |
| `pawnOmp.preferWine` | `false` | Use the Wine wrapper even when a native compiler exists. |
| `pawnOmp.mainScript` | `""` | Workspace-relative main gamemode (e.g. `gamemodes/survival.pwn`). |
| `pawnOmp.includePaths` | `["qawno/include","includes","pawno/include"]` | `-i` include dirs (non-existent ones skipped). |
| `pawnOmp.outputDir` | `""` | Output dir for the `.amx`. Empty = beside the source. |
| `pawnOmp.compilerArgs` | `["-;+","-(+","-d3","-Z+"]` | Extra pawncc args. |
| `pawnOmp.compileOnSave` | `false` | Compile on save. |
| `pawnOmp.compileOnSaveTarget` | `mainScript` | On save, build the main script or the saved file. |

## Building the extension

```bash
npm install
npm run compile          # bundle to dist/extension.js
npx @vscode/vsce package # produce a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host for live testing.

## License

MIT.

## Roadmap to 1.0

This is a **0.x** release: the compiler pipeline is tested on all three
platforms (and the macOS path is verified against a real server), but a few
things remain before a confident **1.0.0**:

- Live-UI smoke testing of the editor features on **real Windows and Linux**
  machines (binaries are verified; the extension UI has been exercised on macOS).
- Optional deeper language tooling (full LSP-style analysis) toward parity with
  established Pawn extensions.

Until then, semver stays in the `0.x` range to reflect honest maturity.
