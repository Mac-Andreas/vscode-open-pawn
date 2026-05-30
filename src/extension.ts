import * as vscode from 'vscode';
import * as path from 'path';
import { compileFile, BuildContext } from './build';
import { resolveCompiler, probeNativeMagic, setBundledBinRoot } from './compiler';
import { registerLanguageFeatures } from './language';
import { registerEditingFeatures } from './editing';

const PAWN_EXTENSIONS = ['.pwn', '.inc', '.p', '.pawn'];

let ctx: BuildContext;

export function activate(context: vscode.ExtensionContext) {
  // Tell the resolver where the bundled per-platform pawncc binaries live.
  setBundledBinRoot(path.join(context.extensionPath, 'bin'));

  const output = vscode.window.createOutputChannel('Pawn');
  const diagnostics = vscode.languages.createDiagnosticCollection('pawn');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = '$(tools) Pawn';
  status.command = 'pawnOmp.compile';
  status.tooltip = 'Compile Pawn (open.mp)';
  status.show();

  ctx = { output, diagnostics, status };
  context.subscriptions.push(output, diagnostics, status);

  context.subscriptions.push(
    vscode.commands.registerCommand('pawnOmp.compile', () => compileActiveFile()),
    vscode.commands.registerCommand('pawnOmp.compileMain', () => compileMain()),
    vscode.commands.registerCommand('pawnOmp.showCompilerInfo', () => showCompilerInfo())
  );

  // Compile-on-save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => onSave(doc))
  );

  // Build-task provider so Cmd+Shift+B / tasks.json can drive the same pipeline.
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('pawn-omp', new PawnTaskProvider())
  );

  // Language smarts: completions, hovers, go-to-definition, symbols, signature help.
  registerLanguageFeatures(context);

  // Editing: folding ranges + a crash-safe formatter.
  registerEditingFeatures(context);

  // If a conflicting Pawn extension is installed, offer to disable it.
  void checkForConflicts(context);
}

const CONFLICTING_EXT = 'openmp.pawn-development';
const CONFLICT_DISMISS_KEY = 'pawnOmp.conflictDismissed';

/**
 * Other Pawn extensions claim the same `pawn` language and register overlapping
 * providers, which can produce duplicate completions/hovers. VS Code does not
 * allow one extension to disable another programmatically, so the best we can do
 * is detect the overlap and guide the user to disable the other one.
 */
