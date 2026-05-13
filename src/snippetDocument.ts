import { createHash } from 'crypto';

const HEADER_REGEXP = /^snippet(?:\s+(?:`([^`]*)`|(\S+)))?(?:\s+"([^"]*)")?(?:\s+(\S+))?\s*$/;
const VALID_FLAGS = /^[AMiwbmt]*$/;

export type SnippetDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SnippetDiagnostic {
  severity: SnippetDiagnosticSeverity;
  message: string;
  line: number;
  snippetId?: string;
}

export interface SnippetBlock {
  id: string;
  trigger: string;
  description: string;
  flags: string;
  priority: number;
  body: string;
  language: string;
  filePath: string;
  startLine: number;
  endLine: number;
  headerStart: number;
  endOffset: number;
  priorityStart?: number;
  isRegex: boolean;
  isDynamic: boolean;
  isSimple: boolean;
  diagnostics: SnippetDiagnostic[];
}

export interface SnippetDocument {
  filePath: string;
  language: string;
  content: string;
  hash: string;
  mtimeMs?: number;
  snippets: SnippetBlock[];
  diagnostics: SnippetDiagnostic[];
}

export interface SnippetUpdate {
  trigger: string;
  description: string;
  flags: string;
  priority: number;
  body: string;
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
  endIncludingNewline: number;
}

function getSourceLines(content: string) {
  let lines: SourceLine[] = [];
  let start = 0;

  if (content.length == 0) {
    return [{ text: '', start: 0, end: 0, endIncludingNewline: 0 }];
  }

  while (start < content.length) {
    let newline = content.indexOf('\n', start);
    if (newline == -1) {
      lines.push({
        text: content.slice(start),
        start,
        end: content.length,
        endIncludingNewline: content.length,
      });
      break;
    }

    let lineEnd = newline > start && content[newline - 1] == '\r' ? newline - 1 : newline;
    lines.push({
      text: content.slice(start, lineEnd),
      start,
      end: lineEnd,
      endIncludingNewline: newline + 1,
    });
    start = newline + 1;
  }

  return lines;
}

export function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

export function assertExpectedSnippetDocumentHash(
  content: string,
  expectedHash: string | undefined
) {
  if (expectedHash && hashText(content) != expectedHash) {
    throw new Error('The snippet file changed on disk. Reload the manager before saving.');
  }
}

function parseHeader(line: string) {
  let match = HEADER_REGEXP.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    isRegex: match[1] !== undefined,
    trigger: match[1] ?? match[2] ?? '',
    description: match[3] ?? '',
    flags: match[4] ?? '',
  };
}

function createDiagnostic(
  severity: SnippetDiagnosticSeverity,
  message: string,
  line: number,
  snippetId?: string
): SnippetDiagnostic {
  return { severity, message, line, snippetId };
}

function collectBlockDiagnostics(block: SnippetBlock) {
  let diagnostics: SnippetDiagnostic[] = [];
  if (!block.trigger) {
    diagnostics.push(createDiagnostic('error', 'Snippet trigger is empty.', block.startLine, block.id));
  }
  if (!VALID_FLAGS.test(block.flags)) {
    diagnostics.push(createDiagnostic('error', `Invalid flags: ${block.flags}`, block.startLine, block.id));
  }
  if (!block.isSimple) {
    diagnostics.push(
      createDiagnostic(
        'info',
        'Complex snippets are read-only in the manager; open the source file to edit them.',
        block.startLine,
        block.id
      )
    );
  }
  return diagnostics;
}

function addDuplicateDiagnostics(document: SnippetDocument) {
  let byTrigger = new Map<string, SnippetBlock[]>();
  let automaticByTrigger = new Map<string, SnippetBlock[]>();

  for (let snippet of document.snippets) {
    if (snippet.isRegex || !snippet.trigger) continue;
    let key = snippet.trigger;
    byTrigger.set(key, [...(byTrigger.get(key) || []), snippet]);
    if (snippet.flags.includes('A')) {
      automaticByTrigger.set(key, [...(automaticByTrigger.get(key) || []), snippet]);
    }
  }

  for (let snippets of byTrigger.values()) {
    if (snippets.length < 2) continue;
    for (let snippet of snippets) {
      snippet.diagnostics.push(
        createDiagnostic('warning', `Duplicate trigger "${snippet.trigger}".`, snippet.startLine, snippet.id)
      );
    }
  }

  for (let snippets of automaticByTrigger.values()) {
    if (snippets.length < 2) continue;
    for (let snippet of snippets) {
      snippet.diagnostics.push(
        createDiagnostic(
          'warning',
          `Multiple automatic snippets use trigger "${snippet.trigger}".`,
          snippet.startLine,
          snippet.id
        )
      );
    }
  }
}

export function parseSnippetDocument(
  content: string,
  filePath = '',
  language = ''
): SnippetDocument {
  let lines = getSourceLines(content);
  let snippets: SnippetBlock[] = [];
  let diagnostics: SnippetDiagnostic[] = [];
  let priority = 0;
  let priorityStart: number | undefined;
  let priorityLineIndex: number | undefined;
  let inGlobal = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    let trimmed = line.text.trim();

    if (inGlobal) {
      if (trimmed == 'endglobal') {
        inGlobal = false;
      }
      continue;
    }

    if (trimmed == 'global') {
      inGlobal = true;
      continue;
    }

    if (trimmed.startsWith('priority ')) {
      priority = Number(trimmed.substring('priority '.length).trim()) || 0;
      priorityStart = line.start;
      priorityLineIndex = lineIndex;
      continue;
    }

    if (!trimmed.startsWith('snippet')) {
      continue;
    }

    let header = parseHeader(trimmed);
    if (!header) {
      diagnostics.push(createDiagnostic('error', 'Invalid snippet header.', lineIndex));
      priority = 0;
      priorityStart = undefined;
      priorityLineIndex = undefined;
      continue;
    }

    let endLineIndex = lineIndex + 1;
    while (endLineIndex < lines.length && lines[endLineIndex].text.trim() != 'endsnippet') {
      endLineIndex++;
    }

    let bodyStart = line.endIncludingNewline;
    let bodyEnd = endLineIndex < lines.length ? lines[endLineIndex].start : content.length;
    let body = content.slice(bodyStart, bodyEnd).replace(/\r?\n$/, '');
    let endOffset = endLineIndex < lines.length ? lines[endLineIndex].endIncludingNewline : content.length;
    let id = `${filePath}:${line.start}`;
    let isDynamic = body.includes('``');
    let canReplacePriority = (
      priorityLineIndex !== undefined &&
      lines.slice(priorityLineIndex + 1, lineIndex).every((sourceLine) => sourceLine.text.trim() == '')
    );
    let isSimple = (
      !header.isRegex &&
      !isDynamic &&
      Boolean(header.trigger) &&
      !/\s/.test(header.trigger) &&
      VALID_FLAGS.test(header.flags)
    );

    let block: SnippetBlock = {
      id,
      trigger: header.trigger,
      description: header.description,
      flags: header.flags,
      priority,
      body,
      language,
      filePath,
      startLine: lineIndex,
      endLine: endLineIndex < lines.length ? endLineIndex : lines.length - 1,
      headerStart: line.start,
      endOffset,
      priorityStart: canReplacePriority ? priorityStart : undefined,
      isRegex: header.isRegex,
      isDynamic,
      isSimple,
      diagnostics: [],
    };

    if (endLineIndex >= lines.length) {
      block.diagnostics.push(createDiagnostic('error', 'Snippet is missing endsnippet.', lineIndex, id));
    }

    block.diagnostics.push(...collectBlockDiagnostics(block));
    snippets.push(block);
    lineIndex = endLineIndex;
    priority = 0;
    priorityStart = undefined;
    priorityLineIndex = undefined;
  }

  let document: SnippetDocument = {
    filePath,
    language,
    content,
    hash: hashText(content),
    snippets,
    diagnostics,
  };

  addDuplicateDiagnostics(document);
  document.diagnostics.push(...document.snippets.flatMap((snippet) => snippet.diagnostics));
  return document;
}

export function validateSnippetUpdate(update: SnippetUpdate) {
  let diagnostics: SnippetDiagnostic[] = [];
  if (!update.trigger.trim()) {
    diagnostics.push(createDiagnostic('error', 'Snippet trigger is required.', 0));
  }
  if (/\s/.test(update.trigger.trim())) {
    diagnostics.push(createDiagnostic('error', 'Simple snippet triggers cannot contain whitespace.', 0));
  }
  if (!VALID_FLAGS.test(update.flags.trim())) {
    diagnostics.push(createDiagnostic('error', `Invalid flags: ${update.flags}`, 0));
  }
  if (update.body.includes('``')) {
    diagnostics.push(createDiagnostic('error', 'Dynamic JavaScript blocks must be edited in source.', 0));
  }
  return diagnostics;
}

function escapeDescription(description: string) {
  return description.replace(/"/g, "'");
}

export function serializeSnippetUpdate(update: SnippetUpdate) {
  let priority = Math.max(0, Number(update.priority) || 0);
  let trigger = update.trigger.trim();
  let description = escapeDescription(update.description.trim());
  let flags = update.flags.trim();
  let lines: string[] = [];

  if (priority > 0) {
    lines.push(`priority ${priority}`);
  }

  let header = `snippet ${trigger}`;
  if (description) {
    header += ` "${description}"`;
  }
  if (flags) {
    header += ` ${flags}`;
  }
  lines.push(header);
  lines.push(update.body.replace(/\s+$/, ''));
  lines.push('endsnippet');
  return lines.join('\n') + '\n';
}

export function applySnippetUpdate(
  content: string,
  block: SnippetBlock,
  update: SnippetUpdate
) {
  if (!block.isSimple) {
    throw new Error('Only simple snippets can be edited in the manager.');
  }

  let diagnostics = validateSnippetUpdate(update);
  if (diagnostics.some((diagnostic) => diagnostic.severity == 'error')) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  let start = block.priorityStart ?? block.headerStart;
  return content.slice(0, start) + serializeSnippetUpdate(update) + content.slice(block.endOffset);
}

export function appendSnippet(content: string, update: SnippetUpdate) {
  let diagnostics = validateSnippetUpdate(update);
  if (diagnostics.some((diagnostic) => diagnostic.severity == 'error')) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  let separator = content.length == 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return content + separator + serializeSnippetUpdate(update);
}

export function deleteSnippet(content: string, block: SnippetBlock) {
  if (!block.isSimple) {
    throw new Error('Only simple snippets can be deleted in the manager.');
  }

  let start = block.priorityStart ?? block.headerStart;
  return content.slice(0, start) + content.slice(block.endOffset);
}
