/**
 * Tool-calling generation loop.
 * Extracted to keep generationService.ts under the max-lines limit.
 */

import { llmService } from './llm';
import { useChatStore } from '../stores';
import { Message } from '../types';
import { getToolsAsOpenAISchema, executeToolCall } from './tools';
import type { ToolResult } from './tools/types';
import logger from '../utils/logger';

const MAX_TOOL_ITERATIONS = 5;

export interface ToolLoopCallbacks {
  onToolCallStart?: (name: string, args: Record<string, any>) => void;
  onToolCallComplete?: (name: string, result: ToolResult) => void;
  onFirstToken?: () => void;
}

export interface ToolLoopContext {
  conversationId: string;
  messages: Message[];
  enabledToolIds: string[];
  callbacks?: ToolLoopCallbacks;
  isAborted: () => boolean;
  onThinkingDone: () => void;
  onFinalResponse: (content: string) => void;
}

async function executeToolCalls(
  ctx: ToolLoopContext,
  toolCalls: import('./tools/types').ToolCall[],
  loopMessages: Message[],
): Promise<void> {
  const chatStore = useChatStore.getState();
  for (const tc of toolCalls) {
    if (ctx.isAborted()) break;

    ctx.callbacks?.onToolCallStart?.(tc.name, tc.arguments);
    const result = await executeToolCall(tc);
    ctx.callbacks?.onToolCallComplete?.(tc.name, result);

    const toolResultMsg: Message = {
      id: `tool-result-${Date.now()}-${tc.id || tc.name}`,
      role: 'tool',
      content: result.error ? `Error: ${result.error}` : result.content,
      timestamp: Date.now(),
      toolCallId: tc.id,
      toolName: tc.name,
      generationTimeMs: result.durationMs,
    };
    loopMessages.push(toolResultMsg);
    chatStore.addMessage(ctx.conversationId, toolResultMsg);
  }
}

/**
 * Run the tool-calling loop: call LLM → execute tools → re-inject results → repeat.
 * Returns when the model produces a final response with no tool calls.
 */
export async function runToolLoop(ctx: ToolLoopContext): Promise<void> {
  const chatStore = useChatStore.getState();
  const toolSchemas = getToolsAsOpenAISchema(ctx.enabledToolIds);
  const loopMessages = [...ctx.messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.isAborted()) break;

    logger.log(`[ToolLoop] Iteration ${iteration}, messages: ${loopMessages.length}, tools: ${toolSchemas.length}`);
    const { fullResponse, toolCalls } = await llmService.generateResponseWithTools(
      loopMessages,
      { tools: toolSchemas },
    );
    logger.log(`[ToolLoop] Result: response=${fullResponse.length} chars, toolCalls=${toolCalls.length}`);

    if (toolCalls.length === 0 || iteration === MAX_TOOL_ITERATIONS - 1) {
      if (fullResponse) {
        ctx.onThinkingDone();
        ctx.callbacks?.onFirstToken?.();
        ctx.onFinalResponse(fullResponse);
      }
      return;
    }

    // Assistant made tool calls — add to context
    const assistantMsg: Message = {
      id: `tool-assist-${Date.now()}-${iteration}`,
      role: 'assistant',
      content: fullResponse || '',
      timestamp: Date.now(),
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    };
    loopMessages.push(assistantMsg);
    chatStore.addMessage(ctx.conversationId, assistantMsg);

    await executeToolCalls(ctx, toolCalls, loopMessages);
  }
}
