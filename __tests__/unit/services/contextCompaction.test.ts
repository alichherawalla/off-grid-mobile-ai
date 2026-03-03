/**
 * Context Compaction Service Unit Tests
 *
 * Tests for auto-summarizing old messages when context is full.
 * Priority: P1 — Prevents generation failures on long conversations.
 */

import { contextCompactionService } from '../../../src/services/contextCompaction';
import { llmService } from '../../../src/services/llm';
import { createMessage } from '../../utils/factories';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    clearKVCache: jest.fn().mockResolvedValue(undefined),
    generateResponse: jest.fn().mockResolvedValue('Summary of the conversation about coding and weather.'),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedLlmService = llmService as jest.Mocked<typeof llmService>;

beforeEach(() => {
  jest.clearAllMocks();
  contextCompactionService.clearSummary('conv-1');
  contextCompactionService.clearSummary('conv-2');
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

describe('buildCompactedMessages', () => {
  it('builds correct message array with system, summary, and recent messages', () => {
    const recent = [
      createMessage({ role: 'user', content: 'latest question' }),
      createMessage({ role: 'assistant', content: 'latest answer' }),
    ];

    const result = contextCompactionService.buildCompactedMessages(
      'You are helpful.',
      'User discussed coding and weather.',
      recent,
    );

    expect(result).toHaveLength(4); // system + summary + 2 recent
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('You are helpful.');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('Previous conversation summary');
    expect(result[1].content).toContain('User discussed coding and weather.');
    expect(result[2]).toBe(recent[0]);
    expect(result[3]).toBe(recent[1]);
  });

  it('works with empty recent messages', () => {
    const result = contextCompactionService.buildCompactedMessages(
      'System prompt', 'A summary', [],
    );
    expect(result).toHaveLength(2);
  });
});

describe('summarizeOldMessages', () => {
  it('calls clearKVCache and generateResponse', async () => {
    const messages = [
      createMessage({ role: 'user', content: 'Hello' }),
      createMessage({ role: 'assistant', content: 'Hi there!' }),
    ];

    const result = await contextCompactionService.summarizeOldMessages(messages);

    expect(mockedLlmService.clearKVCache).toHaveBeenCalledWith(true);
    expect(mockedLlmService.generateResponse).toHaveBeenCalledTimes(1);
    const callMessages = mockedLlmService.generateResponse.mock.calls[0][0];
    expect(callMessages[0].content).toContain('Summarize');
    expect(callMessages[1].content).toContain('user: Hello');
    expect(callMessages[1].content).toContain('assistant: Hi there!');
    expect(result).toBe('Summary of the conversation about coding and weather.');
  });

  it('filters out system messages from transcript', async () => {
    const messages = [
      createMessage({ role: 'system', content: 'You are helpful' }),
      createMessage({ role: 'user', content: 'Question' }),
    ];

    await contextCompactionService.summarizeOldMessages(messages);

    const callMessages = mockedLlmService.generateResponse.mock.calls[0][0];
    expect(callMessages[1].content).not.toContain('system:');
    expect(callMessages[1].content).toContain('user: Question');
  });
});

describe('compact', () => {
  it('splits messages and returns compacted array', async () => {
    const allMessages = [
      createMessage({ id: 'sys', role: 'system', content: 'Be helpful' }),
      createMessage({ role: 'user', content: 'msg 1' }),
      createMessage({ role: 'assistant', content: 'reply 1' }),
      createMessage({ role: 'user', content: 'msg 2' }),
      createMessage({ role: 'assistant', content: 'reply 2' }),
      createMessage({ role: 'user', content: 'msg 3' }),
      createMessage({ role: 'assistant', content: 'reply 3' }),
      createMessage({ role: 'user', content: 'msg 4' }),
      createMessage({ role: 'assistant', content: 'reply 4' }),
    ];

    const result = await contextCompactionService.compact('conv-1', 'Be helpful', allMessages);

    // system + summary + last 4 non-system messages
    expect(result).toHaveLength(6);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('Be helpful');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('Previous conversation summary');
    // Last 4 non-system messages (indices 4-7 of the 8 non-system)
    expect(result[2].content).toBe('msg 3');
    expect(result[3].content).toBe('reply 3');
    expect(result[4].content).toBe('msg 4');
    expect(result[5].content).toBe('reply 4');
  });

  it('returns original messages when no old messages to summarize', async () => {
    const allMessages = [
      createMessage({ role: 'system', content: 'Be helpful' }),
      createMessage({ role: 'user', content: 'msg 1' }),
      createMessage({ role: 'assistant', content: 'reply 1' }),
    ];

    const result = await contextCompactionService.compact('conv-1', 'Be helpful', allMessages);

    // Only 2 non-system messages < KEEP_RECENT(4), returns original
    expect(result).toEqual(allMessages);
    expect(mockedLlmService.generateResponse).not.toHaveBeenCalled();
  });

  it('stores and accumulates summaries', async () => {
    const messages1 = [
      createMessage({ role: 'user', content: 'old 1' }),
      createMessage({ role: 'assistant', content: 'old reply 1' }),
      createMessage({ role: 'user', content: 'old 2' }),
      createMessage({ role: 'assistant', content: 'old reply 2' }),
      createMessage({ role: 'user', content: 'recent 1' }),
      createMessage({ role: 'assistant', content: 'recent reply 1' }),
      createMessage({ role: 'user', content: 'recent 2' }),
      createMessage({ role: 'assistant', content: 'recent reply 2' }),
    ];

    await contextCompactionService.compact('conv-1', 'System', messages1);
    expect(contextCompactionService.getSummary('conv-1')).toBeTruthy();

    // Second compaction should include existing summary
    await contextCompactionService.compact('conv-1', 'System', messages1);
    const secondCall = mockedLlmService.generateResponse.mock.calls[1][0];
    expect(secondCall[1].content).toContain('Previous summary:');
  });

  it('clears KV cache after summarization for retry', async () => {
    const messages = [
      createMessage({ role: 'user', content: 'old' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'r1' }),
      createMessage({ role: 'assistant', content: 'r2' }),
      createMessage({ role: 'user', content: 'r3' }),
      createMessage({ role: 'assistant', content: 'r4' }),
    ];

    await contextCompactionService.compact('conv-1', 'System', messages);

    // clearKVCache called twice: once in summarizeOldMessages, once after
    expect(mockedLlmService.clearKVCache).toHaveBeenCalledTimes(2);
  });
});

describe('clearSummary', () => {
  it('removes stored summary', async () => {
    const messages = [
      createMessage({ role: 'user', content: 'old' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'r1' }),
      createMessage({ role: 'assistant', content: 'r2' }),
      createMessage({ role: 'user', content: 'r3' }),
      createMessage({ role: 'assistant', content: 'r4' }),
    ];

    await contextCompactionService.compact('conv-1', 'System', messages);
    expect(contextCompactionService.getSummary('conv-1')).toBeTruthy();

    contextCompactionService.clearSummary('conv-1');
    expect(contextCompactionService.getSummary('conv-1')).toBeUndefined();
  });
});

describe('compacting state', () => {
  it('sets isCompacting during compact flow', async () => {
    const states: boolean[] = [];
    const unsub = contextCompactionService.subscribeCompacting(v => states.push(v));

    const messages = [
      createMessage({ role: 'user', content: 'old' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'r1' }),
      createMessage({ role: 'assistant', content: 'r2' }),
      createMessage({ role: 'user', content: 'r3' }),
      createMessage({ role: 'assistant', content: 'r4' }),
    ];

    await contextCompactionService.compact('conv-1', 'System', messages);
    unsub();

    // Initial false from subscribe, then true (start), then false (end)
    expect(states[0]).toBe(false);
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it('resets isCompacting even on error', async () => {
    mockedLlmService.generateResponse.mockRejectedValueOnce(new Error('fail'));

    const messages = [
      createMessage({ role: 'user', content: 'old' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'r1' }),
      createMessage({ role: 'assistant', content: 'r2' }),
      createMessage({ role: 'user', content: 'r3' }),
      createMessage({ role: 'assistant', content: 'r4' }),
    ];

    await expect(
      contextCompactionService.compact('conv-1', 'System', messages),
    ).rejects.toThrow('fail');

    expect(contextCompactionService.isCompacting).toBe(false);
  });
});
