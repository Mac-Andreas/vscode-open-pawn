# Publishing — make it discoverable everywhere

The extension is fully prepared (publisher id, icon, banner, keywords,
categories, README). Publishing to two registries makes it show up in search for
the widest set of editors **and** for AI agents that look up extensions:

| Registry | Powers search in | Tool |
| --- | --- | --- |
| **Visual Studio Marketplace** | VS Code, VS Code Insiders | `vsce` |
| **Open VSX** | Cursor, VSCodium, Gitpod, Eclipse Theia, code-server | `ovsx` |

Publish to **both** so a search for "pawn", "pawno", "qawno", "samp", or
"open.mp" finds it regardless of which editor the user (or agent) runs.

## One-time setup

### 1. Pick / confirm the publisher id

`package.json` currently uses `"publisher": "Mac-Andreas"`. It must match a
publisher you own. Create one at
<https://marketplace.visualstudio.com/manage> (sign in with a Microsoft
account), then update the field if you choose a different id.

### 2. Get tokens

- **VS Marketplace**: create an Azure DevOps organization, then a Personal
  Access Token with **Marketplace → Manage** scope:
  <https://dev.azure.com> → User settings → Personal Access Tokens.
- **Open VSX**: sign in at <https://open-vsx.org>, create an access token under
  your profile, and publish an initial namespace once:
  `npx ovsx create-namespace Mac-Andreas -p <OPENVSX_TOKEN>`

## Publish

From the extension folder:

```bash
# Build a clean bundle first
npm run package

# --- VS Marketplace ---
npx @vscode/vsce login Mac-Andreas      # paste the Azure DevOps PAT once
npx @vscode/vsce publish                     # reads version from package.json
# (or publish a bump directly: npx @vscode/vsce publish minor)

# --- Open VSX ---
npx ovsx publish open-pawn-0.1.0.vsix -p <OPENVSX_TOKEN>
```

That's it. Within a few minutes the listing appears at:
- `https://marketplace.visualstudio.com/items?itemName=Mac-Andreas.open-pawn`
- `https://open-vsx.org/extension/Mac-Andreas/open-pawn`

## Updating later

Bump the version (`npm version patch|minor|major` or edit `package.json`),
re-run `npm run package`, then `vsce publish` and `ovsx publish` again.

## Notes on platform-specific binaries

The `.vsix` bundles native compilers for **Windows x64** and **macOS arm64**,
plus **Linux x64** when built. This is a single "universal" VSIX — every user
gets every bundled binary, and the extension picks the right one at runtime.

If you ever want to slim downloads per-OS, `vsce` supports
[platform-specific extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions)
via `--target win32-x64 | darwin-arm64 | linux-x64`. Not required — the
universal package is simpler and only ~230 KB.
