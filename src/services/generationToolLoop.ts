/**
 * Tool-calling generation loop.
 * Extracted to keep generationService.ts under the max-lines limit.
 */

import { llmService } from './llm';
import { useChatStore } from '../stores';
import { Message } from '../types';
import { getToolsAsOpenAISchema, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools/types';
import logger from '../utils/logger';

const MAX_TOOL_ITERATIONS = 3;
const MAX_TOTAL_TOOL_CALLS = 5;

/**
 * Parse tool calls from text output (fallback for small models that emit
 * <tool_call> tags as text instead of using the structured tool calling format).
 */
export function parseToolCallsFromText(text: string): { cleanText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const tagPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name) {
        toolCalls.push({
          id: `text-tc-${Date.now()}-${toolCalls.length}`,
          name: parsed.name,
          arguments: parsed.arguments || parsed.parameters || {},
        });
      }
    } catch {
      logger.log(`[ToolLoop] Failed to parse tool_call tag: ${match[1].substring(0, 100)}`);
    }
  }
  const cleanText = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  return { cleanText, toolCalls };
}

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

/** Extract last user message from the loop messages for fallback context. */
function getLastUserQuery(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content.trim()) {
      return messages[i].content.trim();
    }
  }
  return '';
}

async function executeToolCalls(
  ctx: ToolLoopContext,
  toolCalls: import('./tools/types').ToolCall[],
  loopMessages: Message[],
): Promise<void> {
  const chatStore = useChatStore.getState();
  for (const tc of toolCalls) {
    if (ctx.isAborted()) break;

    // Small models often call web_search with empty args — use user's message as fallback
    if (tc.name === 'web_search' && (!tc.arguments.query || typeof tc.arguments.query !== 'string' || !tc.arguments.query.trim())) {
      const fallbackQuery = getLastUserQuery(loopMessages);
      if (fallbackQuery) {
        logger.log(`[ToolLoop] web_search called with empty query, using user message: "${fallbackQuery.substring(0, 80)}"`);
        tc.arguments = { ...tc.arguments, query: fallbackQuery };
      }
    }

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
  let totalToolCalls = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.isAborted()) break;

    logger.log(`[ToolLoop] Iteration ${iteration}, messages: ${loopMessages.length}, tools: ${toolSchemas.length}, totalCalls: ${totalToolCalls}`);
    const { fullResponse, toolCalls } = await llmService.generateResponseWithTools(
      loopMessages,
      { tools: toolSchemas },
    );
    logger.log(`[ToolLoop] Result: response=${fullResponse.length} chars, toolCalls=${toolCalls.length}`);

    // Fallback: parse <tool_call> tags from text if no structured tool calls
    let effectiveToolCalls = toolCalls;
    let displayResponse = fullResponse;
    if (toolCalls.length === 0 && fullResponse.includes('<tool_call>')) {
      const parsed = parseToolCallsFromText(fullResponse);
      if (parsed.toolCalls.length > 0) {
        logger.log(`[ToolLoop] Parsed ${parsed.toolCalls.length} tool call(s) from text output`);
        effectiveToolCalls = parsed.toolCalls;
        displayResponse = parsed.cleanText;
      }
    }

    // Cap tool calls to prevent runaway loops
    const cappedToolCalls = effectiveToolCalls.slice(0, MAX_TOTAL_TOOL_CALLS - totalToolCalls);
    totalToolCalls += cappedToolCalls.length;

    if (cappedToolCalls.length === 0 || iteration === MAX_TOOL_ITERATIONS - 1) {
      if (displayResponse) {
        ctx.onThinkingDone();
        ctx.callbacks?.onFirstToken?.();
        ctx.onFinalResponse(displayResponse);
      }
      return;
    }

    // Assistant made tool calls — add to context
    const assistantMsg: Message = {
      id: `tool-assist-${Date.now()}-${iteration}`,
      role: 'assistant',
      content: displayResponse || '',
      timestamp: Date.now(),
      toolCalls: cappedToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      })),
    };
    loopMessages.push(assistantMsg);
    chatStore.addMessage(ctx.conversationId, assistantMsg);

    await executeToolCalls(ctx, cappedToolCalls, loopMessages);

    // If we've hit the total cap, force exit on next iteration
    if (totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
      logger.log(`[ToolLoop] Hit total tool call cap (${MAX_TOTAL_TOOL_CALLS}), forcing final generation`);
    }
  }
}
