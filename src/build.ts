import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ResolvedCompiler, resolveCompiler } from './compiler';
import { parsePawnccOutput, applyDiagnostics } from './diagnostics';

export interface BuildContext {
  output: vscode.OutputChannel;
  diagnostics: vscode.DiagnosticCollection;
  status: vscode.StatusBarItem;
}

/** Build the pawncc argument list from settings for a given source file. */
function buildArgs(
  workspaceRoot: string,
  sourceFile: string
): { args: string[]; outPath: string } {
  const cfg = vscode.workspace.getConfiguration('pawnOmp');
  const includePaths = cfg.get<string[]>('includePaths', []);
  const outputDir = cfg.get<string>('outputDir', '').trim();
  const extraArgs = cfg.get<string[]>('compilerArgs', []);

  const baseName = path.basename(sourceFile, path.extname(sourceFile));
  const outDir = outputDir
    ? (path.isAbsolute(outputDir) ? outputDir : path.join(workspaceRoot, outputDir))
    : path.dirname(sourceFile);
  const outPath = path.join(outDir, `${baseName}.amx`);

  const args: string[] = [sourceFile, `-o${outPath}`];

  for (const inc of includePaths) {
    const abs = path.isAbsolute(inc) ? inc : path.join(workspaceRoot, inc);
    if (fs.existsSync(abs)) {
      args.push(`-i${abs}`);
    }
  }
  args.push(...extraArgs);

  return { args, outPath };
}

/**
 * Compile a single source file. Resolves the compiler (native or Wine), runs it,
 * streams output to the channel, and publishes diagnostics. Resolves to true on
 * a clean compile (exit 0, .amx produced).
 */
export async function compileFile(
  workspaceRoot: string,
  sourceFile: string,
  ctx: BuildContext
): Promise<boolean> {
  const compiler = resolveCompiler(workspaceRoot);
  if (!compiler) {
    ctx.output.appendLine(
      '✗ No compiler found. Set `pawnOmp.compilerPath` to a native pawncc, ' +
        'or `pawnOmp.wineWrapperPath` to a pawn-cc.sh wrapper.'
    );
    ctx.output.show(true);
    vscode.window.showErrorMessage('Pawn: no compiler found (see Output → Pawn).');
    return false;
  }

  const { args, outPath } = buildArgs(workspaceRoot, sourceFile);

  ctx.status.text = '$(sync~spin) Pawn: compiling…';
  ctx.status.show();
  ctx.output.appendLine('');
  ctx.output.appendLine(`▶ Compiling ${path.relative(workspaceRoot, sourceFile)}`);
  ctx.output.appendLine(`  using ${compiler.label}`);
  ctx.output.appendLine(`  ${quoteForLog(compiler.command, args)}`);

  const result = await runCompiler(compiler, args, workspaceRoot);
  ctx.output.append(result.output);

  const parsed = parsePawnccOutput(result.output, workspaceRoot);
  applyDiagnostics(ctx.diagnostics, parsed);

  const amxOk = fs.existsSync(outPath);
  const success = result.code === 0 && parsed.errorCount === 0 && amxOk;

  if (success) {
    ctx.status.text = `$(check) Pawn: built (${parsed.warningCount}w)`;
    ctx.output.appendLine(
      `✓ Built ${path.relative(workspaceRoot, outPath)} ` +
        `(${parsed.warningCount} warning${parsed.warningCount === 1 ? '' : 's'})`
    );
  } else {
    ctx.status.text = `$(error) Pawn: ${parsed.errorCount}e ${parsed.warningCount}w`;
    ctx.output.appendLine(
      `✗ Compile failed (${parsed.errorCount} error${parsed.errorCount === 1 ? '' : 's'}, ` +
        `${parsed.warningCount} warning${parsed.warningCount === 1 ? '' : 's'})`
    );
    ctx.output.show(true);
  }

  // Reset status after a short delay so it doesn't linger forever.
  setTimeout(() => {
    ctx.status.text = '$(tools) Pawn';
  }, 6000);

  return success;
}

function runCompiler(
  compiler: ResolvedCompiler,
  args: string[],
  cwd: string
): Promise<{ code: number; output: string }> {
  // The Linux pawncc links libpawnc.so without an $ORIGIN rpath, so point the
  // loader at the binary's own directory. (macOS uses @loader_path and Windows
  // resolves the DLL from the exe's folder, so neither needs this.)
  const env = { ...process.env };
  if (compiler.kind === 'native' && process.platform === 'linux') {
    const dir = path.dirname(compiler.command);
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${dir}:${env.LD_LIBRARY_PATH}` : dir;
  }
  return new Promise((resolve) => {
    execFile(
      compiler.command,
      args,
      { cwd, env, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = (stdout ?? '') + (stderr ?? '');
        // execFile sets err for non-zero exit; pawncc returns 1 when it emits errors.
        const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
        resolve({ code, output });
      }
    );
  });
}

function quoteForLog(cmd: string, args: string[]): string {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [cmd, ...args].map(q).join(' ');
}
