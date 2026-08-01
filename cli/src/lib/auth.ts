import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BONSAI_CONFIG_PATH } from './constants.js';
import { loadConfig, CliConfig } from './config.js';
import { createHttpClient } from './http.js';
import { printEnvelope, successEnvelope, errorEnvelope } from './output.js';

export function registerAuthCommands(program: Command): void {
  const auth = new Command('auth');
  auth.description('Authentication commands');

  auth
    .command('login')
    .description('Login with credentials and save tokens')
    .requiredOption('-u, --user <id>', 'Operator user ID or email')
    .requiredOption('-p, --password <password>', 'Operator user password')
    .option('--base-url <url>', 'API base URL (overrides config)')
    .option('--json', 'Emit JSON envelope (default: false)')
    .action(async (opts: { user: string; password: string; baseUrl?: string; json?: boolean }) => {
      const config = await loadConfig({ baseUrl: opts.baseUrl || null });

      const client = createHttpClient(config);

      try {
        const response = await client.post('/api/auth/login', {
          id: opts.user,
          password: opts.password,
        });

        const data = response as Record<string, unknown>;
        const accessToken = data.accessToken as string;
        const refreshToken = data.refreshToken as string;

        const fileConfig = { ...config };
        delete (fileConfig as any).token;

        const newConfig = {
          ...fileConfig,
          token: accessToken,
          refreshToken,
        };

        const envPath = process.env.BONSAI_CONFIG_PATH;
        const configPath = envPath || resolve(BONSAI_CONFIG_PATH);

        writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

        printEnvelope(successEnvelope({
          accessToken,
          refreshToken,
          expiresIn: data.expiresIn,
          configPath,
        }), !!opts.json);
      } catch (error: any) {
        const status = error.status || 500;
        const body = error.body as Record<string, unknown> || {};
        printEnvelope(errorEnvelope('AUTH_FAILED', String(body.error || 'Authentication failed'), status, body), !!opts.json);
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Remove saved tokens')
    .option('--json', 'Emit JSON envelope (default: false)')
    .action(async (opts: { json?: boolean }) => {
      const envPath = process.env.BONSAI_CONFIG_PATH;
      const configPath = envPath || resolve(BONSAI_CONFIG_PATH);

      const config = await loadConfig();
      const fileConfig = { ...config };
      fileConfig.token = null;
      fileConfig.refreshToken = null;

      writeFileSync(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');

      printEnvelope(successEnvelope({ configPath }), !!opts.json);
    });

  auth
    .command('status')
    .description('Check authentication status')
    .option('--base-url <url>', 'API base URL (overrides config)')
    .option('--json', 'Emit JSON envelope (default: false)')
    .action(async (opts: { baseUrl?: string; json?: boolean }) => {
      const config = await loadConfig({ baseUrl: opts.baseUrl || null });

      if (!config.token) {
        printEnvelope(errorEnvelope('NOT_AUTHENTICATED', 'Not authenticated. Run: bonsai auth login', 401), !!opts.json);
        process.exit(1);
      }

      const client = createHttpClient(config);

      try {
        const profile = await client.get('/api/profile');

        printEnvelope(successEnvelope({
          authenticated: true,
          user: profile,
          baseUrl: config.baseUrl,
          project: config.project,
        }), !!opts.json);
      } catch (error: any) {
        const status = error.status || 500;
        if (status === 401) {
          printEnvelope(errorEnvelope('TOKEN_EXPIRED', 'Token expired. Run: bonsai auth login', 401), !!opts.json);
          process.exit(1);
        }
        throw error;
      }
    });

  program.addCommand(auth);
}
