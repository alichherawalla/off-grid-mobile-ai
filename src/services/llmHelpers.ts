import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import { APP_CONFIG } from '../constants';
import { Message } from '../types';
import { MultimodalSupport, LLMPerformanceStats } from './llmTypes';

// Reserve tokens for system prompt and response generation
export const SYSTEM_PROMPT_RESERVE = 256;
export const RESPONSE_RESERVE = 512;
export const CONTEXT_SAFETY_MARGIN = 0.85;

import { Platform } from 'react-native';
import logger from '../utils/logger';

// Use 4 threads by default to target only performance cores.
// Over-threading onto efficiency cores (A520) slows down inference.
const DEFAULT_THREADS = 4;
const DEFAULT_BATCH = 512;
export const DEFAULT_GPU_LAYERS = Platform.OS === 'ios' ? 99 : 0;

export function getOptimalThreadCount(): number {
  return DEFAULT_THREADS;
}

export function getOptimalBatchSize(): number {
  return DEFAULT_BATCH;
}

const REPACKABLE_QUANTS = ['q4_0', 'iq4_nl'];

/**
 * Detect if a model uses repackable quantization formats.
 * For these formats, disabling mmap allows llama.cpp to repack weights into
 * a more efficient layout at load time, improving inference speed.
 */
export function shouldDisableMmap(modelPath: string): boolean {
  if (Platform.OS !== 'android') return false;
  const lower = modelPath.toLowerCase();
  return REPACKABLE_QUANTS.some(q => lower.includes(q));
}

export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) - hash) + char;
    // eslint-disable-next-line no-bitwise
    hash = hash & hash;
  }
  return hash.toString(16);
}

export async function ensureSessionCacheDir(cacheDir: string): Promise<void> {
  try {
    if (!await RNFS.exists(cacheDir)) await RNFS.mkdir(cacheDir);
  } catch (e) {
    logger.log('[LLM] Failed to create session cache dir:', e);
  }
}

export function getSessionPath(cacheDir: string, promptHash: string): string {
  return `${cacheDir}/session-${promptHash}.bin`;
}

export interface ModelLoadParams {
  baseParams: object;
  nThreads: number;
  nBatch: number;
  ctxLen: number;
  nGpuLayers: number;
}

export function buildModelParams(
  modelPath: string,
  settings: { nThreads?: number; nBatch?: number; contextLength?: number; flashAttn?: boolean; enableGpu?: boolean; gpuLayers?: number; cacheType?: string },
): ModelLoadParams {
  const nThreads = settings.nThreads || getOptimalThreadCount();
  const nBatch = settings.nBatch || getOptimalBatchSize();
  const ctxLen = settings.contextLength || APP_CONFIG.maxContextLength;
  const useFlashAttn = settings.flashAttn ?? true;
  const gpuEnabled = settings.enableGpu !== false;
  const nGpuLayers = gpuEnabled ? (settings.gpuLayers ?? DEFAULT_GPU_LAYERS) : 0;
  // Quantized KV cache (q8_0, q4_0) requires flash attention — SIGSEGV otherwise.
  // On Android, GPU (OpenCL) backend only supports f16 KV cache — SIGABRT in graph_split otherwise.
  const requestedCache = settings.cacheType || (useFlashAttn ? 'q8_0' : 'f16');
  const needsF16 = !useFlashAttn || (Platform.OS === 'android' && nGpuLayers > 0);
  const cacheType = needsF16 && requestedCache !== 'f16' ? 'f16' : requestedCache;
  const useMmap = !shouldDisableMmap(modelPath);
  return {
    baseParams: {
      model: modelPath, use_mlock: false, n_batch: nBatch, n_ubatch: nBatch, n_threads: nThreads,
      use_mmap: useMmap, vocab_only: false, flash_attn: useFlashAttn,
      cache_type_k: cacheType, cache_type_v: cacheType,
    },
    nThreads, nBatch, ctxLen, nGpuLayers,
  };
}

export interface ContextInitResult {
  context: LlamaContext;
  gpuAttemptFailed: boolean;
  actualLength: number;
}

/**
 * Attempts to init llama with GPU, falls back to CPU, then retries with ctx=2048 on failure.
 */
