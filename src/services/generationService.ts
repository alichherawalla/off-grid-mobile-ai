/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop } from './generationToolLoop';
import type { ToolResult } from './tools/types';
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

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private reasoningBuffer: string = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 50; // ~20 updates/sec

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

  private buildGenerationMeta(): GenerationMeta {
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

  /** Shared pre-generation setup: guard, state init, drain pending stop, validate LLM. */
  private async prepareGeneration(conversationId: string): Promise<boolean> {
    if (this.state.isGenerating) {
      logger.log('[GenerationService] Already generating, ignoring request');
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
    if (!llmService.isModelLoaded()) { this.resetState(); throw new Error('No model loaded'); }
    if (llmService.isCurrentlyGenerating()) { this.resetState(); throw new Error('LLM service busy'); }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    return true;
  }

  /** Generate a response for a conversation. Runs independently of UI lifecycle. */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void
  ): Promise<void> {
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();
    logger.log('[GenerationService] Starting text generation');
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
          logger.log('[GenerationService] Text generation completed');
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
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    const { enabledToolIds, ...callbacks } = options;
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();

    try {
      await runToolLoop({
        conversationId,
        messages,
        enabledToolIds,
        callbacks,
        isAborted: () => this.abortRequested,
        onThinkingDone: () => this.updateState({ isThinking: false }),
        onStream: (data) => {
          if (this.abortRequested) return;
          const chunk = this.normalizeStreamChunk(data);
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
        onStreamReset: () => {
          this.forceFlushTokens();
          this.state.streamingContent = '';
          this.tokenBuffer = '';
        },
        onFinalResponse: (content) => {
          this.state.streamingContent = content;
          useChatStore.getState().appendToStreamingMessage(content);
        },
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
      await llmService.stopGeneration().catch(() => {});
      return '';
    }

    // Set abort flag BEFORE stopping LLM so the onComplete callback
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

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    this.pendingStop = llmService.stopGeneration().catch(() => {}).finally(() => {
      this.pendingStop = null;
    });

    return streamingContent;
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
