import { inject, singleton } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { providers, conversationArtifacts } from '../db/schema';
import type { ArtifactType } from '../db/schema';
import { StorageProviderFactory } from './providers/storage/StorageProviderFactory';
import type { IStorageProvider } from './providers/storage/IStorageProvider';
import type { StorageMetadata } from './providers/storage/IStorageProvider';
import type { ErrorCallback } from '../types/callbacks';
import { logger } from '../utils/logger';
import { NotConfiguredError, NotFoundError } from '../errors';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing conversation artifacts in storage
 * Handles audio recordings, transcripts, and other conversation-related files
 */
@singleton()
export class ConversationStorageService {
  constructor(@inject(StorageProviderFactory) private readonly storageFactory: StorageProviderFactory) {}

  /**
   * Upload a conversation artifact to storage and save metadata to database
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID for organizing artifacts
   * @param artifactType Type of artifact (e.g., 'user_voice', 'ai_transcript')
   * @param data Binary data to upload
   * @param metadata Optional metadata (content type, encoding, etc.)
   * @param eventId Optional event ID to link artifact to a specific conversation event
   * @param inputTurnId Optional input turn ID to link artifact to user input
   * @param outputTurnId Optional output turn ID to link artifact to AI output
   * @param errorCallback Optional error callback for error handling
   * @returns Artifact ID and URL of the uploaded artifact
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async uploadArtifact(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, projectId: string, conversationId: string, artifactType: ArtifactType, data: Buffer, metadata?: StorageMetadata, eventId?: string, inputTurnId?: string, outputTurnId?: string, errorCallback?: ErrorCallback): Promise<{ id: string; url: string }> {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const key = this.generateArtifactKey(conversationId, artifactType);
    const url = await provider.upload(key, data, metadata);

    // Save artifact metadata to database
    const artifactId = generateId(ID_PREFIXES.ARTIFACT);
    await db.insert(conversationArtifacts).values({
      id: artifactId,
      projectId,
      conversationId,
      artifactType,
      eventId: eventId ?? null,
      inputTurnId: inputTurnId ?? null,
      outputTurnId: outputTurnId ?? null,
      storageKey: key,
      storageUrl: url,
      data: null, // Not storing in database, only in external storage
      mimeType: metadata?.contentType ?? 'application/octet-stream',
      fileSize: data.length,
      metadata: metadata?.customMetadata ?? null,
    });

    logger.info(`Uploaded artifact for conversation ${conversationId}: ${artifactType} -> ${url} (artifact ID: ${artifactId})`);
    return { id: artifactId, url };
  }

  /**
   * Download a conversation artifact from storage
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID
   * @param artifactType Type of artifact to download
   * @param errorCallback Optional error callback for error handling
   * @returns Binary data of the artifact
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async downloadArtifact(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, conversationId: string, artifactType: string, errorCallback?: ErrorCallback): Promise<Buffer> {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const key = this.generateArtifactKey(conversationId, artifactType);
    const data = await provider.download(key);

    logger.info(`Downloaded artifact for conversation ${conversationId}: ${artifactType} (${data.length} bytes)`);
    return data;
  }

  /**
   * Delete a conversation artifact from storage
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID
   * @param artifactType Type of artifact to delete
   * @param errorCallback Optional error callback for error handling
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async deleteArtifact(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, conversationId: string, artifactType: string, errorCallback?: ErrorCallback): Promise<void> {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const key = this.generateArtifactKey(conversationId, artifactType);
    await provider.delete(key);

    logger.info(`Deleted artifact for conversation ${conversationId}: ${artifactType}`);
  }

  /**
   * Generate a signed URL for accessing a conversation artifact
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID
   * @param artifactType Type of artifact
   * @param expiresIn URL expiration time in seconds (default: 3600 = 1 hour)
   * @param errorCallback Optional error callback for error handling
   * @returns Signed URL for accessing the artifact
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async getSignedUrl(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, conversationId: string, artifactType: string, expiresIn: number = 3600, errorCallback?: ErrorCallback): Promise<string> {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const key = this.generateArtifactKey(conversationId, artifactType);
    const url = await provider.getSignedUrl(key, expiresIn);

    logger.info(`Generated signed URL for conversation ${conversationId}: ${artifactType} (expires in ${expiresIn}s)`);
    return url;
  }

  /**
   * Check if a conversation artifact exists in storage
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID
   * @param artifactType Type of artifact
   * @param errorCallback Optional error callback for error handling
   * @returns True if artifact exists, false otherwise
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async artifactExists(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, conversationId: string, artifactType: string, errorCallback?: ErrorCallback): Promise<boolean> {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const key = this.generateArtifactKey(conversationId, artifactType);
    return await provider.exists(key);
  }

  /**
   * List all artifacts for a conversation
   * @param storageConfig Storage configuration from project (containing storageProviderId and settings)
   * @param conversationId Conversation ID
   * @param errorCallback Optional error callback for error handling
   * @returns Array of artifact objects with metadata
   * @throws NotConfiguredError if storage is not configured for the project
   */
  async listArtifacts(storageConfig: { storageProviderId?: string; settings?: unknown } | null | undefined, conversationId: string, errorCallback?: ErrorCallback) {
    if (!storageConfig?.storageProviderId || !storageConfig?.settings) {
      throw new NotConfiguredError('Storage provider not configured for this project');
    }

    const provider = await this.getStorageProvider(storageConfig.storageProviderId, storageConfig.settings, errorCallback);
    const prefix = `${conversationId}/`;
    return await provider.list(prefix);
  }

  /**
   * Get storage provider instance
   */
  private async getStorageProvider(storageProviderId: string, storageSettings: unknown, errorCallback?: ErrorCallback): Promise<IStorageProvider> {
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, storageProviderId) });

    if (!provider) {
      throw new NotFoundError(`Storage provider with id ${storageProviderId} not found`);
    }

    if (provider.providerType !== 'storage') {
      throw new Error(`Provider ${storageProviderId} is not a storage provider (type: ${provider.providerType})`);
    }

    const instance = await this.storageFactory.createProvider(provider, storageSettings as Record<string, unknown>);
    
    if (errorCallback) {
      instance.setOnError(errorCallback);
    }
    
    return instance;
  }

  /**
   * Generate storage key for a conversation artifact
   * Key format: {conversationId}/{artifactType}_{timestamp}.{extension}
   */
  private generateArtifactKey(conversationId: string, artifactType: string): string {
    const timestamp = Date.now();
    return `${conversationId}/${artifactType}_${timestamp}`;
  }
}
