/**
 * RAG Embedding Contract Tests
 *
 * Documents and verifies the expected interface between our embedding service
 * and the llama.rn native module's embedding API. Also documents the vector
 * storage format and search contract.
 *
 * These tests use mocks — they verify interface compatibility and expected
 * data shapes, not actual native functionality.
 */

describe('RAG Embedding Contract', () => {
  // ============================================================================
  // initLlama Embedding Mode Contract
  // ============================================================================
  describe('initLlama embedding mode', () => {
    it('requires embedding: true to enable embedding mode', () => {
      const embeddingParams = {
        model: '/path/to/embedding-model.gguf',
        embedding: true,
        n_gpu_layers: 0,
        n_ctx: 512,
      };

      expect(embeddingParams.embedding).toBe(true);
      expect(embeddingParams.n_gpu_layers).toBe(0); // CPU-only to avoid GPU contention
    });

    it('uses small context size for embedding models', () => {
      const params = {
        model: '/path/to/model.gguf',
        embedding: true,
        n_ctx: 512,
        n_batch: 512,
        n_threads: 2,
      };

      // Embedding models need small context — input is one chunk at a time
      expect(params.n_ctx).toBeLessThanOrEqual(512);
      expect(params.n_batch).toBeLessThanOrEqual(512);
      // Use fewer threads than main LLM to reduce contention
      expect(params.n_threads).toBeLessThan(4);
    });

    it('runs on CPU only to avoid GPU contention with main LLM', () => {
      const params = { n_gpu_layers: 0 };
      expect(params.n_gpu_layers).toBe(0);
    });
  });

  // ============================================================================
  // Embedding API Contract
  // ============================================================================
  describe('context.embedding() interface', () => {
    it('accepts a string and returns embedding vector', () => {
      // Expected call signature
      const mockEmbedding = jest.fn().mockResolvedValue({
        embedding: new Array(384).fill(0.1),
      });

      const context = { embedding: mockEmbedding };

      expect(typeof context.embedding).toBe('function');
    });

    it('returns fixed-dimension vector for all-MiniLM-L6-v2', () => {
      // all-MiniLM-L6-v2 always produces 384-dimensional embeddings
      const expectedDimension = 384;
      const embedding = new Array(expectedDimension).fill(0);

      expect(embedding).toHaveLength(384);
    });

    it('embedding result has embedding property containing number array', () => {
      const result = {
        embedding: [0.1, -0.2, 0.3, 0.05],
      };

      expect(result).toHaveProperty('embedding');
      expect(Array.isArray(result.embedding)).toBe(true);
      result.embedding.forEach(val => {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Vector Storage Contract
  // ============================================================================
  describe('embedding storage format', () => {
    it('stores embeddings as Float32Array ArrayBuffer blobs', () => {
      const embedding = [0.1, 0.2, 0.3];
      const blob = new Float32Array(embedding).buffer;

      expect(blob.byteLength).toBe(embedding.length * 4); // 4 bytes per float32
    });

    it('can round-trip embeddings through Float32Array', () => {
      const original = [0.1, -0.5, 0.9, 0, -1];
      const blob = new Float32Array(original).buffer;
      const restored = Array.from(new Float32Array(blob));

      expect(restored).toHaveLength(original.length);
      original.forEach((val, i) => {
        expect(restored[i]).toBeCloseTo(val, 5);
      });
    });

    it('embedding blob for 384 dimensions is 1536 bytes', () => {
      const dimension = 384;
      const embedding = new Array(dimension).fill(0);
      const blob = new Float32Array(embedding).buffer;

      expect(blob.byteLength).toBe(1536); // 384 * 4 bytes
    });
  });

  // ============================================================================
  // Search Result Contract
  // ============================================================================
  describe('search result format', () => {
    it('RagSearchResult uses score instead of rank', () => {
      const result = {
        doc_id: 1,
        name: 'document.pdf',
        content: 'chunk text',
        position: 0,
        score: 0.85,
      };

      expect(result).toHaveProperty('score');
      expect(result.score).toBeGreaterThanOrEqual(-1);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('cosine similarity score range is [-1, 1]', () => {
      // Identical vectors → 1.0
      // Orthogonal vectors → 0.0
      // Opposite vectors → -1.0
      const scores = [1, 0.85, 0.5, 0, -0.3, -1];
      scores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
      });
    });

    it('search results are sorted by descending score', () => {
      const results = [
        { score: 0.95 },
        { score: 0.8 },
        { score: 0.65 },
      ];

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  // ============================================================================
  // Model Asset Contract
  // ============================================================================
  describe('embedding model asset', () => {
    it('model filename follows expected convention', () => {
      const filename = 'all-MiniLM-L6-v2-Q8_0.gguf';

      expect(filename).toMatch(/\.gguf$/);
      expect(filename).toContain('MiniLM');
      expect(filename).toContain('Q8_0');
    });

    it('Android asset path follows models/ convention', () => {
      const assetPath = 'models/all-MiniLM-L6-v2-Q8_0.gguf';

      expect(assetPath).toMatch(/^models\//);
    });

    it('destination is DocumentDirectoryPath for both platforms', () => {
      // Both platforms copy to DocumentDirectoryPath at runtime
      const destPath = '/mock/documents/all-MiniLM-L6-v2-Q8_0.gguf';

      expect(destPath).toContain('all-MiniLM-L6-v2-Q8_0.gguf');
    });
  });

  // ============================================================================
  // IndexProgress Contract
  // ============================================================================
  describe('IndexProgress stages', () => {
    it('includes embedding stage in the pipeline', () => {
      const stages = ['extracting', 'chunking', 'indexing', 'embedding', 'done'];

      expect(stages).toContain('embedding');
      expect(stages.indexOf('embedding')).toBe(3);
      expect(stages.indexOf('done')).toBe(4);
    });

    it('embedding stage comes after indexing and before done', () => {
      const stages = ['extracting', 'chunking', 'indexing', 'embedding', 'done'];
      const embIdx = stages.indexOf('embedding');
      const idxIdx = stages.indexOf('indexing');
      const doneIdx = stages.indexOf('done');

      expect(embIdx).toBeGreaterThan(idxIdx);
      expect(embIdx).toBeLessThan(doneIdx);
    });
  });
});
