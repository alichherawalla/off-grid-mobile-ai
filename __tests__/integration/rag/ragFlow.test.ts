/**
 * Integration Tests: RAG Flow
 *
 * Tests the integration between:
 * - ragService → ragDatabase (index, search, delete lifecycle)
 * - chunkDocument → ragDatabase (chunking feeds into FTS indexing)
 * - retrievalService → ragDatabase (search + formatting)
 * - ragService → documentService (text extraction)
 *
 * Uses mocked SQLite but tests the full flow through all RAG layers.
 */

const mockExecuteSync = jest.fn();
const mockDb = {
  executeSync: mockExecuteSync,
  execute: jest.fn(() => Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 })),
  close: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../src/services/documentService', () => ({
  documentService: {
    processDocumentFromPath: jest.fn(),
  },
}));

import { ragService, chunkDocument, retrievalService } from '../../../src/services/rag';
import { ragDatabase } from '../../../src/services/rag/database';
import { documentService } from '../../../src/services/documentService';

const mockDocService = documentService as jest.Mocked<typeof documentService>;

describe('RAG Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
  });

  // ============================================================================
  // Full indexing pipeline
  // ============================================================================
  describe('document indexing pipeline', () => {
    it('extracts text, chunks it, and stores chunks in database', async () => {
      const longText = Array.from({ length: 10 }, (_, i) =>
        `Paragraph ${i}: This is a detailed section about topic ${i} with enough content to form a chunk.`
      ).join('\n\n');

      mockDocService.processDocumentFromPath.mockResolvedValue({
        id: '1', type: 'document', uri: '/docs/guide.pdf',
        fileName: 'guide.pdf', textContent: longText, fileSize: 5000,
      });
      mockExecuteSync.mockReturnValue({ rows: [], insertId: 42, rowsAffected: 1 });

      const progressStages: string[] = [];
      await ragService.indexDocument({
        projectId: 'proj-1',
        filePath: '/docs/guide.pdf',
        fileName: 'guide.pdf',
        fileSize: 5000,
        onProgress: (p) => progressStages.push(p.stage),
      });

      // Verify progress callbacks fired in order
      expect(progressStages).toEqual(['extracting', 'chunking', 'indexing', 'done']);

      // Verify document was inserted
      const docInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_documents')
      );
      expect(docInserts.length).toBe(1);
      expect(docInserts[0][1]).toEqual(expect.arrayContaining(['proj-1', 'guide.pdf']));

      // Verify chunks were inserted
      const chunkInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_chunks')
      );
      expect(chunkInserts.length).toBeGreaterThan(0);

      // Each chunk insert should have [content, docId, position]
      chunkInserts.forEach((call: any[], idx: number) => {
        expect(call[1][1]).toBe(42); // doc_id
        expect(call[1][2]).toBe(idx); // position is sequential
        expect(call[1][0].length).toBeGreaterThan(0); // content is non-empty
      });
    });

    it('rejects documents with no extractable text', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValue(null);

      await expect(ragService.indexDocument({
        projectId: 'proj-1', filePath: '/f', fileName: 'empty.bin', fileSize: 0,
      })).rejects.toThrow('Could not extract text');
    });

    it('rejects documents that produce no chunks', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValue({
        id: '1', type: 'document', uri: '/f',
        fileName: 'tiny.txt', textContent: 'hi', fileSize: 2,
      });

      await expect(ragService.indexDocument({
        projectId: 'proj-1', filePath: '/f', fileName: 'tiny.txt', fileSize: 2,
      })).rejects.toThrow('no indexable content');
    });
  });

  // ============================================================================
  // Chunking → Retrieval pipeline
  // ============================================================================
  describe('chunking produces searchable content', () => {
    it('chunks a document and retrieval formats results for prompt', () => {
      const text = 'Introduction to machine learning.\n\nSupervised learning uses labeled data to train models.\n\nUnsupervised learning finds patterns in unlabeled data.';
      const chunks = chunkDocument(text, { chunkSize: 500 });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('machine learning');

      // Simulate search results matching the chunks
      const searchResult = {
        chunks: chunks.map((c, i) => ({
          doc_id: 1, name: 'ml-guide.txt', content: c.content, position: c.position, rank: -(i + 1),
        })),
        truncated: false,
      };

      const formatted = retrievalService.formatForPrompt(searchResult);
      expect(formatted).toContain('<knowledge_base>');
      expect(formatted).toContain('</knowledge_base>');
      expect(formatted).toContain('[Source: ml-guide.txt');
      expect(formatted).toContain('machine learning');
    });
  });

  // ============================================================================
  // Search with budget
  // ============================================================================
  describe('search with budget truncation', () => {
    it('respects character budget and truncates lower-ranked results', () => {
      const longContent = 'x'.repeat(2000);
      const shortContent = 'Short relevant chunk.';

      mockExecuteSync.mockReturnValue({ rows: [
        { doc_id: 1, name: 'big.txt', content: longContent, position: 0, rank: -2 },
        { doc_id: 2, name: 'small.txt', content: shortContent, position: 0, rank: -1 },
      ]});

      // Initialize DB first
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      // Budget = 1024 tokens * 4 * 0.25 = 1024 chars. longContent is 2000.
      const result = retrievalService.searchWithBudget({
        projectId: 'proj-1', query: 'test', contextLength: 1024,
      });

      expect(result.truncated).toBe(true);
      expect(result.chunks.length).toBe(0); // First chunk exceeds budget
    });

    it('includes all results when within budget', () => {
      mockExecuteSync.mockReturnValue({ rows: [
        { doc_id: 1, name: 'a.txt', content: 'short chunk one', position: 0, rank: -2 },
        { doc_id: 2, name: 'b.txt', content: 'short chunk two', position: 0, rank: -1 },
      ]});

      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      const result = retrievalService.searchWithBudget({
        projectId: 'proj-1', query: 'test', contextLength: 4096,
      });

      expect(result.truncated).toBe(false);
      expect(result.chunks.length).toBe(2);
    });
  });

  // ============================================================================
  // Project-scoped document lifecycle
  // ============================================================================
  describe('project-scoped document lifecycle', () => {
    beforeEach(async () => {
      mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
      await ragService.ensureReady();
    });

    it('getDocumentsByProject returns only that project\'s documents', async () => {
      const mockDocs = [
        { id: 1, project_id: 'proj-1', name: 'a.txt', path: '/a', size: 100, created_at: '2024-01-01', enabled: 1 },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockDocs });

      const docs = await ragService.getDocumentsByProject('proj-1');
      expect(docs).toEqual(mockDocs);

      // Verify query was scoped to project
      const selectCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('SELECT') && c[0].includes('project_id')
      );
      expect(selectCalls.length).toBeGreaterThan(0);
      expect(selectCalls[0][1]).toContain('proj-1');
    });

    it('toggleDocument changes enabled state', async () => {
      await ragService.toggleDocument(1, false);

      const updateCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE')
      );
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][1]).toEqual([0, 1]); // enabled=0, docId=1
    });

    it('deleteDocument removes both chunks and document', async () => {
      await ragService.deleteDocument(42);

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE')
      );
      expect(deleteCalls.length).toBe(2);
      expect(deleteCalls[0][0]).toContain('rag_chunks');
      expect(deleteCalls[1][0]).toContain('rag_documents');
    });

    it('deleteProjectDocuments cleans up all docs for a project', async () => {
      const mockDocs = [
        { id: 1, project_id: 'proj-1', name: 'a.txt', path: '/a', size: 100, created_at: '2024-01-01', enabled: 1 },
        { id: 2, project_id: 'proj-1', name: 'b.txt', path: '/b', size: 200, created_at: '2024-01-01', enabled: 1 },
      ];
      mockExecuteSync
        .mockReturnValueOnce({ rows: mockDocs }) // getDocumentsByProject SELECT
        .mockReturnValue({ rows: [], rowsAffected: 1 }); // DELETEs

      await ragService.deleteProjectDocuments('proj-1');

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE')
      );
      // 2 chunk deletes (one per doc) + 1 project-level doc delete
      expect(deleteCalls.length).toBe(3);
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================
  describe('edge cases', () => {
    it('search returns empty for projects with no documents', async () => {
      mockExecuteSync.mockReturnValue({ rows: [] });
      await ragService.ensureReady();

      const result = await ragService.searchProject('proj-no-docs', 'anything');
      expect(result.chunks).toEqual([]);
    });

    it('formatForPrompt returns empty string when no chunks', () => {
      expect(retrievalService.formatForPrompt({ chunks: [], truncated: false })).toBe('');
    });

    it('chunking handles single long paragraph with overlap', () => {
      const longParagraph = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
      const chunks = chunkDocument(longParagraph, { chunkSize: 200, overlap: 50 });

      expect(chunks.length).toBeGreaterThan(1);
      // Verify overlap: end of chunk N should overlap with start of chunk N+1
      if (chunks.length >= 2) {
        const overlap = chunks[0].content.slice(-50);
        // The overlap means chunk1 should start with content near where chunk0 ended
        expect(chunks[1].content).toContain(overlap.slice(0, 10));
      }
    });

    it('chunking handles empty paragraphs gracefully', () => {
      const text = 'First paragraph is here.\n\n\n\n\n\nSecond paragraph is here.';
      const chunks = chunkDocument(text, { chunkSize: 500 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toContain('First');
      expect(chunks[0].content).toContain('Second');
    });

    it('database sanitizes FTS5 special characters in queries', async () => {
      mockExecuteSync.mockReturnValue({ rows: [] });
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      ragDatabase.searchByProject('proj-1', 'hello "world" (test)', 5);

      const matchCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('MATCH')
      );
      expect(matchCalls.length).toBe(1);
      // Special chars should be stripped
      const sanitizedQuery = matchCalls[0][1][1];
      expect(sanitizedQuery).not.toContain('"');
      expect(sanitizedQuery).not.toContain('(');
      expect(sanitizedQuery).toContain('hello');
      expect(sanitizedQuery).toContain('world');
    });
  });
});