export async function initContextWithFallback(
  params: object,
  contextLength: number,
  nGpuLayers: number,
): Promise<ContextInitResult> {
  let gpuAttemptFailed = false;
  try {
    const context = await initLlama({ ...params, n_ctx: contextLength, n_gpu_layers: nGpuLayers } as any);
    return { context, gpuAttemptFailed, actualLength: contextLength };
  } catch (gpuError: any) {
    if (nGpuLayers > 0) {
      logger.warn('[LLM] GPU load failed, falling back to CPU:', gpuError?.message || gpuError);
      gpuAttemptFailed = true;
    }
    try {
      const context = await initLlama({ ...params, n_ctx: contextLength, n_gpu_layers: 0 } as any);
      return { context, gpuAttemptFailed, actualLength: contextLength };
    } catch (cpuError: any) {
      logger.warn(`[LLM] CPU load failed (ctx=${contextLength}), retrying with ctx=2048:`, cpuError?.message || cpuError);
      const context = await initLlama({ ...params, n_ctx: 2048, n_gpu_layers: 0 } as any);
      return { context, gpuAttemptFailed, actualLength: 2048 };
    }
  }
}

export interface GpuInfo {
  gpuEnabled: boolean;
  gpuReason: string;
  gpuDevices: string[];
  activeGpuLayers: number;
}

export function captureGpuInfo(
  context: LlamaContext,
  gpuAttemptFailed: boolean,
  nGpuLayers: number,
): GpuInfo {
  const nativeGpuAvailable = context.gpu ?? false;
  const gpuReason = (context as any).reasonNoGPU ?? '';
  const gpuDevices = (context as any).devices ?? [];
  const activeGpuLayers = gpuAttemptFailed ? 0 : nGpuLayers;
  const gpuEnabled = nativeGpuAvailable && activeGpuLayers > 0;
  return { gpuEnabled, gpuReason, gpuDevices, activeGpuLayers };
}

export function supportsNativeThinking(context: LlamaContext | null): boolean {
  if (!context) return false;
  try {
    if (typeof context.isJinjaSupported === 'function') {
      return context.isJinjaSupported();
    }
    const jinja = (context as any)?.model?.chatTemplates?.jinja;
    return !!(jinja?.default || jinja?.toolUse);
  } catch {
    return false;
  }
}

export function buildThinkingCompletionParams(enableThinking: boolean): {
  enable_thinking: boolean;
  reasoning_format: 'none' | 'deepseek';
} {
  return {
    enable_thinking: enableThinking,
    reasoning_format: enableThinking ? 'deepseek' : 'none',
  };
}

export function getStreamingDelta(nextValue: string | undefined, previousValue: string): string | undefined {
  if (!nextValue) return undefined;
  if (!previousValue) return nextValue;
  return nextValue.startsWith(previousValue) ? nextValue.slice(previousValue.length) || undefined : nextValue;
}

/**
 * Reads the model's trained context length from metadata.
 * Returns the max context the model supports, or null if unavailable.
 */
export function getModelMaxContext(context: LlamaContext): number | null {
  try {
    const metadata = (context as any).model?.metadata;
    if (!metadata) return null;
    const trainCtx = metadata['llama.context_length'] || metadata['general.context_length'] || metadata.context_length;
    if (!trainCtx) return null;
    const maxModelCtx = parseInt(trainCtx, 10);
    return isNaN(maxModelCtx) || maxModelCtx <= 0 ? null : maxModelCtx;
  } catch {
    return null;
  }
}

export function logContextMetadata(context: LlamaContext, contextLength: number): void {
  const maxModelCtx = getModelMaxContext(context);
  if (maxModelCtx == null) return;
  logger.log(`[LLM] Model trained context: ${maxModelCtx}, using: ${contextLength}`);
  if (contextLength > maxModelCtx) {
    logger.warn(`[LLM] Requested context (${contextLength}) exceeds model max (${maxModelCtx})`);
  }
}

export interface MultimodalInitResult {
  initialized: boolean;
  support: MultimodalSupport;
}

export async function initMultimodal(
  context: LlamaContext,
  mmProjPath: string,
  useGpuForClip: boolean,
): Promise<MultimodalInitResult> {
  const noSupport: MultimodalInitResult = { initialized: false, support: { vision: false, audio: false } };
  try {
    const success = await context.initMultimodal({ path: mmProjPath, use_gpu: useGpuForClip });
    if (!success) {
      logger.warn('[LLM] initMultimodal returned false - mmproj may be incompatible with model');
      return noSupport;
    }
    let support: MultimodalSupport = { vision: true, audio: false };
    try {
      const s = await context.getMultimodalSupport();
      support = { vision: s?.vision || true, audio: s?.audio || false };
    } catch {
      // getMultimodalSupport not available, keep defaults
    }
    logger.log('[LLM] Multimodal initialized successfully, vision:', support.vision);
    return { initialized: true, support };
  } catch (error: any) {
    logger.error('[LLM] Multimodal init exception:', error?.message || error);
    return noSupport;
  }
}

