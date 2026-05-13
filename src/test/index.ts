import * as assert from 'assert';
import {
  getLatexContext,
  getOpenLatexEnvironmentStack,
  getSmartEnterPlan,
  getSmartEnterRecoveryPlan,
  shouldInsertAlignmentSeparator,
  SmartEnterPlan,
  TextEdit,
} from '../latexEdit';
import {
  createEnvironmentConversionPlan,
  createWrapEnvironmentPlan,
  formatTableArguments,
} from '../environmentConvert';
import {
  assertExpectedSnippetDocumentHash,
  appendSnippet,
  applySnippetUpdate,
  deleteSnippet,
  hashText,
  parseSnippetDocument,
} from '../snippetDocument';
import { parse } from '../parser';

function marked(input: string) {
  let offset = input.indexOf('|');
  assert.notStrictEqual(offset, -1, 'test input must contain a cursor marker');
  return {
    text: input.slice(0, offset) + input.slice(offset + 1),
    offset,
  };
}

function applyTextEdits(text: string, edits: TextEdit[]) {
  return edits
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, edit) => {
      return result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }, text);
}

function applySmartEnter(text: string, plan: SmartEnterPlan) {
  let result = applyTextEdits(text, plan.edits);
  assert.strictEqual(plan.handled, true);
  assert.strictEqual(typeof plan.cursorOffset, 'number');
  return result.slice(0, plan.cursorOffset) + '|' + result.slice(plan.cursorOffset);
}

function testEnvironmentStack() {
  let { text, offset } = marked(String.raw`\begin{align}
a &= b|
\end{align}`);
  assert.deepStrictEqual(getOpenLatexEnvironmentStack(text, offset), ['align']);

  let commented = marked(String.raw`% \begin{align}
outside|`);
  assert.deepStrictEqual(getOpenLatexEnvironmentStack(commented.text, commented.offset), []);
}

function testMathContext() {
  let inline = marked(String.raw`before $x + y|$ after`);
  assert.strictEqual(getLatexContext(inline.text, inline.offset).inMath, true);
  assert.strictEqual(getLatexContext(inline.text, inline.offset).mathKind, 'inlineDollar');

  let label = marked(String.raw`\begin{align}
\label{eq:test|}
\end{align}`);
  assert.strictEqual(getLatexContext(label.text, label.offset).inMath, false);

  let comment = marked(String.raw`\begin{align}
a &= b % x|
\end{align}`);
  assert.strictEqual(getLatexContext(comment.text, comment.offset).canSmartEnter, false);

  let fencedCode = marked([
    '```tex',
    String.raw`\begin{align}`,
    'a &= b|',
    '```',
  ].join('\n'));
  assert.strictEqual(getLatexContext(fencedCode.text, fencedCode.offset).canSmartEnter, false);

  let verbatim = marked(String.raw`\begin{verbatim}
\begin{align}
a &= b|
\end{align}
\end{verbatim}`);
  assert.strictEqual(getLatexContext(verbatim.text, verbatim.offset).inVerbatimLikeEnvironment, true);
  assert.strictEqual(getLatexContext(verbatim.text, verbatim.offset).canSmartEnter, false);

  let custom = marked(String.raw`\begin{myalign}
a &= b|
\end{myalign}`);
  let customContext = getLatexContext(custom.text, custom.offset, {
    extraMathEnvironments: ['myalign'],
    extraRowBreakEnvironments: ['myalign'],
    extraAlignmentEnvironments: ['myalign'],
  });
  assert.strictEqual(customContext.canExpandMathSnippet, true);
  assert.strictEqual(customContext.canSmartEnter, true);
  assert.strictEqual(customContext.canSmartTab, true);
}

