/* eslint-disable max-lines, max-params, complexity */
/**
 * OpenAI-Compatible Provider
 *
 * Provider implementation for OpenAI-compatible servers (Ollama, LM Studio, LocalAI, etc.)
 * Handles model discovery, streaming generation, vision, and tool calling.
 */

import { Message } from '../../types';
import type {
  LLMProvider,
  ProviderType,
  ProviderCapabilities,
  GenerationOptions,
  StreamCallbacks,
} from './types';
import {
  createStreamingRequest,
  createNDJSONStreamingRequest,
  parseOpenAIMessage,
  imageToBase64DataUrl,
} from '../httpClient';
import { useAppStore } from '../../stores';
import logger from '../../utils/logger';
import { generateId } from '../../utils/generateId';

/** Returns true if the endpoint looks like an Ollama server (port 11434) */
function isOllamaEndpoint(endpoint: string): boolean {
  return endpoint.includes(':11434');
}

/** Returns true if the endpoint looks like an LM Studio server (port 1234) */
function isLMStudioEndpoint(endpoint: string): boolean {
  return endpoint.includes(':1234');
}

/**
 * Streaming parser for <think>...</think> tags embedded in delta.content.
 * Routes thinking content to onReasoning and regular content to onToken.
 * Handles tags split across multiple streaming chunks.
 */
class ThinkTagParser {
  private inThinkBlock = false;
  private buffer = '';

  process(content: string, onToken: (t: string) => void, onReasoning: (t: string) => void): void {
    this.buffer += content;
    this.flush(onToken, onReasoning);
  }

  /**
   * Handle one iteration of the while loop when we are outside a think block.
   * Returns true if the while loop should break (buffer needs more data).
   */
  private handleOutsideThink(openTag: string, onToken: (t: string) => void): boolean {
    const idx = this.buffer.indexOf(openTag);
    if (idx === -1) {
      const partial = this.partialSuffix(this.buffer, openTag);
      if (partial > 0) {
        onToken(this.buffer.slice(0, this.buffer.length - partial));
        this.buffer = this.buffer.slice(this.buffer.length - partial);
        return true;
      }
      onToken(this.buffer);
      this.buffer = '';
      return true;
    }
    if (idx > 0) onToken(this.buffer.slice(0, idx));
    this.buffer = this.buffer.slice(idx + openTag.length);
    this.inThinkBlock = true;
    return false;
  }

  /**
   * Handle one iteration of the while loop when we are inside a think block.
   * Returns true if the while loop should break (buffer needs more data).
   */
  private handleInsideThink(closeTag: string, onReasoning: (t: string) => void): boolean {
    const idx = this.buffer.indexOf(closeTag);
    if (idx === -1) {
      const partial = this.partialSuffix(this.buffer, closeTag);
      if (partial > 0) {
        onReasoning(this.buffer.slice(0, this.buffer.length - partial));
        this.buffer = this.buffer.slice(this.buffer.length - partial);
        return true;
      }
      onReasoning(this.buffer);
      this.buffer = '';
      return true;
    }
    if (idx > 0) onReasoning(this.buffer.slice(0, idx));
    this.buffer = this.buffer.slice(idx + closeTag.length);
    this.inThinkBlock = false;
    return false;
  }

  private flush(onToken: (t: string) => void, onReasoning: (t: string) => void): void {
    const openTag = '<think>';
    const closeTag = '</think>';
    while (this.buffer.length > 0) {
      if (!this.inThinkBlock) {
        if (this.handleOutsideThink(openTag, onToken)) break;
      } else {
        if (this.handleInsideThink(closeTag, onReasoning)) break;
      }
    }
  }

