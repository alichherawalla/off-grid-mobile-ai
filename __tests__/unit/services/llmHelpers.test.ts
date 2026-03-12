import {
  getMaxContextForDevice,
  getGpuLayersForDevice,
  BYTES_PER_GB,
  supportsNativeThinking,
  getModelMaxContext,
  estimateTokens,
  fitMessagesInBudget,
  getStreamingDelta,
  buildModelParams,
  shouldDisableMmap,
  captureGpuInfo,
  logContextMetadata,
} from '../../../src/services/llmHelpers';

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const GB = BYTES_PER_GB;

describe('getMaxContextForDevice', () => {
  it('caps at 2048 for 3GB RAM', () => {
    expect(getMaxContextForDevice(3 * GB)).toBe(2048);
  });

  it('caps at 2048 for 4GB RAM (iPhone XS)', () => {
    expect(getMaxContextForDevice(4 * GB)).toBe(2048);
  });

  it('caps at 2048 for 6GB RAM', () => {
    expect(getMaxContextForDevice(6 * GB)).toBe(2048);
  });

  it('caps at 4096 for 8GB RAM', () => {
    expect(getMaxContextForDevice(8 * GB)).toBe(4096);
  });

  it('caps at 4096 for 7GB RAM', () => {
    expect(getMaxContextForDevice(7 * GB)).toBe(4096);
  });

  it('caps at 8192 for 12GB RAM', () => {
    expect(getMaxContextForDevice(12 * GB)).toBe(8192);
  });

  it('caps at 8192 for 16GB RAM', () => {
    expect(getMaxContextForDevice(16 * GB)).toBe(8192);
  });
});

describe('getGpuLayersForDevice', () => {
  it('disables GPU on 3GB RAM device', () => {
    expect(getGpuLayersForDevice(3 * GB, 99)).toBe(0);
  });

  it('disables GPU on 4GB RAM device (iPhone XS)', () => {
    expect(getGpuLayersForDevice(4 * GB, 99)).toBe(0);
  });

  it('keeps requested GPU layers on 6GB RAM device', () => {
    expect(getGpuLayersForDevice(6 * GB, 99)).toBe(99);
  });

  it('keeps requested GPU layers on 8GB RAM device', () => {
    expect(getGpuLayersForDevice(8 * GB, 99)).toBe(99);
  });

  it('passes through 0 GPU layers unchanged', () => {
    expect(getGpuLayersForDevice(4 * GB, 0)).toBe(0);
    expect(getGpuLayersForDevice(8 * GB, 0)).toBe(0);
  });
});

describe('supportsNativeThinking', () => {
  it('returns false when context is null', () => {
    expect(supportsNativeThinking(null)).toBe(false);
  });

  it('returns result of isJinjaSupported() when available', () => {
    const ctx = { isJinjaSupported: jest.fn(() => true) } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
    expect(ctx.isJinjaSupported).toHaveBeenCalled();
  });

  it('reads chatTemplates.jinja when isJinjaSupported is not a function', () => {
    const ctx = { model: { chatTemplates: { jinja: { default: 'template' } } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
  });

  it('returns false when jinja has no default or toolUse', () => {
    const ctx = { model: { chatTemplates: { jinja: {} } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(false);
  });

  it('returns false on exception', () => {
    const ctx = {
      get model() { throw new Error('boom'); }
    } as any;
    expect(supportsNativeThinking(ctx)).toBe(false);
  });
});

describe('getModelMaxContext', () => {
  it('returns null when metadata is missing', () => {
    const ctx = {} as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns null when trainCtx not found in metadata', () => {
    const ctx = { model: { metadata: {} } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns parsed context length', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '4096' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(4096);
  });

  it('returns null when parseInt gives NaN', () => {
    const ctx = { model: { metadata: { 'llama.context_length': 'not-a-number' } } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns null on exception', () => {
    const ctx = {
      get model() { throw new Error('boom'); }
    } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('returns token count from context.tokenize', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }) } as any;
    const count = await estimateTokens(ctx, 'hello');
    expect(count).toBe(3);
  });

  it('falls back to char/4 estimate on exception', async () => {
    const ctx = { tokenize: jest.fn().mockRejectedValue(new Error('fail')) } as any;
    const count = await estimateTokens(ctx, '1234'); // 4 chars → 1 token
    expect(count).toBe(1);
  });

  it('returns 0 when tokens array is empty', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: [] }) } as any;
    expect(await estimateTokens(ctx, '')).toBe(0);
  });
});

function makeMsg(content: string): any {
  return { id: '1', role: 'user', content, timestamp: 0 };
}

