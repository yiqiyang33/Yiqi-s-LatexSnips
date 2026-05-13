import {
  isEscaped,
  LatexContextOptions,
  sanitizeLatexForParsing,
  VERBATIM_LIKE_ENVIRONMENTS,
} from './latexContext';
import { TextEdit } from './latexEdit';

export const CONVERTIBLE_ENVIRONMENTS = [
  'align',
  'align*',
  'aligned',
  'equation',
  'equation*',
  'split',
  'gather',
  'gather*',
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

const TABLE_LIKE_ENVIRONMENTS = [
  'array',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
];

const TWO_ARGUMENT_TABLE_ENVIRONMENTS = ['tabular*', 'tabularx'];

export interface LatexArgumentRange {
  start: number;
  end: number;
  text: string;
}

export interface LatexEnvironmentPair {
  name: string;
  beginStart: number;
  beginEnd: number;
  beginNameStart: number;
  beginNameEnd: number;
  endStart: number;
  endEnd: number;
  endNameStart: number;
  endNameEnd: number;
  beginArguments: LatexArgumentRange[];
}

export interface MathDelimiterPair {
  kind: 'displayDollar' | 'bracket';
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

export interface ConversionPlan {
  handled: boolean;
  edits: TextEdit[];
  cursorOffset?: number;
}

interface BeginToken {
  name: string;
  beginStart: number;
  beginEnd: number;
  beginNameStart: number;
  beginNameEnd: number;
}

interface DelimiterToken {
  kind: 'inlineDollar' | 'displayDollar' | 'paren' | 'bracket';
  openStart: number;
  openEnd: number;
}

function findMatchingBrace(text: string, openBrace: number) {
  let depth = 0;
  for (let index = openBrace; index < text.length; index++) {
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

function parseBracedArguments(text: string, start: number): LatexArgumentRange[] {
  let args: LatexArgumentRange[] = [];
  let index = start;

  while (index < text.length) {
    while (/\s/.test(text[index] || '')) index++;
    if (text[index] != '{') break;

    let end = findMatchingBrace(text, index);
    if (end == -1) break;

    args.push({
      start: index,
      end: end + 1,
      text: text.slice(index, end + 1),
    });
    index = end + 1;
  }

  return args;
}

function getEnvironmentNameRange(match: RegExpExecArray) {
  let rawName = match[2];
  let name = rawName.trim();
  let rawNameStart = match.index + match[0].indexOf('{') + 1;
  let leadingWhitespace = rawName.search(/\S/);
  let nameStart = rawNameStart + (leadingWhitespace == -1 ? 0 : leadingWhitespace);
  return {
    name,
    nameStart,
    nameEnd: nameStart + name.length,
  };
}

export function findLatexEnvironmentPairAt(
  text: string,
  offset: number,
  _options: LatexContextOptions = {}
) {
  let sanitized = sanitizeLatexForParsing(text);
  let verbatimEnvironments = new Set(VERBATIM_LIKE_ENVIRONMENTS);
  let stack: BeginToken[] = [];
  let pairs: LatexEnvironmentPair[] = [];
  const environmentReg = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = environmentReg.exec(sanitized)) !== null) {
    let kind = match[1];
    let { name, nameStart, nameEnd } = getEnvironmentNameRange(match);
    let currentVerbatim: BeginToken | undefined;
    for (let index = stack.length - 1; index >= 0; index--) {
      if (verbatimEnvironments.has(stack[index].name)) {
        currentVerbatim = stack[index];
        break;
      }
    }

    if (currentVerbatim) {
      if (kind == 'end' && name == currentVerbatim.name) {
        let matchingBegin = stack.lastIndexOf(currentVerbatim);
        if (matchingBegin != -1) {
          stack.splice(matchingBegin, 1);
        }
      }
      continue;
    }

    if (kind == 'begin') {
      stack.push({
        name,
        beginStart: match.index,
        beginEnd: environmentReg.lastIndex,
        beginNameStart: nameStart,
        beginNameEnd: nameEnd,
      });
      continue;
    }

    let matchingBegin = stack.map((token) => token.name).lastIndexOf(name);
    if (matchingBegin == -1) {
      continue;
    }

    let begin = stack[matchingBegin];
    stack.splice(matchingBegin, 1);
    pairs.push({
      name,
      beginStart: begin.beginStart,
      beginEnd: begin.beginEnd,
      beginNameStart: begin.beginNameStart,
      beginNameEnd: begin.beginNameEnd,
      endStart: match.index,
      endEnd: environmentReg.lastIndex,
      endNameStart: nameStart,
      endNameEnd: nameEnd,
      beginArguments: parseBracedArguments(text, begin.beginEnd),
    });
  }

  return pairs
    .filter((pair) => pair.beginStart <= offset && offset <= pair.endEnd)
    .sort((a, b) => (a.endEnd - a.beginStart) - (b.endEnd - b.beginStart))[0];
}

export function findDisplayMathDelimiterAt(text: string, offset: number) {
  let sanitized = sanitizeLatexForParsing(text);
  let stack: DelimiterToken[] = [];
  let pairs: MathDelimiterPair[] = [];

  for (let index = 0; index < sanitized.length; index++) {
    let char = sanitized[index];

    if (char == '\\') {
      let next = sanitized[index + 1];
      if (next == '(' || next == '[') {
        stack.push({
          kind: next == '(' ? 'paren' : 'bracket',
          openStart: index,
          openEnd: index + 2,
        });
        index++;
        continue;
      }

      if (next == ')' || next == ']') {
        let kind = next == ')' ? 'paren' : 'bracket';
        if (stack[stack.length - 1]?.kind == kind) {
          let open = stack.pop() as DelimiterToken;
          if (kind == 'bracket') {
            pairs.push({
              kind: 'bracket',
              openStart: open.openStart,
              openEnd: open.openEnd,
              closeStart: index,
              closeEnd: index + 2,
            });
          }
        }
        index++;
        continue;
      }

      index++;
      continue;
    }

    if (char == '$' && !isEscaped(sanitized, index)) {
      let isDisplay = sanitized[index + 1] == '$';
      let kind: DelimiterToken['kind'] = isDisplay ? 'displayDollar' : 'inlineDollar';
      let width = isDisplay ? 2 : 1;
      if (stack[stack.length - 1]?.kind == kind) {
        let open = stack.pop() as DelimiterToken;
        if (kind == 'displayDollar') {
          pairs.push({
            kind: 'displayDollar',
            openStart: open.openStart,
            openEnd: open.openEnd,
            closeStart: index,
            closeEnd: index + width,
          });
        }
      } else {
        stack.push({ kind, openStart: index, openEnd: index + width });
      }
      index += width - 1;
    }
  }

  return pairs
    .filter((pair) => pair.openStart <= offset && offset <= pair.closeEnd)
    .sort((a, b) => (a.closeEnd - a.openStart) - (b.closeEnd - b.openStart))[0];
}

export function isTableLikeEnvironment(name: string) {
  return TABLE_LIKE_ENVIRONMENTS.indexOf(name) != -1;
}

function needsTwoTableArguments(name: string) {
  return TWO_ARGUMENT_TABLE_ENVIRONMENTS.indexOf(name) != -1;
}

export function formatTableArguments(targetName: string, columnSpecOrArguments = 'c') {
  let value = columnSpecOrArguments.trim() || 'c';
  if (value.startsWith('{')) {
    return value;
  }

  if (needsTwoTableArguments(targetName)) {
    return `{\\linewidth}{${value}}`;
  }

  return `{${value}}`;
}

function normalizeArgumentsForTarget(
  currentArguments: LatexArgumentRange[],
  targetName: string,
  fallbackArguments?: string
) {
  if (!isTableLikeEnvironment(targetName)) {
    return '';
  }

  if (currentArguments.length > 0) {
    if (needsTwoTableArguments(targetName)) {
      if (currentArguments.length >= 2) {
        return currentArguments[0].text + currentArguments[1].text;
      }
      return `{\\linewidth}` + currentArguments[0].text;
    }

    return currentArguments[currentArguments.length - 1].text;
  }

  return fallbackArguments || formatTableArguments(targetName);
}

export function conversionNeedsTableArguments(
  text: string,
  offset: number,
  targetName: string
) {
  if (!isTableLikeEnvironment(targetName)) {
    return false;
  }

  let pair = findLatexEnvironmentPairAt(text, offset);
  return !pair || pair.beginArguments.length == 0;
}

function getBeginArgumentsRange(pair: LatexEnvironmentPair) {
  if (pair.beginArguments.length == 0) {
    return { start: pair.beginEnd, end: pair.beginEnd };
  }

  return {
    start: pair.beginArguments[0].start,
    end: pair.beginArguments[pair.beginArguments.length - 1].end,
  };
}

export function createEnvironmentRenamePlan(
  text: string,
  pair: LatexEnvironmentPair,
  targetName: string,
  targetArguments?: string
): ConversionPlan {
  let argsRange = getBeginArgumentsRange(pair);
  let nextArguments = normalizeArgumentsForTarget(pair.beginArguments, targetName, targetArguments);
  let currentArgumentsText = text.slice(argsRange.start, argsRange.end);
  let edits: TextEdit[] = [
    { start: pair.beginNameStart, end: pair.beginNameEnd, text: targetName },
    { start: pair.endNameStart, end: pair.endNameEnd, text: targetName },
  ];

  if (currentArgumentsText != nextArguments) {
    edits.push({ start: argsRange.start, end: argsRange.end, text: nextArguments });
  }

  if (pair.name == targetName && currentArgumentsText == nextArguments) {
    return { handled: false, edits: [] };
  }

  return {
    handled: true,
    edits,
    cursorOffset: pair.beginStart,
  };
}

function trimOneOuterNewline(text: string) {
  if (text.startsWith('\n')) {
    text = text.slice(1);
  }
  if (text.endsWith('\n')) {
    text = text.slice(0, -1);
  }
  return text;
}

export function createDelimiterConversionPlan(
  text: string,
  pair: MathDelimiterPair,
  targetName: string,
  targetArguments = ''
): ConversionPlan {
  let body = trimOneOuterNewline(text.slice(pair.openEnd, pair.closeStart));
  let begin = `\\begin{${targetName}}${targetArguments}`;
  let replacement = `${begin}\n${body}\n\\end{${targetName}}`;

  return {
    handled: true,
    edits: [{ start: pair.openStart, end: pair.closeEnd, text: replacement }],
    cursorOffset: pair.openStart + begin.length + 1,
  };
}

export function createWrapEnvironmentPlan(
  text: string,
  start: number,
  end: number,
  targetName: string,
  targetArguments = ''
): ConversionPlan {
  let body = text.slice(start, end);
  let begin = `\\begin{${targetName}}${targetArguments}`;
  let replacement = `${begin}\n${body}\n\\end{${targetName}}`;

  return {
    handled: true,
    edits: [{ start, end, text: replacement }],
    cursorOffset: start + begin.length + 1,
  };
}

export function createEnvironmentConversionPlan(
  text: string,
  offset: number,
  targetName: string,
  targetArguments = '',
  options: LatexContextOptions = {}
): ConversionPlan {
  let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
  if (environmentPair) {
    return createEnvironmentRenamePlan(text, environmentPair, targetName, targetArguments);
  }

  let delimiterPair = findDisplayMathDelimiterAt(text, offset);
  if (delimiterPair) {
    return createDelimiterConversionPlan(text, delimiterPair, targetName, targetArguments);
  }

  return { handled: false, edits: [] };
}
