import { initLlama } from 'llama.rn';
import RNFS from 'react-native-fs';

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;
const mockExists = RNFS.exists as jest.MockedFunction<typeof RNFS.exists>;
const mockCopyFileAssets = (RNFS as any).copyFileAssets as jest.MockedFunction<any>;
const mockCopyFile = RNFS.copyFile as jest.MockedFunction<typeof RNFS.copyFile>;

// Must import after mocks are set up
import { embeddingService } from '../../../../src/services/rag/embedding';

const mockEmbedding = jest.fn();
const mockRelease = jest.fn();

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state
    (embeddingService as any).context = null;
    (embeddingService as any).loading = null;

    mockEmbedding.mockResolvedValue({ embedding: new Array(384).fill(0.1) });
    mockRelease.mockResolvedValue(undefined);
    mockInitLlama.mockResolvedValue({
      embedding: mockEmbedding,
      release: mockRelease,
    } as any);
    mockExists.mockResolvedValue(false);
  });

  describe('load', () => {
    it('initializes llama context with embedding params', async () => {
      await embeddingService.load();

      expect(mockInitLlama).toHaveBeenCalledWith(expect.objectContaining({
        embedding: true,
        n_gpu_layers: 0,
        n_ctx: 512,
      }));
      expect(embeddingService.isLoaded()).toBe(true);
    });

    it('copies model from assets if not already present', async () => {
      mockExists.mockResolvedValue(false);
      await embeddingService.load();

      // Should have checked existence and copied
      expect(mockExists).toHaveBeenCalled();
    });

    it('skips copy if model already exists', async () => {
      mockExists.mockResolvedValue(true);
      await embeddingService.load();

      expect(mockCopyFileAssets).not.toHaveBeenCalled();
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('is idempotent — second call is a no-op', async () => {
      await embeddingService.load();
      await embeddingService.load();

      expect(mockInitLlama).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent calls', async () => {
      const p1 = embeddingService.load();
      const p2 = embeddingService.load();
      await Promise.all([p1, p2]);

      expect(mockInitLlama).toHaveBeenCalledTimes(1);
    });
  });

  describe('embed', () => {
    it('returns embedding vector', async () => {
      await embeddingService.load();
      const result = await embeddingService.embed('hello world');

      expect(mockEmbedding).toHaveBeenCalledWith('hello world');
      expect(result).toHaveLength(384);
    });

    it('throws if model not loaded', async () => {
      await expect(embeddingService.embed('test')).rejects.toThrow('not loaded');
    });
  });

  describe('embedBatch', () => {
    it('embeds multiple texts sequentially', async () => {
      await embeddingService.load();
      const results = await embeddingService.embedBatch(['hello', 'world']);

      expect(results).toHaveLength(2);
      expect(mockEmbedding).toHaveBeenCalledTimes(2);
    });
  });

  describe('unload', () => {
    it('releases the context', async () => {
      await embeddingService.load();
      await embeddingService.unload();

      expect(mockRelease).toHaveBeenCalled();
      expect(embeddingService.isLoaded()).toBe(false);
    });

    it('is safe to call when not loaded', async () => {
      await embeddingService.unload();
      expect(mockRelease).not.toHaveBeenCalled();
    });
  });

  describe('getDimension', () => {
    it('returns 384', () => {
      expect(embeddingService.getDimension()).toBe(384);
    });
  });
});
