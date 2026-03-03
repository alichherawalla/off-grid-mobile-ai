/**
 * Context Compaction Service Unit Tests
 *
 * Tests for LLM-based summarization and token-aware message trimming
 * when context is full.
 * Priority: P1 — Prevents generation failures on long conversations.
 */

import { contextCompactionService } from '../../../src/services/contextCompaction';
import { llmService } from '../../../src/services/llm';
import { useChatStore } from '../../../src/stores/chatStore';
import { createMessage } from '../../utils/factories';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    clearKVCache: jest.fn().mockResolvedValue(undefined),
    getTokenCount: jest.fn().mockImplementation((text: string) =>
      Promise.resolve(Math.ceil(text.length / 4)),
    ),
    getPerformanceSettings: jest.fn().mockReturnValue({ contextLength: 2048 }),
    generateWithMaxTokens: jest.fn().mockResolvedValue('Summary of conversation'),
  },
}));

jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: jest.fn().mockReturnValue({
      updateCompactionState: jest.fn(),
    }),
  },
}));

const mockedLlmService = llmService as jest.Mocked<typeof llmService>;
const mockedUpdateCompactionState = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedLlmService.getTokenCount.mockImplementation((text: string) =>
    Promise.resolve(Math.ceil(text.length / 4)),
  );
  mockedLlmService.getPerformanceSettings.mockReturnValue({ contextLength: 2048 } as any);
  mockedLlmService.generateWithMaxTokens.mockResolvedValue('Summary of conversation');
  mockedUpdateCompactionState.mockClear();
  (useChatStore.getState as jest.Mock).mockReturnValue({
    updateCompactionState: mockedUpdateCompactionState,
  });
});

describe('isContextFullError', () => {
  it('returns true for "Context is full" error', () => {
    expect(contextCompactionService.isContextFullError(new Error('Context is full'))).toBe(true);
  });

  it('returns true for "Not enough context space" error', () => {
    expect(contextCompactionService.isContextFullError(new Error('Not enough context space'))).toBe(true);
  });

  it('returns true for case-insensitive match', () => {
    expect(contextCompactionService.isContextFullError(new Error('CONTEXT IS FULL'))).toBe(true);
  });

  it('returns true for error embedded in longer message', () => {
    expect(contextCompactionService.isContextFullError(
      new Error('Failed: context is full, cannot continue'),
    )).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(contextCompactionService.isContextFullError(new Error('No model loaded'))).toBe(false);
  });

  it('handles string errors', () => {
    expect(contextCompactionService.isContextFullError('context is full')).toBe(true);
  });

  it('returns true for "context window exceeded"', () => {
    expect(contextCompactionService.isContextFullError(new Error('context window exceeded'))).toBe(true);
  });

  it('returns true for "context length exceeded"', () => {
    expect(contextCompactionService.isContextFullError(new Error('context length exceeded'))).toBe(true);
  });
});

