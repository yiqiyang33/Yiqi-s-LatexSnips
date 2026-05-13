import * as vscode from 'vscode';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import * as path from 'path';
import { getSnippetDir } from './utils';
import {
  assertExpectedSnippetDocumentHash,
  parseSnippetDocument,
  SnippetDocument,
} from './snippetDocument';

interface SnippetManagerMessage {
  type: string;
  filePath?: string;
  line?: number;
  content?: string;
  documentHash?: string;
  mtimeMs?: number;
  requestId?: number;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function readSnippetDocuments(snippetDir = getSnippetDir()) {
  if (!existsSync(snippetDir)) {
    mkdirSync(snippetDir, { recursive: true });
  }

  return readdirSync(snippetDir)
    .filter((file) => path.extname(file).toLowerCase() == '.hsnips')
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      let filePath = path.join(snippetDir, file);
      let content = readFileSync(filePath, 'utf8');
      let stat = statSync(filePath);
      let document = parseSnippetDocument(content, filePath, path.basename(file, '.hsnips'));
      document.mtimeMs = stat.mtimeMs;
      return document;
    });
}

function toWebviewDocument(document: SnippetDocument, savedHash = document.hash) {
  return {
    filePath: document.filePath,
    fileName: path.basename(document.filePath),
    language: document.language,
    savedHash,
    contentHash: document.hash,
    mtimeMs: document.mtimeMs,
    content: document.content,
    diagnostics: document.diagnostics,
    snippets: document.snippets.map((snippet) => ({
      id: snippet.id,
      trigger: snippet.trigger,
      description: snippet.description,
      flags: snippet.flags,
      priority: snippet.priority,
      body: snippet.body,
      language: snippet.language,
      filePath: snippet.filePath,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      sourceStart: snippet.priorityStart ?? snippet.headerStart,
      sourceEnd: snippet.endOffset,
      isRegex: snippet.isRegex,
      isDynamic: snippet.isDynamic,
      isSimple: snippet.isSimple,
      diagnostics: snippet.diagnostics,
    })),
  };
}

