import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

/**
 * A resolved compiler: either a native pawncc binary or a Wine wrapper script.
 *
 * The native path is preferred — on Apple Silicon a natively-built pawncc
 * (32-bit cells) emits AMX magic 0xF1E0, which the open.mp server accepts, with
 * none of Wine's startup cost. The Wine wrapper exists only as a fallback for
 * setups that still rely on the Windows pawncc.exe.
 */
export interface ResolvedCompiler {
  kind: 'native' | 'wine';
  /** Executable to invoke (the pawncc binary, or the wrapper .sh). */
  command: string;
  /** Human-readable description for the output channel / info command. */
  label: string;
}

/** Native compiler executable name for the current platform. */
const PAWNCC_BIN = process.platform === 'win32' ? 'pawncc.exe' : 'pawncc';

/**
 * Workspace-relative locations to probe for a native compiler, in priority
 * order. On Windows the binary is `pawncc.exe`; elsewhere it's `pawncc`.
 * The trailing bare name triggers a PATH lookup (see findOnPath).
 */
const NATIVE_CANDIDATES = [
  `qawno/native/${PAWNCC_BIN}`,
  `qawno/${PAWNCC_BIN}`,
  `pawno/${PAWNCC_BIN}`,
  PAWNCC_BIN,
];

/**
 * Wine wrapper scripts (macOS/Linux only). On Windows pawncc.exe runs directly,
 * so there is nothing to wrap — this list is effectively unused there.
 */
const WINE_CANDIDATES = [
  'qawno/pawn-cc.sh',
  'qawno/run-pawncc-wine.sh',
  'pawn-cc.sh',
  'run-pawncc-wine.sh',
];

/**
 * Per-platform subfolder of the extension's bundled `bin/` directory, used as a
 * last-resort compiler when the workspace has none. Filled in by setBundledDir.
 */
function bundledSubdir(): string | undefined {
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (process.platform === 'linux') return 'linux-x64';
  return undefined;
}

/** Absolute path to the extension's bundled bin/ dir; set on activation. */
let bundledBinRoot: string | undefined;
export function setBundledBinRoot(dir: string): void {
  bundledBinRoot = dir;
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve a workspace-relative or absolute path against the workspace root. */
function resolveInWorkspace(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/** Look up an executable on PATH. On Windows, tries PATHEXT extensions too. */
function findOnPath(name: string): string | undefined {
  const PATH = process.env.PATH ?? '';
  // On Windows an unqualified name may resolve via PATHEXT (.EXE, .CMD, …).
  const exts =
    process.platform === 'win32' && !path.extname(name)
      ? (process.env.PATHEXT ?? '.EXE').split(';').filter(Boolean)
      : [''];
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (exists(full)) return full;
    }
  }
  return undefined;
}

/**
 * The extension's own bundled pawncc for the current platform, if present.
 * Lets the extension compile out-of-the-box when the workspace has no compiler.
 */
function findBundled(): ResolvedCompiler | undefined {
  const sub = bundledSubdir();
  if (!bundledBinRoot || !sub) return undefined;
  const p = path.join(bundledBinRoot, sub, PAWNCC_BIN);
  if (exists(p)) return { kind: 'native', command: p, label: `bundled pawncc (${p})` };
  return undefined;
}

/**
 * Decide which compiler to use for a given workspace folder.
 *
 * Order: explicit native setting -> preferWine override -> native candidates ->
 * explicit wine setting -> wine candidates. Returns undefined if nothing found.
 */
export function resolveCompiler(workspaceRoot: string): ResolvedCompiler | undefined {
  const cfg = vscode.workspace.getConfiguration('pawnOmp');
  const explicitNative = cfg.get<string>('compilerPath', '').trim();
  const explicitWine = cfg.get<string>('wineWrapperPath', '').trim();
  const preferWine = cfg.get<boolean>('preferWine', false);

  const findNative = (): ResolvedCompiler | undefined => {
    if (explicitNative) {
      const p = resolveInWorkspace(workspaceRoot, explicitNative);
      if (exists(p)) return { kind: 'native', command: p, label: `native pawncc (${p})` };
      return undefined;
    }
    for (const c of NATIVE_CANDIDATES) {
      if (c === PAWNCC_BIN) {
        const onPath = findOnPath(PAWNCC_BIN);
        if (onPath) return { kind: 'native', command: onPath, label: `native pawncc (PATH: ${onPath})` };
        continue;
      }
      const p = resolveInWorkspace(workspaceRoot, c);
      if (exists(p)) return { kind: 'native', command: p, label: `native pawncc (${p})` };
    }
    return undefined;
  };

  const findWine = (): ResolvedCompiler | undefined => {
    if (explicitWine) {
      const p = resolveInWorkspace(workspaceRoot, explicitWine);
      if (exists(p)) return { kind: 'wine', command: p, label: `Wine wrapper (${p})` };
      return undefined;
    }
    for (const c of WINE_CANDIDATES) {
      const p = resolveInWorkspace(workspaceRoot, c);
      if (exists(p)) return { kind: 'wine', command: p, label: `Wine wrapper (${p})` };
    }
    return undefined;
  };

  if (preferWine) {
    return findWine() ?? findNative() ?? findBundled();
  }
  // Workspace compiler first; then the extension's bundled binary; Wine last
  // (Wine only ever resolves on macOS/Linux where a .sh wrapper exists).
  return findNative() ?? findBundled() ?? findWine();
}

/**
 * Probe a native pawncc by compiling a trivial throwaway program and reading the
 * AMX magic number. open.mp requires 0xF1E0 (32-bit cells); a 64-bit-cell build
 * emits 0xF1E1, which the server rejects. Returns the magic as a hex string, or
 * an error message.
 */
export function probeNativeMagic(command: string): Promise<{ magic?: number; error?: string }> {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pawn-probe-'));
    const src = path.join(tmpDir, 'probe.pwn');
    const out = path.join(tmpDir, 'probe.amx');
    fs.writeFileSync(src, 'main(){new x=1;x++;}\n');
    execFile(command, [src, `-o${out}`], { cwd: tmpDir }, (err) => {
      try {
        if (!exists(out)) {
          resolve({ error: err ? String(err.message ?? err) : 'no .amx produced' });
          return;
        }
        const buf = fs.readFileSync(out);
        // AMX header: magic is a 16-bit LE value at offset 0x04.
        const magic = buf.readUInt16LE(4);
        resolve({ magic });
      } catch (e) {
        resolve({ error: String(e) });
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    });
  });
}
