import Mocha from 'mocha';
import { rootHooks } from './setup';
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
    timeout: 60000,
    // No exit: true — let mocha print summary, then we force exit after a delay
  });

  // Register root hooks for global setup/teardown
  const hooks = rootHooks();
  mocha.suite.beforeAll(async () => {
    await hooks.beforeAll!();
  });
  mocha.suite.afterAll(async () => {
    await hooks.afterAll!();
  });

  // Add all e2e test files
  const testFiles = findTestFiles('tests/e2e');
  for (const file of testFiles) {
    mocha.addFile(file);
  }

  // Run
  const runner = mocha.run((failures) => {
    console.log(`\nMOCHA CALLBACK: ${failures || 0} failures`);
    process.exitCode = failures ? 1 : 0;
    // Force exit after a short delay to let mocha print its summary.
    // Background services keep the event loop alive, so without this
    // the process would hang indefinitely.
    setTimeout(() => process.exit(process.exitCode || 0), 3000);
  });
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
