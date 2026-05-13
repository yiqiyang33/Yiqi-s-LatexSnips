import {
  findLatexCommentStart,
  getLatexContext,
  LatexContextOptions,
} from './latexContext';

export {
  ALIGNMENT_SEPARATOR_ENVIRONMENTS,
  findLatexCommentStart,
  getLatexContext,
  getOpenLatexEnvironmentFrames,
  getOpenLatexEnvironmentStack,
  isInsideLatexLineComment,
  isInsideMarkdownCode,
  isInsideTextLikeCommand,
  LatexContext,
  LatexContextOptions,
  LatexEditorContext,
  LatexEnvironmentFrame,
  MATH_ENVIRONMENTS,
  ROW_BREAK_ENVIRONMENTS,
  sanitizeLatexForParsing,
  stripLatexComments,
} from './latexContext';

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface SmartEnterPlan {
  handled: boolean;
  edits: TextEdit[];
  cursorOffset?: number;
}

function getLineBounds(text: string, offset: number) {
  let start = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1;
  let nextNewline = text.indexOf('\n', offset);
  let end = nextNewline == -1 ? text.length : nextNewline;
  return { start, end };
}

function getLineIndent(line: string) {
  let match = line.match(/^\s*/);
  return match ? match[0] : '';
}

export function applyTextEditsToString(text: string, edits: TextEdit[]) {
  return edits
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, edit) => {
      return result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }, text);
}

function getTextReplacement(fromText: string, toText: string): TextEdit | undefined {
  if (fromText == toText) {
    return undefined;
  }

  let start = 0;
  while (
    start < fromText.length &&
    start < toText.length &&
    fromText[start] == toText[start]
  ) {
    start++;
  }

  let fromEnd = fromText.length;
  let toEnd = toText.length;
  while (
    fromEnd > start &&
    toEnd > start &&
    fromText[fromEnd - 1] == toText[toEnd - 1]
  ) {
    fromEnd--;
    toEnd--;
  }

  return {
    start,
    end: fromEnd,
    text: toText.slice(start, toEnd),
  };
}

function shouldAppendMathLineBreak(line: string) {
  let commentStart = findLatexCommentStart(line);
  let formulaPart = commentStart == -1 ? line : line.substring(0, commentStart);
  let trimmed = formulaPart.trim();

  if (!trimmed) return false;
  if (/^\\(?:begin|end)\s*\{[^}]+\}$/.test(trimmed)) return false;
  if (/\\\\(?:\[[^\]]+\])?$/.test(trimmed)) return false;

  return true;
}

export function getSmartEnterPlan(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
): SmartEnterPlan {
  let context = getLatexContext(text, offset, options);
  if (!context.canSmartEnter) {
    return { handled: false, edits: [] };
  }

  let lineBounds = getLineBounds(text, offset);
  let line = text.substring(lineBounds.start, lineBounds.end);
  let column = offset - lineBounds.start;
  let commentStart = findLatexCommentStart(line);
  let formulaLimit = commentStart == -1 ? line.length : commentStart;

  if (column > formulaLimit) {
    return { handled: false, edits: [] };
  }

  if (line.substring(column, formulaLimit).trim().length > 0) {
    return { handled: false, edits: [] };
  }

  if (!shouldAppendMathLineBreak(line)) {
    return { handled: false, edits: [] };
  }

  let indent = getLineIndent(line);
  let formulaEnd = line.substring(0, formulaLimit).replace(/\s+$/, '').length;

  if (commentStart == -1) {
    let replaceStart = lineBounds.start + formulaEnd;
    let insertText = ' ' + '\\\\' + '\n' + indent;
    return {
      handled: true,
      edits: [{ start: replaceStart, end: lineBounds.end, text: insertText }],
      cursorOffset: replaceStart + insertText.length,
    };
  }

  let replaceStart = lineBounds.start + formulaEnd;
  let replaceEnd = lineBounds.start + commentStart;
  let insertText = ' ' + '\\\\' + ' ';
  let lineBreakText = '\n' + indent;

  return {
    handled: true,
    edits: [
      { start: replaceStart, end: replaceEnd, text: insertText },
      { start: lineBounds.end, end: lineBounds.end, text: lineBreakText },
    ],
    cursorOffset: lineBounds.end + insertText.length - (replaceEnd - replaceStart) + lineBreakText.length,
  };
}

export function getSmartEnterRecoveryPlan(
  beforeEnterText: string,
  offsetBeforeEnter: number,
  currentText: string,
  options: LatexContextOptions = {}
): SmartEnterPlan {
  let desiredPlan = getSmartEnterPlan(beforeEnterText, offsetBeforeEnter, options);
  if (!desiredPlan.handled || typeof desiredPlan.cursorOffset != 'number') {
    return { handled: false, edits: [] };
  }

  let desiredText = applyTextEditsToString(beforeEnterText, desiredPlan.edits);
  let replacement = getTextReplacement(currentText, desiredText);
  if (!replacement) {
    return { handled: false, edits: [] };
  }

  return {
    handled: true,
    edits: [replacement],
    cursorOffset: desiredPlan.cursorOffset,
  };
}

export function shouldInsertAlignmentSeparator(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
) {
  let context = getLatexContext(text, offset, options);
  if (!context.canSmartTab) {
    return false;
  }

  let lineBounds = getLineBounds(text, offset);
  let line = text.substring(lineBounds.start, lineBounds.end);
  let column = offset - lineBounds.start;
  let commentStart = findLatexCommentStart(line);
  let formulaLimit = commentStart == -1 ? line.length : commentStart;
  let formulaPart = line.substring(0, formulaLimit).trim();

  if (column > formulaLimit) return false;
  if (!formulaPart && line.trim().startsWith('%')) return false;
  if (/^\\(?:begin|end)\s*\{[^}]+\}$/.test(formulaPart)) return false;
  if (/\\\\(?:\[[^\]]+\])?$/.test(formulaPart)) return false;

  return true;
}