async function checkForConflicts(context: vscode.ExtensionContext): Promise<void> {
  const other = vscode.extensions.getExtension(CONFLICTING_EXT);
  if (!other) return;
  if (context.globalState.get<boolean>(CONFLICT_DISMISS_KEY)) return;

  const choice = await vscode.window.showInformationMessage(
    'Another Pawn extension ("Pawn Development Tool") is installed. Having both ' +
      'active can cause duplicate autocomplete and hovers. Disable the other one?',
    'Disable it',
    'Keep both',
    "Don't ask again"
  );

  if (choice === 'Disable it') {
    // We cannot disable it directly; open the Extensions view focused on it so
    // the user can toggle it off in one click.
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${CONFLICTING_EXT}`);
    void vscode.window.showInformationMessage(
      'Click the gear on "Pawn Development Tool" → Disable, then reload.'
    );
  } else if (choice === "Don't ask again") {
    await context.globalState.update(CONFLICT_DISMISS_KEY, true);
  }
}

export function deactivate() {
  /* disposables handled via context.subscriptions */
}

function workspaceRootFor(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) return folder.uri.fsPath;
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function isPawnFile(filePath: string): boolean {
  return PAWN_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

async function compileActiveFile(): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Pawn: no active editor to compile.');
    return false;
  }
  await editor.document.save();
  const file = editor.document.uri.fsPath;
  const root = workspaceRootFor(editor.document.uri);
  if (!root) {
    vscode.window.showWarningMessage('Pawn: open a workspace folder to compile.');
    return false;
  }
  return compileFile(root, file, ctx);
}

async function compileMain(): Promise<boolean> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage('Pawn: open a workspace folder to compile.');
    return false;
  }
  const main = vscode.workspace.getConfiguration('pawnOmp').get<string>('mainScript', '').trim();
  if (!main) {
    vscode.window.showWarningMessage(
      'Pawn: set `pawnOmp.mainScript` (e.g. gamemodes/survival.pwn) to use Compile Main Script.'
    );
    return false;
  }
  const file = path.isAbsolute(main) ? main : path.join(root, main);
  return compileFile(root, file, ctx);
}

async function onSave(doc: vscode.TextDocument): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('pawnOmp');
  if (!cfg.get<boolean>('compileOnSave', false)) return;
  if (!isPawnFile(doc.uri.fsPath)) return;

  const root = workspaceRootFor(doc.uri);
  if (!root) return;

  const target = cfg.get<string>('compileOnSaveTarget', 'mainScript');
  const main = cfg.get<string>('mainScript', '').trim();

  if (target === 'mainScript' && main) {
    const file = path.isAbsolute(main) ? main : path.join(root, main);
    await compileFile(root, file, ctx);
  } else {
    await compileFile(root, doc.uri.fsPath, ctx);
  }
}

async function showCompilerInfo(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage('Pawn: open a workspace folder first.');
    return;
  }
  const compiler = resolveCompiler(root);
  ctx.output.show(true);
  ctx.output.appendLine('');
  ctx.output.appendLine('── Pawn compiler info ──');
  if (!compiler) {
    ctx.output.appendLine('No compiler found.');
    return;
  }
  ctx.output.appendLine(`Resolved: ${compiler.label}`);
  ctx.output.appendLine(`Kind:     ${compiler.kind}`);

  if (compiler.kind === 'native') {
    const { magic, error } = await probeNativeMagic(compiler.command);
    if (error) {
      ctx.output.appendLine(`Probe:    failed — ${error}`);
    } else if (magic !== undefined) {
      const hex = '0x' + magic.toString(16).toUpperCase().padStart(4, '0');
      const ok = magic === 0xf1e0;
      ctx.output.appendLine(
        `AMX magic: ${hex} ${ok ? '✓ (open.mp compatible)' : '✗ (open.mp expects 0xF1E0 — likely a 64-bit-cell build)'}`
      );
    }
  } else {
    ctx.output.appendLine('Native pawncc not found; using Wine wrapper (slower, needs CrossOver/Wine).');
  }
}

/**
 * Task provider so `pawn-omp` shows up under Run Build Task and can be pinned
 * in tasks.json. Each task delegates to the same compile command.
 */
class PawnTaskProvider implements vscode.TaskProvider {
  provideTasks(): vscode.Task[] {
    const task = new vscode.Task(
      { type: 'pawn-omp' },
      vscode.TaskScope.Workspace,
      'Compile current Pawn file',
      'pawn-omp',
      new vscode.CustomExecution(async () => new PawnPseudoTerminal('current')),
      []
    );
    task.group = vscode.TaskGroup.Build;
    return [task];
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const file = task.definition.file as string | undefined;
    return new vscode.Task(
      task.definition,
      task.scope ?? vscode.TaskScope.Workspace,
      task.name || 'Compile Pawn',
      'pawn-omp',
      new vscode.CustomExecution(async () => new PawnPseudoTerminal(file ?? 'current')),
      []
    );
  }
}

/**
 * Minimal pseudo-terminal that runs a compile and closes. Reuses the command
 * pipeline so a build task produces the same diagnostics/output as the command.
 */
class PawnPseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite = this.writeEmitter.event;
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose = this.closeEmitter.event;

  constructor(private target: string) {}

  async open(): Promise<void> {
    let ok = false;
    if (this.target === 'current') {
      ok = await compileActiveFile();
    } else {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) {
        const file = path.isAbsolute(this.target) ? this.target : path.join(root, this.target);
        ok = await compileFile(root, file, ctx);
      }
    }
    this.writeEmitter.fire(
      ok ? 'Pawn build succeeded. See Output → Pawn.\r\n' : 'Pawn build failed. See Output → Pawn.\r\n'
    );
    this.closeEmitter.fire(ok ? 0 : 1);
  }

  close(): void {
    /* nothing to clean up */
  }
}
