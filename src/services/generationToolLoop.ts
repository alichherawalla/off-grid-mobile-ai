/**
 * Tool-calling generation loop.
 * Extracted to keep generationService.ts under the max-lines limit.
 */

import { llmService } from './llm';
import type { StreamToken } from './llm';
import { useChatStore, useRemoteServerStore, useAppStore } from '../stores';
import { Message } from '../types';
import { getToolsAsOpenAISchema, executeToolCall } from './tools';
import type { ToolCall, ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';

const MAX_TOOL_ITERATIONS = 3;
const MAX_TOTAL_TOOL_CALLS = 5;
type StreamChunk = string | StreamToken;

/** Parse XML-like tool call: <tool_call><function=NAME><parameter=KEY>VALUE... */
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
    if (parsed.name) return { id: `text-tc-${Date.now()}-${idSuffix}`, name: parsed.name, arguments: parsed.arguments || parsed.parameters || {} };
  } catch { /* Not JSON — fall through to XML */ }
  return parseXmlStyleToolCall(body, idSuffix);
}

/**
 * Parse tool calls from text output (fallback for small models).
 * Supports JSON and XML-like formats; closing tag is optional.
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

  // Remove all matched ranges from text (process in reverse order to preserve indices)
  matchedRanges.sort((a, b) => b[0] - a[0]);
  let cleanText = text;
  for (const [start, end] of matchedRanges) {
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
  projectId?: string;
  callbacks?: ToolLoopCallbacks;
  isAborted: () => boolean;
  onThinkingDone: () => void;
  onStream?: (data: StreamChunk) => void;
  onStreamReset?: () => void;
  onFinalResponse: (content: string) => void;
  /** Force using remote provider (from generationService) */
  forceRemote?: boolean;
}

function normalizeStreamChunk(data: StreamChunk): StreamToken {
  return typeof data === 'string' ? { content: data } : data;
}

/** Extract last user message from the loop messages for fallback context. */
function getLastUserQuery(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === 'user' && messages[i].content.trim()) return messages[i].content.trim();
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

    if (ctx.projectId) tc.context = { projectId: ctx.projectId };
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
  return msg.includes('No model loaded') || msg.includes('aborted') || msg.includes('Remote provider');
}

/** Call remote LLM provider with tools */
async function callRemoteLLMWithTools(
  messages: Message[],
  tools: any[],
  onStream?: (data: StreamToken) => void,
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  const activeServerId = useRemoteServerStore.getState().activeServerId;
  if (!activeServerId) throw new Error('No remote provider active');

  const provider = providerRegistry.getProvider(activeServerId);
  if (!provider) throw new Error('Remote provider not found');

  const settings = useAppStore.getState().settings;
  const options: GenerationOptions = {
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    tools,
    enableThinking: settings.thinkingEnabled,
  };

  let _fullContent = '';
  let toolCalls: ToolCall[] = [];

  return new Promise((resolve, reject) => {
    provider.generate(messages, options, {
      onToken: (token: string) => { _fullContent += token; onStream?.({ content: token }); },
      onReasoning: (content: string) => { onStream?.({ reasoningContent: content }); },
      onComplete: (result: CompletionResult) => {
        if (result.toolCalls) {
          toolCalls = result.toolCalls.map(tc => ({
            id: tc.id || `call-${Date.now()}`,
            name: tc.name,
            arguments: typeof tc.arguments === 'string'
              ? JSON.parse(tc.arguments) as Record<string, any>
              : tc.arguments,
          }));
        }
        resolve({ fullResponse: result.content, toolCalls });
      },
      onError: (error: Error) => { reject(error); },
    });
  });
}