describe('fitMessagesInBudget', () => {
  it('includes all messages when budget is large', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(10).fill(1) }) } as any;
    const msgs = [makeMsg('short'), makeMsg('message')];
    const result = await fitMessagesInBudget(ctx, msgs, 1000);
    expect(result).toHaveLength(2);
  });

  it('drops older messages that exceed budget', async () => {
    // Each message tokenizes to 10 tokens + 10 overhead = 20
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(10).fill(1) }) } as any;
    const msgs = [makeMsg('old message'), makeMsg('new message')];
    // Budget of 25: can fit new message (20 tokens) but not both (40 tokens)
    const result = await fitMessagesInBudget(ctx, msgs, 25);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('new message');
  });

  it('always includes at least the last message even if it exceeds budget', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(100).fill(1) }) } as any;
    const msgs = [makeMsg('only message')];
    // Budget of 5: 110 tokens exceeds budget, but result should still include it
    const result = await fitMessagesInBudget(ctx, msgs, 5);
    expect(result).toHaveLength(1);
  });

  it('falls back to char estimate when tokenize throws', async () => {
    const ctx = { tokenize: jest.fn().mockRejectedValue(new Error('no tokenizer')) } as any;
    const msgs = [makeMsg('hi')]; // 2 chars → ~1 token + 10 = 11
    const result = await fitMessagesInBudget(ctx, msgs, 100);
    expect(result).toHaveLength(1);
  });
});

describe('getStreamingDelta', () => {
  it('returns undefined when nextValue is falsy', () => {
    expect(getStreamingDelta(undefined, 'prev')).toBeUndefined();
    expect(getStreamingDelta('', 'prev')).toBeUndefined();
  });

  it('returns nextValue when previousValue is empty', () => {
    expect(getStreamingDelta('hello', '')).toBe('hello');
  });

  it('returns slice when nextValue starts with previousValue', () => {
    expect(getStreamingDelta('hello world', 'hello ')).toBe('world');
  });

  it('returns undefined when slice is empty (no new content)', () => {
    expect(getStreamingDelta('same', 'same')).toBeUndefined();
  });

  it('returns nextValue when it does not start with previousValue', () => {
    expect(getStreamingDelta('different', 'prev')).toBe('different');
  });
});

describe('supportsNativeThinking — toolUse branch', () => {
  it('returns true when jinja has toolUse but no default', () => {
    const ctx = { model: { chatTemplates: { jinja: { toolUse: 'some-template' } } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
  });
});

describe('getModelMaxContext — alternative metadata keys', () => {
  it('falls back to general.context_length when llama key absent', () => {
    const ctx = { model: { metadata: { 'general.context_length': '8192' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(8192);
  });

  it('falls back to context_length key', () => {
    const ctx = { model: { metadata: { context_length: '4096' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(4096);
  });

  it('returns null when context length is zero or negative', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '0' } } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });
});

describe('shouldDisableMmap', () => {
  it('returns false on non-android', () => {
    // Platform.OS is mocked as 'ios' in test env
    expect(shouldDisableMmap('/path/to/model.q4_0.gguf')).toBe(false);
  });
});

describe('buildModelParams', () => {
  it('uses provided nThreads and nBatch over defaults', () => {
    const params = buildModelParams('/model.gguf', { nThreads: 8, nBatch: 256 });
    expect(params.nThreads).toBe(8);
    expect(params.nBatch).toBe(256);
  });

  it('uses provided contextLength', () => {
    const params = buildModelParams('/model.gguf', { contextLength: 4096 });
    expect(params.ctxLen).toBe(4096);
  });

  it('disables GPU when enableGpu=false', () => {
    const params = buildModelParams('/model.gguf', { enableGpu: false });
    expect(params.nGpuLayers).toBe(0);
  });

  it('uses flashAttn=false settings', () => {
    const params = buildModelParams('/model.gguf', { flashAttn: false });
    expect((params.baseParams as any).flash_attn).toBe(false);
  });

  it('uses provided cacheType', () => {
    const params = buildModelParams('/model.gguf', { cacheType: 'f16' });
    expect((params.baseParams as any).cache_type_k).toBe('f16');
  });

  it('uses provided gpuLayers', () => {
    const params = buildModelParams('/model.gguf', { gpuLayers: 16 });
    expect(params.nGpuLayers).toBe(16);
  });
});

describe('captureGpuInfo', () => {
  it('returns gpuEnabled=false when gpuAttemptFailed=true', () => {
    const ctx = { gpu: true, reasonNoGPU: '', devices: [] } as any;
    const info = captureGpuInfo(ctx, true, 32);
    expect(info.gpuEnabled).toBe(false);
    expect(info.activeGpuLayers).toBe(0);
  });

  it('returns gpuEnabled=true when gpu available and layers > 0', () => {
    const ctx = { gpu: true, reasonNoGPU: '', devices: ['Metal'] } as any;
    const info = captureGpuInfo(ctx, false, 32);
    expect(info.gpuEnabled).toBe(true);
    expect(info.activeGpuLayers).toBe(32);
    expect(info.gpuDevices).toEqual(['Metal']);
  });

  it('returns gpuEnabled=false when gpu unavailable', () => {
    const ctx = { gpu: false, reasonNoGPU: 'No GPU', devices: [] } as any;
    const info = captureGpuInfo(ctx, false, 32);
    expect(info.gpuEnabled).toBe(false);
  });
});

describe('logContextMetadata', () => {
  const logger = require('../../../src/utils/logger').default;

  beforeEach(() => jest.clearAllMocks());

  it('logs nothing when context has no metadata', () => {
    const ctx = {} as any;
    logContextMetadata(ctx, 4096);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs warning when requested context exceeds model max', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '2048' } } } as any;
    logContextMetadata(ctx, 4096);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs without warning when context is within model max', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '8192' } } } as any;
    logContextMetadata(ctx, 4096);
    expect(logger.log).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
