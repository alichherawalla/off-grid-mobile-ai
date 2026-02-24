/**
 * Tool-aware LLM generation helper.
 * Extracted to keep llm.ts under the max-lines limit.
 */

import { useAppStore } from '../stores';
import type { Message } from '../types';
import type { ToolCall } from './tools/types';
import { recordGenerationStats, buildCompletionParams } from './llmHelpers';
import logger from '../utils/logger';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;

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
  manageContextWindow: (messages: Message[]) => Promise<Message[]>;
  convertToOAIMessages: (messages: Message[]) => any[];
  setPerformanceStats: (stats: any) => void;
  setIsGenerating: (v: boolean) => void;
}

export async function generateWithToolsImpl(
  deps: ToolGenerationDeps,
  messages: Message[],
  options: { tools: any[]; onStream?: StreamCallback; onComplete?: CompleteCallback },
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  if (!deps.context) throw new Error('No model loaded');
  if (deps.isGenerating) throw new Error('Generation already in progress');
  deps.setIsGenerating(true);

  try {
    const managed = await deps.manageContextWindow(messages);
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
    };
    logger.log(`[LLM-Tools] Completion params: ${oaiMessages.length} msgs, ${options.tools.length} tools, n_predict=${(completionParams as any).n_predict}`);
    const completionResult = await deps.context.completion(completionParams as any, (data: any) => {
      if (!deps.isGenerating) return;
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          collectedToolCalls.push(parseToolCall(tc));
        }
      }
      if (!data.token) return;
      if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
      tokenCount++;
      fullResponse += data.token;
      options.onStream?.(data.token);
    });

    logger.log(`[LLM-Tools] Completion done: tokens=${tokenCount}, response="${fullResponse.substring(0, 100)}", streamedToolCalls=${collectedToolCalls.length}`);
    logger.log(`[LLM-Tools] completionResult keys: ${completionResult ? Object.keys(completionResult as any).join(', ') : 'null'}`);
    // Check final result for tool calls if none collected during streaming
    const resultToolCalls = (completionResult as any)?.tool_calls;
    if (resultToolCalls?.length && collectedToolCalls.length === 0) {
      for (const tc of resultToolCalls) {
        collectedToolCalls.push(parseToolCall(tc));
      }
    }

    deps.setPerformanceStats(recordGenerationStats(startTime, firstTokenMs, tokenCount));
    deps.setIsGenerating(false);
    options.onComplete?.(fullResponse);
    return { fullResponse, toolCalls: collectedToolCalls };
  } catch (error) {
    deps.setIsGenerating(false);
    throw error;
  }
}
