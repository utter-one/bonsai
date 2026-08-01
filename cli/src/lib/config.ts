import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { BONSAI_CONFIG_PATH } from './constants.js';

export interface CliConfig {
  baseUrl: string | null;
  token: string | null;
  refreshToken: string | null;
  project: string | null;
  timeout: number;
}

const DEFAULTS: CliConfig = {
  baseUrl: null,
  token: null,
  refreshToken: null,
  project: null,
  timeout: 30000,
};

async function loadConfigFile(): Promise<CliConfig | null> {
  const envPath = process.env.BONSAI_CONFIG_PATH;
  const filePath = envPath || resolve(BONSAI_CONFIG_PATH);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      baseUrl: parsed.baseUrl || null,
      token: parsed.token || null,
      refreshToken: parsed.refreshToken || null,
      project: parsed.project || null,
      timeout: parsed.timeout || DEFAULTS.timeout,
    };
  } catch {
    return null;
  }
}

export async function loadConfig(overrides: Partial<CliConfig> = {}): Promise<CliConfig> {
  const fileConfig = await loadConfigFile();
  const envBaseUrl = process.env.BONSAI_API_BASE_URL || null;
  const envToken = process.env.BONSAI_API_TOKEN || null;
  const envProject = process.env.BONSAI_PROJECT_ID || null;

  return {
    baseUrl: overrides.baseUrl ?? envBaseUrl ?? fileConfig?.baseUrl ?? DEFAULTS.baseUrl,
    token: overrides.token ?? envToken ?? fileConfig?.token ?? DEFAULTS.token,
    refreshToken: fileConfig?.refreshToken ?? DEFAULTS.refreshToken,
    project: overrides.project ?? envProject ?? fileConfig?.project ?? DEFAULTS.project,
    timeout: overrides.timeout ?? fileConfig?.timeout ?? DEFAULTS.timeout,
  };
}
