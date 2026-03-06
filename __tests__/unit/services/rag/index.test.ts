jest.mock('../../../../src/services/rag/database', () => ({
  ragDatabase: {
    ensureReady: jest.fn(() => Promise.resolve()),
    insertDocument: jest.fn((_doc: any) => 1),
    insertChunks: jest.fn(),
    deleteDocument: jest.fn(),
    getDocumentsByProject: jest.fn(() => []),
    toggleEnabled: jest.fn(),
    searchByProject: jest.fn(() => []),
    deleteDocumentsByProject: jest.fn(),
  },
}));

jest.mock('../../../../src/services/documentService', () => ({
  documentService: {
    processDocumentFromPath: jest.fn(() => Promise.resolve({
      id: '1',
      type: 'document',
      uri: '/path/to/doc',
      fileName: 'test.txt',
      textContent: 'This is a long enough test document content that should be chunked properly by the service.',
      fileSize: 100,
    })),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { ragService } from '../../../../src/services/rag';
import { ragDatabase } from '../../../../src/services/rag/database';
import { documentService } from '../../../../src/services/documentService';

const mockDb = ragDatabase as jest.Mocked<typeof ragDatabase>;
const mockDocService = documentService as jest.Mocked<typeof documentService>;

describe('RagService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureReady', () => {
    it('calls ragDatabase.ensureReady', async () => {
      await ragService.ensureReady();
      expect(mockDb.ensureReady).toHaveBeenCalled();
    });
  });

  describe('indexDocument', () => {
    it('extracts text, chunks, and stores in database', async () => {
      const onProgress = jest.fn();
      const docId = await ragService.indexDocument({ projectId: 'proj1', filePath: '/path/test.txt', fileName: 'test.txt', fileSize: 100, onProgress });

      expect(mockDocService.processDocumentFromPath).toHaveBeenCalledWith('/path/test.txt', 'test.txt');
      expect(mockDb.insertDocument).toHaveBeenCalledWith({ projectId: 'proj1', name: 'test.txt', path: '/path/test.txt', size: 100 });
      expect(mockDb.insertChunks).toHaveBeenCalled();
      expect(docId).toBe(1);

      // Progress callbacks
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'extracting' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'chunking' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'indexing' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'done' }));
    });

    it('throws when no text content extracted', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValueOnce(null);
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'f', fileSize: 0 })).rejects.toThrow('Could not extract text');
    });

    it('throws when document produces no chunks', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValueOnce({
        id: '1', type: 'document', uri: '/p', fileName: 'f', textContent: 'tiny', fileSize: 5,
      });
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'f', fileSize: 0 })).rejects.toThrow('no indexable content');
    });

    it('works without onProgress callback', async () => {
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'f', fileSize: 100 })).resolves.toBe(1);
    });
  });

  describe('deleteDocument', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.deleteDocument(42);
      expect(mockDb.deleteDocument).toHaveBeenCalledWith(42);
    });
  });

  describe('getDocumentsByProject', () => {
    it('returns documents from database', async () => {
      const mockDocs = [{ id: 1, project_id: 'proj1', name: 'a.txt', path: '/a', size: 100, created_at: '', enabled: 1 }];
      mockDb.getDocumentsByProject.mockReturnValue(mockDocs);

      const docs = await ragService.getDocumentsByProject('proj1');
      expect(docs).toEqual(mockDocs);
    });
  });

  describe('toggleDocument', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.toggleDocument(1, false);
      expect(mockDb.toggleEnabled).toHaveBeenCalledWith(1, false);
    });
  });

  describe('searchProject', () => {
    it('calls search without contextLength', async () => {
      mockDb.searchByProject.mockReturnValue([]);
      const result = await ragService.searchProject('proj1', 'query');
      expect(result.chunks).toEqual([]);
    });

    it('calls searchWithBudget with contextLength', async () => {
      mockDb.searchByProject.mockReturnValue([]);
      const result = await ragService.searchProject('proj1', 'query', 2048);
      expect(result.chunks).toEqual([]);
    });
  });

  describe('deleteProjectDocuments', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.deleteProjectDocuments('proj1');
      expect(mockDb.deleteDocumentsByProject).toHaveBeenCalledWith('proj1');
    });
  });
});
