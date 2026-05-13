import * as vscode from 'vscode';
import { lineRange } from './utils';
import { HSnippet } from './hsnippet';

export class CompletionInfo {
  range: vscode.Range;
  completionRange: vscode.Range;
  snippet: HSnippet;
  label: string;
  groups: string[];

  constructor(snippet: HSnippet, label: string, range: vscode.Range, groups: string[]) {
    this.snippet = snippet;
    this.label = label;
    this.range = range;
    this.completionRange = new vscode.Range(range.start, range.start.translate(0, label.length));
    this.groups = groups;
  }

  toCompletionItem() {
    let completionItem = new vscode.CompletionItem(this.label);
    completionItem.range = this.range;
    completionItem.detail = this.snippet.description;
    completionItem.insertText = this.label;
    completionItem.command = {
      command: 'hsnips.expand',
      title: 'expand',
      arguments: [this],
    };

    return completionItem;
  }
}

function matchSuffixPrefix(context: string, trigger: string) {
  while (trigger.length) {
    if (context.endsWith(trigger)) return trigger;
    trigger = trigger.substring(0, trigger.length - 1);
  }

  return null;
}

interface CompletionMatchContext {
  line: string;
  contextRange: vscode.Range;
  context: string;
  isPrecedingContextWhitespace: boolean;
  wordContext: string;
  longContext?: string;
}

interface SnippetMatch {
  snippetMatches: boolean;
  prefixMatches: boolean;
  range: vscode.Range;
  label: string;
  groups: string[];
}

function createCompletionMatchContext(
  document: vscode.TextDocument,
  position: vscode.Position
): CompletionMatchContext {
  let line = document.getText(lineRange(0, position));

  // Grab everything until previous whitespace as our matching context.
  let match = line.match(/\S*$/);
  let contextRange = lineRange((match as RegExpMatchArray).index || 0, position);
  let context = document.getText(contextRange);
  let precedingContextRange = new vscode.Range(
    position.line,
    0,
    position.line,
    (match as RegExpMatchArray).index || 0
  );
  let precedingContext = document.getText(precedingContextRange);
  let isPrecedingContextWhitespace = precedingContext.match(/^\s*$/) != null;

  let wordRange = document.getWordRangeAtPosition(position) || contextRange;
  if (wordRange.end != position) {
    wordRange = new vscode.Range(wordRange.start, position);
  }
  let wordContext = document.getText(wordRange);

  return {
    line,
    contextRange,
    context,
    isPrecedingContextWhitespace,
    wordContext,
  };
}

function getLongContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: CompletionMatchContext
) {
  if (context.longContext === undefined) {
    let numberPrevLines = vscode.workspace
      .getConfiguration('hsnips')
      .get('multiLineContext') as number;

    context.longContext = document
      .getText(
        new vscode.Range(
          new vscode.Position(Math.max(position.line - numberPrevLines, 0), 0),
          position
        )
      )
      .replace(/\r/g, '');
  }

  return context.longContext;
}

function matchSnippet(
  document: vscode.TextDocument,
  position: vscode.Position,
  snippet: HSnippet,
  context: CompletionMatchContext
): SnippetMatch {
  let snippetMatches = false;
  let snippetRange = context.contextRange;
  let prefixMatches = false;
  let matchGroups: string[] = [];
  let label = snippet.trigger;

  if (snippet.trigger) {
    let matchingPrefix = null;

    if (snippet.inword) {
      snippetMatches = context.context.endsWith(snippet.trigger);
      matchingPrefix = snippetMatches
        ? snippet.trigger
        : matchSuffixPrefix(context.context, snippet.trigger);
    } else if (snippet.wordboundary) {
      snippetMatches = context.wordContext == snippet.trigger;
      matchingPrefix = snippet.trigger.startsWith(context.wordContext) ? context.wordContext : null;
    } else if (snippet.beginningofline) {
      snippetMatches = context.context.endsWith(snippet.trigger) && context.isPrecedingContextWhitespace;
      matchingPrefix =
        snippet.trigger.startsWith(context.context) && context.isPrecedingContextWhitespace
          ? context.context
          : null;
    } else {
      snippetMatches = context.context == snippet.trigger;
      matchingPrefix = snippet.trigger.startsWith(context.context) ? context.context : null;
    }

    if (matchingPrefix) {
      snippetRange = new vscode.Range(position.translate(0, -matchingPrefix.length), position);
      prefixMatches = true;
    }
  } else if (snippet.regexp) {
    let regexContext = context.line;

    if (snippet.multiline) {
      regexContext = getLongContext(document, position, context);
    }

    let match = snippet.regexp.exec(regexContext);
    if (match) {
      let charOffset = match.index - regexContext.lastIndexOf('\n', match.index) - 1;
      let lineOffset = match[0].split('\n').length - 1;

      snippetRange = new vscode.Range(
        new vscode.Position(position.line - lineOffset, charOffset),
        position
      );
      snippetMatches = true;
      matchGroups = match;
      label = match[0];
    }
  }

  return {
    snippetMatches,
    prefixMatches,
    range: snippetRange,
    label,
    groups: matchGroups,
  };
}

export function getAutomaticCompletion(
  document: vscode.TextDocument,
  position: vscode.Position,
  snippets: HSnippet[]
): CompletionInfo | undefined {
  let context = createCompletionMatchContext(document, position);

  for (let snippet of snippets) {
    if (!snippet.automatic) continue;

    let match = matchSnippet(document, position, snippet, context);
    if (match.snippetMatches) {
      return new CompletionInfo(snippet, match.label, match.range, match.groups);
    }
  }
}

export function getCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  snippets: HSnippet[]
): CompletionInfo[] | CompletionInfo | undefined {
  let context = createCompletionMatchContext(document, position);
  let completions = [];

  for (let snippet of snippets) {
    let match = matchSnippet(document, position, snippet, context);

    if (snippet.automatic && match.snippetMatches) {
      return new CompletionInfo(snippet, match.label, match.range, match.groups);
    }

    if (match.prefixMatches) {
      completions.push(new CompletionInfo(snippet, match.label, match.range, match.groups));
    }
  }

  return completions;
}
