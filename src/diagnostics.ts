import * as vscode from 'vscode';
import * as path from 'path';

/**
 * pawncc emits diagnostics in the form:
 *   /abs/path/file.pwn(123) : error 017: undefined symbol "printf"
 *   /abs/path/file.pwn(45) : warning 203: symbol is never used: "x"
 *   /abs/path/file.pwn(45 -- 47) : error 001: ...      (range form)
 *
 * It also emits "fatal error" lines. We parse all of these into VSCode
 * diagnostics grouped by file URI.
 */
const LINE_RE =
  /^(.*?)\((\d+)(?:\s*--\s*(\d+))?\)\s*:\s*(fatal error|error|warning)\s+(\d+):\s*(.*)$/;

export interface ParsedDiagnostics {
  byFile: Map<string, vscode.Diagnostic[]>;
  errorCount: number;
  warningCount: number;
}

function severityFor(kind: string): vscode.DiagnosticSeverity {
  return kind === 'warning'
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
}

/**
 * Parse raw pawncc stdout+stderr into diagnostics.
 *
 * `baseDir` is used to resolve any relative file paths pawncc may print
 * (it usually prints absolute paths, but compatibility mode can differ).
 */
export function parsePawnccOutput(output: string, baseDir: string): ParsedDiagnostics {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  let errorCount = 0;
  let warningCount = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = LINE_RE.exec(line);
    if (!m) continue;

    const [, filePart, startStr, endStr, kind, code, message] = m;
    const startLine = Math.max(0, parseInt(startStr, 10) - 1);
    const endLine = endStr ? Math.max(0, parseInt(endStr, 10) - 1) : startLine;

    // Highlight the whole line; pawncc gives line numbers, not columns.
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
    );

    const diag = new vscode.Diagnostic(
      range,
      `${message}  (${code})`,
      severityFor(kind)
    );
    diag.source = 'pawncc';
    diag.code = code;

    if (kind === 'warning') warningCount++;
    else errorCount++;

    const absFile = path.isAbsolute(filePart)
      ? filePart
      : path.join(baseDir, filePart);
    const list = byFile.get(absFile) ?? [];
    list.push(diag);
    byFile.set(absFile, list);
  }

  return { byFile, errorCount, warningCount };
}

/** Apply parsed diagnostics to the shared collection, replacing prior results. */
export function applyDiagnostics(
  collection: vscode.DiagnosticCollection,
  parsed: ParsedDiagnostics
): void {
  collection.clear();
  for (const [file, diags] of parsed.byFile) {
    collection.set(vscode.Uri.file(file), diags);
  }
}