export async function checkContextMultimodal(context: LlamaContext): Promise<MultimodalSupport> {
  try {
    // @ts-ignore - llama.rn may have this method
    if (typeof context.getMultimodalSupport === 'function') {
      const s = await context.getMultimodalSupport();
      return { vision: s?.vision || false, audio: s?.audio || false };
    }
  } catch {
    logger.log('Multimodal support check not available');
  }
  return { vision: false, audio: false };
}

export async function estimateTokens(context: LlamaContext, text: string): Promise<number> {
  try {
    return (await context.tokenize(text)).tokens?.length || 0;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export async function fitMessagesInBudget(
  context: LlamaContext,
  messages: Message[],
  budget: number,
): Promise<Message[]> {
  const result: Message[] = [];
  let remaining = budget;
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    const msg = messages[i];
    let tokens: number;
    try {
      tokens = ((await context.tokenize(msg.content)).tokens?.length || 0) + 10;
    } catch {
      tokens = Math.ceil(msg.content.length / 4) + 10;
    }
    if (tokens <= remaining) {
      result.unshift(msg);
      remaining -= tokens;
    } else if (result.length === 0) {
      result.unshift(msg);
      break;
    } else {
      break;
    }
  }
  return result;
}

/**
 * Returns the maximum safe context length based on device RAM.
 * Prevents OOM crashes on low-RAM devices (e.g. iPhone XS with 4GB).
 */
export const BYTES_PER_GB = 1024 * 1024 * 1024;

export function getMaxContextForDevice(totalMemoryBytes: number): number {
  const totalGB = totalMemoryBytes / BYTES_PER_GB;
  if (totalGB <= 6) return 2048;
  if (totalGB <= 8) return 4096;
  return 8192;
}

/**
 * Returns safe GPU layer count based on device RAM.
 * On low-RAM devices (≤4GB like iPhone XS), Metal allocation can call
 * abort() which bypasses JS try/catch, killing the app instantly.
 * Skip GPU entirely on these devices to prevent the uncatchable crash.
 */
export function getGpuLayersForDevice(totalMemoryBytes: number, requestedLayers: number): number {
  const totalGB = totalMemoryBytes / BYTES_PER_GB;
  if (totalGB <= 4) return 0;
  return requestedLayers;
}

export const STOP_TOKENS = ['</s>', '<|end|>', '<|eot_id|>'];

export function buildCompletionParams(settings: {
  maxTokens?: number; temperature?: number; topP?: number; repeatPenalty?: number;
}): Record<string, any> {
  return {
    n_predict: settings.maxTokens || RESPONSE_RESERVE,
    temperature: settings.temperature ?? 0.7,
    top_k: 40,
    top_p: settings.topP ?? 0.95,
    penalty_repeat: settings.repeatPenalty ?? 1.1,
    stop: STOP_TOKENS,
    ctx_shift: true,
  };
}


export function recordGenerationStats(
  startTime: number,
  firstTokenMs: number,
  tokenCount: number,
): LLMPerformanceStats {
  const elapsed = (Date.now() - startTime) / 1000;
  const tokensPerSec = elapsed > 0 ? tokenCount / elapsed : 0;
  const ttft = firstTokenMs / 1000;
  const decodeTime = elapsed - ttft;
  const decodeTokensPerSec = decodeTime > 0 && tokenCount > 1 ? (tokenCount - 1) / decodeTime : 0;
  logger.log(`[LLM] Generated ${tokenCount} tokens in ${elapsed.toFixed(1)}s (${tokensPerSec.toFixed(1)} tok/s, TTFT ${ttft.toFixed(2)}s)`);
  return {
    lastTokensPerSecond: tokensPerSec,
    lastDecodeTokensPerSecond: decodeTokensPerSec,
    lastTimeToFirstToken: ttft,
    lastGenerationTime: elapsed,
    lastTokenCount: tokenCount,
  };
}
