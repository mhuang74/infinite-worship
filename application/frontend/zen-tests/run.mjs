/**
 * Zen draw-module test runner (issues #38–#41 testing decisions).
 *
 * Plain Node scripts with `assert` — deliberately no test framework, matching
 * the repo's avoidance of one. Runs each *.test.mjs beside this file and
 * reports pass/fail per file with a summary line.
 *
 * Usage: node zen-tests/run.mjs [test-file-filter-substring]
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // application/frontend/zen-tests

const filter = process.argv[2] ? process.argv[2].toLowerCase() : null;
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs') && (!filter || f.includes(filter)));

let passed = 0;
const failed = [];
for (const file of files) {
  const url = pathToFileURL(path.join(here, file)).href;
  try {
    await import(url);
    console.log(`PASS ${file}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${file}`);
    console.error(err?.stack || String(err));
    failed.push(file);
  }
}
console.log(`\n${passed} passed, ${failed.length} failed (${files.length} files)`);
process.exit(failed.length > 0 ? 1 : 0);