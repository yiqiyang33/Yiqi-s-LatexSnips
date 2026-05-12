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

testEnvironmentStack();
testMathContext();
testSmartEnter();
testSmartEnterRecovery();
testAlignmentTab();

console.log('latex edit tests passed');
