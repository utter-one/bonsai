import { container, inject, singleton } from 'tsyringe';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { providers } from '../db/schema';
import { smtpImapChannelProviderConfigSchema } from './providers/channel/SmtpImapChannelProvider';
import { SecretRefUtils } from './secrets/SecretRefUtils';
import { logger } from '../utils/logger';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

type OAuth2TokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
};

@singleton()
export class OAuth2TokenRefreshService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
  ) {}

  private async resolveImapInboundService(): Promise<{ reload: (id: string) => Promise<void> }> {
    const mod = await import('./ImapInboundService');
    return container.resolve(mod.ImapInboundService);
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('OAuth2TokenRefreshService already started');
      return;
    }
    this.isRunning = true;
    logger.info('Starting OAuth2TokenRefreshService');
    this.scheduleRefresh();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('OAuth2TokenRefreshService stopped');
  }

  async refreshProvider(providerId: string): Promise<void> {
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerId),
    });

    if (!provider || provider.apiType !== 'smtp_imap') {
      logger.warn({ providerId }, 'Provider not found or not smtp_imap, skipping OAuth2 refresh');
      return;
    }

    await this.processProviderRefresh(provider);
  }

  private scheduleRefresh(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(async () => {
      if (!this.isRunning) return;
      try {
        await this.runRefreshCycle();
      } catch (error) {
        logger.error({ error }, 'Error during OAuth2 refresh cycle');
      }
      if (this.isRunning) {
        this.scheduleRefresh();
      }
    }, REFRESH_INTERVAL_MS);
    if (this.timer) {
      this.timer.unref?.();
    }
  }

  private async runRefreshCycle(): Promise<void> {
    const providerRecords = await db.query.providers.findMany({
      where: and(
        eq(providers.providerType, 'channel'),
      ),
    });

    const smtpImapProviders = providerRecords.filter((p) => p.apiType === 'smtp_imap');

    for (const provider of smtpImapProviders) {
      try {
        await this.processProviderRefresh(provider);
      } catch (error) {
        logger.error({ error, providerId: provider.id }, 'Failed to process OAuth2 refresh for provider');
      }
    }
  }

  private async processProviderRefresh(provider: { id: string; config: Record<string, unknown> }): Promise<void> {
    const rawConfig = await this.secretRefUtils.resolveObject(provider.config);
    const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);

    if (!configResult.success) {
      return;
    }

    const config = configResult.data;

    if (!config.oauth2) {
      return;
    }

    const { oauth2 } = config;
    const now = Date.now();

    if (!oauth2.accessTokenExpiry || !oauth2.refreshToken || oauth2.accessTokenExpiry - now > EXPIRY_BUFFER_MS) {
      return;
    }

    logger.info({ providerId: provider.id, expiresIn: oauth2.accessTokenExpiry - now }, 'OAuth2 token expiring, refreshing');

    const tokenResponse = await this.fetchToken(oauth2);

    const updatedConfig: Record<string, unknown> = { ...provider.config };
    if (typeof updatedConfig.oauth2 !== 'object' || updatedConfig.oauth2 === null) {
      updatedConfig.oauth2 = {};
    }

    const oauth2Config = updatedConfig.oauth2 as Record<string, unknown>;
    oauth2Config.accessToken = tokenResponse.access_token;
    oauth2Config.accessTokenExpiry = now + (tokenResponse.expires_in ?? 3600) * 1000;

    if (tokenResponse.refresh_token) {
      oauth2Config.refreshToken = tokenResponse.refresh_token;
    }

    const secretizedConfig = await this.secretRefUtils.secretizeObject(updatedConfig, new Set());

    await db.update(providers)
      .set({
        config: secretizedConfig,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, provider.id));

    logger.info({ providerId: provider.id, newExpiry: oauth2Config.accessTokenExpiry }, 'OAuth2 token refreshed successfully');

    (await this.resolveImapInboundService()).reload(provider.id).catch((error) => {
      logger.error({ error, providerId: provider.id }, 'Failed to reload IMAP session after OAuth2 token refresh');
    });
  }

  private async fetchToken(oauth2: NonNullable<ReturnType<typeof smtpImapChannelProviderConfigSchema.parse>['oauth2']>): Promise<OAuth2TokenResponse> {
    const response = await fetch(oauth2.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: oauth2.clientId,
        client_secret: oauth2.clientSecret,
        refresh_token: oauth2.refreshToken,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body, providerTokenUrl: oauth2.tokenUrl }, 'OAuth2 token refresh failed');
      throw new Error(`OAuth2 token refresh failed: ${response.status} ${body}`);
    }

    const json = (await response.json()) as OAuth2TokenResponse;

    if (!json.access_token) {
      throw new Error('OAuth2 token refresh response missing access_token');
    }

    return json;
  }
}
