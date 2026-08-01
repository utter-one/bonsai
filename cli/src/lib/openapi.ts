import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printEnvelope, successEnvelope, errorEnvelope } from './output.js';
import { loadConfig } from './config.js';
import { request } from './http.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, '../../bundled/openapi.json');

let openApiSpec: any = null;

function loadOpenApiSpec(): any {
  if (openApiSpec) return openApiSpec;
  try {
    const raw = readFileSync(OPENAPI_PATH, 'utf-8');
    openApiSpec = JSON.parse(raw);
    return openApiSpec;
  } catch {
    return null;
  }
}

export function registerOpenApiCommands(program: Command): void {
  const openapi = new Command('openapi');
  openapi.description('OpenAPI spec inspection commands');

  openapi
    .command('dump')
    .description('Dump the full bundled OpenAPI spec')
    .option('--json', 'Emit JSON (default: true for this command)')
    .option('--save <path>', 'Save spec to a file instead of stdout')
    .action((opts: { json?: boolean; save?: string }) => {
      const spec = loadOpenApiSpec();
      if (!spec) {
        printEnvelope(errorEnvelope('SPEC_NOT_FOUND', 'OpenAPI spec not found', 500), true);
        process.exit(1);
      }
      const json = JSON.stringify(spec, null, 2) + '\n';
      if (opts.save) {
        writeFileSync(opts.save, json, 'utf-8');
        process.stderr.write(`Saved OpenAPI spec to ${opts.save}\n`);
      } else {
        process.stdout.write(json);
      }
    });

  openapi
    .command('paths')
    .description('List all API paths')
    .option('--methods', 'Include HTTP methods', false)
    .option('--json', 'Emit JSON', false)
    .action((opts: { methods?: boolean; json?: boolean }) => {
      const spec = loadOpenApiSpec();
      if (!spec) {
        printEnvelope(errorEnvelope('SPEC_NOT_FOUND', 'OpenAPI spec not found', 500), !!opts.json);
        process.exit(1);
      }

      const paths = spec.paths || {};
      const result: Array<{ path: string; methods?: string[] }> = [];

      for (const [path, item] of Object.entries(paths)) {
        const entry: { path: string; methods?: string[] } = { path };
        if (opts.methods) {
          entry.methods = Object.keys(item as Record<string, unknown>).filter(
            k => ['get', 'post', 'put', 'delete', 'patch'].includes(k)
          );
        }
        result.push(entry);
      }

      if (opts.json) {
        printEnvelope(successEnvelope(result), true);
      } else {
        for (const entry of result) {
          const methods = entry.methods ? ` [${entry.methods.join(', ')}]` : '';
          process.stdout.write(`${entry.path}${methods}\n`);
        }
      }
    });

  openapi
    .command('schemas')
    .description('List all schema names')
    .option('--json', 'Emit JSON', false)
    .action((opts: { json?: boolean }) => {
      const spec = loadOpenApiSpec();
      if (!spec) {
        printEnvelope(errorEnvelope('SPEC_NOT_FOUND', 'OpenAPI spec not found', 500), !!opts.json);
        process.exit(1);
      }

      const schemas = spec.components?.schemas || {};
      const names = Object.keys(schemas);

      if (opts.json) {
        printEnvelope(successEnvelope(names), true);
      } else {
        for (const name of names) {
          process.stdout.write(`${name}\n`);
        }
      }
    });

  openapi
    .command('schema')
    .description('Show a specific schema definition')
    .requiredOption('--name <name>', 'Schema name')
    .option('--json', 'Emit JSON (default: true for this command)')
    .action((opts: { name: string; json?: boolean }) => {
      const spec = loadOpenApiSpec();
      if (!spec) {
        printEnvelope(errorEnvelope('SPEC_NOT_FOUND', 'OpenAPI spec not found', 500), true);
        process.exit(1);
      }

      const schemas = spec.components?.schemas || {};
      const schema = schemas[opts.name];

      if (!schema) {
        printEnvelope(errorEnvelope('SCHEMA_NOT_FOUND', `Schema '${opts.name}' not found`, 404), true);
        process.exit(1);
      }

      process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
    });

  openapi
    .command('refresh')
    .description('Fetch the latest OpenAPI spec from the server')
    .option('--save <path>', 'Save fetched spec to a file')
    .option('--base-url <url>', 'API base URL')
    .option('--token <string>', 'Auth token')
    .action(async (opts: { save?: string; baseUrl?: string; token?: string }) => {
      const config = await loadConfig({
        baseUrl: opts.baseUrl,
        token: opts.token,
      });

      if (!config.baseUrl) {
        printEnvelope(errorEnvelope('CONFIG_ERROR', 'No API base URL configured', 1), true);
        process.exit(2);
      }

      try {
        const resp = await request({
          method: 'get',
          baseUrl: config.baseUrl,
          pathTemplate: '/openapi.json',
          pathParams: {},
          timeout: config.timeout,
          token: config.token,
        });

        if (resp.status >= 400) {
          printEnvelope(errorEnvelope('FETCH_ERROR', `Failed to fetch spec: HTTP ${resp.status}`, resp.status), true);
          process.exit(1);
        }

        const json = JSON.stringify(resp.data, null, 2) + '\n';

        if (opts.save) {
          writeFileSync(opts.save, json, 'utf-8');
          process.stderr.write(`Saved OpenAPI spec to ${opts.save}\n`);
        } else {
          process.stdout.write(json);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printEnvelope(errorEnvelope('NETWORK_ERROR', message, 0), true);
        process.exit(8);
      }
    });

  program.addCommand(openapi);
}