function testSmartEnter() {
  let align = marked(String.raw`\begin{align}
  a &= b|
\end{align}`);
  assert.strictEqual(
    applySmartEnter(align.text, getSmartEnterPlan(align.text, align.offset)),
    String.raw`\begin{align}
  a &= b \\
  |
\end{align}`
  );

  let withComment = marked(String.raw`\begin{align}
  a &= b | % reason
\end{align}`);
  assert.strictEqual(
    applySmartEnter(withComment.text, getSmartEnterPlan(withComment.text, withComment.offset)),
    String.raw`\begin{align}
  a &= b \\ % reason
  |
\end{align}`
  );

  let alreadyBroken = marked(String.raw`\begin{align}
  a &= b \\|
\end{align}`);
  assert.strictEqual(getSmartEnterPlan(alreadyBroken.text, alreadyBroken.offset).handled, false);

  let beginLine = marked(String.raw`\begin{align}|
a &= b
\end{align}`);
  assert.strictEqual(getSmartEnterPlan(beginLine.text, beginLine.offset).handled, false);

  let plainText = marked(String.raw`hello world|`);
  assert.strictEqual(getSmartEnterPlan(plainText.text, plainText.offset).handled, false);
}

function testSmartEnterRecovery() {
  let beforeEnter = marked(String.raw`\begin{align}
  a &= b|
\end{align}`);
  let afterPlainEnter = marked(String.raw`\begin{align}
  a &= b
  |
\end{align}`);

  assert.strictEqual(
    applySmartEnter(
      afterPlainEnter.text,
      getSmartEnterRecoveryPlan(beforeEnter.text, beforeEnter.offset, afterPlainEnter.text)
    ),
    String.raw`\begin{align}
  a &= b \\
  |
\end{align}`
  );

  let afterPlainEnterNoIndent = marked(String.raw`\begin{align}
  a &= b
|
\end{align}`);
  assert.strictEqual(
    applySmartEnter(
      afterPlainEnterNoIndent.text,
      getSmartEnterRecoveryPlan(beforeEnter.text, beforeEnter.offset, afterPlainEnterNoIndent.text)
    ),
    String.raw`\begin{align}
  a &= b \\
  |
\end{align}`
  );

  let plainText = marked(String.raw`hello|
world`);
  assert.strictEqual(
    getSmartEnterRecoveryPlan('hello world', 'hello'.length, plainText.text).handled,
    false
  );
}

