jest.mock('../../../../src/services/rag/database', () => ({
  ragDatabase: {
    searchByProject: jest.fn(() => []),
    ensureReady: jest.fn(),
  },
}));

import { retrievalService } from '../../../../src/services/rag/retrieval';
import { ragDatabase } from '../../../../src/services/rag/database';

const mockSearchByProject = ragDatabase.searchByProject as jest.Mock;

describe('RetrievalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('calls ragDatabase.searchByProject with correct params', () => {
      retrievalService.search('proj1', 'test query', 3);
      expect(mockSearchByProject).toHaveBeenCalledWith('proj1', 'test query', 3);
    });

    it('returns chunks and truncated flag', () => {
      const mockChunks = [
        { doc_id: 1, name: 'doc.txt', content: 'hello world', position: 0, rank: -1.0 },
      ];
      mockSearchByProject.mockReturnValue(mockChunks);

      const result = retrievalService.search('proj1', 'hello');
      expect(result.chunks).toEqual(mockChunks);
      expect(result.truncated).toBe(false);
    });

    it('uses default topK of 5', () => {
      retrievalService.search('proj1', 'query');
      expect(mockSearchByProject).toHaveBeenCalledWith('proj1', 'query', 5);
    });
  });

  describe('formatForPrompt', () => {
    it('returns empty string for no chunks', () => {
      expect(retrievalService.formatForPrompt({ chunks: [], truncated: false })).toBe('');
    });

    it('formats chunks with knowledge_base tags', () => {
      const result = retrievalService.formatForPrompt({
        chunks: [
          { doc_id: 1, name: 'notes.txt', content: 'Some content here', position: 0, rank: -1.0 },
          { doc_id: 1, name: 'notes.txt', content: 'More content', position: 1, rank: -0.5 },
        ],
        truncated: false,
      });

      expect(result).toContain('<knowledge_base>');
      expect(result).toContain('</knowledge_base>');
      expect(result).toContain('[Source: notes.txt (part 1)]');
      expect(result).toContain('Some content here');
      expect(result).toContain('[Source: notes.txt (part 2)]');
      expect(result).toContain('More content');
    });
  });

  describe('estimateCharBudget', () => {
    it('reserves 25% of context window', () => {
      // contextLength 2048 tokens * 4 chars * 0.25 = 2048
      expect(retrievalService.estimateCharBudget(2048)).toBe(2048);
    });

    it('scales with context length', () => {
      expect(retrievalService.estimateCharBudget(4096)).toBe(4096);
    });
  });

  describe('searchWithBudget', () => {
    it('truncates results that exceed budget', () => {
      const longContent = 'x'.repeat(3000);
      mockSearchByProject.mockReturnValue([
        { doc_id: 1, name: 'a.txt', content: longContent, position: 0, rank: -2.0 },
        { doc_id: 2, name: 'b.txt', content: 'short', position: 0, rank: -1.0 },
      ]);

      // Budget: 2048 tokens * 4 * 0.25 = 2048 chars. First chunk is 3000 chars
      const result = retrievalService.searchWithBudget({ projectId: 'proj1', query: 'query', contextLength: 2048 });
      expect(result.chunks).toHaveLength(0);
      expect(result.truncated).toBe(true);
    });

    it('includes all chunks if within budget', () => {
      mockSearchByProject.mockReturnValue([
        { doc_id: 1, name: 'a.txt', content: 'short chunk', position: 0, rank: -2.0 },
        { doc_id: 2, name: 'b.txt', content: 'another short', position: 0, rank: -1.0 },
      ]);

      const result = retrievalService.searchWithBudget({ projectId: 'proj1', query: 'query', contextLength: 4096 });
      expect(result.chunks).toHaveLength(2);
      expect(result.truncated).toBe(false);
    });
  });
});
