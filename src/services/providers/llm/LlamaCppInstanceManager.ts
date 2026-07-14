import { singleton } from 'tsyringe';
import { getLlama } from 'node-llama-cpp';
import type { Llama, LlamaModel, LlamaModelOptions } from 'node-llama-cpp';
import { logger } from '../../../utils/logger';

interface LlamaSlot {
  modelPath: string;
  model: LlamaModel;
  refs: number;
  lastAccessed: number;
}

interface LaunchOptions {
  gpuLayers?: number;
  flashAttention?: boolean;
}

@singleton()
export class LlamaCppInstanceManager {
  private llama: Llama | null = null;
  private slots: Map<string, LlamaSlot> = new Map();
  private loading: Map<string, Promise<LlamaModel>> = new Map();
  private maxInstances: number = 1;
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.maxInstances = parseInt(process.env.NODE_LLAMA_CPP_MAX_INSTANCES || '1', 10);
    if (isNaN(this.maxInstances) || this.maxInstances < 1) {
      this.maxInstances = 1;
    }
    logger.info({ maxInstances: this.maxInstances }, 'Initializing LlamaCppInstanceManager');
    this.llama = await getLlama();
    this.initialized = true;
    logger.info('LlamaCppInstanceManager initialized');
  }

  async acquireModel(modelPath: string, launchOptions?: LaunchOptions): Promise<{ model: LlamaModel; llama: Llama }> {
    await this.ensureInitialized();
    const existing = this.slots.get(modelPath);
    if (existing) {
      existing.refs++;
      existing.lastAccessed = Date.now();
      logger.info({ modelPath, refs: existing.refs }, 'Reusing loaded llama.cpp model');
      return { model: existing.model, llama: this.llama! };
    }

    if (this.loading.has(modelPath)) {
      logger.info({ modelPath }, 'Waiting for in-flight model load');
      const model = await this.loading.get(modelPath)!;
      const slot = this.slots.get(modelPath);
      if (slot) {
        slot.refs++;
        slot.lastAccessed = Date.now();
      } else {
        this.slots.set(modelPath, { modelPath, model, refs: 1, lastAccessed: Date.now() });
      }
      this.loading.delete(modelPath);
      return { model, llama: this.llama! };
    }

    if (this.slots.size >= this.maxInstances) {
      const evicted = this.findEvictableSlot();
      if (!evicted) {
        throw new Error(`No available model slots for ${modelPath}. ${this.slots.size}/${this.maxInstances} slots in use and all have active references. Set NODE_LLAMA_CPP_MAX_INSTANCES higher.`);
      }
      this.evictSlot(evicted);
    }

    logger.info({ modelPath, launchOptions }, 'Loading llama.cpp model');
    const loadPromise = this.loadModel(modelPath, launchOptions);
    this.loading.set(modelPath, loadPromise);

    try {
      const model = await loadPromise;
      const slot: LlamaSlot = { modelPath, model, refs: 1, lastAccessed: Date.now() };
      this.slots.set(modelPath, slot);
      this.loading.delete(modelPath);
      logger.info({ modelPath, filename: model.filename }, 'llama.cpp model loaded successfully');
      return { model, llama: this.llama! };
    } catch (error) {
      this.loading.delete(modelPath);
      throw error;
    }
  }

  releaseModel(modelPath: string): void {
    const slot = this.slots.get(modelPath);
    if (!slot) return;
    slot.refs = Math.max(0, slot.refs - 1);
    slot.lastAccessed = Date.now();
    logger.info({ modelPath, refs: slot.refs }, 'Released llama.cpp model reference');
  }

  getLlama(): Llama {
    this.ensureInitializedSync();
    return this.llama!;
  }

  async dispose(): Promise<void> {
    logger.info({ slots: this.slots.size }, 'Disposing LlamaCppInstanceManager');
    for (const [modelPath, slot] of this.slots) {
      try {
        slot.model.dispose();
        logger.info({ modelPath }, 'Disposed model on shutdown');
      } catch (error) {
        logger.error({ modelPath, error: error instanceof Error ? error.message : String(error) }, 'Error disposing model on shutdown');
      }
    }
    this.slots.clear();
    this.loading.clear();
    if (this.llama) {
      try {
        await this.llama.dispose();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error disposing llama instance on shutdown');
      }
      this.llama = null;
    }
    this.initialized = false;
  }

  private async loadModel(modelPath: string, launchOptions?: LaunchOptions): Promise<LlamaModel> {
    const loadOptions: LlamaModelOptions = { modelPath };
    if (launchOptions?.gpuLayers !== undefined) loadOptions.gpuLayers = launchOptions.gpuLayers;
    if (launchOptions?.flashAttention !== undefined) loadOptions.defaultContextFlashAttention = launchOptions.flashAttention;
    return this.llama!.loadModel(loadOptions);
  }

  private findEvictableSlot(): LlamaSlot | null {
    let evictable: LlamaSlot | null = null;
    for (const slot of this.slots.values()) {
      if (slot.refs > 0) continue;
      if (!evictable || slot.lastAccessed < evictable.lastAccessed) {
        evictable = slot;
      }
    }
    return evictable;
  }

  private evictSlot(slot: LlamaSlot): void {
    this.slots.delete(slot.modelPath);
    try {
      slot.model.dispose();
      logger.info({ modelPath: slot.modelPath }, 'Evicted llama.cpp model');
    } catch (error) {
      logger.error({ modelPath: slot.modelPath, error: error instanceof Error ? error.message : String(error) }, 'Error evicting llama.cpp model');
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private ensureInitializedSync(): void {
    if (!this.initialized || !this.llama) {
      throw new Error('LlamaCppInstanceManager not initialized. Call init() first.');
    }
  }
}
