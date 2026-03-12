/* eslint-disable max-lines */
/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop } from './generationToolLoop';
import type { ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';
import { shouldShowSharePrompt, emitSharePrompt } from '../utils/sharePrompt';

const SHARE_PROMPT_DELAY_MS = 1500;
type StreamChunk = string | { content?: string; reasoningContent?: string };

export interface QueuedMessage {
  id: string; conversationId: string; text: string;
  attachments?: MediaAttachment[]; messageText: string;
}

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  queuedMessages: QueuedMessage[];
}

type GenerationListener = (state: GenerationState) => void;
type QueueProcessor = (item: QueuedMessage) => Promise<void>;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false, isThinking: false, conversationId: null,
    streamingContent: '', startTime: null, queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  private pendingStop: Promise<void> | null = null;
  private queueProcessor: QueueProcessor | null = null;
  private currentRemoteAbortController: AbortController | null = null;
  private remoteTimeToFirstToken: number | undefined;

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private reasoningBuffer: string = '';
  private totalReasoningLength: number = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 50; // ~20 updates/sec

  /** Get the current provider (local or remote) */
  private getCurrentProvider() {
    const activeServerId = useRemoteServerStore.getState().activeServerId;
    if (activeServerId) {
      return providerRegistry.getProvider(activeServerId);
    }
    return providerRegistry.getProvider('local');
  }

  /** Check if using a remote provider */
  private isUsingRemoteProvider(): boolean {
    const { activeServerId } = useRemoteServerStore.getState();
    const hasProvider = activeServerId ? providerRegistry.hasProvider(activeServerId) : false;
    const localLoaded = llmService.isModelLoaded();
    if (!activeServerId) return false;
    // Provider must be registered (not just persisted from a previous session)
    if (!hasProvider) return false;
    // If a local model is loaded, prefer it over the remote server.
    // Log a warning so this is diagnosable if a user selects remote but gets local responses.
    if (localLoaded) {
      logger.warn('[GenerationService] Local model is loaded — preferring local over active remote server:', activeServerId);
      return false;
    }
    return true;
  }

  private flushTokenBuffer(): void {
    const store = useChatStore.getState();
    if (this.tokenBuffer) {
      store.appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
    }
    if (this.reasoningBuffer) {
      store.appendToStreamingReasoningContent(this.reasoningBuffer);
      this.reasoningBuffer = '';
    }
    this.flushTimer = null;
  }

  private forceFlushTokens(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTokenBuffer();
  }

  private normalizeStreamChunk(data: StreamChunk): { content?: string; reasoningContent?: string } {
    return typeof data === 'string' ? { content: data } : data;
  }

  getState(): GenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void { this.listeners.forEach(l => l(this.getState())); }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private checkSharePrompt(delayMs = SHARE_PROMPT_DELAY_MS): void {
    const s = useAppStore.getState();
    if (s.hasEngagedSharePrompt) return;
    if (shouldShowSharePrompt(s.incrementTextGenerationCount())) setTimeout(() => emitSharePrompt('text'), delayMs);
  }

  private buildToolLoopHandlers() {
    return {
      isAborted: () => this.abortRequested,
      onThinkingDone: () => this.updateState({ isThinking: false }),
      onStream: (data: StreamChunk) => {
        if (this.abortRequested) return;
        const chunk = this.normalizeStreamChunk(data);
        if (chunk.content) {
          if (!this.state.streamingContent && this.remoteTimeToFirstToken === undefined) {
            this.remoteTimeToFirstToken = this.state.startTime ? (Date.now() - this.state.startTime) / 1000 : undefined;
          }
          this.state.streamingContent += chunk.content;
          this.tokenBuffer += chunk.content;
        }
        if (chunk.reasoningContent) {
          this.reasoningBuffer += chunk.reasoningContent;
          this.totalReasoningLength += chunk.reasoningContent.length;
        }
        if (!this.flushTimer) {
          this.flushTimer = setTimeout(
            () => this.flushTokenBuffer(),
            GenerationService.FLUSH_INTERVAL_MS,
          );
        }
      },
      onStreamReset: () => {
        this.forceFlushTokens();
        this.state.streamingContent = '';
        this.tokenBuffer = '';
      },
      onFinalResponse: (content: string) => {
        this.state.streamingContent = content;
        useChatStore.getState().appendToStreamingMessage(content);
      },
    };
  }

  private buildGenerationMeta(): GenerationMeta {
    // For remote providers, return basic metadata with token estimation
    if (this.isUsingRemoteProvider()) {
      const remoteStore = useRemoteServerStore.getState();
      const activeServer = remoteStore.getActiveServer();
      const _modelId = providerRegistry.getActiveProvider().getLoadedModelId();

      // Estimate token count from streaming content (roughly 4 chars per token), including reasoning tokens
      const contentLength = this.state.streamingContent.length + this.totalReasoningLength;
      const estimatedTokens = Math.ceil(contentLength / 4);
      const generationTime = this.state.startTime ? (Date.now() - this.state.startTime) / 1000 : 0;
      const tokensPerSecond = generationTime > 0 ? estimatedTokens / generationTime : undefined;

      return {
        gpu: false,
        gpuBackend: 'Remote',
        modelName: activeServer?.name || 'Remote Model',
        tokenCount: estimatedTokens,
        tokensPerSecond,
        timeToFirstToken: this.remoteTimeToFirstToken,
      };
    }

    // Local provider metadata
    const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
    const perf = llmService.getPerformanceStats();
    const { downloadedModels, activeModelId, settings } = useAppStore.getState();
    return {
      gpu, gpuBackend, gpuLayers,
      modelName: downloadedModels.find(m => m.id === activeModelId)?.name,
      tokensPerSecond: perf.lastTokensPerSecond,
      decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
      timeToFirstToken: perf.lastTimeToFirstToken,
      tokenCount: perf.lastTokenCount,
      cacheType: settings.cacheType,
    };
  }

  /** Shared pre-generation setup: guard, state init, drain pending stop, validate provider. */
  private async prepareGeneration(conversationId: string): Promise<boolean> {
    if (this.state.isGenerating) {
      return false;
    }
    this.updateState({
      isGenerating: true, isThinking: true, conversationId,
      streamingContent: '', startTime: Date.now(),
    });
    useChatStore.getState().startStreaming(conversationId);
    // Drain pending native stop so LLM is idle before we start.
    if (this.pendingStop !== null) await this.pendingStop;
    if (!this.state.isGenerating) return false; // stop called during drain
    this.abortRequested = false;

    // Check provider readiness
    if (this.isUsingRemoteProvider()) {
      const provider = this.getCurrentProvider();
      if (!provider) {
        this.resetState();
        throw new Error('Remote provider not found');
      }
      const ready = await provider.isReady();
      if (!ready) {
        this.resetState();
        throw new Error('Remote provider not ready');
      }
    } else {
      if (!llmService.isModelLoaded()) { this.resetState(); throw new Error('No model loaded'); }
      if (llmService.isCurrentlyGenerating()) { this.resetState(); throw new Error('LLM service busy'); }
    }

    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    return true;
  }

  /** Generate a response for a conversation. Runs independently of UI lifecycle. */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void
  ): Promise<void> {
    // Route to remote provider if active
    if (this.isUsingRemoteProvider()) {
      return this.generateRemoteResponse(conversationId, messages, onFirstToken);
    }

    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();
    let firstTokenReceived = false;

    try {
      await llmService.generateResponse(
        messages,
        (data) => {
          if (this.abortRequested) return;
          const chunk = this.normalizeStreamChunk(data);
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            this.updateState({ isThinking: false });
            onFirstToken?.();
          }
          if (chunk.content) {
            this.state.streamingContent += chunk.content;
            this.tokenBuffer += chunk.content;
          }
          if (chunk.reasoningContent) {
            this.reasoningBuffer += chunk.reasoningContent;
          }
          if (!this.flushTimer) {
            this.flushTimer = setTimeout(
              () => this.flushTokenBuffer(),
              GenerationService.FLUSH_INTERVAL_MS,
            );
          }
        },
        () => {
          // If aborted, stopGeneration() already handled cleanup — don't clobber new generation state.
          if (this.abortRequested) return;
          this.forceFlushTokens();
          const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
          chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
          this.checkSharePrompt();
          this.resetState();
        },
      );
    } catch (error) {
      if (this.abortRequested) return;
      logger.error('[GenerationService] Generation error:', error);
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.tokenBuffer = '';
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    }
  }

  /** Generate a response with tool calling support (LLM → tools → repeat, max 5 iterations). */
  async generateWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    // Route to remote provider if active
    if (this.isUsingRemoteProvider()) {
      return this.generateRemoteWithTools(conversationId, messages, options);
    }
    // Local generation with tools
    const { enabledToolIds, projectId, ...callbacks } = options;
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();

    try {
      await runToolLoop({
        conversationId,
        messages,
        enabledToolIds,
        projectId,
        callbacks,
        ...this.buildToolLoopHandlers(),
      });

      // If aborted, stopGeneration() already handled cleanup.
      if (!this.abortRequested) {
        this.forceFlushTokens();
        const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
        useChatStore.getState().finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
        this.checkSharePrompt();
        this.resetState();
      }
    } catch (error) {
      if (this.abortRequested) return;
      logger.error('[GenerationService] Tool generation error:', error);
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.tokenBuffer = '';
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    }
  }

  /** Stop the current generation. Returns partial content if any was generated. */
  async stopGeneration(): Promise<string> {
    if (!this.state.isGenerating) {
      // Stop both local and remote
      await llmService.stopGeneration().catch(() => {});
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => {});
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      return '';
    }

    // Set abort flag BEFORE stopping so the onComplete callback
    // knows we're stopping and won't finalize/reset on its own.
    this.abortRequested = true;
    this.forceFlushTokens();

    const { conversationId, streamingContent, startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;

    const chatStore = useChatStore.getState();
    if (conversationId && streamingContent.trim()) {
      chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
      this.checkSharePrompt();
    } else {
      chatStore.clearStreamingMessage();
    }

    this.resetState();

    // Stop both local and remote
    if (this.isUsingRemoteProvider()) {
      // Abort the provider's XHR so the server connection is closed immediately
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => {});
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      return streamingContent;
    }

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    this.pendingStop = llmService.stopGeneration().catch(() => {}).finally(() => {
      this.pendingStop = null;
    });

    return streamingContent;
  }

  /** Generate a response using a remote provider */
  async generateRemoteResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void
  ): Promise<void> {
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();
    const provider = this.getCurrentProvider();

    if (!provider) {
      this.resetState();
      throw new Error('No remote provider available');
    }
    let firstTokenReceived = false;
    this.remoteTimeToFirstToken = undefined;

    this.currentRemoteAbortController = new AbortController();
    // Capture signal per-generation so callbacks stay guarded even after
    // abortRequested is reset by the next generation's prepareGeneration().
    const { signal: generationSignal } = this.currentRemoteAbortController;

    const { temperature, maxTokens, topP, thinkingEnabled } = useAppStore.getState().settings;
    const options: GenerationOptions = {
      temperature,
      maxTokens,
      topP,
      stopSequences: [],
      enableThinking: thinkingEnabled,
    };

    try {
      await provider.generate(
        messages,
        options,
        {
          onToken: (token: string) => {
            if (generationSignal.aborted) return;
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              this.remoteTimeToFirstToken = this.state.startTime ? (Date.now() - this.state.startTime) / 1000 : undefined;
              this.updateState({ isThinking: false });
              onFirstToken?.();
            }
            this.state.streamingContent += token;
            this.tokenBuffer += token;
            if (!this.flushTimer) {
              this.flushTimer = setTimeout(
                () => this.flushTokenBuffer(),
                GenerationService.FLUSH_INTERVAL_MS,
              );
            }
          },
          onReasoning: (content: string) => {
            if (generationSignal.aborted) return;
            this.reasoningBuffer += content;
            this.totalReasoningLength += content.length;
            if (!this.flushTimer) {
              this.flushTimer = setTimeout(
                () => this.flushTokenBuffer(),
                GenerationService.FLUSH_INTERVAL_MS,
              );
            }
          },
          onComplete: (_result: CompletionResult) => {
            if (generationSignal.aborted) return;
            this.forceFlushTokens();
            const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
            chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
            this.checkSharePrompt();
            this.resetState();
          },
          onError: (error: Error) => {
            if (generationSignal.aborted) return;
            logger.error('[GenerationService] Remote generation error:', error);
            if (this.flushTimer) {
              clearTimeout(this.flushTimer);
              this.flushTimer = null;
            }
            this.tokenBuffer = '';
            chatStore.clearStreamingMessage();
            this.resetState();
            throw error;
          },
        }
      );
    } catch (error) {
      if (generationSignal.aborted) return;
      logger.error('[GenerationService] Remote generation error:', error);
      // Mark server as offline so the Remote Servers screen reflects the failure
      const failedServerId = useRemoteServerStore.getState().activeServerId;
      if (failedServerId) {
        useRemoteServerStore.getState().updateServerHealth(failedServerId, false);
      }
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.tokenBuffer = '';
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    } finally {
      this.currentRemoteAbortController = null;
    }
  }

  /** Generate a response with tools using a remote provider */
  async generateRemoteWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    // For remote providers with tools, we delegate to the provider
    // The provider handles the tool calling format (OpenAI-style)
    // and we use runToolLoop for tool execution

    if (!(await this.prepareGeneration(conversationId))) return;
    const provider = this.getCurrentProvider();

    if (!provider) {
      this.resetState();
      throw new Error('No remote provider available');
    }

    const { enabledToolIds, projectId, ...callbacks } = options;

    // Use the same tool loop but with remote provider
    await runToolLoop({
      conversationId,
      messages,
      enabledToolIds,
      projectId,
      callbacks,
      ...this.buildToolLoopHandlers(),
      forceRemote: true,
    });

    if (!this.abortRequested) {
      this.forceFlushTokens();
      const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
      useChatStore.getState().finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
      this.checkSharePrompt();
      this.resetState();
    }
  }

  enqueueMessage(entry: QueuedMessage): void {
    this.state = { ...this.state, queuedMessages: [...this.state.queuedMessages, entry] };
    this.notifyListeners();
  }

  removeFromQueue(id: string): void {
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.id !== id) };
    this.notifyListeners();
  }

  clearQueue(): void { this.state = { ...this.state, queuedMessages: [] }; this.notifyListeners(); }

  setQueueProcessor(processor: QueueProcessor | null): void { this.queueProcessor = processor; }

  private processNextInQueue(): void {
    if (this.state.queuedMessages.length === 0 || !this.queueProcessor) return;
    const all = this.state.queuedMessages;
    this.state = { ...this.state, queuedMessages: [] };
    this.notifyListeners();
    const combined: QueuedMessage = all.length === 1 ? all[0] : {
      id: all[0].id, conversationId: all[0].conversationId,
      text: all.map(m => m.text).join('\n\n'),
      attachments: all.flatMap(m => m.attachments || []),
      messageText: all.map(m => m.messageText).join('\n\n'),
    };
    this.queueProcessor(combined).catch(e => { logger.error('[GenerationService] Queue processor error:', e); });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    this.updateState({
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
    });
    if (hasQueuedItems) {
      setTimeout(() => this.processNextInQueue(), 100);
    }
  }
}

export const generationService = new GenerationService();
