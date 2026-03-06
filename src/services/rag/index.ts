import { ragDatabase } from './database';
import { chunkDocument } from './chunking';
import { retrievalService } from './retrieval';
import { documentService } from '../documentService';
import logger from '../../utils/logger';

export type { Chunk, ChunkOptions } from './chunking';
export type { RagDocument, RagSearchResult } from './database';
export type { SearchResult } from './retrieval';
export { chunkDocument } from './chunking';
export { retrievalService } from './retrieval';

export interface IndexProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'done';
  message: string;
}

export interface IndexDocumentParams {
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  onProgress?: (progress: IndexProgress) => void;
}

class RagService {
  async ensureReady(): Promise<void> {
    await ragDatabase.ensureReady();
  }

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    const { projectId, filePath, fileName, fileSize, onProgress } = params;
    await this.ensureReady();

    onProgress?.({ stage: 'extracting', message: `Extracting text from ${fileName}...` });
    const attachment = await documentService.processDocumentFromPath(filePath, fileName);
    if (!attachment?.textContent) {
      throw new Error('Could not extract text from document');
    }

    onProgress?.({ stage: 'chunking', message: 'Splitting into chunks...' });
    const chunks = chunkDocument(attachment.textContent);
    if (chunks.length === 0) {
      throw new Error('Document produced no indexable content');
    }

    onProgress?.({ stage: 'indexing', message: 'Indexing chunks...' });
    const docId = ragDatabase.insertDocument({ projectId, name: fileName, path: filePath, size: fileSize });
    ragDatabase.insertChunks(docId, chunks);

    onProgress?.({ stage: 'done', message: 'Done' });
    logger.log(`[RAG] Indexed ${fileName}: ${chunks.length} chunks`);
    return docId;
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    ragDatabase.deleteDocument(docId);
  }

  async getDocumentsByProject(projectId: string) {
    await this.ensureReady();
    return ragDatabase.getDocumentsByProject(projectId);
  }

  async toggleDocument(docId: number, enabled: boolean): Promise<void> {
    await this.ensureReady();
    ragDatabase.toggleEnabled(docId, enabled);
  }

  async searchProject(projectId: string, query: string, contextLength?: number) {
    await this.ensureReady();
    if (contextLength) {
      return retrievalService.searchWithBudget({ projectId, query, contextLength });
    }
    return retrievalService.search(projectId, query);
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    ragDatabase.deleteDocumentsByProject(projectId);
  }
}

export const ragService = new RagService();
