# Changelog

## 0.1.0 — initial release

- **Native pawncc compiler bundled for every platform** — Windows x64, macOS
  arm64, and Linux x64 — all producing open.mp-compatible AMX (`0xF1E0`). No
  Wine needed on macOS.
- **Compile workflow**: compile command, `Cmd/Ctrl+Shift+B` build task,
  compile-on-save, and errors/warnings in the **Problems** panel.
- **Language features**: syntax highlighting, snippets, autocomplete, hovers,
  signature help, go-to-definition, and document/workspace symbols (indexed from
  your `.inc` / `.pwn` files).
- **Editing**: code folding (braces, `//#region`, block comments) and a
  dependency-free document formatter (no `astyle` WASM, so no host crashes).
- **Platform-aware compiler discovery** with a Wine-wrapper fallback on
  macOS/Linux, backwards compatibility with legacy `pawno/` / `qawno/` layouts,
  and a conflict notice if another Pawn extension is installed.
