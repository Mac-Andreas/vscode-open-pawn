import * as vscode from 'vscode';
import { PawnIndex, PawnSymbol } from './indexer';

const PAWN_GLOB = '**/*.{pwn,inc,p,pawn}';
const SELECTOR: vscode.DocumentSelector = { language: 'pawn' };

/** Word under/just-before the cursor, matching Pawn identifier rules. */
function wordRangeAt(doc: vscode.TextDocument, pos: vscode.Position): vscode.Range | undefined {
  return doc.getWordRangeAtPosition(pos, /[A-Za-z_@][A-Za-z0-9_@]*/);
}

function completionKindFor(kind: PawnSymbol['kind']): vscode.CompletionItemKind {
  switch (kind) {
    case 'native':
    case 'function':
    case 'callback':
      return vscode.CompletionItemKind.Function;
    case 'define':
      return vscode.CompletionItemKind.Constant;
    case 'enum':
      return vscode.CompletionItemKind.EnumMember;
  }
}

function symbolKindFor(kind: PawnSymbol['kind']): vscode.SymbolKind {
  switch (kind) {
    case 'native':
    case 'function':
    case 'callback':
      return vscode.SymbolKind.Function;
    case 'define':
      return vscode.SymbolKind.Constant;
    case 'enum':
      return vscode.SymbolKind.EnumMember;
  }
}

function hoverMarkdown(sym: PawnSymbol): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(sym.signature, 'pawn');
  if (sym.doc) md.appendMarkdown('\n\n' + sym.doc);
  md.appendMarkdown(`\n\n_${sym.kind}_`);
  return md;
}

/**
 * Wire up completion, hover, definition, and symbol providers backed by a shared
 * PawnIndex. The index is (re)built from all workspace Pawn files and kept fresh
 * on save/change/delete.
 */
export function registerLanguageFeatures(context: vscode.ExtensionContext): PawnIndex {
  const index = new PawnIndex();

  // Build the initial index in the background.
  void rebuildAll(index);

  // Keep the index fresh.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'pawn') index.indexDocument(doc.uri, doc.getText());
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'pawn') index.indexDocument(doc.uri, doc.getText());
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher(PAWN_GLOB);
  watcher.onDidDelete((uri) => index.removeFile(uri));
  watcher.onDidChange(async (uri) => indexUri(index, uri));
  watcher.onDidCreate(async (uri) => indexUri(index, uri));
  context.subscriptions.push(watcher);

  // Completion: workspace symbols + a useful fallback set.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, {
      provideCompletionItems(doc, pos) {
        // Never let a provider error break autocomplete for the session
        // (cf. openmultiplayer/vscode-pawn#5).
        try {
          const range = wordRangeAt(doc, pos);
          const prefix = range ? doc.getText(range) : '';
          const items: vscode.CompletionItem[] = [];
          for (const sym of index.match(prefix || '', 500)) {
            const item = new vscode.CompletionItem(sym.name, completionKindFor(sym.kind));
            item.detail = sym.signature;
            if (sym.doc) item.documentation = new vscode.MarkdownString(sym.doc);
            items.push(item);
          }
          return items;
        } catch {
          return [];
        }
      },
    })
  );

  // Hover.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        const range = wordRangeAt(doc, pos);
        if (!range) return undefined;
        const name = doc.getText(range);
        const syms = index.get(name);
        if (!syms.length) return undefined;
        return new vscode.Hover(hoverMarkdown(syms[0]), range);
      },
    })
  );

  // Go-to-definition.
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(doc, pos) {
        const range = wordRangeAt(doc, pos);
        if (!range) return undefined;
        const name = doc.getText(range);
        const syms = index.get(name).filter((s) => s.kind !== 'callback');
        return syms.map(
          (s) => new vscode.Location(s.uri, new vscode.Position(s.line, 0))
        );
      },
    })
  );

  // Document symbols (outline).
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(doc) {
        const local = new PawnIndex();
        local.indexDocument(doc.uri, doc.getText());
        return local.all().map((s) => {
          const pos = new vscode.Position(s.line, 0);
          return new vscode.SymbolInformation(
            s.name,
            symbolKindFor(s.kind),
            s.signature,
            new vscode.Location(doc.uri, pos)
          );
        });
      },
    })
  );

  // Workspace symbols (Cmd+T).
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols(query) {
        return index.match(query, 500).map((s) => {
          const pos = new vscode.Position(s.line, 0);
          return new vscode.SymbolInformation(
            s.name,
            symbolKindFor(s.kind),
            '',
            new vscode.Location(s.uri, pos)
          );
        });
      },
    })
  );

  // Signature help: show the function signature while typing arguments.
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      SELECTOR,
      {
        provideSignatureHelp(doc, pos) {
          const line = doc.lineAt(pos.line).text.slice(0, pos.character);
          const call = /([A-Za-z_@][A-Za-z0-9_@]*)\s*\([^()]*$/.exec(line);
          if (!call) return undefined;
          const syms = index.get(call[1]);
          if (!syms.length) return undefined;
          const help = new vscode.SignatureHelp();
          help.signatures = [new vscode.SignatureInformation(syms[0].signature)];
          help.activeSignature = 0;
          return help;
        },
      },
      '(',
      ','
    )
  );

  return index;
}

async function indexUri(index: PawnIndex, uri: vscode.Uri): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    index.indexDocument(uri, Buffer.from(bytes).toString('utf8'));
  } catch {
    /* file vanished or unreadable; ignore */
  }
}

async function rebuildAll(index: PawnIndex): Promise<void> {
  index.clear();
  const files = await vscode.workspace.findFiles(PAWN_GLOB, '**/node_modules/**', 4000);
  for (const uri of files) {
    await indexUri(index, uri);
  }
}
