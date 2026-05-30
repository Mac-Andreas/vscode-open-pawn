import * as vscode from 'vscode';

/**
 * A symbol discovered in Pawn source: a native/stock/public/forward function,
 * or a #define / enum constant. Used to power completions, hovers, and
 * go-to-definition without a full language server.
 */
export interface PawnSymbol {
  name: string;
  kind: 'function' | 'native' | 'define' | 'enum' | 'callback';
  /** Signature line as written (e.g. `native SendClientMessage(playerid, ...)`). */
  signature: string;
  /** Leading doc comment, if one immediately precedes the declaration. */
  doc?: string;
  uri: vscode.Uri;
  line: number;
}

// Function-like declarations: native / forward / public / stock, optionally
// with a return tag (e.g. `native Float:GetVehicleHealth(...)`,
// `native bool:IsValidVehicle(...)`). Group 2 captures an optional tag, group 3
// the function name, group 4 the parameter list.
const FUNC_RE =
  /^\s*(native|forward|public|stock)\s+(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_@][A-Za-z0-9_@]*)\s*\(([^;{]*)\)?/;
// #define NAME ...   (constant-style defines only; skip macro(args) noise lightly)
const DEFINE_RE = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/;
// enum members are matched loosely inside enum blocks.
const ENUM_OPEN_RE = /^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)?/;

/** SA-MP / open.mp callbacks worth surfacing even if no include declares them. */
const KNOWN_CALLBACKS = new Set([
  'OnGameModeInit', 'OnGameModeExit', 'OnFilterScriptInit', 'OnFilterScriptExit',
  'OnPlayerConnect', 'OnPlayerDisconnect', 'OnPlayerSpawn', 'OnPlayerDeath',
  'OnPlayerText', 'OnPlayerCommandText', 'OnPlayerRequestClass', 'OnPlayerEnterVehicle',
  'OnPlayerExitVehicle', 'OnPlayerStateChange', 'OnPlayerKeyStateChange',
  'OnDialogResponse', 'OnPlayerClickPlayer', 'OnPlayerUpdate', 'OnVehicleSpawn',
  'OnVehicleDeath', 'OnPlayerTakeDamage', 'OnPlayerGiveDamage', 'OnPlayerWeaponShot',
]);

export class PawnIndex {
  private symbols = new Map<string, PawnSymbol[]>();

  /** Parse one document's text into symbols, replacing any prior entries. */
  indexDocument(uri: vscode.Uri, text: string): void {
    this.removeFile(uri);
    const lines = text.split(/\r?\n/);
    let pendingDoc: string | undefined;
    let inEnum = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Guard against pathological lines (minified output, generated blobs):
      // very long lines can trigger catastrophic regex backtracking, which is a
      // real extension-host hang/crash vector. Skip them rather than risk it.
      if (line.length > 2000) {
        pendingDoc = undefined;
        continue;
      }

      // Collect a single-line doc comment immediately above a declaration.
      const docMatch = /^\s*\/\/\/?\s?(.*)$/.exec(line) || /^\s*\*\s?(.*)$/.exec(line);
      if (docMatch) {
        pendingDoc = pendingDoc ? `${pendingDoc}\n${docMatch[1]}` : docMatch[1];
        continue;
      }

      const fn = FUNC_RE.exec(line);
      if (fn) {
        const [, kw, tag, name, params] = fn;
        const kind =
          kw === 'native' ? 'native'
          : KNOWN_CALLBACKS.has(name) ? 'callback'
          : 'function';
        const ret = tag ? `${tag}:` : '';
        this.add({
          name,
          kind,
          signature: `${kw} ${ret}${name}(${params.trim()})`,
          doc: pendingDoc,
          uri,
          line: i,
        });
        pendingDoc = undefined;
        continue;
      }

      const def = DEFINE_RE.exec(line);
      if (def) {
        const [, name, rest] = def;
        this.add({
          name,
          kind: 'define',
          signature: `#define ${name}${rest ? ' ' + rest.trim() : ''}`,
          doc: pendingDoc,
          uri,
          line: i,
        });
        pendingDoc = undefined;
        continue;
      }

      if (ENUM_OPEN_RE.test(line)) inEnum = true;
      if (inEnum) {
        const member = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:[:=,].*)?$/.exec(line);
        if (member && member[1] && !/\b(enum)\b/.test(line)) {
          this.add({
            name: member[1],
            kind: 'enum',
            signature: `enum member ${member[1]}`,
            uri,
            line: i,
          });
        }
        if (line.includes('}')) inEnum = false;
      }

      pendingDoc = undefined;
    }
  }

  private add(sym: PawnSymbol): void {
    const list = this.symbols.get(sym.name) ?? [];
    list.push(sym);
    this.symbols.set(sym.name, list);
  }

  removeFile(uri: vscode.Uri): void {
    for (const [name, list] of this.symbols) {
      const filtered = list.filter((s) => s.uri.toString() !== uri.toString());
      if (filtered.length) this.symbols.set(name, filtered);
      else this.symbols.delete(name);
    }
  }

  get(name: string): PawnSymbol[] {
    return this.symbols.get(name) ?? [];
  }

  /** All symbols whose name starts with `prefix` (case-insensitive), capped. */
  match(prefix: string, limit = 200): PawnSymbol[] {
    const lower = prefix.toLowerCase();
    const out: PawnSymbol[] = [];
    for (const list of this.symbols.values()) {
      const first = list[0];
      if (!first) continue;
      if (first.name.toLowerCase().startsWith(lower)) {
        out.push(first);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  all(): PawnSymbol[] {
    const out: PawnSymbol[] = [];
    for (const list of this.symbols.values()) if (list[0]) out.push(list[0]);
    return out;
  }

  clear(): void {
    this.symbols.clear();
  }
}
