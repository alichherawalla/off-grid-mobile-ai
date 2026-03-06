import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import type { Chunk } from './chunking';
import logger from '../../utils/logger';

export interface RagDocument {
  id: number;
  project_id: string;
  name: string;
  path: string;
  size: number;
  created_at: string;
  enabled: number;
}

export interface RagSearchResult {
  doc_id: number;
  name: string;
  content: string;
  position: number;
  rank: number;
}

class RagDatabase {
  private db: DB | null = null;
  private ready = false;

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    try {
      this.db = open({ name: 'rag.db' });
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        )`
      );
      this.db.executeSync(
        `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING fts5(
          content,
          doc_id UNINDEXED,
          position UNINDEXED
        )`
      );
      this.ready = true;
    } catch (error) {
      logger.error('[RagDB] Failed to initialize:', error);
      throw error;
    }
  }

  private getDb(): DB {
    if (!this.db) throw new Error('RagDatabase not initialized. Call ensureReady() first.');
    return this.db;
  }

  insertDocument(doc: { projectId: string; name: string; path: string; size: number }): number {
    const db = this.getDb();
    const result = db.executeSync(
      'INSERT INTO rag_documents (project_id, name, path, size, created_at) VALUES (?, ?, ?, ?, ?)',
      [doc.projectId, doc.name, doc.path, doc.size, new Date().toISOString()]
    );
    return result.insertId ?? 0;
  }

  insertChunks(docId: number, chunks: Chunk[]): void {
    const db = this.getDb();
    for (const chunk of chunks) {
      db.executeSync(
        'INSERT INTO rag_chunks (content, doc_id, position) VALUES (?, ?, ?)',
        [chunk.content, docId, chunk.position]
      );
    }
  }

  deleteDocument(docId: number): void {
    const db = this.getDb();
    db.executeSync('DELETE FROM rag_chunks WHERE doc_id = ?', [docId]);
    db.executeSync('DELETE FROM rag_documents WHERE id = ?', [docId]);
  }

  getDocumentsByProject(projectId: string): RagDocument[] {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, project_id, name, path, size, created_at, enabled FROM rag_documents WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    );
    return (result.rows ?? []) as unknown as RagDocument[];
  }

  toggleEnabled(docId: number, enabled: boolean): void {
    const db = this.getDb();
    db.executeSync('UPDATE rag_documents SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, docId]);
  }

  searchByProject(projectId: string, query: string, topK: number = 5): RagSearchResult[] {
    if (!query.trim()) return [];
    const db = this.getDb();
    // Sanitize the query for FTS5: remove special characters that could break the MATCH syntax
    const sanitized = query.replace(/[^\w\s]/g, ' ').trim();
    if (!sanitized) return [];

    const result = db.executeSync(
      `SELECT c.doc_id, d.name, c.content, c.position, rank
       FROM rag_chunks c JOIN rag_documents d ON c.doc_id = d.id
       WHERE d.project_id = ? AND d.enabled = 1 AND rag_chunks MATCH ?
       ORDER BY rank LIMIT ?`,
      [projectId, sanitized, topK]
    );
    return (result.rows ?? []) as unknown as RagSearchResult[];
  }

  deleteDocumentsByProject(projectId: string): void {
    const db = this.getDb();
    const docs = this.getDocumentsByProject(projectId);
    for (const doc of docs) {
      db.executeSync('DELETE FROM rag_chunks WHERE doc_id = ?', [doc.id]);
    }
    db.executeSync('DELETE FROM rag_documents WHERE project_id = ?', [projectId]);
  }
}

export const ragDatabase = new RagDatabase();