  /** Length of the longest suffix of text that is a prefix of tag. */
  private partialSuffix(text: string, tag: string): number {
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

/** OpenAI model info */
interface _OpenAIModel {
  id: string;
  object?: string;
  owned_by?: string;
}

/** OpenAI chat message */
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI content part */
interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/** OpenAI tool call */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI API configuration */
interface OpenAIConfig {
  endpoint: string;
  apiKey?: string;
  modelId: string;
}

/**
 * OpenAI-Compatible Provider Implementation
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly type: ProviderType = 'openai-compatible';

  private config: OpenAIConfig;
  private abortController: AbortController | null = null;
  private modelCapabilities: ProviderCapabilities;

  constructor(
    public readonly id: string,
    config: OpenAIConfig
  ) {
    this.config = config;
    this.modelCapabilities = {
      supportsVision: false,
      supportsToolCalling: true, // Assume true for OpenAI-compatible
      supportsThinking: false,
    };
  }

  get capabilities(): ProviderCapabilities {
    return this.modelCapabilities;
  }

  /**
   * Update configuration (endpoint, model, API key)
   */
  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async loadModel(modelId: string): Promise<void> {
    this.config.modelId = modelId;

    // For remote providers, "loading" just means setting the model ID
    // The actual model selection happens on the server

    // Try to detect capabilities from model name
    this.modelCapabilities = {
      ...this.modelCapabilities,
      supportsVision: this.detectVisionCapability(modelId),
    };
  }

  /**
   * Detect if model supports vision based on name patterns
   */
  private detectVisionCapability(modelId: string): boolean {
    const visionPatterns = [
      'vision', 'llava', 'bakllava', 'moondream', 'cogvlm',
      'cogagent', 'fuyu', 'idefics', 'qwen-vl', 'gpt-4-vision',
      'gpt-4o', 'claude-3', 'gemini', 'pixtral', 'phi-3.5-vision',
    ];
    const lowerModelId = modelId.toLowerCase();
    return visionPatterns.some(pattern => lowerModelId.includes(pattern));
  }

  async unloadModel(): Promise<void> {
    this.config.modelId = '';
    this.abortController = null;
  }

  isModelLoaded(): boolean {
    return !!this.config.modelId;
  }

  getLoadedModelId(): string | null {
    return this.config.modelId || null;
  }

  /**
   * Build the request body for the /v1/chat/completions endpoint.
   */
  private buildRequestBody(
    openaiMessages: OpenAIChatMessage[],
    options: GenerationOptions,
    thinkingEnabled: boolean
  ): Record<string, unknown> {
    return {
      model: this.config.modelId,
      messages: openaiMessages,
      stream: true,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      ...(options.topP !== undefined && { top_p: options.topP }),
      ...(options.tools && options.tools.length > 0 && { tools: options.tools, tool_choice: 'auto' }),
      // LM Studio only: control Qwen3 thinking per-request via chat_template_kwargs.
      // Sent only to LM Studio endpoints (port 1234) — other servers may reject unknown fields.
      ...(isLMStudioEndpoint(this.config.endpoint) && { chat_template_kwargs: { enable_thinking: thinkingEnabled } }),
    };
  }

  async generate(
    messages: Message[],
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (!this.config.modelId) {
      callbacks.onError(new Error('No model selected'));
      return;
    }

    this.abortController = new AbortController();
    // Capture signal in closure so abort checks remain valid even after
    // this.abortController is nulled by stopGeneration().
    const { signal } = this.abortController;

    try {
      // Build the API request
      const openaiMessages = await this.buildOpenAIMessages(messages, options);

      const isOllama = isOllamaEndpoint(this.config.endpoint);
      const thinkingEnabled = options.enableThinking !== false;

      // Route Ollama through its native /api/chat which supports think: true/false
      if (isOllama) {
        return this.generateOllamaChat(openaiMessages, options, callbacks, signal);
      }

      const requestBody = this.buildRequestBody(openaiMessages, options, thinkingEnabled);

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      // Make the streaming request
      let baseUrl = this.config.endpoint;
      while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      const url = `${baseUrl}/v1/chat/completions`;

      let fullContent = '';
      let fullReasoningContent = '';
      let toolCalls: OpenAIToolCall[] = [];
      let currentToolCall: Partial<OpenAIToolCall> | null = null;
      let completeCalled = false;
      let streamErrorOccurred = false;
      const thinkTagParser = new ThinkTagParser();

      await createStreamingRequest(
        url,
        requestBody,
        headers,
        (event) => {
          if (signal.aborted) return;

          const message = parseOpenAIMessage(event);
          if (!message) return;

          // Handle errors — abort the XHR so no further events arrive
          if (message.error) {
            streamErrorOccurred = true;
            callbacks.onError(new Error(message.error.message || 'API error'));
            this.abortController?.abort();
            return;
          }

          // Handle completion
          if (message.object === 'done') {
            return;
          }

          // Handle streaming chunks
          if (message.choices && message.choices.length > 0) {
            const choice = message.choices[0];
            const delta = choice.delta;

            if (delta) {
              // Text content — run through ThinkTagParser to extract embedded <think> blocks
              if (delta.content) {
                thinkTagParser.process(
                  delta.content,
                  (text) => { fullContent += text; callbacks.onToken(text); },
                  (reasoning) => {
                    if (thinkingEnabled) {
                      fullReasoningContent += reasoning;
                      callbacks.onReasoning?.(reasoning);
                    }
                  },
                );
              }

              // Reasoning content — check all known field names across providers:
              // - delta.reasoning_content (LM Studio)
              // - delta.reasoning         (Ollama /v1/chat/completions)
              // - delta.thinking          (Ollama /api/chat native, kept as fallback)
              const reasoningDelta = delta.reasoning_content || delta.reasoning || delta.thinking;
              if (reasoningDelta && thinkingEnabled) {
                fullReasoningContent += reasoningDelta;
                callbacks.onReasoning?.(reasoningDelta);
              }

              // Tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.id) {
                    // New tool call
                    currentToolCall = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
                    toolCalls.push(currentToolCall as OpenAIToolCall);
                  }
                  if (tc.function?.name) {
                    if (currentToolCall) {
                      currentToolCall.function!.name = tc.function.name;
                    }
                  }
                  if (tc.function?.arguments) {
                    if (currentToolCall) {
                      currentToolCall.function!.arguments += tc.function.arguments;
                    }
                  }
                }
              }
            }

            // Check for finish reason
            if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
              // Generation complete
              completeCalled = true;
              callbacks.onComplete({
                content: fullContent,
                reasoningContent: fullReasoningContent || undefined,
                meta: {
                  gpu: false,
                  gpuBackend: 'Remote',
                },
                toolCalls: toolCalls.filter(tc => tc.function?.name).length > 0
                  ? toolCalls.filter(tc => tc.function?.name).map(tc => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  })) : undefined,
              });
            }
          }
        },
        300000, // 5 minute timeout
        signal
      );

      // Fallback: if stream ended without a recognised finish_reason (e.g. 'length',
      // 'content_filter', null), ensure the generation is finalised.
      // Skip if an error was already reported or the stream was aborted by the user.
      const completedToolCalls = toolCalls.filter(tc => tc.function?.name);
      if (!completeCalled && !streamErrorOccurred) {
        callbacks.onComplete({
          content: fullContent,
          reasoningContent: fullReasoningContent || undefined,
          meta: { gpu: false, gpuBackend: 'Remote' },
          toolCalls: completedToolCalls.length > 0 ? completedToolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })) : undefined,
        });
      }
    } catch (error) {
      if (signal.aborted) {
        // Cancelled by user
        callbacks.onComplete({
          content: '',
          meta: { gpu: false },
        });
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError(err);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Generate using Ollama's native /api/chat endpoint (NDJSON streaming).
   * Supports think: true/false for reasoning control.
   */
  private async generateOllamaChat(
    openaiMessages: OpenAIChatMessage[],
    options: GenerationOptions,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const thinkingEnabled = options.enableThinking !== false;

    // Convert to Ollama message format (plain string content)
    const ollamaMessages = openaiMessages.map(m => {
      const content = typeof m.content === 'string'
        ? m.content
        : (m.content as OpenAIContentPart[]).find(p => p.type === 'text')?.text ?? '';
      return {
        role: m.role,
        content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      };
    });

    const requestBody: Record<string, unknown> = {
      model: this.config.modelId,
      messages: ollamaMessages,
      stream: true,
      think: thinkingEnabled,
      ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
      options: {
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { num_predict: options.maxTokens }),
        ...(options.topP !== undefined && { top_p: options.topP }),
      },
    };

    let baseUrl = this.config.endpoint;
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const url = `${baseUrl}/api/chat`;

    let fullContent = '';
    let fullReasoningContent = '';
    let completeCalled = false;
    let streamErrorOccurred = false;

    try {
      await createNDJSONStreamingRequest(
        url,
        requestBody,
        (line) => {
          if (signal.aborted) return;

          if (line.error) {
            streamErrorOccurred = true;
            callbacks.onError(new Error(String(line.error)));
            this.abortController?.abort();
            return;
          }

          const msg = line.message as { role?: string; content?: string; thinking?: string; tool_calls?: OpenAIToolCall[] } | undefined;
          if (msg) {
            if (msg.thinking) {
              fullReasoningContent += msg.thinking;
              callbacks.onReasoning?.(msg.thinking);
            }
            if (msg.content) {
              fullContent += msg.content;
              callbacks.onToken(msg.content);
            }
          }

          if (line.done) {
            completeCalled = true;
            const toolCalls = (msg?.tool_calls ?? []).filter(tc => tc.function?.name);
            callbacks.onComplete({
              content: fullContent,
              reasoningContent: fullReasoningContent || undefined,
              meta: { gpu: false, gpuBackend: 'Remote' },
              toolCalls: toolCalls.length > 0 ? toolCalls.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })) : undefined,
            });
          }
        },
        {},
        300000,
        signal
      );

      if (!completeCalled && !streamErrorOccurred) {
        callbacks.onComplete({
          content: fullContent,
          reasoningContent: fullReasoningContent || undefined,
          meta: { gpu: false, gpuBackend: 'Remote' },
        });
      }
    } catch (error) {
      if (signal.aborted) {
        callbacks.onComplete({ content: '', meta: { gpu: false } });
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Build OpenAI chat messages from app messages
   */
  private async buildOpenAIMessages(
    messages: Message[],
    options: GenerationOptions
  ): Promise<OpenAIChatMessage[]> {
    const openaiMessages: OpenAIChatMessage[] = [];

    // Check if messages array already contains a system message
    const hasSystemMessage = messages.some(m => m.role === 'system');

    // Add system prompt if provided and no system message exists in messages
    const systemPrompt = options.systemPrompt || useAppStore.getState().settings.systemPrompt;
    if (systemPrompt && !hasSystemMessage) {
      openaiMessages.push({
        role: 'system',
        content: [{ type: 'text', text: systemPrompt }],
      });
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        openaiMessages.push({
          role: 'system',
          content: [{ type: 'text', text: msg.content }],
        });
        continue;
      }

      if (msg.role === 'tool') {
        // Tool result — wrap as array so models with strict Jinja templates (e.g. qwen3.5)
        // that iterate over message['content'] don't fail on plain strings
        openaiMessages.push({
          role: 'tool',
          content: [{ type: 'text', text: msg.content }],
          tool_call_id: msg.toolCallId || '',
        });
        continue;
      }

      // User or assistant
      const _hasAttachments = msg.attachments && msg.attachments.length > 0;
      const hasImages = msg.attachments?.some(a => a.type === 'image');

      if (msg.role === 'user' && hasImages && this.modelCapabilities.supportsVision) {
        // Build multimodal content
        const content: OpenAIContentPart[] = [];

        // Add text first
        content.push({ type: 'text', text: msg.content });

        // Add images
        for (const attachment of msg.attachments || []) {
          if (attachment.type === 'image') {
            try {
              const dataUrl = await imageToBase64DataUrl(attachment.uri);
              content.push({
                type: 'image_url',
                image_url: { url: dataUrl },
              });
            } catch (error) {
              logger.warn('[OpenAIProvider] Failed to encode image:', error);
            }
          }
        }

        openaiMessages.push({
          role: 'user',
          content,
        });
      } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant with tool calls
        openaiMessages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id || `call_${generateId()}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        });
      } else if (msg.role === 'user') {
        // Wrap user content as array — some model templates (e.g. qwen3.5) require
        // message['content'] to be iterable, not a plain string
        openaiMessages.push({
          role: 'user',
          content: [{ type: 'text', text: msg.content }],
        });
      } else {
        // Assistant text message
        openaiMessages.push({
          role: 'assistant',
          content: msg.content,
        });
      }
    }

    return openaiMessages;
  }

  async stopGeneration(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async getTokenCount(text: string): Promise<number> {
    // Approximate token count for remote providers
    // Most models use ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  async isReady(): Promise<boolean> {
    return !!this.config.modelId && !!this.config.endpoint;
  }

  async dispose(): Promise<void> {
    await this.stopGeneration();
    this.config.modelId = '';
  }
}

/**
 * Factory to create an OpenAI-compatible provider
 */
export function createOpenAIProvider(
  serverId: string,
  endpoint: string,
  apiKey?: string,
  modelId?: string
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(serverId, {
    endpoint,
    apiKey,
    modelId: modelId || '',
  });
}