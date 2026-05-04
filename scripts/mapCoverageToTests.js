#!/usr/bin/env node
/**
 * Parses vitest coverage output and maps source files to their test files.
 * Usage: npm run test:coverage 2>&1 | npm run coverage:map
 *        or: npm run test:coverage > /tmp/cov.txt && npm run coverage:map -- /tmp/cov.txt
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';

const TESTS_DIR = 'tests';

function getAllTestFiles(dir = TESTS_DIR) {
  let results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(getAllTestFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) results.push(fullPath);
  }
  return results;
}

function testFileToSource(testPath) {
  let rel = relative(TESTS_DIR, testPath);
  const name = rel.replace(/\.test\.ts$/, '');
  const dir = relative(TESTS_DIR, join(testPath, '..'));
  const baseName = name.split('/').pop();
  const pascalBase = baseName.charAt(0).toUpperCase() + baseName.slice(1);

  if (dir === 'controllers') return join('src', 'http', 'controllers', pascalBase + '.ts');
  if (dir === 'channels') return join('src', 'channels', pascalBase + '.ts');
  if (dir.startsWith('services')) {
    const subPath = dir.replace(/^services/, '');
    return join('src', 'services', ...subPath.split('/'), pascalBase + '.ts');
  }
  if (dir === 'contracts') return join('src', 'http', 'contracts', pascalBase + '.ts');
  if (dir === 'utils') return join('src', 'utils', pascalBase + '.ts');
  if (dir === 'errors') return join('src', 'errors', pascalBase + '.ts');

  let mapped = rel.replace(/\.test$/, '.ts');
  return join('src', ...mapped.split('/'));
}

const testFiles = getAllTestFiles();
const sourceWithTests = new Set();
const testMap = new Map();

for (const tf of testFiles) {
  const src = testFileToSource(tf);
  if (src) {
    sourceWithTests.add(src);
    if (!testMap.has(src)) testMap.set(src, []);
    testMap.get(src).push(relative(process.cwd(), tf));
  }
}

function parseCoverage(input) {
  const lines = input.split('\n');
  const coverage = new Map();

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('File') && lines[i].includes('% Stmts')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return coverage;

  const headerLine = lines[headerIdx];
  const cols = headerLine.split('|').map(s => s.trim()).filter(Boolean);
  const fileCol = cols.indexOf('File');
  const stmtsCol = cols.indexOf('% Stmts');
  const branchesCol = cols.indexOf('% Branch');
  const funcsCol = cols.indexOf('% Funcs');
  const linesCol = cols.indexOf('% Lines');

  // Coverage table uses directory headers + indented file names
  // e.g. " src/channels        | 62.58 | ..." then "  ChannelCatalog.ts | 9.09 | ..."
  let currentDir = '';
  let pastSecondSeparator = false;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('---')) {
      pastSecondSeparator = !pastSecondSeparator;
      continue;
    }
    if (!pastSecondSeparator) continue;
    if (line.includes('===') || line.includes('Coverage summary') || line.trim() === '') break;

    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const fileCell = cells[fileCol].trimStart();

    // Directory header: starts with "src" at column 0 (no leading space beyond trim)
    if (line.startsWith(' src') && fileCell.includes('/')) {
      currentDir = fileCell;
      continue;
    }
    // Root dir marker
    if (line.startsWith(' src ') && !fileCell.includes('/')) {
      currentDir = 'src';
      continue;
    }

    // File row: indented with spaces, ends with .ts or similar
    const fileName = fileCell;
    if (!fileName || fileName === 'All files') continue;

    const fullPath = currentDir ? join(currentDir, fileName) : fileName;
    if (!fullPath.startsWith('src/')) continue;

    coverage.set(fullPath, {
      stmts: parseFloat(cells[stmtsCol]) || 0,
      branches: parseFloat(cells[branchesCol]) || 0,
      funcs: parseFloat(cells[funcsCol]) || 0,
      lines: parseFloat(cells[linesCol]) || 0,
    });
  }

  return coverage;
}

async function main() {
  let input = '';

  if (process.argv[2]) {
    input = readFileSync(process.argv[2], 'utf-8');
  } else if (!process.stdin.isTTY) {
    const chunks = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) chunks.push(line);
    input = chunks.join('\n');
  } else {
    console.error('Usage: pipe coverage output to stdin or pass a file path as argument');
    process.exit(1);
  }

  const coverage = parseCoverage(input);

  const results = [];
  for (const [file, data] of coverage) {
    if (sourceWithTests.has(file)) {
      results.push({ file, tests: testMap.get(file) || [], ...data });
    }
  }

  results.sort((a, b) => a.stmts - b.stmts);

  const maxFileLen = Math.max(...results.map(r => r.file.length), 10);
  const maxTests = Math.max(...results.map(r => r.tests.join(', ').length), 10);

  console.log('\n COVERAGE BY SOURCE FILE (only files with dedicated tests)\n');
  console.log(
    ` ${'FILE'.padEnd(maxFileLen)}  ${'%STMTS'.padStart(7)}  ${'%BRANCH'.padStart(8)}  ${'%FUNCS'.padStart(8)}  ${'%LINES'.padStart(8)}  TEST(S)`
  );
  console.log('\u2500'.repeat(maxFileLen + maxTests + 50));

  for (const r of results) {
    const color = r.stmts < 50 ? '\x1b[31m' : r.stmts < 75 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';
    console.log(
      ` ${r.file.padEnd(maxFileLen)}  ${color}${r.stmts.toFixed(1).padStart(6)}%${reset}  ${r.branches.toFixed(1).padStart(7)}%  ${r.funcs.toFixed(1).padStart(7)}%  ${r.lines.toFixed(1).padStart(7)}%  ${r.tests.join(', ')}`
    );
  }

  console.log(`\n Total: ${results.length} file(s) with dedicated test(s)\n`);
}

main();
