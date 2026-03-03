import { LlamaContext, RNLlamaOAICompatibleMessage } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { Message } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores';
import {
  initContextWithFallback, captureGpuInfo, logContextMetadata, getModelMaxContext,
  initMultimodal, checkContextMultimodal,
  recordGenerationStats,
  hashString, ensureSessionCacheDir, getSessionPath, buildModelParams,
  buildCompletionParams, createThinkInjector, getMaxContextForDevice, getGpuLayersForDevice, BYTES_PER_GB,
} from './llmHelpers';
import { hardwareService } from './hardware';
import { formatLlamaMessages, extractImageUris, buildOAIMessages } from './llmMessages';
import { generateWithToolsImpl } from './llmToolGeneration';
import type { ToolCall } from './tools/types';

export type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import type { MultimodalSupport, LLMPerformanceSettings, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;

class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private isGenerating: boolean = false;
  private multimodalSupport: MultimodalSupport | null = null;
  private multimodalInitialized: boolean = false;
  private performanceStats: LLMPerformanceStats = {
    lastTokensPerSecond: 0, lastDecodeTokensPerSecond: 0,
    lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 0,
  };
  private currentSettings: LLMPerformanceSettings = {
    nThreads: Platform.OS === 'android' ? 6 : 4,
    nBatch: 512,
    contextLength: 2048,
  };
  private gpuEnabled: boolean = false;
  private gpuReason: string = '';
  private gpuDevices: string[] = [];
  private activeGpuLayers: number = 0;
  private toolCallingSupported: boolean = false;
  private thinkingSupported: boolean = false;
  private lastSystemPromptHash: string | null = null;
  private sessionCacheDir: string = `${RNFS.CachesDirectoryPath}/llm-sessions`;

  private hashString(str: string): string { return hashString(str); }
  private ensureSessionCacheDir(): Promise<void> { return ensureSessionCacheDir(this.sessionCacheDir); }
  private getSessionPath(promptHash: string): string { return getSessionPath(this.sessionCacheDir, promptHash); }

  async loadModel(modelPath: string, mmProjPath?: string): Promise<void> {
    if (this.context && this.currentModelPath !== modelPath) await this.unloadModel();
    if (this.context && this.currentModelPath === modelPath) return;
    if (!await RNFS.exists(modelPath)) throw new Error(`Model file not found at: ${modelPath}`);
    if (mmProjPath && !await RNFS.exists(mmProjPath)) {
      logger.warn('[LLM] MMProj file not found, disabling vision support');
      mmProjPath = undefined;
    }
    const { settings } = useAppStore.getState();
    const { baseParams, nThreads, nBatch, ctxLen, nGpuLayers } = buildModelParams(modelPath, settings);
    this.currentSettings = { nThreads, nBatch, contextLength: ctxLen };
    logger.log(`[LLM] Loading model: ctx=${ctxLen}, threads=${nThreads}, batch=${nBatch}`);
    try {
      const result = await this.initWithAutoContext({ baseParams, ctxLen, nGpuLayers });
      const { context, gpuAttemptFailed, actualLength } = result;
      this.context = context;
      if (actualLength !== ctxLen) this.currentSettings.contextLength = actualLength;
      logContextMetadata(context, actualLength);
      useAppStore.getState().setModelMaxContext(getModelMaxContext(context));
      Object.assign(this, captureGpuInfo(context, gpuAttemptFailed, nGpuLayers));
      logger.log(`[LLM] Native lib: ${(context as any).androidLib || 'N/A'}`);
      this.currentModelPath = modelPath;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;
      logger.log('[LLM] mmProjPath:', mmProjPath || 'none');
      if (mmProjPath) await this.initializeMultimodal(mmProjPath);
      else await this.checkMultimodalSupport();
      this.detectToolCallingSupport();
      this.detectThinkingSupport();
      logger.log(`[LLM] Model loaded, vision: ${this.supportsVision()}, tools: ${this.toolCallingSupported}, thinking: ${this.thinkingSupported}`);
    } catch (error: any) {
      this.context = null;
      this.currentModelPath = null;
      this.multimodalSupport = null;
      this.toolCallingSupported = false;
      this.thinkingSupported = false;
      Object.assign(this, { gpuEnabled: false, gpuReason: '', activeGpuLayers: 0, gpuDevices: [] });
      throw new Error(error?.message || 'Unknown error loading model');
    }
  }

  /** Auto-scale context and cap GPU layers based on device RAM to prevent abort() on low-RAM devices. */
  private async initWithAutoContext(
    params: { baseParams: object; ctxLen: number; nGpuLayers: number },
  ): Promise<{ context: LlamaContext; gpuAttemptFailed: boolean; actualLength: number }> {
    const deviceInfo = await hardwareService.getDeviceInfo();
    const safeGpuLayers = getGpuLayersForDevice(deviceInfo.totalMemory, params.nGpuLayers);
    if (safeGpuLayers !== params.nGpuLayers) {
      logger.log(`[LLM] Low RAM (${(deviceInfo.totalMemory / BYTES_PER_GB).toFixed(1)}GB), GPU layers ${params.nGpuLayers} → ${safeGpuLayers}`);
    }
    const initial = await initContextWithFallback(params.baseParams, params.ctxLen, safeGpuLayers);
    const modelMax = getModelMaxContext(initial.context);
    const userIsOnDefault = this.currentSettings.contextLength === APP_CONFIG.maxContextLength;
    if (!modelMax || !userIsOnDefault || modelMax <= initial.actualLength) return initial;
    const deviceMaxCtx = getMaxContextForDevice(deviceInfo.totalMemory);
    const targetCtx = Math.min(modelMax, 4096, deviceMaxCtx);
    if (targetCtx <= initial.actualLength) return initial;
    logger.log(`[LLM] Model supports ${modelMax} ctx, RAM cap ${deviceMaxCtx}, scaling ${initial.actualLength} → ${targetCtx}`);
    await initial.context.release();
    return initContextWithFallback(params.baseParams, targetCtx, safeGpuLayers);
  }

  async initializeMultimodal(mmProjPath: string): Promise<boolean> {
    if (!this.context) { logger.warn('[LLM] initializeMultimodal: no context'); return false; }
    try {
      const stat = await RNFS.stat(mmProjPath);
      const sizeMB = (Number(stat.size) / (1024 * 1024)).toFixed(1);
      logger.log(`[LLM] mmproj file size: ${sizeMB} MB`);
      if (Number(stat.size) < 100 * 1024 * 1024) {
        console.warn(`[LLM] WARNING: mmproj file seems too small (${sizeMB} MB) - may be incomplete download!`);
      }
    } catch (statErr) {
      console.error('[LLM] Failed to stat mmproj file:', statErr);
    }
    const devInfo = useAppStore.getState().deviceInfo;
    const mem = devInfo?.totalMemory ?? 0;
    const useGpuForClip = Platform.OS === 'ios' && !devInfo?.isEmulator && mem > 4 * BYTES_PER_GB;
    logger.log('[LLM] Calling initMultimodal, use_gpu:', useGpuForClip);
    const { initialized, support } = await initMultimodal(this.context, mmProjPath, useGpuForClip);
    this.multimodalInitialized = initialized;
    this.multimodalSupport = support;
    return initialized;
  }

  async checkMultimodalSupport(): Promise<MultimodalSupport> {
    if (!this.context) { this.multimodalSupport = { vision: false, audio: false }; return this.multimodalSupport; }
    this.multimodalSupport = await checkContextMultimodal(this.context);
    return this.multimodalSupport;
  }

  getMultimodalSupport(): MultimodalSupport | null { return this.multimodalSupport; }
  supportsVision(): boolean { return this.multimodalSupport?.vision || false; }

  supportsToolCalling(): boolean { return this.toolCallingSupported; }
  supportsThinking(): boolean { return this.thinkingSupported; }

  private detectToolCallingSupport(): void {
    if (!this.context) { this.toolCallingSupported = false; return; }
    try {
      const model = (this.context as any)?.model;
      const jinja = model?.chatTemplates?.jinja;
      logger.log('[LLM] Chat template jinja:', JSON.stringify(jinja, null, 2));
      logger.log('[LLM] Chat template keys:', model?.chatTemplates ? Object.keys(model.chatTemplates) : 'none');
      this.toolCallingSupported = !!(jinja?.defaultCaps?.toolCalls || jinja?.toolUse || jinja?.toolUseCaps?.toolCalls);
      logger.log('[LLM] Tool calling supported:', this.toolCallingSupported);
    } catch (e) {
      logger.warn('[LLM] Error detecting tool calling support:', e);
      this.toolCallingSupported = false;
    }
  }

  private detectThinkingSupport(): void {
    if (!this.context) { this.thinkingSupported = false; return; }
    try {
      const model = (this.context as any)?.model;
      const metadata = model?.metadata || {};
      const template = metadata['tokenizer.chat_template'] || '';
      this.thinkingSupported = typeof template === 'string' && template.includes('<think>');
      logger.log('[LLM] Thinking supported:', this.thinkingSupported);
    } catch (_e) {
      this.thinkingSupported = false;
    }
  }

  async unloadModel(): Promise<void> {
    if (this.context) {
      await this.context.release();
      useAppStore.getState().setModelMaxContext(null);
      Object.assign(this, {
        context: null, currentModelPath: null, multimodalSupport: null,
        multimodalInitialized: false, toolCallingSupported: false,
        gpuEnabled: false, gpuReason: '', gpuDevices: [], activeGpuLayers: 0,
      });
    }
  }

  isModelLoaded(): boolean { return this.context !== null; }
  getLoadedModelPath(): string | null { return this.currentModelPath; }

  async generateResponse(
    messages: Message[],
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
  ): Promise<string> {
    if (!this.context) throw new Error('No model loaded');
    if (this.isGenerating) throw new Error('Generation already in progress');
    this.isGenerating = true;
    try {
      const managed = await this.manageContextWindow(messages);
      const hasImages = managed.some(m => m.attachments?.some(a => a.type === 'image'));
      const useMultimodal = hasImages && this.multimodalInitialized;
      if (hasImages && !this.multimodalInitialized) {
        logger.warn('[LLM] Images attached but multimodal not initialized - falling back to text-only');
      }
      logger.log('[LLM] Generation mode:', useMultimodal ? 'VISION' : 'TEXT-ONLY');
      const oaiMessages = this.convertToOAIMessages(managed);
      const { settings } = useAppStore.getState();
      const startTime = Date.now();
      let firstTokenMs = 0;
      let tokenCount = 0;
      let fullResponse = '';
      let firstReceived = false;
      const thinkStream = this.thinkingSupported && onStream
        ? createThinkInjector(t => onStream(t)) : null;
      await this.context.completion({
        messages: oaiMessages,
        ...buildCompletionParams(settings),
      }, (data) => {
        if (!this.isGenerating || !data.token) return;
        if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
        tokenCount++;
        fullResponse += data.token;
        if (thinkStream) { thinkStream(data.token); } else { onStream?.(data.token); }
      });
      this.performanceStats = recordGenerationStats(startTime, firstTokenMs, tokenCount);
      this.isGenerating = false;
      onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      this.isGenerating = false;
      throw error;
    }
  }

  async generateResponseWithTools(
    messages: Message[],
    options: { tools: any[]; onStream?: StreamCallback; onComplete?: CompleteCallback },
  ): Promise<{ fullResponse: string; toolCalls: ToolCall[] }> {
    return generateWithToolsImpl({
      context: this.context, isGenerating: this.isGenerating,
      manageContextWindow: (msgs, extra?) => this.manageContextWindow(msgs, extra),
      convertToOAIMessages: (msgs) => this.convertToOAIMessages(msgs),
      setPerformanceStats: (s) => { this.performanceStats = s; },
      setIsGenerating: (v) => { this.isGenerating = v; },
    }, messages, options);
  }

  /**
   * Pass all messages through to llama.rn and let its native context shifting
   * (ctx_shift) handle overflow. This preserves a stable prompt prefix between
   * turns, enabling automatic KV cache reuse — the engine skips re-processing
   * tokens it has already seen, dramatically reducing time-to-first-token.
   *
   * JS-side truncation was removed because it changed the prompt prefix every
   * time old messages were dropped, which invalidated the KV cache and forced
   * full re-computation on every turn.
   */
  private async manageContextWindow(messages: Message[], _extraReserve = 0): Promise<Message[]> {
    return messages;
  }

  async stopGeneration(): Promise<void> {
    if (this.context) { try { await this.context.stopCompletion(); } catch (e) { logger.log('[LLM] Stop error:', e); } }
    this.isGenerating = false;
  }
  async clearKVCache(clearData: boolean = false): Promise<void> {
    if (!this.context || this.isGenerating) return;
    try { await (this.context as any).clearCache(clearData); } catch (e) { logger.log('[LLM] Clear cache error:', e); }
  }
  getEstimatedMemoryUsage(): { contextMemoryMB: number; totalEstimatedMB: number } {
    if (!this.context) return { contextMemoryMB: 0, totalEstimatedMB: 0 };
    const contextMemoryMB = (this.currentSettings.contextLength || 2048) * 0.5;
    return { contextMemoryMB, totalEstimatedMB: contextMemoryMB };
  }
  getGpuInfo(): { gpu: boolean; gpuBackend: string; gpuLayers: number; reasonNoGPU: string } {
    let backend = 'CPU';
    if (this.gpuEnabled) {
      if (Platform.OS === 'ios') backend = 'Metal';
      else if (this.gpuDevices.length > 0) backend = this.gpuDevices.join(', ');
      else backend = 'OpenCL';
    }
    return { gpu: this.gpuEnabled, gpuBackend: backend, gpuLayers: this.activeGpuLayers, reasonNoGPU: this.gpuReason };
  }
  isCurrentlyGenerating(): boolean { return this.isGenerating; }
  private formatMessages(messages: Message[]): string { return formatLlamaMessages(messages, this.supportsVision()); }
  private getImageUris(messages: Message[]): string[] { return extractImageUris(messages); }
  private convertToOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] { return buildOAIMessages(messages); }

  async getModelInfo(): Promise<{ contextLength: number; vocabSize: number } | null> {
    return this.context ? { contextLength: APP_CONFIG.maxContextLength, vocabSize: 0 } : null;
  }
  async tokenize(text: string): Promise<number[]> {
    if (!this.context) throw new Error('No model loaded');
    return (await this.context.tokenize(text)).tokens || [];
  }
  async getTokenCount(text: string): Promise<number> {
    if (!this.context) throw new Error('No model loaded');
    return (await this.context.tokenize(text)).tokens?.length || 0;
  }
  async estimateContextUsage(messages: Message[]): Promise<{ tokenCount: number; percentUsed: number; willFit: boolean }> {
    const prompt = this.formatMessages(messages);
    const tokenCount = await this.getTokenCount(prompt);
    const ctxLen = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    return { tokenCount, percentUsed: (tokenCount / ctxLen) * 100, willFit: tokenCount < ctxLen * 0.9 };
  }
  getFormattedPrompt(messages: Message[]): string { return this.formatMessages(messages); }

  async getContextDebugInfo(messages: Message[]) {
    const managed = await this.manageContextWindow(messages);
    const fmt = this.formatMessages(managed);
    let tokens = 0;
    try { if (this.context) tokens = (await this.context.tokenize(fmt)).tokens?.length || 0; }
    catch { tokens = Math.ceil(fmt.length / 4); }
    const sys = (m: Message[]) => m.filter(x => x.role === 'system').length;
    const ctx = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    return { originalMessageCount: messages.length, managedMessageCount: managed.length,
      truncatedCount: (messages.length - sys(messages)) - (managed.length - sys(managed)),
      formattedPrompt: fmt, estimatedTokens: tokens, maxContextLength: ctx, contextUsagePercent: (tokens / ctx) * 100 };
  }
  updatePerformanceSettings(settings: Partial<LLMPerformanceSettings>): void {
    this.currentSettings = { ...this.currentSettings, ...settings };
    logger.log('[LLM] Performance settings updated:', this.currentSettings);
  }
  getPerformanceSettings(): LLMPerformanceSettings { return { ...this.currentSettings }; }
  getPerformanceStats(): LLMPerformanceStats { return { ...this.performanceStats }; }
  async reloadWithSettings(modelPath: string, settings: LLMPerformanceSettings): Promise<void> {
    this.updatePerformanceSettings(settings);
    if (this.context) await this.unloadModel();
    const { settings: appS } = useAppStore.getState();
    const { baseParams, nGpuLayers } = buildModelParams(modelPath, { ...appS, ...settings });
    logger.log(`[LLM] Reloading with threads=${settings.nThreads}, batch=${settings.nBatch}, ctx=${settings.contextLength}`);
    try {
      const { context, gpuAttemptFailed } = await initContextWithFallback(baseParams, settings.contextLength, nGpuLayers);
      this.context = context;
      Object.assign(this, captureGpuInfo(context, gpuAttemptFailed, nGpuLayers));
      this.currentModelPath = modelPath;
      this.multimodalSupport = null; this.multimodalInitialized = false;
      await this.checkMultimodalSupport(); this.detectToolCallingSupport(); this.detectThinkingSupport();
    } catch (error) {
      logger.error('[LLM] Error reloading model:', error);
      Object.assign(this, { context: null, currentModelPath: null, toolCallingSupported: false, thinkingSupported: false });
      throw error;
    }
  }
}

export const llmService = new LLMService();
