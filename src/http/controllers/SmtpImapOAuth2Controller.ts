import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '../../db';
import { providers } from '../../db/schema';
import { smtpImapChannelProviderConfigSchema } from '../../services/providers/channel/SmtpImapChannelProvider';
import { SecretRefUtils } from '../../services/secrets/SecretRefUtils';
import { OAuth2TokenRefreshService } from '../../services/OAuth2TokenRefreshService';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  oauth2AuthorizeBodySchema,
  oauth2AuthorizeResponseSchema,
  oauth2CallbackQuerySchema,
  oauth2CallbackResponseSchema,
  oauth2RefreshBodySchema,
  oauth2RefreshResponseSchema,
  type OAuth2AuthorizeResponse,
  type OAuth2CallbackResponse,
  type OAuth2RefreshResponse,
} from '../contracts/smtp-imap-oauth2';

const STATE_TTL_MS = 10 * 60 * 1000;

type OAuth2StateEntry = {
  providerId: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  scope: string;
  createdAt: number;
};

@singleton()
export class SmtpImapOAuth2Controller {
  private readonly pendingStates = new Map<string, OAuth2StateEntry>();

  constructor(
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(OAuth2TokenRefreshService) private readonly tokenRefreshService: OAuth2TokenRefreshService,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [state, entry] of this.pendingStates.entries()) {
        if (now - entry.createdAt > STATE_TTL_MS) {
          this.pendingStates.delete(state);
        }
      }
    }, 60_000).unref();
  }

  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/email/smtp-imap/oauth2/authorize',
        tags: ['SMTP/IMAP OAuth2'],
        summary: 'Generate OAuth2 authorization URL',
        description: 'Generates an authorization URL for the user to grant OAuth2 access to their email account. The user should be redirected to this URL.',
        request: {
          body: { content: { 'application/json': { schema: oauth2AuthorizeBodySchema } } },
        },
        responses: {
          200: { description: 'Authorization URL generated', content: { 'application/json': { schema: oauth2AuthorizeResponseSchema } } },
          400: { description: 'Invalid request or provider not found' },
        },
      },
      {
        method: 'get',
        path: '/api/email/smtp-imap/oauth2/callback',
        tags: ['SMTP/IMAP OAuth2'],
        summary: 'OAuth2 authorization callback',
        description: 'Handles the OAuth2 authorization callback. The OAuth2 provider redirects here with the authorization code.',
        request: {
          query: oauth2CallbackQuerySchema,
        },
        responses: {
          200: { description: 'Callback processed', content: { 'application/json': { schema: oauth2CallbackResponseSchema } } },
          400: { description: 'Invalid or expired state' },
        },
      },
      {
        method: 'post',
        path: '/api/email/smtp-imap/oauth2/refresh',
        tags: ['SMTP/IMAP OAuth2'],
        summary: 'Manually trigger OAuth2 token refresh',
        description: 'Immediately refreshes the OAuth2 access token for the given provider.',
        request: {
          body: { content: { 'application/json': { schema: oauth2RefreshBodySchema } } },
        },
        responses: {
          200: { description: 'Token refresh initiated', content: { 'application/json': { schema: oauth2RefreshResponseSchema } } },
          400: { description: 'Provider not found or not configured for OAuth2' },
        },
      },
    ];
  }

  registerRoutes(router: Router): void {
    router.post('/api/email/smtp-imap/oauth2/authorize', asyncHandler(this.handleAuthorize.bind(this)));
    router.get('/api/email/smtp-imap/oauth2/callback', asyncHandler(this.handleCallback.bind(this)));
    router.post('/api/email/smtp-imap/oauth2/refresh', asyncHandler(this.handleRefresh.bind(this)));
  }

  private async handleAuthorize(req: Request, res: Response): Promise<void> {
    const body = oauth2AuthorizeBodySchema.parse(req.body);
    const { providerId, tokenUrl, authorizationUrl, clientId, clientSecret, scope, redirectUrl } = body;

    const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    if (!provider || provider.apiType !== 'smtp_imap') {
      res.status(400).json({ error: 'Provider not found or not an SMTP/IMAP channel' });
      return;
    }

    const state = randomBytes(16).toString('hex');

    this.pendingStates.set(state, {
      providerId,
      tokenUrl,
      clientId,
      clientSecret,
      redirectUrl,
      scope,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUrl,
      scope,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const fullAuthUrl = `${authorizationUrl}?${params.toString()}`;

    const response: OAuth2AuthorizeResponse = oauth2AuthorizeResponseSchema.parse({
      authorizationUrl: fullAuthUrl,
      state,
    });

    res.status(200).json(response);
  }

  private async handleCallback(req: Request, res: Response): Promise<void> {
    const query = oauth2CallbackQuerySchema.parse(req.query);

    if (query.error) {
      const response: OAuth2CallbackResponse = oauth2CallbackResponseSchema.parse({
        success: false,
        message: query.error_description ?? query.error,
      });
      res.status(400).json(response);
      return;
    }

    const { code, state } = query;

    if (!code || !state) {
      const response: OAuth2CallbackResponse = oauth2CallbackResponseSchema.parse({
        success: false,
        message: 'Missing code or state parameter',
      });
      res.status(400).json(response);
      return;
    }

    const entry = this.pendingStates.get(state);
    if (!entry) {
      res.status(400).json({ error: 'Invalid or expired state parameter' });
      return;
    }
    this.pendingStates.delete(state);

    try {
      const tokenResponse = await this.exchangeCodeForToken(
        entry.tokenUrl,
        entry.clientId,
        entry.clientSecret,
        entry.redirectUrl,
        code,
      );

      const provider = await db.query.providers.findFirst({ where: eq(providers.id, entry.providerId) });
      if (!provider) {
        res.status(400).json({ error: 'Provider not found' });
        return;
      }

      const updatedConfig: Record<string, unknown> = { ...provider.config };
      if (typeof updatedConfig.oauth2 !== 'object' || updatedConfig.oauth2 === null) {
        updatedConfig.oauth2 = {};
      }

      const oauth2Config = updatedConfig.oauth2 as Record<string, unknown>;
      oauth2Config.tokenUrl = entry.tokenUrl;
      oauth2Config.clientId = entry.clientId;
      oauth2Config.clientSecret = entry.clientSecret;
      oauth2Config.accessToken = tokenResponse.access_token;
      if (tokenResponse.refresh_token) {
        oauth2Config.refreshToken = tokenResponse.refresh_token;
      }
      oauth2Config.accessTokenExpiry = Date.now() + (tokenResponse.expires_in ?? 3600) * 1000;
      oauth2Config.scope = entry.scope;

      const secretizedConfig = await this.secretRefUtils.secretizeObject(updatedConfig, new Set());

      await db.update(providers)
        .set({
          config: secretizedConfig,
          updatedAt: new Date(),
        })
        .where(eq(providers.id, entry.providerId));

      logger.info({ providerId: entry.providerId }, 'OAuth2 tokens stored successfully');

      const response: OAuth2CallbackResponse = oauth2CallbackResponseSchema.parse({
        success: true,
        message: 'OAuth2 tokens stored successfully',
      });

      res.status(200).json(response);
    } catch (error) {
      logger.error({ error, providerId: entry.providerId }, 'Failed to exchange OAuth2 code for tokens');
      const response: OAuth2CallbackResponse = oauth2CallbackResponseSchema.parse({
        success: false,
        message: `Failed to exchange code for tokens: ${error instanceof Error ? error.message : String(error)}`,
      });
      res.status(400).json(response);
    }
  }

  private async handleRefresh(req: Request, res: Response): Promise<void> {
    const body = oauth2RefreshBodySchema.parse(req.body);
    const { providerId } = body;

    const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    if (!provider || provider.apiType !== 'smtp_imap') {
      res.status(400).json({ error: 'Provider not found or not an SMTP/IMAP channel' });
      return;
    }

    const rawConfig = await this.secretRefUtils.resolveObject(provider.config as Record<string, unknown>);
    const configResult = smtpImapChannelProviderConfigSchema.safeParse(rawConfig);
    if (!configResult.success || !configResult.data.oauth2) {
      res.status(400).json({ error: 'Provider is not configured for OAuth2' });
      return;
    }

    try {
      await this.tokenRefreshService.refreshProvider(providerId);

      const updatedProvider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
      const updatedConfig = await this.secretRefUtils.resolveObject(updatedProvider!.config as Record<string, unknown>);
      const parsedConfig = smtpImapChannelProviderConfigSchema.parse(updatedConfig);

      const response: OAuth2RefreshResponse = oauth2RefreshResponseSchema.parse({
        success: true,
        accessTokenExpiry: parsedConfig.oauth2?.accessTokenExpiry,
      });

      res.status(200).json(response);
    } catch (error) {
      const response: OAuth2RefreshResponse = oauth2RefreshResponseSchema.parse({
        success: false,
        accessTokenExpiry: undefined,
      });
      res.status(502).json(response);
    }
  }

  private async exchangeCodeForToken(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    redirectUrl: string,
    code: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUrl,
        code,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${body}`);
    }

    const json = await response.json();

    if (!json.access_token) {
      throw new Error('Token exchange response missing access_token');
    }

    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in ?? 3600,
    };
  }
}
