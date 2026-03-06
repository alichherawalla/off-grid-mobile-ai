import { initLlama, LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import logger from '../../utils/logger';

const EMBEDDING_MODEL_FILENAME = 'all-MiniLM-L6-v2-Q8_0.gguf';
const EMBEDDING_DIMENSION = 384;
const EMBEDDING_CTX_SIZE = 512;

class EmbeddingService {
  private context: LlamaContext | null = null;
  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.context) return;
    if (this.loading !== null) return this.loading;

    this.loading = this.doLoad();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async doLoad(): Promise<void> {
    const modelPath = await this.ensureModelCopied();
    logger.log('[Embedding] Loading embedding model...');
    this.context = await initLlama({
      model: modelPath,
      embedding: true,
      n_gpu_layers: 0,
      n_ctx: EMBEDDING_CTX_SIZE,
      n_batch: EMBEDDING_CTX_SIZE,
      n_threads: 2,
      use_mlock: false,
      use_mmap: true,
    } as any);
    logger.log('[Embedding] Model loaded successfully');
  }

  private async ensureModelCopied(): Promise<string> {
    const destPath = `${RNFS.DocumentDirectoryPath}/${EMBEDDING_MODEL_FILENAME}`;
    const exists = await RNFS.exists(destPath);
    if (!exists) {
      if (Platform.OS === 'android') {
        await RNFS.copyFileAssets(`models/${EMBEDDING_MODEL_FILENAME}`, destPath);
      } else {
        const bundlePath = `${RNFS.MainBundlePath}/${EMBEDDING_MODEL_FILENAME}`;
        await RNFS.copyFile(bundlePath, destPath);
      }
      logger.log('[Embedding] Copied embedding model to documents directory');
    }
    return destPath;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) throw new Error('Embedding model not loaded. Call load() first.');
    const result = await (this.context as any).embedding(text);
    return result.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async unload(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      logger.log('[Embedding] Model unloaded');
    }
  }

  isLoaded(): boolean {
    return this.context !== null;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }
}

export const embeddingService = new EmbeddingService();
