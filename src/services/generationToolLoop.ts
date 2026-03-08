/**
 * Tool-calling generation loop.
 * Extracted to keep generationService.ts under the max-lines limit.
 */

import { llmService } from './llm';
import type { StreamToken } from './llm';
import { useChatStore } from '../stores';
import { Message } from '../types';
import { getToolsAsOpenAISchema, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools/types';
import logger from '../utils/logger';

const MAX_TOOL_ITERATIONS = 3;
const MAX_TOTAL_TOOL_CALLS = 5;
type StreamChunk = string | StreamToken;

/**
 * Parse the XML-like tool call format that some models emit:
 *   <tool_call><function=NAME><parameter=KEY>VALUE<parameter=KEY2>VALUE2</tool_call>
 * or without a closing tag (model hits EOS):
 *   <tool_call><function=NAME><parameter=KEY>VALUE
 */
function parseXmlStyleToolCall(body: string, idSuffix: number): ToolCall | null {
  const funcMatch = body.match(/<function=(\w+)>/);
  if (!funcMatch) return null;

  const name = funcMatch[1];
  const args: Record<string, any> = {};

  // Extract all <parameter=KEY>VALUE pairs, stopping at next param, closing tags, or end
  const paramPattern = /<parameter=(\w+)>([\s\S]*?)(?=<parameter=|<\/|$)/g;
  let pm;
  while ((pm = paramPattern.exec(body)) !== null) {
    args[pm[1]] = pm[2].trim();
  }

  return {
    id: `text-tc-${Date.now()}-${idSuffix}`,
    name,
    arguments: args,
  };
}

/** Try to parse a tool call body as JSON then XML. Returns null if neither works. */
function parseToolCallBody(body: string, idSuffix: number): ToolCall | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed.name) {
      return {
        id: `text-tc-${Date.now()}-${idSuffix}`,
        name: parsed.name,
        arguments: parsed.arguments || parsed.parameters || {},
      };
    }
  } catch {
    // Not JSON — fall through to XML
  }
  return parseXmlStyleToolCall(body, idSuffix);
}

/**
 * Parse tool calls from text output (fallback for small models that emit
 * <tool_call> tags as text instead of using the structured tool calling format).
 *
 * Supports two formats:
 * 1. JSON: <tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call>
 * 2. XML-like: <tool_call><function=web_search><parameter=query>test</tool_call>
 *    (closing tag optional — model may hit EOS first)
 */
export function parseToolCallsFromText(text: string): { cleanText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];

  // Match <tool_call>...</tool_call> (with closing tag)
  const closedPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  const matchedRanges: [number, number][] = [];

  while ((match = closedPattern.exec(text)) !== null) {
    matchedRanges.push([match.index, match.index + match[0].length]);
    const call = parseToolCallBody(match[1].trim(), toolCalls.length);
    if (call) {
      toolCalls.push(call);
    } else {
      logger.log(`[ToolLoop] Failed to parse tool_call tag: ${match[1].trim().substring(0, 100)}`);
    }
  }

  // Also match unclosed <tool_call> at end of text (model hit EOS without closing tag)
  const unclosedPattern = /<tool_call>([\s\S]+)$/;
  const unclosedMatch = text.match(unclosedPattern);
  if (unclosedMatch) {
    const unclosedStart = text.lastIndexOf(unclosedMatch[0]);
    const alreadyMatched = matchedRanges.some(([s, e]) => unclosedStart >= s && unclosedStart < e);
    if (!alreadyMatched) {
      const call = parseToolCallBody(unclosedMatch[1].trim(), toolCalls.length);
      if (call) toolCalls.push(call);
      matchedRanges.push([unclosedStart, text.length]);
    }
  }

  // Remove all matched ranges from text
  let cleanText = text;
  for (const [start, end] of matchedRanges.sort((a, b) => b[0] - a[0])) {
    cleanText = cleanText.slice(0, start) + cleanText.slice(end);
  }
  cleanText = cleanText.trim();

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
  onStream?: (data: StreamChunk) => void;
  onStreamReset?: () => void;
  onFinalResponse: (content: string) => void;
}

