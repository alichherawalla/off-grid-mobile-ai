import { open } from '@op-engineering/op-sqlite';

// We need to get a reference to the mock DB to control its return values
const mockExecuteSync = jest.fn();
const mockDb = {
  executeSync: mockExecuteSync,
  execute: jest.fn(() => Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 })),
  close: jest.fn(),
  delete: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

jest.mock('../../../../src/utils/logger', () => ({
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Import after mocks
import { ragDatabase } from '../../../../src/services/rag/database';

describe('RagDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
  });

  describe('ensureReady', () => {
    it('opens the database and creates tables', async () => {
      await ragDatabase.ensureReady();
      expect(open).toHaveBeenCalledWith({ name: 'rag.db' });
      expect(mockExecuteSync).toHaveBeenCalledTimes(2);
      expect(mockExecuteSync.mock.calls[0][0]).toContain('rag_documents');
      expect(mockExecuteSync.mock.calls[1][0]).toContain('rag_chunks');
    });

    it('does not re-initialize on second call', async () => {
      await ragDatabase.ensureReady();
      const callCount = mockExecuteSync.mock.calls.length;
      await ragDatabase.ensureReady();
      expect(mockExecuteSync.mock.calls.length).toBe(callCount);
    });
  });

  describe('insertDocument', () => {
    it('inserts a document and returns the id', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({ insertId: 42, rowsAffected: 1, rows: [] });

      const id = ragDatabase.insertDocument({ projectId: 'proj1', name: 'test.txt', path: '/path/test.txt', size: 1234 });
      expect(id).toBe(42);
      expect(mockExecuteSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rag_documents'),
        expect.arrayContaining(['proj1', 'test.txt', '/path/test.txt', 1234])
      );
    });
  });

  describe('insertChunks', () => {
    it('inserts each chunk with doc_id', async () => {
      await ragDatabase.ensureReady();
      const chunks = [
        { content: 'chunk one', position: 0 },
        { content: 'chunk two', position: 1 },
      ];
      ragDatabase.insertChunks(42, chunks);
      const chunkInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_chunks')
      );
      expect(chunkInserts).toHaveLength(2);
      expect(chunkInserts[0][1]).toEqual(['chunk one', 42, 0]);
      expect(chunkInserts[1][1]).toEqual(['chunk two', 42, 1]);
    });
  });

  describe('deleteDocument', () => {
    it('deletes chunks and document', async () => {
      await ragDatabase.ensureReady();
      ragDatabase.deleteDocument(42);
      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE')
      );
      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls[0][0]).toContain('rag_chunks');
      expect(deleteCalls[1][0]).toContain('rag_documents');
    });
  });

  describe('getDocumentsByProject', () => {
    it('returns documents for the given project', async () => {
      await ragDatabase.ensureReady();
      const mockDocs = [
        { id: 1, project_id: 'proj1', name: 'doc1.txt', path: '/p', size: 100, created_at: '2024-01-01', enabled: 1 },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockDocs });

      const docs = ragDatabase.getDocumentsByProject('proj1');
      expect(docs).toEqual(mockDocs);
    });
  });

  describe('toggleEnabled', () => {
    it('updates enabled flag', async () => {
      await ragDatabase.ensureReady();
      ragDatabase.toggleEnabled(42, false);
      const updateCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE')
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual([0, 42]);
    });
  });

  describe('searchByProject', () => {
    it('returns search results', async () => {
      await ragDatabase.ensureReady();
      const mockResults = [
        { doc_id: 1, name: 'doc.txt', content: 'match content', position: 0, rank: -1.5 },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockResults });

      const results = ragDatabase.searchByProject('proj1', 'test query', 5);
      expect(results).toEqual(mockResults);
    });

    it('returns empty array for empty query', async () => {
      await ragDatabase.ensureReady();
      const results = ragDatabase.searchByProject('proj1', '', 5);
      expect(results).toEqual([]);
    });

    it('returns empty array for query with only special characters', async () => {
      await ragDatabase.ensureReady();
      const results = ragDatabase.searchByProject('proj1', '!@#$%', 5);
      expect(results).toEqual([]);
    });

    it('sanitizes special characters from query', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({ rows: [] });
      ragDatabase.searchByProject('proj1', 'hello "world"', 5);
      const searchCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('MATCH')
      );
      expect(searchCalls).toHaveLength(1);
      expect(searchCalls[0][1][1]).toBe('hello  world');
    });
  });

  describe('deleteDocumentsByProject', () => {
    it('deletes all documents and chunks for a project', async () => {
      await ragDatabase.ensureReady();
      const mockDocs = [
        { id: 1, project_id: 'proj1', name: 'a.txt', path: '/a', size: 100, created_at: '2024-01-01', enabled: 1 },
        { id: 2, project_id: 'proj1', name: 'b.txt', path: '/b', size: 200, created_at: '2024-01-01', enabled: 1 },
      ];
      mockExecuteSync
        .mockReturnValueOnce({ rows: mockDocs }) // SELECT
        .mockReturnValue({ rows: [], rowsAffected: 1 }); // DELETEs

      ragDatabase.deleteDocumentsByProject('proj1');

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE')
      );
      // 2 chunk deletes (one per doc) + 1 project-level delete
      expect(deleteCalls).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('throws if getDb called before ensureReady', () => {
      (ragDatabase as any).ready = false;
      (ragDatabase as any).db = null;
      expect(() => ragDatabase.insertDocument({ projectId: 'p', name: 'n', path: 'path', size: 0 })).toThrow('not initialized');
    });
  });
});