async function callLocalWithRetry(
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
      if (isNonRetryableError(msg) || attempt >= MAX_LLM_RETRIES - 1) break;
      logger.log(`[ToolLoop] Error: "${msg.substring(0, 120) || '(no message)'}", stopping context and retrying (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
      await llmService.stopGeneration().catch(() => { });
      await new Promise<void>(resolve => setTimeout(resolve, (attempt + 1) * RETRY_BACKOFF_MS));
    }
  }
  throw new Error(lastError?.message || String(lastError) || 'Unknown LLM error after tool execution');
}

interface CallLLMOptions { onStream?: (data: StreamToken) => void; forceRemote?: boolean; }

/** Call LLM with retry+backoff for transient native context errors. */
async function callLLMWithRetry(
  messages: Message[],
  tools: any[],
  { onStream, forceRemote }: CallLLMOptions = {},
): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
  const activeServerId = useRemoteServerStore.getState().activeServerId;
  const useRemote = forceRemote || (!!activeServerId && providerRegistry.hasProvider(activeServerId) && !llmService.isModelLoaded());
  if (useRemote) {
    try { return await callRemoteLLMWithTools(messages, tools, onStream); }
    catch (e: any) { throw new Error(e?.message || String(e) || 'Remote LLM error'); }
  }
  return callLocalWithRetry(messages, tools, onStream);
}

/** If no structured tool calls, try parsing <tool_call> tags from text. */
function resolveToolCalls(fullResponse: string, toolCalls: ToolCall[]) {
  if (toolCalls.length > 0 || !fullResponse.includes('<tool_call>'))
    return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
  const parsed = parseToolCallsFromText(fullResponse);
  if (parsed.toolCalls.length > 0) {
    logger.log(`[ToolLoop] Parsed ${parsed.toolCalls.length} tool call(s) from text output`);
    return { effectiveToolCalls: parsed.toolCalls, displayResponse: parsed.cleanText };
  }
  return { effectiveToolCalls: toolCalls, displayResponse: fullResponse };
}

interface ToolLoopState { firstTokenFired: boolean; streamedContent: string; }

function buildStreamHandler(ctx: ToolLoopContext, state: ToolLoopState): ((data: StreamChunk) => void) | undefined {
  if (!ctx.onStream) return undefined;
  return (data: StreamChunk) => {
    if (ctx.isAborted()) return;
    const chunk = normalizeStreamChunk(data);
    if (!state.firstTokenFired) { state.firstTokenFired = true; ctx.onThinkingDone(); ctx.callbacks?.onFirstToken?.(); }
    if (chunk.content) state.streamedContent += chunk.content;
    ctx.onStream!(data);
  };
}

function emitFinalResponse(ctx: ToolLoopContext, displayResponse: string, streamedContent: string): void {
  // If streamedContent is set, tokens were already streamed; otherwise deliver now.
  if (!streamedContent) {
    ctx.onThinkingDone();
    ctx.callbacks?.onFirstToken?.();
    ctx.onFinalResponse(displayResponse || '_(No response)_');
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
  const state: ToolLoopState = { firstTokenFired: false, streamedContent: '' };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (ctx.isAborted()) break;

    // Hit iteration or total-call cap — force one final text-only generation (no tools)
    if (iteration === MAX_TOOL_ITERATIONS - 1 || totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
      logger.log(`[ToolLoop] Hit cap after ${totalToolCalls} calls — forcing final text response`);
      state.streamedContent = '';
      state.firstTokenFired = false;
      const forcedOnStream = buildStreamHandler(ctx, state);
      const { fullResponse: forcedResponse } = await callLLMWithRetry(loopMessages, [], { onStream: forcedOnStream, forceRemote: ctx.forceRemote });
      emitFinalResponse(ctx, forcedResponse, state.streamedContent);
      return;
    }

    state.streamedContent = '';
    logger.log(`[ToolLoop] Iteration ${iteration}, messages: ${loopMessages.length}, tools: ${toolSchemas.length}, totalCalls: ${totalToolCalls}`);

    const onStream = buildStreamHandler(ctx, state);
    const { fullResponse, toolCalls } = await callLLMWithRetry(loopMessages, toolSchemas, { onStream, forceRemote: ctx.forceRemote });

    const { effectiveToolCalls, displayResponse } = resolveToolCalls(fullResponse, toolCalls);
    const cappedToolCalls = effectiveToolCalls.slice(0, MAX_TOTAL_TOOL_CALLS - totalToolCalls);
    totalToolCalls += cappedToolCalls.length;

    // No tool calls → model gave a final text response
    if (cappedToolCalls.length === 0) {
      emitFinalResponse(ctx, displayResponse, state.streamedContent);
      return;
    }

    // Execute the tool calls
    if (state.streamedContent) { ctx.onStreamReset?.(); chatStore.setStreamingMessage(''); }

    const assistantMsg: Message = {
      id: `tool-assist-${Date.now()}-${iteration}`, role: 'assistant',
      content: displayResponse || state.streamedContent || '', timestamp: Date.now(),
      toolCalls: cappedToolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) })),
    };
    loopMessages.push(assistantMsg);
    chatStore.addMessage(ctx.conversationId, assistantMsg);

    await executeToolCalls(ctx, cappedToolCalls, loopMessages);

    chatStore.setIsThinking(true);
    await new Promise<void>(resolve => setTimeout(resolve, CONTEXT_RELEASE_PAUSE_MS));
  }
}
