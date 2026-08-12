import Mocha from 'mocha';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

function findTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.endsWith('.test.ts')) {
      files.push(resolve(fullPath));
    }
  }
  return files;
}

async function run() {
  const mocha = new Mocha({
    require: ['tsx'],
    timeout: 10000,
  });

  // Add all unit test files
  const testFiles = findTestFiles('tests/unit');
  for (const file of testFiles) {
    mocha.addFile(file);
  }

  // Run
  const runner = mocha.run((failures) => {
    console.log(`\nMOCHA CALLBACK: ${failures || 0} failures`);
    process.exitCode = failures ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode || 0), 1000);
  });
}

run().catch((err) => {
  console.error('Unit test runner failed:', err);
  process.exit(1);
});