describe('compact', () => {
  it('clears KV cache before compacting', async () => {
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Hello' }),
    ];

    await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });
    expect(mockedLlmService.clearKVCache).toHaveBeenCalledWith(true);
  });

  it('keeps recent messages that fit within recent token budget', async () => {
    // With contextLength=2048, recentBudget=floor(2048*0.40)=819 tokens
    // Each short msg ≈ 3-5 tokens — all fit
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'msg 1' }),
      createMessage({ role: 'assistant', content: 'reply 1' }),
      createMessage({ role: 'user', content: 'msg 2' }),
      createMessage({ role: 'assistant', content: 'reply 2' }),
      createMessage({ role: 'user', content: 'latest question' }),
    ];

    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // All short messages fit within recent budget, no old messages → no summary
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System');
    expect(result[result.length - 1].content).toBe('latest question');
  });

  it('summarizes old messages when they exceed recent budget', async () => {
    // Make token counts realistic: 500 tokens per message
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(500);
    });

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ id: 'old-1', role: 'user', content: 'old msg 1' }),
      createMessage({ id: 'old-2', role: 'assistant', content: 'old reply 1' }),
      createMessage({ id: 'old-3', role: 'user', content: 'old msg 2' }),
      createMessage({ role: 'assistant', content: 'recent reply' }),
      createMessage({ role: 'user', content: 'latest question' }),
    ];

    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // recentBudget=819, each msg=500 → only 1 recent message fits
    // Old messages get summarized
    expect(mockedLlmService.generateWithMaxTokens).toHaveBeenCalled();
    // Result should have: system + summary system + recent message(s)
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System');
    const summaryMsg = result.find(m => m.id === 'compaction-summary');
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.content).toContain('[Previous conversation summary]');
    expect(summaryMsg!.content).toContain('Summary of conversation');
  });

  it('calls generateWithMaxTokens with bounded summary token budget', async () => {
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(500);
    });

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ id: 'old-1', role: 'user', content: 'old msg' }),
      createMessage({ id: 'old-2', role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // summaryTokenBudget = floor(2048 * 0.12) = 245
    const callArgs = mockedLlmService.generateWithMaxTokens.mock.calls[0];
    expect(callArgs[1]).toBe(Math.floor(2048 * 0.12));
  });

  it('persists compaction state to chat store', async () => {
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(500);
    });

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ id: 'old-msg', role: 'user', content: 'old msg' }),
      createMessage({ id: 'old-reply', role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    expect(mockedUpdateCompactionState).toHaveBeenCalledWith(
      'conv-1',
      'Summary of conversation',
      expect.any(String), // cutoff message ID
    );
  });

  it('includes previous summary in summarization input', async () => {
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(500);
    });

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ id: 'old-1', role: 'user', content: 'old msg' }),
      createMessage({ id: 'old-2', role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages, previousSummary: 'Previous summary text' });

    // The input to generateWithMaxTokens should contain the previous summary
    const summaryMessages = mockedLlmService.generateWithMaxTokens.mock.calls[0][0];
    const userInput = summaryMessages.find((m: any) => m.role === 'user');
    expect(userInput).toBeDefined();
    expect(userInput!.content).toContain('Previous summary');
  });

  it('falls back to trim-only on summarization failure', async () => {
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(500);
    });
    mockedLlmService.generateWithMaxTokens.mockRejectedValue(new Error('generation failed'));

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'old msg' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // Should still return a valid result with system + recent messages, no summary
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System');
    // No summary message
    const summaryMsg = result.find(m => m.id === 'compaction-summary');
    expect(summaryMsg).toBeUndefined();
    // Should not have persisted state
    expect(mockedUpdateCompactionState).not.toHaveBeenCalled();
  });

  it('truncates last user message when it alone exceeds recent budget', async () => {
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text === 'System') return Promise.resolve(10);
      return Promise.resolve(2000); // Way over budget
    });

    const longContent = 'x'.repeat(8000);
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: longContent }),
    ];

    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // Should still have the user message, but truncated
    const userMsg = result.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content.length).toBeLessThan(longContent.length);
  });

  it('uses actual context length from settings', async () => {
    mockedLlmService.getPerformanceSettings.mockReturnValue({ contextLength: 512 } as any);
    mockedLlmService.getTokenCount.mockImplementation((text: string) => {
      if (text.length < 20) return Promise.resolve(5);
      return Promise.resolve(200);
    });

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'a'.repeat(100) }),
      createMessage({ role: 'assistant', content: 'b'.repeat(100) }),
      createMessage({ role: 'user', content: 'c'.repeat(100) }),
    ];

    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });

    // 512 * 0.40 = 204 recent budget, each msg=200
    // Can only fit 1 recent message
    const nonSystemNonSummary = result.filter(m => m.role !== 'system');
    expect(nonSystemNonSummary.length).toBe(1);
  });

  it('falls back to char estimate when tokenizer fails', async () => {
    mockedLlmService.getTokenCount.mockRejectedValue(new Error('tokenizer unavailable'));
    mockedLlmService.generateWithMaxTokens.mockRejectedValue(new Error('no tokenizer'));

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Hello' }),
    ];

    // Should not throw — falls back to char-based estimate
    const result = await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe('clearSummary', () => {
  it('clears persisted compaction state from store', () => {
    contextCompactionService.clearSummary('conv-1');

    expect(mockedUpdateCompactionState).toHaveBeenCalledWith('conv-1', undefined, undefined);
  });
});

describe('compacting state', () => {
  it('sets isCompacting during compact flow', async () => {
    const states: boolean[] = [];
    const unsub = contextCompactionService.subscribeCompacting(v => states.push(v));

    const messages = [createMessage({ role: 'user', content: 'Hello' })];
    await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: messages });
    unsub();

    expect(states[0]).toBe(false);
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it('resets isCompacting even on error', async () => {
    mockedLlmService.clearKVCache.mockRejectedValueOnce(new Error('cache error'));

    const states: boolean[] = [];
    const unsub = contextCompactionService.subscribeCompacting(v => states.push(v));

    try {
      await contextCompactionService.compact({ conversationId: 'conv-1', systemPrompt: 'System', allMessages: [] });
    } catch {
      // expected
    }
    unsub();

    expect(states[states.length - 1]).toBe(false);
  });
});
