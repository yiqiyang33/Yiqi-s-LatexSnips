const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const targetRoot = path.join(root, 'media', 'monaco', 'vs');

if (!fs.existsSync(sourceRoot)) {
  throw new Error('monaco-editor is not installed. Run npm install first.');
}

const files = [
  'loader.js',
  'editor/editor.main.js',
  'editor/editor.main.css',
  'base/worker/workerMain.js',
  'base/browser/ui/codicons/codicon/codicon.ttf',
  ...fs
    .readdirSync(sourceRoot)
    .filter((file) => /^nls\.messages\..+\.js$/.test(file)),
];

fs.rmSync(path.join(root, 'media', 'monaco'), { recursive: true, force: true });

for (const file of files) {
  const source = path.join(sourceRoot, file);
  const target = path.join(targetRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

console.log(`Prepared Monaco runtime (${files.length} files).`);
