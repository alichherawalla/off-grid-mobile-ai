/**
 * Tool-aware LLM generation helper.
 * Extracted to keep llm.ts under the max-lines limit.
 */

import { useAppStore } from '../stores';
import type { Message } from '../types';
import type { ToolCall } from './tools/types';
import { recordGenerationStats, buildCompletionParams, buildThinkingCompletionParams } from './llmHelpers';
import type { StreamToken } from './llm';
import logger from '../utils/logger';

type ToolStreamCallback = (data: StreamToken) => void;
type ToolCompleteCallback = (fullResponse: string) => void;

function parseToolCall(tc: any): ToolCall {
  const fn = tc.function || {};
  let args = fn.arguments || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args || '{}'); } catch { args = {}; }
  }
  return { id: tc.id, name: fn.name || '', arguments: args };
}

export interface ToolGenerationDeps {
  context: any;
  isGenerating: boolean;
  isThinkingEnabled: boolean;
  manageContextWindow: (messages: Message[], extraReserve?: number) => Promise<Message[]>;
  convertToOAIMessages: (messages: Message[]) => any[];
  setPerformanceStats: (stats: any) => void;
  setIsGenerating: (v: boolean) => void;
}

export async function generateWithToolsImpl(
  deps: ToolGenerationDeps,
  messages: Message[],
  options: { tools: any[]; onStream?: ToolStreamCallback; onComplete?: ToolCompleteCallback },
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  if (!deps.context) throw new Error('No model loaded');
  if (deps.isGenerating) throw new Error('Generation already in progress');
  deps.setIsGenerating(true);

  // Mutable flag for the streaming callback (deps.isGenerating is a stale copy)
  let generating = true;

  try {
    // Reserve context space for tool schemas (~100 tokens per tool)
    const toolTokenReserve = options.tools.length * 100;
    const managed = await deps.manageContextWindow(messages, toolTokenReserve);
    const oaiMessages = deps.convertToOAIMessages(managed);
    const { settings } = useAppStore.getState();
    const startTime = Date.now();
    let firstTokenMs = 0;
    let tokenCount = 0;
    let fullResponse = '';
    let firstReceived = false;
    const collectedToolCalls: ToolCall[] = [];

    const completionParams = {
      messages: oaiMessages,
      ...buildCompletionParams(settings),
      tools: options.tools,
      tool_choice: 'auto',
      ...buildThinkingCompletionParams(deps.isThinkingEnabled),
    };
    console.log('[LLM-Tools] === INPUT ===');
    console.log(JSON.stringify(completionParams, null, 2));
    const completionResult = await deps.context.completion(completionParams as any, (data: any) => {
      if (!generating) return;
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          collectedToolCalls.push(parseToolCall(tc));
        }
      }
      if (!data.token) return;
      if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
      tokenCount++;
      fullResponse += data.token;
      options.onStream?.({ content: data.token });
    });
    console.log('[LLM-Tools] === OUTPUT ===');
    console.log(JSON.stringify(completionResult, null, 2));

    const cr = completionResult as any;

    // If streaming didn't capture tokens but completionResult has text, use it
    if (!fullResponse && cr?.text) {
      fullResponse = cr.text;
      tokenCount = cr.tokens_predicted || 0;
      logger.log(`[LLM-Tools] Using completionResult.text as response (${fullResponse.length} chars)`);
    }

    // Prefer completionResult tool_calls over streamed ones — streaming may
    // deliver partial tool calls (name only, no arguments) while the final
    // result contains the complete tool call data.
    const resultToolCalls = cr?.tool_calls;
    if (resultToolCalls?.length) {
      collectedToolCalls.length = 0;
      for (const tc of resultToolCalls) {
        collectedToolCalls.push(parseToolCall(tc));
      }
      logger.log(`[LLM-Tools] Using ${collectedToolCalls.length} tool call(s) from completionResult`);
    }

    deps.setPerformanceStats(recordGenerationStats(startTime, firstTokenMs, tokenCount));
    generating = false;
    deps.setIsGenerating(false);
    if (cr?.context_full) {
      logger.log('[LLM-Tools] Context full detected — signalling for compaction');
      throw new Error('Context is full');
    }
    options.onComplete?.(fullResponse);
    return { fullResponse, toolCalls: collectedToolCalls };
  } catch (error) {
    generating = false;
    deps.setIsGenerating(false);
    throw error;
  }
}
