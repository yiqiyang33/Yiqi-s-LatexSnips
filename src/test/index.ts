import * as assert from 'assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
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
  createEnvironmentNameOnlyRenamePlan,
  createEnvironmentNameSyncPlan,
  createEnvironmentConversionPlan,
  createUnwrapMathStructurePlan,
  createWrapCurrentMathStructurePlan,
  createWrapEnvironmentPlan,
  findLatexEnvironmentPairAt,
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
import {
  discoverSnippetProfiles,
  getSnippetFilesForProfile,
} from '../snippetProfiles';
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

function testEnvironmentNameSync() {
  let beforeBeginEdit = String.raw`\begin{align}
a &= b
\end{align}`;
  let insertAtBeginNameEnd = beforeBeginEdit.indexOf('align') + 'align'.length;
  let afterBeginEdit = (
    beforeBeginEdit.slice(0, insertAtBeginNameEnd) +
    'ed' +
    beforeBeginEdit.slice(insertAtBeginNameEnd)
  );
  assert.strictEqual(
    applyTextEdits(
      afterBeginEdit,
      createEnvironmentNameSyncPlan(beforeBeginEdit, afterBeginEdit, {
        rangeOffset: insertAtBeginNameEnd,
        rangeLength: 0,
        text: 'ed',
      }).edits
    ),
    String.raw`\begin{aligned}
a &= b
\end{aligned}`
  );

  let beforeBeginDelete = String.raw`\begin{aligned}
a &= b
\end{aligned}`;
  let deleteAtBeginNameEnd = beforeBeginDelete.indexOf('aligned') + 'align'.length;
  let afterBeginDelete = (
    beforeBeginDelete.slice(0, deleteAtBeginNameEnd) +
    beforeBeginDelete.slice(deleteAtBeginNameEnd + 2)
  );
  assert.strictEqual(
    applyTextEdits(
      afterBeginDelete,
      createEnvironmentNameSyncPlan(beforeBeginDelete, afterBeginDelete, {
        rangeOffset: deleteAtBeginNameEnd,
        rangeLength: 2,
        text: '',
      }).edits
    ),
    String.raw`\begin{align}
a &= b
\end{align}`
  );

  let beforeEndEdit = String.raw`\begin{align}
a &= b
\end{align}`;
  let insertAtEndNameEnd = beforeEndEdit.lastIndexOf('align') + 'align'.length;
  let afterEndEdit = (
    beforeEndEdit.slice(0, insertAtEndNameEnd) +
    'ed' +
    beforeEndEdit.slice(insertAtEndNameEnd)
  );
  assert.strictEqual(
    applyTextEdits(
      afterEndEdit,
      createEnvironmentNameSyncPlan(beforeEndEdit, afterEndEdit, {
        rangeOffset: insertAtEndNameEnd,
        rangeLength: 0,
        text: 'ed',
      }).edits
    ),
    String.raw`\begin{aligned}
a &= b
\end{aligned}`
  );

  let beforeEndDelete = String.raw`\begin{aligned}
a &= b
\end{aligned}`;
  let deleteAtEndNameEnd = beforeEndDelete.lastIndexOf('aligned') + 'align'.length;
  let afterEndDelete = (
    beforeEndDelete.slice(0, deleteAtEndNameEnd) +
    beforeEndDelete.slice(deleteAtEndNameEnd + 2)
  );
  assert.strictEqual(
    applyTextEdits(
      afterEndDelete,
      createEnvironmentNameSyncPlan(beforeEndDelete, afterEndDelete, {
        rangeOffset: deleteAtEndNameEnd,
        rangeLength: 2,
        text: '',
      }).edits
    ),
    String.raw`\begin{align}
a &= b
\end{align}`
  );

  let nested = String.raw`\begin{outer}
\begin{inner}
x
\end{inner}
\end{outer}`;
  let nestedInsert = nested.indexOf('inner') + 'inner'.length;
  let nestedAfter = nested.slice(0, nestedInsert) + 'x' + nested.slice(nestedInsert);
  assert.strictEqual(
    applyTextEdits(
      nestedAfter,
      createEnvironmentNameSyncPlan(nested, nestedAfter, {
        rangeOffset: nestedInsert,
        rangeLength: 0,
        text: 'x',
      }).edits
    ),
    String.raw`\begin{outer}
\begin{innerx}
x
\end{innerx}
\end{outer}`
  );

  let commented = String.raw`% \begin{align}
text
% \end{align}`;
  let commentedInsert = commented.indexOf('align') + 'align'.length;
  let commentedAfter = commented.slice(0, commentedInsert) + 'ed' + commented.slice(commentedInsert);
  assert.strictEqual(
    createEnvironmentNameSyncPlan(commented, commentedAfter, {
      rangeOffset: commentedInsert,
      rangeLength: 0,
      text: 'ed',
    }).handled,
    false
  );

  let verbatim = String.raw`\begin{verbatim}
\begin{align}
x
\end{align}
\end{verbatim}`;
  let verbatimInsert = verbatim.indexOf('align') + 'align'.length;
  let verbatimAfter = verbatim.slice(0, verbatimInsert) + 'ed' + verbatim.slice(verbatimInsert);
  assert.strictEqual(
    createEnvironmentNameSyncPlan(verbatim, verbatimAfter, {
      rangeOffset: verbatimInsert,
      rangeLength: 0,
      text: 'ed',
    }).handled,
    false
  );

  let { text, offset } = marked(String.raw`\begin{align}
a &= b|
\end{align}`);
  let environmentPair = findLatexEnvironmentPairAt(text, offset);
  assert.ok(environmentPair);
  let pair = createEnvironmentNameOnlyRenamePlan(environmentPair, 'aligned');
  assert.strictEqual(
    applyTextEdits(text, pair.edits),
    String.raw`\begin{aligned}
a &= b
\end{aligned}`
  );
}

