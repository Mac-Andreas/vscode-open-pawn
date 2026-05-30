import * as vscode from 'vscode';

/**
 * Folding + formatting for Pawn.
 *
 * The folding range logic is adapted from openmultiplayer/vscode-pawn
 * (MIT, Copyright (c) 2019 Indian Ocean Roleplay) — see NOTICE.md.
 *
 * The formatter is a deliberately lightweight, dependency-free re-implementation.
 * The upstream extension used the `astyle` WASM library, which repeatedly
 * crashed the VS Code extension host (openmultiplayer/vscode-pawn#7, #8, #13),
 * especially on SSH / network paths. We avoid that whole failure class by doing
 * brace-aware reindentation in pure TypeScript.
 */

const SELECTOR: vscode.DocumentSelector = { language: 'pawn' };

// ---------------------------------------------------------------------------
// Folding (adapted from MIT upstream; brace + //#region + block comments)
// ---------------------------------------------------------------------------

class PawnFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const folds: vscode.FoldingRange[] = [];
    const braceStack: number[] = [];
    const regionStack: number[] = [];
    let blockCommentStart = -1;

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;

      if (/\/\/\s*#region\b/.test(line)) regionStack.push(i);
      else if (/\/\/\s*#endregion\b/.test(line)) {
        const s = regionStack.pop();
        if (s !== undefined && s < i) {
          folds.push(new vscode.FoldingRange(s, i, vscode.FoldingRangeKind.Region));
        }
      }

      if (/\/\*/.test(line) && !/\*\//.test(line)) blockCommentStart = i;
      else if (/\*\//.test(line) && blockCommentStart >= 0) {
        if (blockCommentStart < i) {
          folds.push(new vscode.FoldingRange(blockCommentStart, i, vscode.FoldingRangeKind.Comment));
        }
        blockCommentStart = -1;
      }

      // Brace folding: count net braces, ignoring those in strings/line comments.
      const cleaned = stripStringsAndComments(line);
      for (const ch of cleaned) {
        if (ch === '{') braceStack.push(i);
        else if (ch === '}') {
          const s = braceStack.pop();
          if (s !== undefined && s < i) folds.push(new vscode.FoldingRange(s, i));
        }
      }
    }
    return folds;
  }
}

// ---------------------------------------------------------------------------
// Formatter (clean-room, no external deps)
// ---------------------------------------------------------------------------

/** Remove string/char literals and line comments so braces inside them don't count. */
function stripStringsAndComments(line: string): string {
  let out = '';
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    out += c;
  }
  return out;
}

interface FormatOpts {
  indentUnit: string;
}

/**
 * Brace-aware reindentation. Conservative by design: it only adjusts leading
 * indentation, never touches the content of a line, and leaves preprocessor
 * directives and label/`case` lines sensible. It never throws — on any anomaly
 * it returns the original text unchanged.
 */
export function formatPawn(text: string, opts: FormatOpts): string {
  try {
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let depth = 0;

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed === '') { out.push(''); continue; }

      const code = stripStringsAndComments(trimmed);
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;

      // A line that starts by closing a block dedents before being printed.
      let thisDepth = depth;
      if (/^\}/.test(trimmed)) thisDepth = Math.max(0, depth - 1);
      // `case x:` / `default:` / labels sit one level out from their body — leave
      // as-is (the body lines indent themselves via braces or are switch cases).

      // Preprocessor directives are pinned to column 0 (Pawn convention).
      const indent = /^#/.test(trimmed) ? '' : opts.indentUnit.repeat(thisDepth);
      out.push(indent + trimmed);

      depth = Math.max(0, depth + opens - closes);
    }
    return out.join('\n');
  } catch {
    return text; // never crash the host — worst case, no-op format
  }
}

class PawnFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const indentUnit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    const formatted = formatPawn(document.getText(), { indentUnit });
    if (formatted === document.getText()) return [];
    const full = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    return [vscode.TextEdit.replace(full, formatted)];
  }
}

export function registerEditingFeatures(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new PawnFoldingProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, new PawnFormatter())
  );
}
