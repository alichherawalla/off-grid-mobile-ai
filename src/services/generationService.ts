/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop } from './generationToolLoop';
import type { ToolResult } from './tools/types';
import logger from '../utils/logger';

export interface QueuedMessage {
  id: string;
  conversationId: string;
  text: string;
  attachments?: MediaAttachment[];
  messageText: string;
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
    isGenerating: false,
    isThinking: false,
    conversationId: null,
    streamingContent: '',
    startTime: null,
    queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  private queueProcessor: QueueProcessor | null = null;

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 50; // ~20 updates/sec

  private flushTokenBuffer(): void {
    if (this.tokenBuffer) {
      useChatStore.getState().appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
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

  getState(): GenerationState {
    return { ...this.state };
  }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private buildGenerationMeta(): GenerationMeta {
    const gpuInfo = llmService.getGpuInfo();
    const perfStats = llmService.getPerformanceStats();
    const { downloadedModels, activeModelId, settings } = useAppStore.getState();
    const activeModel = downloadedModels.find(m => m.id === activeModelId);
    return {
      gpu: gpuInfo.gpu,
      gpuBackend: gpuInfo.gpuBackend,
      gpuLayers: gpuInfo.gpuLayers,
      modelName: activeModel?.name,
      tokensPerSecond: perfStats.lastTokensPerSecond,
      decodeTokensPerSecond: perfStats.lastDecodeTokensPerSecond,
      timeToFirstToken: perfStats.lastTimeToFirstToken,
      tokenCount: perfStats.lastTokenCount,
      cacheType: settings.cacheType,
    };
  }

  /**
   * Generate a response for a conversation.
   * Runs independently of UI — continues even if user navigates away.
   */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void
  ): Promise<void> {
    if (this.state.isGenerating) {
      logger.log('[GenerationService] Already generating, ignoring request');
      return;
    }

    if (!llmService.isModelLoaded()) throw new Error('No model loaded');
    if (llmService.isCurrentlyGenerating()) throw new Error('LLM service busy - try again in a moment');
    logger.log('[GenerationService] Starting text generation');

    this.abortRequested = false;
    this.updateState({
      isGenerating: true,
      isThinking: true,
      conversationId,
      streamingContent: '',
      startTime: Date.now(),
    });

    const chatStore = useChatStore.getState();
    chatStore.startStreaming(conversationId);
    this.tokenBuffer = '';
    let firstTokenReceived = false;

    try {
      logger.log('[GenerationService] Calling llmService.generateResponse');
      await llmService.generateResponse(
        messages,
        (token) => {
          if (this.abortRequested) return;
          if (!firstTokenReceived) {
            firstTokenReceived = true;
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
        () => {
          logger.log('[GenerationService] Text generation completed');
          this.forceFlushTokens();
          if (this.abortRequested) {
            chatStore.clearStreamingMessage();
          } else {
            const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
            chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
          }
          this.resetState();
        },
      );
    } catch (error) {
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

  /**
   * Generate a response with tool calling support.
   * Loops: call LLM → if tool_calls, execute tools, inject results, repeat (max 5 iterations).
   */
  async generateWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    const { enabledToolIds, ...callbacks } = options;
    if (this.state.isGenerating) {
      logger.log('[GenerationService] Already generating, ignoring request');
      return;
    }

    if (!llmService.isModelLoaded()) throw new Error('No model loaded');
    if (llmService.isCurrentlyGenerating()) throw new Error('LLM service busy');

    this.abortRequested = false;
    this.updateState({
      isGenerating: true,
      isThinking: true,
      conversationId,
      streamingContent: '',
      startTime: Date.now(),
    });

    const chatStore = useChatStore.getState();
    chatStore.startStreaming(conversationId);
    this.tokenBuffer = '';

    try {
      await runToolLoop({
        conversationId,
        messages,
        enabledToolIds,
        callbacks,
        isAborted: () => this.abortRequested,
        onThinkingDone: () => this.updateState({ isThinking: false }),
        onFinalResponse: (content) => {
          this.state.streamingContent = content;
          useChatStore.getState().appendToStreamingMessage(content);
        },
      });

      this.forceFlushTokens();
      if (this.abortRequested) {
        chatStore.clearStreamingMessage();
      } else {
        const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
        useChatStore.getState().finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
      }
      this.resetState();
    } catch (error) {
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

  /**
   * Stop the current generation.
   * Returns the partial content if any was generated.
   */
  async stopGeneration(): Promise<string> {
    await llmService.stopGeneration().catch(() => {});
    if (!this.state.isGenerating) return '';

    this.forceFlushTokens();

    const { conversationId, streamingContent, startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;
    this.abortRequested = true;

    const chatStore = useChatStore.getState();
    if (conversationId && streamingContent.trim()) {
      chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
    } else {
      chatStore.clearStreamingMessage();
    }

    this.resetState();
    return streamingContent;
  }

  /** Add a message to the queue (processed after current generation completes) */
  enqueueMessage(entry: QueuedMessage): void {
    this.state = { ...this.state, queuedMessages: [...this.state.queuedMessages, entry] };
    this.notifyListeners();
  }

  /** Remove a specific message from the queue */
  removeFromQueue(id: string): void {
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.id !== id) };
    this.notifyListeners();
  }

  /** Clear all queued messages */
  clearQueue(): void {
    this.state = { ...this.state, queuedMessages: [] };
    this.notifyListeners();
  }

  /** Register a callback that processes queued messages. ChatScreen sets this on mount/unmount. */
  setQueueProcessor(processor: QueueProcessor | null): void {
    this.queueProcessor = processor;
  }

  /**
   * Drain all queued messages, aggregate into a single combined message, and call the processor once.
   */
  private processNextInQueue(): void {
    if (this.state.queuedMessages.length === 0 || !this.queueProcessor) return;

    const all = this.state.queuedMessages;
    this.state = { ...this.state, queuedMessages: [] };
    this.notifyListeners();

    const combined: QueuedMessage = all.length === 1
      ? all[0]
      : {
          id: all[0].id,
          conversationId: all[0].conversationId,
          text: all.map(m => m.text).join('\n\n'),
          attachments: all.flatMap(m => m.attachments || []),
          messageText: all.map(m => m.messageText).join('\n\n'),
        };

    this.queueProcessor(combined).catch(error => {
      logger.error('[GenerationService] Queue processor error:', error);
    });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
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