function testAlignmentTab() {
  let align = marked(String.raw`\begin{align}
a |&= b
\end{align}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(align.text, align.offset), true);

  let matrix = marked(String.raw`\begin{bmatrix}
a|
\end{bmatrix}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(matrix.text, matrix.offset), true);

  let tabular = marked(String.raw`\begin{tabular}{cc}
a|
\end{tabular}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(tabular.text, tabular.offset), true);

  let blank = marked(String.raw`\begin{bmatrix}
  |
\end{bmatrix}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(blank.text, blank.offset), true);

  let rowEnd = marked(String.raw`\begin{bmatrix}
a \\|
\end{bmatrix}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(rowEnd.text, rowEnd.offset), false);

  let comment = marked(String.raw`\begin{bmatrix}
a % |
\end{bmatrix}`);
  assert.strictEqual(shouldInsertAlignmentSeparator(comment.text, comment.offset), false);
}

function testEnvironmentConversion() {
  let align = marked(String.raw`\begin{align}
a &= b|
\end{align}`);
  assert.strictEqual(
    applyTextEdits(
      align.text,
      createEnvironmentConversionPlan(align.text, align.offset, 'aligned').edits
    ),
    String.raw`\begin{aligned}
a &= b
\end{aligned}`
  );

  let display = marked(String.raw`\[
a &= b|
\]`);
  assert.strictEqual(
    applyTextEdits(
      display.text,
      createEnvironmentConversionPlan(display.text, display.offset, 'equation*').edits
    ),
    String.raw`\begin{equation*}
a &= b
\end{equation*}`
  );

  let tabular = marked(String.raw`\begin{tabular}{cc}
a & b|
\end{tabular}`);
  assert.strictEqual(
    applyTextEdits(
      tabular.text,
      createEnvironmentConversionPlan(tabular.text, tabular.offset, 'tabularx').edits
    ),
    String.raw`\begin{tabularx}{\linewidth}{cc}
a & b
\end{tabularx}`
  );

  assert.strictEqual(formatTableArguments('tabular', 'lr'), '{lr}');
  assert.strictEqual(formatTableArguments('tabularx', 'lr'), String.raw`{\linewidth}{lr}`);

  let selected = 'a &= b';
  assert.strictEqual(
    applyTextEdits(selected, createWrapEnvironmentPlan(selected, 0, selected.length, 'align').edits),
    String.raw`\begin{align}
a &= b
\end{align}`
  );
}

function testSnippetDocument() {
  let content = [
    'priority 10',
    'snippet foo "Foo" wA',
    '\\foo{$0}',
    'endsnippet',
    '',
    'snippet foo "Duplicate" A',
    '\\bar',
    'endsnippet',
    '',
    'snippet `x+` "Dynamic" rmA',
    '``rv = "x";``',
    'endsnippet',
  ].join('\n');
  let document = parseSnippetDocument(content, '/tmp/latex.hsnips', 'latex');

  assert.strictEqual(document.snippets.length, 3);
  assert.strictEqual(document.snippets[0].priority, 10);
  assert.strictEqual(document.snippets[0].priorityStart, 0);
  assert.strictEqual(content.slice(document.snippets[0].headerStart).startsWith('snippet foo'), true);
  assert.strictEqual(document.snippets[0].isSimple, true);
  assert.strictEqual(document.snippets[2].isRegex, true);
  assert.strictEqual(document.snippets[2].isSimple, false);
  assert.strictEqual(
    document.snippets[0].diagnostics.some((diagnostic) => diagnostic.message.includes('Duplicate')),
    true
  );

  let updated = applySnippetUpdate(content, document.snippets[0], {
    trigger: 'foo2',
    description: 'Foo 2',
    flags: 'iAm',
    priority: 5,
    body: '\\fooTwo{$0}',
  });
  assert.strictEqual(updated.includes('priority 5\nsnippet foo2 "Foo 2" iAm\n\\fooTwo{$0}\nendsnippet'), true);

  let appended = appendSnippet('', {
    trigger: 'new',
    description: 'New',
    flags: 'wAt',
    priority: 0,
    body: '$0',
  });
  assert.strictEqual(appended.trim(), 'snippet new "New" wAt\n$0\nendsnippet');

  let reparsed = parseSnippetDocument(updated, '/tmp/latex.hsnips', 'latex');
  let deleted = deleteSnippet(updated, reparsed.snippets[0]);
  assert.strictEqual(deleted.includes('foo2'), false);

  let broken = parseSnippetDocument('snippet bad "Bad" w\nbody', '/tmp/bad.hsnips', 'latex');
  assert.strictEqual(
    broken.diagnostics.some((diagnostic) => diagnostic.message.includes('missing endsnippet')),
    true
  );

  assert.doesNotThrow(() => assertExpectedSnippetDocumentHash(content, hashText(content)));
  assert.throws(
    () => assertExpectedSnippetDocumentHash(content, hashText(content + 'changed')),
    /changed on disk/
  );
}

function testTextOnlySnippetFlag() {
  let snippets = parse([
    'snippet align "align" wAt',
    '\\begin{align}',
    '$0',
    '\\end{align}',
    'endsnippet',
  ].join('\n'));

  assert.strictEqual(snippets.length, 1);
  assert.strictEqual(snippets[0].automatic, true);
  assert.strictEqual(snippets[0].wordboundary, true);
  assert.strictEqual(snippets[0].text, true);
  assert.strictEqual(snippets[0].math, false);
}

testEnvironmentStack();
testMathContext();
testSmartEnter();
testSmartEnterRecovery();
testAlignmentTab();
testEnvironmentConversion();
testSnippetDocument();
testTextOnlySnippetFlag();

console.log('latex edit tests passed');
