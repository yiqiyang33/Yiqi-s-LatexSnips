export const ROW_BREAK_ENVIRONMENTS = [
  'align',
  'align*',
  'aligned',
  'alignedat',
  'alignedat*',
  'gather',
  'gather*',
  'gathered',
  'split',
  'multline',
  'multline*',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'cases',
  'array',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
];

export const ALIGNMENT_SEPARATOR_ENVIRONMENTS = [
  'align',
  'align*',
  'aligned',
  'alignedat',
  'alignedat*',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'cases',
  'array',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
];

const MATH_ENVIRONMENTS = [
  'math',
  'displaymath',
  'equation',
  'equation*',
  ...ROW_BREAK_ENVIRONMENTS,
];

const TEXT_COMMANDS = [
  'text',
  'textrm',
  'textnormal',
  'mbox',
  'operatorname',
  'mathrm',
  'label',
  'tag',
];

export interface LatexContext {
  environmentStack: string[];
  currentEnvironment: string | undefined;
  inComment: boolean;
  inMarkdownCode: boolean;
  inTextLikeCommand: boolean;
  inMath: boolean;
  canSmartEnter: boolean;
  canInsertAlignmentSeparator: boolean;
}

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

function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] == '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 == 1;
}

export function findLatexCommentStart(line: string) {
  for (let index = 0; index < line.length; index++) {
    if (line[index] == '%' && !isEscaped(line, index)) {
      return index;
    }
  }

  return -1;
}

function stripMarkdownCodeAndHtmlComments(text: string) {
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`\n]*`/g, '');
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

export function stripLatexComments(text: string) {
  return stripMarkdownCodeAndHtmlComments(text)
    .split(/\r?\n/)
    .map((line) => {
      let commentStart = findLatexCommentStart(line);
      return commentStart == -1 ? line : line.substring(0, commentStart);
    })
    .join('\n');
}

export function getOpenLatexEnvironmentStack(text: string, offset: number) {
  let beforeCursor = stripLatexComments(text.substring(0, offset));
  const stack: string[] = [];
  const environmentReg = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = environmentReg.exec(beforeCursor)) !== null) {
    let kind = match[1];
    let environment = match[2].trim();

    if (kind == 'begin') {
      stack.push(environment);
      continue;
    }

    let matchingBegin = stack.lastIndexOf(environment);
    if (matchingBegin != -1) {
      stack.splice(matchingBegin, 1);
    }
  }

  return stack;
}

function isInAnyEnvironment(stack: string[], environments: string[]) {
  return stack.some((environment) => environments.indexOf(environment) != -1);
}

export function isInsideLatexLineComment(text: string, offset: number) {
  let lineStart = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1;
  let lineBeforeCursor = text.substring(lineStart, offset);
  return findLatexCommentStart(lineBeforeCursor) != -1;
}

export function isInsideMarkdownCode(text: string, offset: number) {
  let beforeCursor = text.substring(0, offset);
  let fenceCount = (beforeCursor.match(/^```/gm) || []).length;
  if (fenceCount % 2 == 1) {
    return true;
  }

  let lineStart = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1;
  let lineBeforeCursor = text.substring(lineStart, offset);
  let inlineBackticks = lineBeforeCursor.match(/`/g);
  return inlineBackticks ? inlineBackticks.length % 2 == 1 : false;
}

function findMatchingBrace(text: string, openBrace: number, limit: number) {
  let depth = 0;
  for (let index = openBrace; index < limit; index++) {
    if (isEscaped(text, index)) {
      continue;
    }

    if (text[index] == '{') {
      depth++;
      continue;
    }

    if (text[index] == '}') {
      depth--;
      if (depth == 0) {
        return index;
      }
    }
  }

  return -1;
}

export function isInsideTextLikeCommand(text: string, offset: number) {
  const commandReg = new RegExp('\\\\(' + TEXT_COMMANDS.join('|') + ')\\s*\\{', 'g');
  let match: RegExpExecArray | null;

  while ((match = commandReg.exec(text.substring(0, offset))) !== null) {
    let openBrace = commandReg.lastIndex - 1;
    let closeBrace = findMatchingBrace(text, openBrace, offset + 1);
    if (closeBrace == -1 || closeBrace >= offset) {
      return true;
    }
  }

  return false;
}

function isInsideDollarMath(text: string, offset: number) {
  let beforeCursor = stripLatexComments(text.substring(0, offset));
  let stack: string[] = [];

  for (let index = 0; index < beforeCursor.length; index++) {
    let char = beforeCursor[index];

    if (char == '\\') {
      let next = beforeCursor[index + 1];
      if (next == '(' || next == '[') {
        stack.push(next == '(' ? '\\(' : '\\[');
        index++;
        continue;
      }
      if (next == ')' && stack[stack.length - 1] == '\\(') {
        stack.pop();
        index++;
        continue;
      }
      if (next == ']' && stack[stack.length - 1] == '\\[') {
        stack.pop();
        index++;
        continue;
      }

      index++;
      continue;
    }

    if (char == '$') {
      let delimiter = beforeCursor[index + 1] == '$' ? '$$' : '$';
      if (stack[stack.length - 1] == delimiter) {
        stack.pop();
      } else {
        stack.push(delimiter);
      }
      if (delimiter == '$$') {
        index++;
      }
    }
  }

  return stack.length > 0;
}

export function getLatexContext(text: string, offset: number): LatexContext {
  let environmentStack = getOpenLatexEnvironmentStack(text, offset);
  let currentEnvironment = environmentStack[environmentStack.length - 1];
  let inComment = isInsideLatexLineComment(text, offset);
  let inMarkdownCode = isInsideMarkdownCode(text, offset);
  let inTextLikeCommand = isInsideTextLikeCommand(text, offset);
  let inRowBreakEnvironment = isInAnyEnvironment(environmentStack, ROW_BREAK_ENVIRONMENTS);
  let inAlignmentEnvironment = isInAnyEnvironment(environmentStack, ALIGNMENT_SEPARATOR_ENVIRONMENTS);
  let inMath = (
    isInsideDollarMath(text, offset) ||
    isInAnyEnvironment(environmentStack, MATH_ENVIRONMENTS)
  ) && !inComment && !inMarkdownCode && !inTextLikeCommand;

  return {
    environmentStack,
    currentEnvironment,
    inComment,
    inMarkdownCode,
    inTextLikeCommand,
    inMath,
    canSmartEnter: inRowBreakEnvironment && !inComment && !inMarkdownCode && !inTextLikeCommand,
    canInsertAlignmentSeparator: inAlignmentEnvironment && !inComment && !inMarkdownCode && !inTextLikeCommand,
  };
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

export function getSmartEnterPlan(text: string, offset: number): SmartEnterPlan {
  let context = getLatexContext(text, offset);
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
  currentText: string
): SmartEnterPlan {
  let desiredPlan = getSmartEnterPlan(beforeEnterText, offsetBeforeEnter);
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

export function shouldInsertAlignmentSeparator(text: string, offset: number) {
  let context = getLatexContext(text, offset);
  if (!context.canInsertAlignmentSeparator) {
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
