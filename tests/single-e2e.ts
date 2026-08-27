/**
 * Run a single e2e test file with the same global setup/teardown as the full
 * suite: `npx tsx tests/single-e2e.ts tests/e2e/foo.test.ts`.
 */
import Mocha from 'mocha';
import { rootHooks } from './setup';
import { resolve } from 'path';

async function run() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx tests/single-e2e.ts <test-file>');
    process.exit(2);
  }
  const mocha = new Mocha({
    require: ['tsx'],
    timeout: 60000,
  });

  const hooks = rootHooks();
  mocha.suite.beforeAll(async () => {
    await hooks.beforeAll!();
  });
  mocha.suite.afterAll(async () => {
    await hooks.afterAll!();
  });

  mocha.addFile(resolve(file));

  const runner = mocha.run((failures) => {
    console.log(`\nMOCHA CALLBACK: ${failures || 0} failures`);
    process.exitCode = failures ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode || 0), 3000);
  });
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
