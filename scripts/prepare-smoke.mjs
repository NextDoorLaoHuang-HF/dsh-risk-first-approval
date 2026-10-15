import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
for (const [source, target] of [['src/upstream-review.js', 'smoke/reviewer.js'], ['LICENSE', 'smoke/LICENSE'], ['NOTICE.md', 'smoke/NOTICE.md']]) {
  const root = new URL('../', import.meta.url);
  const input = new URL(source, root), output = new URL(target, root);
  const content = await readFile(input);
  let exists = false;
  try { await access(output); exists = true; } catch {}
  if (exists) {
    if (!(await readFile(output)).equals(content)) throw new Error(`Existing generated file differs: ${fileURLToPath(output)}`);
  } else await writeFile(output, content, { flag: 'wx' });
}
console.log('Prepared byte-identical reviewer source for isolated, removable diagnostic');
