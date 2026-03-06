import { ragDatabase, RagSearchResult } from './database';

export interface SearchResult {
  chunks: RagSearchResult[];
  truncated: boolean;
}

class RetrievalService {
  search(projectId: string, query: string, topK: number = 5): SearchResult {
    const chunks = ragDatabase.searchByProject(projectId, query, topK);
    return { chunks, truncated: false };
  }

  formatForPrompt(result: SearchResult): string {
    if (result.chunks.length === 0) return '';

    const sections = result.chunks.map((chunk) => {
      return `[Source: ${chunk.name} (part ${chunk.position + 1})]\n${chunk.content}`;
    });

    return `<knowledge_base>\nThe following excerpts are from the user's project knowledge base. Use them to inform your response when relevant.\n\n${sections.join('\n\n---\n\n')}\n</knowledge_base>`;
  }

  estimateCharBudget(contextLength: number): number {
    // Reserve 25% of context window for RAG
    // Rough estimate: 1 token ≈ 4 chars
    return Math.floor(contextLength * 4 * 0.25);
  }

  searchWithBudget(params: { projectId: string; query: string; contextLength: number; topK?: number }): SearchResult {
    const chunks = ragDatabase.searchByProject(params.projectId, params.query, params.topK ?? 5);
    const budget = this.estimateCharBudget(params.contextLength);

    let totalChars = 0;
    const fittingChunks: RagSearchResult[] = [];
    let truncated = false;

    for (const chunk of chunks) {
      totalChars += chunk.content.length;
      if (totalChars > budget) {
        truncated = true;
        break;
      }
      fittingChunks.push(chunk);
    }

    return { chunks: fittingChunks, truncated };
  }
}

export const retrievalService = new RetrievalService();