function getWebviewState(documents: SnippetDocument[]) {
  return {
    documents: documents.map((document) => toWebviewDocument(document)),
  };
}

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  documents: SnippetDocument[]
) {
  let nonce = getNonce();
  let state = escapeScriptJson(getWebviewState(documents));
  let monacoVsUri = vscode.Uri.joinPath(extensionUri, 'media', 'monaco', 'vs');
  let monacoBaseUri = webview.asWebviewUri(monacoVsUri).toString();
  let monacoLoaderUri = webview
    .asWebviewUri(vscode.Uri.joinPath(monacoVsUri, 'loader.js'))
    .toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval'; worker-src ${webview.cspSource} blob: data:; connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snippet Manager</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border);
      --muted: var(--vscode-descriptionForeground);
      --danger: var(--vscode-errorForeground);
      --warn: var(--vscode-editorWarning-foreground);
      --bg: var(--vscode-editor-background);
      --side: var(--vscode-sideBar-background);
      --input: var(--vscode-input-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --active: var(--vscode-list-activeSelectionBackground);
      --active-fg: var(--vscode-list-activeSelectionForeground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--bg);
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(170px, 250px) minmax(180px, 1fr) auto;
      gap: 8px;
      align-items: center;
      height: 48px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--side);
    }
    .filters, .actions, .summary, .snippet-main, .badges {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .filters {
      grid-column: 1 / -1;
      gap: 12px;
      color: var(--muted);
      white-space: nowrap;
    }
    .filters label {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--input);
      color: var(--vscode-input-foreground);
      padding: 6px 8px;
      font: inherit;
    }
    button {
      border: 0;
      background: var(--button);
      color: var(--button-fg);
      padding: 6px 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.icon {
      min-width: 32px;
      padding: 6px;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(260px, 28%) minmax(360px, 1fr) minmax(240px, 24%);
      height: calc(100vh - 84px);
      min-height: 420px;
    }
    .sidebar, .inspector {
      overflow: auto;
      background: var(--side);
    }
    .sidebar {
      border-right: 1px solid var(--border);
    }
    .inspector {
      border-left: 1px solid var(--border);
      padding: 12px;
    }
    .editor-wrap {
      min-width: 0;
      min-height: 0;
      position: relative;
    }
    #editor, #fallbackEditor {
      width: 100%;
      height: 100%;
    }
    #fallbackEditor {
      display: none;
      resize: none;
      border: 0;
      padding: 12px;
      font-family: var(--vscode-editor-font-family);
      line-height: 1.45;
    }
    .summary {
      justify-content: space-between;
      padding: 9px 10px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .snippet-list {
      display: grid;
    }
    .snippet-row {
      display: grid;
      gap: 3px;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-bottom: 1px solid var(--border);
      text-align: left;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
    }
    .snippet-row.active {
      background: var(--active);
      color: var(--active-fg);
    }
    .trigger {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
      font-weight: 600;
    }
    .meta, .diag, .body-preview, .empty, .status {
      color: var(--muted);
      font-size: 0.92em;
    }
    .meta, .diag {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      flex: 0 0 auto;
      border: 1px solid var(--border);
      padding: 1px 5px;
      color: var(--muted);
      font-size: 0.85em;
    }
    .diag.error, .count.error { color: var(--danger); }
    .diag.warning, .count.warning { color: var(--warn); }
    .inspector h2 {
      margin: 0 0 8px;
      font-size: 1.05em;
      font-weight: 600;
    }
    .section {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
    }
    .diagnostic-row {
      display: grid;
      gap: 2px;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }
    .body-preview {
      margin: 0;
      max-height: 220px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
    }
    .empty {
      padding: 16px 10px;
    }
    .status {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 920px) {
      body { overflow: auto; }
      .toolbar { height: auto; grid-template-columns: 1fr; }
      .filters, .actions { flex-wrap: wrap; }
      .layout {
        grid-template-columns: 1fr;
        height: auto;
      }
      .sidebar { max-height: 36vh; border-right: 0; border-bottom: 1px solid var(--border); }
      .editor-wrap { height: 48vh; }
      .inspector { border-left: 0; border-top: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <select id="fileSelect"></select>
    <input id="search" type="search" placeholder="Search trigger, description, flags, body">
    <div class="actions">
      <button id="openSource" class="secondary">Open Source</button>
      <button id="newSnippet" class="secondary">New</button>
      <button id="deleteSnippet" class="secondary">Delete</button>
      <button id="reload" class="secondary">Reload</button>
      <button id="save">Save</button>
    </div>
    <div class="filters">
      <label><input id="filterIssues" type="checkbox"> issues</label>
      <label><input id="filterDuplicates" type="checkbox"> duplicates</label>
      <label><input id="filterAutomatic" type="checkbox"> automatic</label>
      <label><input id="filterMath" type="checkbox"> math</label>
      <label><input id="filterDynamic" type="checkbox"> dynamic</label>
      <label><input id="filterRegex" type="checkbox"> regex</label>
      <span id="status" class="status"></span>
    </div>
  </div>
  <main class="layout">
    <section class="sidebar">
      <div id="summary" class="summary"></div>
      <div id="snippetList" class="snippet-list"></div>
    </section>
    <section class="editor-wrap">
      <div id="editor"></div>
      <textarea id="fallbackEditor" spellcheck="false"></textarea>
    </section>
    <section id="inspector" class="inspector"></section>
  </main>
  <script nonce="${nonce}" src="${monacoLoaderUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const initialState = ${state};
    const monacoBaseUri = ${JSON.stringify(monacoBaseUri)};
    let state = initialState;
    let selectedFile = state.documents[0]?.filePath || '';
    let selectedSnippetId = state.documents[0]?.snippets[0]?.id || '';
    let editor;
    let suppressEditorChange = false;
    let saving = false;
    let analysisSequence = 0;
    const dirtyFiles = new Set();
    const freshAnalysis = new Map();
    const analysisTimers = new Map();
    const latestAnalysisRequest = new Map();

    const fileSelect = document.getElementById('fileSelect');
    const search = document.getElementById('search');
    const list = document.getElementById('snippetList');
    const summary = document.getElementById('summary');
    const inspector = document.getElementById('inspector');
    const fallbackEditor = document.getElementById('fallbackEditor');
    const status = document.getElementById('status');
    const filterIssues = document.getElementById('filterIssues');
    const filterDuplicates = document.getElementById('filterDuplicates');
    const filterAutomatic = document.getElementById('filterAutomatic');
    const filterMath = document.getElementById('filterMath');
    const filterDynamic = document.getElementById('filterDynamic');
    const filterRegex = document.getElementById('filterRegex');
    const saveButton = document.getElementById('save');
    const deleteButton = document.getElementById('deleteSnippet');

    function currentDocument() {
      return state.documents.find(doc => doc.filePath === selectedFile) || state.documents[0];
    }

    function currentSnippet() {
      const doc = currentDocument();
      return doc?.snippets.find(snippet => snippet.id === selectedSnippetId);
    }

    function getEditorContent() {
      if (editor) return editor.getValue();
      return fallbackEditor.value;
    }

    function setEditorContent(content) {
      suppressEditorChange = true;
      if (editor) {
        if (editor.getValue() !== content) {
          editor.setValue(content);
        }
      } else {
        fallbackEditor.value = content;
      }
      suppressEditorChange = false;
    }

    function setStatus(message) {
      status.textContent = message || '';
    }

    function replaceDocument(nextDocument) {
      const index = state.documents.findIndex(doc => doc.filePath === nextDocument.filePath);
      if (index == -1) {
        state.documents.push(nextDocument);
      } else {
        state.documents[index] = nextDocument;
      }
      freshAnalysis.set(nextDocument.filePath, true);
    }

    function applyState(nextState) {
      state = nextState;
      dirtyFiles.clear();
      latestAnalysisRequest.clear();
      analysisTimers.forEach(timer => clearTimeout(timer));
      analysisTimers.clear();
      for (const doc of state.documents) {
        freshAnalysis.set(doc.filePath, true);
      }
      if (!state.documents.some(doc => doc.filePath === selectedFile)) {
        selectedFile = state.documents[0]?.filePath || '';
      }
      const doc = currentDocument();
      if (!doc?.snippets.some(snippet => snippet.id === selectedSnippetId)) {
        selectedSnippetId = doc?.snippets[0]?.id || '';
      }
      setEditorContent(doc?.content || '');
      render();
      setStatus('Ready');
    }

    function hasIssue(snippet) {
      return snippet.diagnostics.length > 0;
    }

    function hasDuplicate(snippet) {
      return snippet.diagnostics.some(d => d.message.includes('Duplicate') || d.message.includes('Multiple automatic'));
    }

    function filteredSnippets(doc) {
      const q = search.value.trim().toLowerCase();
      return doc.snippets.filter(snippet => {
        const haystack = [snippet.trigger, snippet.description, snippet.body, snippet.flags].join('\\n').toLowerCase();
        if (q && !haystack.includes(q)) return false;
        if (filterIssues.checked && !hasIssue(snippet)) return false;
        if (filterDuplicates.checked && !hasDuplicate(snippet)) return false;
        if (filterAutomatic.checked && !snippet.flags.includes('A')) return false;
        if (filterMath.checked && !snippet.flags.includes('m')) return false;
        if (filterDynamic.checked && !snippet.isDynamic) return false;
        if (filterRegex.checked && !snippet.isRegex) return false;
        return true;
      });
    }

    function diagnosticCounts(doc) {
      const counts = { error: 0, warning: 0, info: 0 };
      for (const diagnostic of doc?.diagnostics || []) {
        counts[diagnostic.severity] = (counts[diagnostic.severity] || 0) + 1;
      }
      return counts;
    }

    function renderFiles() {
      fileSelect.innerHTML = '';
      for (const doc of state.documents) {
        const option = document.createElement('option');
        const counts = diagnosticCounts(doc);
        option.value = doc.filePath;
        option.textContent = (dirtyFiles.has(doc.filePath) ? '* ' : '') +
          doc.fileName + ' (' + doc.snippets.length + ', ' +
          (counts.error + counts.warning) + ' issues)';
        fileSelect.appendChild(option);
      }
      fileSelect.value = selectedFile;
    }

    function renderSummary(doc, snippets) {
      summary.innerHTML = '';
      if (!doc) {
        summary.textContent = 'No .hsnips files';
        return;
      }
      const counts = diagnosticCounts(doc);
      const left = document.createElement('span');
      left.textContent = snippets.length + ' / ' + doc.snippets.length + ' snippets';
      const right = document.createElement('span');
      right.innerHTML =
        '<span class="count error">' + counts.error + ' errors</span> · ' +
        '<span class="count warning">' + counts.warning + ' warnings</span>';
      summary.append(left, right);
    }

    function renderList() {
      const doc = currentDocument();
      list.innerHTML = '';
      if (!doc) {
        list.innerHTML = '<div class="empty">No .hsnips files found.</div>';
        renderSummary(doc, []);
        return;
      }

      const snippets = filteredSnippets(doc);
      renderSummary(doc, snippets);
      if (!snippets.some(snippet => snippet.id === selectedSnippetId)) {
        selectedSnippetId = snippets[0]?.id || '';
      }

      for (const snippet of snippets) {
        const row = document.createElement('button');
        row.className = 'snippet-row' + (snippet.id === selectedSnippetId ? ' active' : '');
        row.type = 'button';
        row.onclick = () => {
          selectedSnippetId = snippet.id;
          revealSnippet(snippet);
          render();
        };

        const main = document.createElement('div');
        main.className = 'snippet-main';
        const trigger = document.createElement('span');
        trigger.className = 'trigger';
        trigger.textContent = snippet.trigger || '(empty)';
        const badges = document.createElement('span');
        badges.className = 'badges';
        for (const label of [
          snippet.flags || '-',
          snippet.priority ? 'p' + snippet.priority : 'p0',
          snippet.isRegex ? 'regex' : '',
          snippet.isDynamic ? 'dynamic' : '',
        ].filter(Boolean)) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = label;
          badges.appendChild(badge);
        }
        main.append(trigger, badges);

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = snippet.description || snippet.body.split('\\n')[0] || ' ';

        const diag = document.createElement('div');
        diag.className = 'diag';
        const firstDiag = snippet.diagnostics[0];
        if (firstDiag) {
          diag.textContent = firstDiag.message;
          diag.classList.add(firstDiag.severity);
        }

        row.append(main, meta, diag);
        list.appendChild(row);
      }

      if (snippets.length == 0) {
        list.innerHTML = '<div class="empty">No matching snippets.</div>';
      }
    }

    function renderInspector() {
      const doc = currentDocument();
      const snippet = currentSnippet();
      inspector.innerHTML = '';
      deleteButton.disabled = !snippet || freshAnalysis.get(selectedFile) === false;
      saveButton.disabled = saving || !doc || !dirtyFiles.has(selectedFile);

      if (!doc) {
        inspector.innerHTML = '<div class="empty">Create a .hsnips file first.</div>';
        return;
      }

      const docSection = document.createElement('div');
      docSection.className = 'section';
      const docTitle = document.createElement('h2');
      docTitle.textContent = doc.fileName + (dirtyFiles.has(doc.filePath) ? ' *' : '');
      const docMeta = document.createElement('div');
      docMeta.className = 'meta';
      docMeta.textContent = doc.filePath;
      docSection.append(docTitle, docMeta);
      inspector.appendChild(docSection);

      const diagnostics = doc.diagnostics.slice(0, 12);
      if (diagnostics.length > 0) {
        const diagSection = document.createElement('div');
        diagSection.className = 'section';
        const title = document.createElement('h2');
        title.textContent = 'Diagnostics';
        diagSection.appendChild(title);
        for (const diagnostic of diagnostics) {
          const row = document.createElement('div');
          row.className = 'diagnostic-row diag ' + diagnostic.severity;
          row.onclick = () => goToLine(diagnostic.line);
          const message = document.createElement('div');
          message.textContent = diagnostic.severity + ': ' + diagnostic.message;
          const location = document.createElement('div');
          location.className = 'meta';
          location.textContent = 'line ' + (diagnostic.line + 1);
          row.append(message, location);
          diagSection.appendChild(row);
        }
        inspector.appendChild(diagSection);
      }

      if (!snippet) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Select a snippet.';
        inspector.appendChild(empty);
        return;
      }

      const snippetSection = document.createElement('div');
      snippetSection.className = 'section';
      const title = document.createElement('h2');
      title.textContent = snippet.trigger || '(empty)';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = 'line ' + (snippet.startLine + 1) + ' · ' +
        (snippet.description || 'no description');
      const flags = document.createElement('div');
      flags.className = 'badges';
      for (const label of [
        snippet.flags || 'no flags',
        snippet.isRegex ? 'regex' : 'literal',
        snippet.isDynamic ? 'dynamic' : 'static',
        snippet.isSimple ? 'simple' : 'complex',
      ]) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = label;
        flags.appendChild(badge);
      }
      const body = document.createElement('pre');
      body.className = 'body-preview';
      body.textContent = snippet.body || '';
      snippetSection.append(title, meta, flags, body);
      inspector.appendChild(snippetSection);
    }

    function render() {
      renderFiles();
      renderList();
      renderInspector();
    }

    function revealSnippet(snippet) {
      if (!snippet) return;
      goToLine(snippet.startLine);
    }

    function goToLine(line) {
      if (editor) {
        const lineNumber = Math.max(line + 1, 1);
        editor.revealLineInCenter(lineNumber);
        editor.setPosition({ lineNumber, column: 1 });
        editor.focus();
      } else {
        const content = fallbackEditor.value;
        let offset = 0;
        for (let currentLine = 0; currentLine < line; currentLine++) {
          const next = content.indexOf('\\n', offset);
          if (next == -1) break;
          offset = next + 1;
        }
        fallbackEditor.focus();
        fallbackEditor.setSelectionRange(offset, offset);
      }
    }

    function selectSnippetAtLine(line) {
      const doc = currentDocument();
      if (!doc) return;
      const snippet = doc.snippets.find(item => line >= item.startLine && line <= item.endLine);
      if (snippet && snippet.id !== selectedSnippetId) {
        selectedSnippetId = snippet.id;
        render();
      }
    }

    function markEdited() {
      const doc = currentDocument();
      if (!doc || suppressEditorChange) return;
      doc.content = getEditorContent();
      dirtyFiles.add(doc.filePath);
      freshAnalysis.set(doc.filePath, false);
      scheduleAnalyze(doc.filePath, doc.content, doc.savedHash, doc.mtimeMs);
      render();
      setStatus('Unsaved changes');
    }

    function scheduleAnalyze(filePath, content, documentHash, mtimeMs) {
      const existing = analysisTimers.get(filePath);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        const requestId = ++analysisSequence;
        latestAnalysisRequest.set(filePath, requestId);
        vscode.postMessage({
          type: 'analyzeDocument',
          filePath,
          content,
          documentHash,
          mtimeMs,
          requestId,
        });
      }, 250);
      analysisTimers.set(filePath, timer);
    }

    function saveDocument() {
      const doc = currentDocument();
      if (!doc || saving) return;
      saving = true;
      saveButton.disabled = true;
      setStatus('Saving...');
      vscode.postMessage({
        type: 'saveDocument',
        filePath: doc.filePath,
        documentHash: doc.savedHash,
        mtimeMs: doc.mtimeMs,
        content: getEditorContent(),
      });
    }

    function insertNewSnippet() {
      const content = getEditorContent();
      const separator = content.length == 0 ? '' : content.endsWith('\\n') ? '\\n' : '\\n\\n';
      const snippet = separator + 'snippet newSnippet "New snippet" w\\n$0\\nendsnippet\\n';
      if (editor) {
        const model = editor.getModel();
        const end = model.getFullModelRange().getEndPosition();
        editor.executeEdits('hsnips-new', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: snippet }]);
        editor.setPosition(model.getFullModelRange().getEndPosition());
        editor.focus();
      } else {
        fallbackEditor.value = content + snippet;
        markEdited();
      }
    }

    function deleteCurrentSnippet() {
      const doc = currentDocument();
      const snippet = currentSnippet();
      if (!doc || !snippet) return;
      if (freshAnalysis.get(doc.filePath) === false) {
        setStatus('Waiting for diagnostics before deleting');
        scheduleAnalyze(doc.filePath, getEditorContent(), doc.savedHash, doc.mtimeMs);
        return;
      }

      const content = getEditorContent();
      const next = content.slice(0, snippet.sourceStart) + content.slice(snippet.sourceEnd);
      setEditorContent(next);
      suppressEditorChange = false;
      markEdited();
    }

    function openCurrentSource() {
      const snippet = currentSnippet();
      const doc = currentDocument();
      if (snippet) {
        vscode.postMessage({ type: 'openSource', filePath: snippet.filePath, line: snippet.startLine });
      } else if (doc) {
        vscode.postMessage({ type: 'openSource', filePath: doc.filePath, line: 0 });
      }
    }

    function setupMonaco() {
      fallbackEditor.oninput = markEdited;
      if (typeof require !== 'function') {
        activateFallback();
        return;
      }

      window.MonacoEnvironment = {
        getWorkerUrl: function() {
          const workerSource = 'self.MonacoEnvironment={baseUrl:' + JSON.stringify(monacoBaseUri + '/') + '};importScripts(' + JSON.stringify(monacoBaseUri + '/base/worker/workerMain.js') + ');';
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(workerSource);
        }
      };

      require.config({ paths: { vs: monacoBaseUri } });
      require(['vs/editor/editor.main'], function() {
        monaco.languages.register({ id: 'hsnips' });
        monaco.languages.setMonarchTokensProvider('hsnips', {
          tokenizer: {
            root: [
              [/^\\s*priority\\s+\\d+/, 'keyword'],
              [/^\\s*(snippet|endsnippet|global|endglobal)\\b/, 'keyword'],
              [/\`[^\`]*\`/, 'regexp'],
              [/"[^"]*"/, 'string'],
              [/\\$\\{?\\d+[^\\s}]*\\}?/, 'number'],
              [/\`\`/, 'delimiter'],
            ]
          }
        });
        editor = monaco.editor.create(document.getElementById('editor'), {
          value: currentDocument()?.content || '',
          language: 'hsnips',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontFamily: 'var(--vscode-editor-font-family)',
          fontSize: parseInt(getComputedStyle(document.body).fontSize, 10) || 13,
          theme: document.body.classList.contains('vscode-light') ? 'vs' : 'vs-dark',
        });
        editor.onDidChangeModelContent(markEdited);
        editor.onDidChangeCursorPosition(event => selectSnippetAtLine(event.position.lineNumber - 1));
        render();
      }, activateFallback);
    }

    function activateFallback() {
      document.getElementById('editor').style.display = 'none';
      fallbackEditor.style.display = 'block';
      fallbackEditor.value = currentDocument()?.content || '';
      setStatus('Using fallback editor');
    }

    fileSelect.onchange = () => {
      selectedFile = fileSelect.value;
      selectedSnippetId = currentDocument()?.snippets[0]?.id || '';
      setEditorContent(currentDocument()?.content || '');
      render();
    };
    search.oninput = render;
    filterIssues.onchange = render;
    filterDuplicates.onchange = render;
    filterAutomatic.onchange = render;
    filterMath.onchange = render;
    filterDynamic.onchange = render;
    filterRegex.onchange = render;
    document.getElementById('reload').onclick = () => {
      saving = false;
      vscode.postMessage({ type: 'reload' });
    };
    document.getElementById('newSnippet').onclick = insertNewSnippet;
    deleteButton.onclick = deleteCurrentSnippet;
    saveButton.onclick = saveDocument;
    document.getElementById('openSource').onclick = openCurrentSource;

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'state') {
        saving = false;
        applyState(message.state);
        return;
      }
      if (message.type === 'documentAnalyzed') {
        const doc = state.documents.find(item => item.filePath === message.document.filePath);
        if (latestAnalysisRequest.get(message.document.filePath) !== message.requestId) return;
        if (doc && doc.content !== message.document.content) return;
        replaceDocument(message.document);
        if (!currentDocument()?.snippets.some(snippet => snippet.id === selectedSnippetId)) {
          selectedSnippetId = currentDocument()?.snippets[0]?.id || '';
        }
        render();
        setStatus(dirtyFiles.has(message.document.filePath) ? 'Unsaved changes' : 'Ready');
        return;
      }
      if (message.type === 'error') {
        saving = false;
        render();
        setStatus(message.message);
      }
    });

    setupMonaco();
    render();
  </script>
</body>
</html>`;
}

async function openSource(filePath: string, line = 0) {
  let document = await vscode.workspace.openTextDocument(filePath);
  let editor = await vscode.window.showTextDocument(document, { preview: false });
  let position = new vscode.Position(Math.max(line, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function ensureFreshDocument(
  filePath: string,
  expectedHash: string | undefined,
  expectedMtimeMs: number | undefined
) {
  let openDocument = vscode.workspace.textDocuments.find((document) => {
    return path.resolve(document.uri.fsPath) == path.resolve(filePath);
  });
  if (openDocument?.isDirty) {
    throw new Error('The snippet file has unsaved changes in the editor. Save or discard them before using the manager.');
  }

  let content = readFileSync(filePath, 'utf8');
  let stat = statSync(filePath);
  assertExpectedSnippetDocumentHash(content, expectedHash);
  if (!expectedHash && expectedMtimeMs !== undefined && stat.mtimeMs != expectedMtimeMs) {
    throw new Error('The snippet file timestamp changed on disk. Reload the manager before saving.');
  }

  return { content, stat };
}

function writeSnippetDocument(message: SnippetManagerMessage) {
  if (!message.filePath || message.content === undefined) {
    throw new Error('Invalid snippet manager save request.');
  }

  ensureFreshDocument(message.filePath, message.documentHash, message.mtimeMs);
  writeFileSync(message.filePath, message.content, 'utf8');
}

function analyzeSnippetDocument(message: SnippetManagerMessage) {
  if (!message.filePath || message.content === undefined) {
    throw new Error('Invalid snippet manager analysis request.');
  }

  let document = parseSnippetDocument(
    message.content,
    message.filePath,
    path.basename(message.filePath, '.hsnips')
  );
  document.mtimeMs = message.mtimeMs;
  return toWebviewDocument(document, message.documentHash || document.hash);
}

export function registerSnippetManager(
  context: vscode.ExtensionContext,
  reloadSnippets: () => void | Promise<void>
) {
  let panel: vscode.WebviewPanel | undefined;

  function postState() {
    if (!panel) return;
    panel.webview.postMessage({ type: 'state', state: getWebviewState(readSnippetDocuments()) });
  }

  async function refresh() {
    if (!panel) return;
    await reloadSnippets();
    postState();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('hsnips.openSnippetManager', async () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        postState();
        return;
      }

      let monacoRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'monaco');
      panel = vscode.window.createWebviewPanel(
        'hsnipsSnippetManager',
        "Yiqi's LatexSnips",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [monacoRoot],
        }
      );
      panel.webview.html = getHtml(panel.webview, context.extensionUri, readSnippetDocuments());

      panel.onDidDispose(() => {
        panel = undefined;
      });

      panel.webview.onDidReceiveMessage(async (message: SnippetManagerMessage) => {
        try {
          if (message.type == 'openSource' && message.filePath) {
            await openSource(message.filePath, message.line);
            return;
          }

          if (message.type == 'reload') {
            await refresh();
            return;
          }

          if (message.type == 'analyzeDocument') {
            let document = analyzeSnippetDocument(message);
            panel?.webview.postMessage({
              type: 'documentAnalyzed',
              requestId: message.requestId,
              document,
            });
            return;
          }

          if (message.type == 'saveDocument') {
            writeSnippetDocument(message);
            await refresh();
            return;
          }
        } catch (error) {
          let messageText = error instanceof Error ? error.message : String(error);
          panel?.webview.postMessage({ type: 'error', message: messageText });
        }
      });
    })
  );
}