function normalizeStreamChunk(data: StreamChunk): StreamToken {
  return typeof data === 'string' ? { content: data } : data;
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

const MAX_LLM_RETRIES = 4;
const RETRY_BACKOFF_MS = 1000;
const CONTEXT_RELEASE_PAUSE_MS = 500;

/** Non-retryable errors that should fail immediately. */
function isNonRetryableError(msg: string): boolean {
  return msg.includes('No model loaded') || msg.includes('aborted');
}

/** Call LLM with retry+backoff for transient native context errors. */
async function callLLMWithRetry(
  messages: Message[],
  tools: any[],
  onStream?: (data: StreamToken) => void,
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  let lastError: any;
  for (let attempt = 0; attempt < MAX_LLM_RETRIES; attempt++) {
    try {
      return await llmService.generateResponseWithTools(messages, { tools, onStream });
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || String(e) || '';
      // Fail fast on errors that won't resolve with a retry
      if (isNonRetryableError(msg) || attempt >= MAX_LLM_RETRIES - 1) {
        break;
      }
      // Force-stop native context and reset isGenerating before retrying —
      // the native context may be stuck in a busy state after an error
      logger.log(`[ToolLoop] Error: "${msg.substring(0, 120) || '(no message)'}", stopping context and retrying (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
      await llmService.stopGeneration().catch(() => {});
      const delayMs = (attempt + 1) * RETRY_BACKOFF_MS;
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
  // Preserve a meaningful error message for the UI
  const errMsg = lastError?.message || String(lastError) || 'Unknown LLM error after tool execution';
  throw new Error(errMsg);
}

/** If no structured tool calls, try parsing <tool_call> tags from text. */
function resolveToolCalls(fullResponse: string, toolCalls: ToolCall[]) {
  if (toolCalls.length > 0 || !fullResponse.includes('<tool_call>')) {
    return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
  }
  const parsed = parseToolCallsFromText(fullResponse);
  if (parsed.toolCalls.length > 0) {
    logger.log(`[ToolLoop] Parsed ${parsed.toolCalls.length} tool call(s) from text output`);
    return { effectiveToolCalls: parsed.toolCalls, displayResponse: parsed.cleanText };
  }
  return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
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
  let firstTokenFired = false;
  let streamedContent = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.isAborted()) break;
    streamedContent = '';
    logger.log(`[ToolLoop] Iteration ${iteration}, messages: ${loopMessages.length}, tools: ${toolSchemas.length}, totalCalls: ${totalToolCalls}`);

    const streamHandler = ctx.onStream;
    const onStream = streamHandler ? (data: StreamChunk) => {
      if (ctx.isAborted()) return;
      const chunk = normalizeStreamChunk(data);
      if (!firstTokenFired) { firstTokenFired = true; ctx.onThinkingDone(); ctx.callbacks?.onFirstToken?.(); }
      if (chunk.content) streamedContent += chunk.content;
      streamHandler(data);
    } : undefined;

    const { fullResponse, toolCalls } = await callLLMWithRetry(loopMessages, toolSchemas, onStream);
    logger.log(`[ToolLoop] Result: response=${fullResponse.length} chars, toolCalls=${toolCalls.length}`);

    const { effectiveToolCalls, displayResponse } = resolveToolCalls(fullResponse, toolCalls);
    const cappedToolCalls = effectiveToolCalls.slice(0, MAX_TOTAL_TOOL_CALLS - totalToolCalls);
    totalToolCalls += cappedToolCalls.length;

    if (cappedToolCalls.length === 0 || iteration === MAX_TOOL_ITERATIONS - 1) {
      if (displayResponse && !streamedContent) {
        ctx.onThinkingDone();
        ctx.callbacks?.onFirstToken?.();
        ctx.onFinalResponse(displayResponse);
      }
      return;
    }

    if (streamedContent) { ctx.onStreamReset?.(); chatStore.setStreamingMessage(''); }

    const assistantMsg: Message = {
      id: `tool-assist-${Date.now()}-${iteration}`, role: 'assistant',
      content: displayResponse || '', timestamp: Date.now(),
      toolCalls: cappedToolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) })),
    };
    loopMessages.push(assistantMsg);
    chatStore.addMessage(ctx.conversationId, assistantMsg);

    await executeToolCalls(ctx, cappedToolCalls, loopMessages);

    // Show "Thinking..." indicator while waiting for the next LLM response
    chatStore.setIsThinking(true);
    await new Promise<void>(resolve => setTimeout(resolve, CONTEXT_RELEASE_PAUSE_MS));

    if (totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
      logger.log(`[ToolLoop] Hit total tool call cap (${MAX_TOTAL_TOOL_CALLS}), forcing final generation`);
    }
  }
}