function testWrapUnwrapMathStructure() {
  let display = marked(String.raw`\[
a &= b|
\]`);
  assert.strictEqual(
    applyTextEdits(
      display.text,
      createWrapCurrentMathStructurePlan(display.text, display.offset, 'aligned').edits
    ),
    String.raw`\[
\begin{aligned}
a &= b
\end{aligned}
\]`
  );

  let env = marked(String.raw`\begin{equation}
x + y|
\end{equation}`);
  assert.strictEqual(
    applyTextEdits(
      env.text,
      createWrapCurrentMathStructurePlan(env.text, env.offset, 'split').edits
    ),
    String.raw`\begin{equation}
\begin{split}
x + y
\end{split}
\end{equation}`
  );

  let unwrapEnv = marked(String.raw`\begin{aligned}
a &= b|
\end{aligned}`);
  assert.strictEqual(
    applyTextEdits(
      unwrapEnv.text,
      createUnwrapMathStructurePlan(unwrapEnv.text, unwrapEnv.offset).edits
    ),
    'a &= b'
  );

  let unwrapDisplay = marked(String.raw`\[
a &= b|
\]`);
  assert.strictEqual(
    applyTextEdits(
      unwrapDisplay.text,
      createUnwrapMathStructurePlan(unwrapDisplay.text, unwrapDisplay.offset).edits
    ),
    'a &= b'
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

function testSnippetProfiles() {
  let tempDir = mkdtempSync(path.join(os.tmpdir(), 'yiqi-snips-'));
  try {
    writeFileSync(
      path.join(tempDir, 'latex.hsnips'),
      [
        'snippet base "Base" A',
        '\\base',
        'endsnippet',
      ].join('\n')
    );
    writeFileSync(
      path.join(tempDir, 'all.hsnips'),
      [
        'priority 5',
        'snippet allbase "All Base" A',
        '\\allbase',
        'endsnippet',
      ].join('\n')
    );
    mkdirSync(path.join(tempDir, 'profiles', 'notes'), { recursive: true });
    writeFileSync(
      path.join(tempDir, 'profiles', 'notes', 'latex.hsnips'),
      [
        'priority 10',
        'snippet prof "Profile" A',
        '\\prof',
        'endsnippet',
      ].join('\n')
    );
    writeFileSync(
      path.join(tempDir, 'profiles', 'notes', 'all.hsnips'),
      [
        'snippet allprof "All Profile" A',
        '\\allprof',
        'endsnippet',
      ].join('\n')
    );

    assert.deepStrictEqual(discoverSnippetProfiles(tempDir), ['notes']);
    assert.deepStrictEqual(
      getSnippetFilesForProfile(tempDir).map((entry) => entry.language),
      ['all', 'latex']
    );

    let profileEntries = getSnippetFilesForProfile(tempDir, 'notes');
    assert.deepStrictEqual(
      profileEntries.map((entry) => `${entry.scope}:${entry.language}`),
      ['base:all', 'base:latex', 'profile:all', 'profile:latex']
    );

    let latexSnippets = profileEntries
      .filter((entry) => entry.language == 'latex')
      .flatMap((entry) => parse(readFileSync(entry.filePath, 'utf8')));
    let allSnippets = profileEntries
      .filter((entry) => entry.language == 'all')
      .flatMap((entry) => parse(readFileSync(entry.filePath, 'utf8')));
    latexSnippets.push(...allSnippets);
    latexSnippets.sort((a, b) => b.priority - a.priority);
    assert.deepStrictEqual(
      latexSnippets.map((snippet) => snippet.trigger),
      ['prof', 'allbase', 'base', 'allprof']
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testEnvironmentStack();
testMathContext();
testSmartEnter();
testSmartEnterRecovery();
testAlignmentTab();
testEnvironmentConversion();
testEnvironmentNameSync();
testWrapUnwrapMathStructure();
testSnippetDocument();
testTextOnlySnippetFlag();
testSnippetProfiles();

console.log('latex edit tests passed');
