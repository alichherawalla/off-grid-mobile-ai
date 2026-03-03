/** Context Compaction Service — auto-summarizes old messages when context is full */
import { llmService } from './llm';
import { Message } from '../types';
import logger from '../utils/logger';

const CONTEXT_FULL_PATTERNS = [
  'context is full',
  'not enough context space',
  'context window exceeded',
  'context length exceeded',
];

/** Number of recent non-system messages to keep verbatim */
const KEEP_RECENT = 4;

const SUMMARIZE_PROMPT =
  'Summarize this conversation in 2-3 sentences. Include key topics, decisions, and any important details the assistant should remember.';

class ContextCompactionService {
  /** conversationId → accumulated summary */
  private summaries = new Map<string, string>();

  /** Whether a compaction is currently in progress (for UI indicator) */
  private _isCompacting = false;
  private compactingListeners = new Set<(v: boolean) => void>();

  get isCompacting(): boolean {
    return this._isCompacting;
  }

  subscribeCompacting(listener: (v: boolean) => void): () => void {
    this.compactingListeners.add(listener);
    listener(this._isCompacting);
    return () => this.compactingListeners.delete(listener);
  }

  private setCompacting(v: boolean): void {
    this._isCompacting = v;
    this.compactingListeners.forEach(fn => fn(v));
  }

  isContextFullError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return CONTEXT_FULL_PATTERNS.some(p => msg.includes(p));
  }

  /** Summarize old messages using the loaded LLM */
  async summarizeOldMessages(messagesToSummarize: Message[]): Promise<string> {
    // Clear KV cache to free context space for the summarization request
    await llmService.clearKVCache(true);

    const transcript = messagesToSummarize
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 3000); // cap input to fit in context

    const summaryMessages: Message[] = [
      { id: 'sys', role: 'system', content: SUMMARIZE_PROMPT, timestamp: 0 },
      { id: 'usr', role: 'user', content: transcript, timestamp: 0 },
    ];

    const summary = await llmService.generateResponse(summaryMessages);
    return summary.trim();
  }

  /** Build a compacted message array: system + summary + recent messages */
  buildCompactedMessages(
    systemPrompt: string,
    summary: string,
    recentMessages: Message[],
  ): Message[] {
    return [
      { id: 'system', role: 'system', content: systemPrompt, timestamp: 0 },
      {
        id: 'summary',
        role: 'system',
        content: `[Previous conversation summary]\n${summary}`,
        timestamp: 0,
      },
      ...recentMessages,
    ];
  }

  /** Full compaction flow: split messages, summarize old ones, return compacted array */
  async compact(
    conversationId: string,
    systemPrompt: string,
    allMessages: Message[],
  ): Promise<Message[]> {
    this.setCompacting(true);
    try {
      logger.log('[ContextCompaction] Starting compaction for conversation', conversationId);

      const nonSystem = allMessages.filter(m => m.role !== 'system');
      const recentMessages = nonSystem.slice(-KEEP_RECENT);
      const oldMessages = nonSystem.slice(0, -KEEP_RECENT);

      if (oldMessages.length === 0) {
        logger.log('[ContextCompaction] No old messages to summarize');
        return allMessages;
      }

      // Include existing summary in the input so summaries accumulate
      const existingSummary = this.summaries.get(conversationId);
      const toSummarize: Message[] = existingSummary
        ? [{ id: 'prev-summary', role: 'user', content: `Previous summary: ${existingSummary}`, timestamp: 0 }, ...oldMessages]
        : oldMessages;

      const summary = await this.summarizeOldMessages(toSummarize);
      this.summaries.set(conversationId, summary);
      logger.log('[ContextCompaction] Summary generated:', summary.slice(0, 100));

      // Clear KV cache again before the retry generation
      await llmService.clearKVCache(true);

      return this.buildCompactedMessages(systemPrompt, summary, recentMessages);
    } finally {
      this.setCompacting(false);
    }
  }

  /** Cleanup when a conversation is deleted */
  clearSummary(conversationId: string): void {
    this.summaries.delete(conversationId);
  }

  /** Get the current summary for a conversation (for testing/debugging) */
  getSummary(conversationId: string): string | undefined {
    return this.summaries.get(conversationId);
  }
}

export const contextCompactionService = new ContextCompactionService();
