/**
 * Unit tests for useChatGenerationActions
 *
 * Covers uncovered branches:
 * - shouldRouteToImageGenerationFn: LLM-based classification path (lines 90, 100-105)
 * - handleImageGenerationFn: skipUserMessage=false path (lines 127-128), error path (line 141)
 * - startGenerationFn: generateResponse call (line 184)
 * - handleSendFn: no model (lines 203-204)
 * - executeDeleteConversationFn: image cleanup (line 264)
 * - regenerateResponseFn: shouldGenerateImage+imageModel path (lines 279-280)
 */

import {
  shouldRouteToImageGenerationFn,
  handleImageGenerationFn,
  startGenerationFn,
  executeDeleteConversationFn,
  regenerateResponseFn,
  handleSendFn,
  handleStopFn,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { createDownloadedModel } from '../../utils/factories';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

// Mock heavy service modules that pull in native code or env variables
jest.mock('../../../src/services/huggingface', () => ({ huggingFaceService: {} }));
jest.mock('../../../src/services/modelManager', () => ({ modelManager: {} }));
jest.mock('../../../src/services/hardware', () => ({ hardwareService: {} }));
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: { isAvailable: jest.fn(() => false) },
}));
jest.mock('../../../src/services/activeModelService/index', () => ({
  activeModelService: { loadTextModel: jest.fn(), unloadTextModel: jest.fn() },
}));
jest.mock('../../../src/services/intentClassifier', () => ({
  intentClassifier: { classifyIntent: jest.fn() },
}));
jest.mock('../../../src/services/generationService', () => ({
  generationService: {
    generateResponse: jest.fn(),
    stopGeneration: jest.fn(),
    enqueueMessage: jest.fn(),
    getState: jest.fn(() => ({ isGenerating: false })),
  },
}));
jest.mock('../../../src/services/imageGenerationService', () => ({
  imageGenerationService: {
    generateImage: jest.fn(),
    cancelGeneration: jest.fn(),
  },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    getLoadedModelPath: jest.fn(),
    isModelLoaded: jest.fn(),
    supportsToolCalling: jest.fn(() => false),
    stopGeneration: jest.fn(),
    getContextDebugInfo: jest.fn(),
    clearKVCache: jest.fn(),
  },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    deleteGeneratedImage: jest.fn(),
  },
}));

// Get mock references after hoisting
const { intentClassifier } = require('../../../src/services/intentClassifier');
const { generationService } = require('../../../src/services/generationService');
const { imageGenerationService } = require('../../../src/services/imageGenerationService');
const { llmService } = require('../../../src/services/llm');
const { localDreamGeneratorService } = require('../../../src/services/localDreamGenerator');

// Typed references
const mockClassifyIntent = intentClassifier.classifyIntent as jest.Mock;
const mockGenerateResponse = generationService.generateResponse as jest.Mock;
const mockStopGenerationService = generationService.stopGeneration as jest.Mock;
const mockEnqueueMessage = generationService.enqueueMessage as jest.Mock;
const mockGetGenerationState = generationService.getState as jest.Mock;
const mockGenerateImage = imageGenerationService.generateImage as jest.Mock;
const mockCancelGeneration = imageGenerationService.cancelGeneration as jest.Mock;
const mockGetLoadedModelPath = llmService.getLoadedModelPath as jest.Mock;
const mockIsModelLoaded = llmService.isModelLoaded as jest.Mock;
const mockStopLlmGeneration = llmService.stopGeneration as jest.Mock;
const mockGetContextDebugInfo = llmService.getContextDebugInfo as jest.Mock;
const mockClearKVCache = llmService.clearKVCache as jest.Mock;
const mockDeleteGeneratedImage = localDreamGeneratorService.deleteGeneratedImage as jest.Mock;

const mockSetHasSeenCacheTypeNudge = jest.fn();

jest.mock('../../../src/stores/appStore', () => ({
  useAppStore: {
    getState: jest.fn(() => ({
      hasSeenCacheTypeNudge: true,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    })),
  },
}));

jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({ conversations: [], updateCompactionState: jest.fn() }),
  },
}));

jest.mock('../../../src/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ getProject: jest.fn(() => null) }),
  },
}));

jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message?: string, buttons?: any[]) => ({ visible: true, title, message, buttons: buttons || [] })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

jest.mock('../../../src/constants', () => ({
  APP_CONFIG: { defaultSystemPrompt: 'You are a helpful assistant.' },
}));

// ─────────────────────────────────────────────
// Default implementations (reset each test)
// ─────────────────────────────────────────────

beforeEach(() => {
  mockClassifyIntent.mockResolvedValue('text');
  mockGenerateResponse.mockResolvedValue(undefined);
  mockStopGenerationService.mockResolvedValue(undefined);
  mockGenerateImage.mockResolvedValue(null);
  mockCancelGeneration.mockResolvedValue(undefined);
  mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
  mockIsModelLoaded.mockReturnValue(true);
  mockStopLlmGeneration.mockResolvedValue(undefined);
  mockGetContextDebugInfo.mockResolvedValue({ truncatedCount: 0, contextUsagePercent: 0 });
  mockClearKVCache.mockResolvedValue(undefined);
  mockDeleteGeneratedImage.mockResolvedValue(undefined);
  mockGetGenerationState.mockReturnValue({ isGenerating: false });
  mockEnqueueMessage.mockReturnValue(undefined);
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeRef<T>(value: T): React.MutableRefObject<T> {
  return { current: value } as React.MutableRefObject<T>;
}

const baseModel = createDownloadedModel({ id: 'model-1', filePath: '/path/model.gguf' });
const baseImageModel = { id: 'img-1', name: 'SD Model' };

function makeGenerationDeps(overrides: Record<string, unknown> = {}): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    activeModelId: 'model-1',
    activeModel: baseModel,
    activeConversationId: 'conv-1',
    activeConversation: { id: 'conv-1', messages: [] },
    activeProject: null,
    activeImageModel: null,
    imageModelLoaded: false,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    settings: {
      showGenerationDetails: false,
      imageGenerationMode: 'auto',
      autoDetectMethod: 'simple',
      classifierModelId: null,
      modelLoadingStrategy: 'performance' as const,
      systemPrompt: 'Be helpful',
      imageSteps: 8,
      imageGuidanceScale: 2,
    },
    downloadedModels: [baseModel],
    setAlertState: jest.fn(),
    setIsClassifying: jest.fn(),
    setAppImageGenerationStatus: jest.fn(),
    setAppIsGeneratingImage: jest.fn(),
    addMessage: jest.fn(),
    clearStreamingMessage: jest.fn(),
    deleteConversation: jest.fn(),
    setActiveConversation: jest.fn(),
    removeImagesByConversationId: jest.fn(() => []),
    generatingForConversationRef: makeRef<string | null>(null),
    navigation: { goBack: jest.fn(), navigate: jest.fn() },
    ensureModelLoaded: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// shouldRouteToImageGenerationFn
// ─────────────────────────────────────────────

describe('shouldRouteToImageGenerationFn', () => {
  it('returns false when already generating image', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: true, imageModelLoaded: true });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(result).toBe(false);
  });

  it('returns forceImageMode===true when mode is manual', async () => {
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, imageGenerationMode: 'manual' } });
    expect(await shouldRouteToImageGenerationFn(deps, 'text', true)).toBe(true);
    expect(await shouldRouteToImageGenerationFn(deps, 'text', false)).toBe(false);
  });

  it('returns true immediately when forceImageMode and imageModelLoaded', async () => {
    const deps = makeGenerationDeps({ imageModelLoaded: true });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw', true);
    expect(result).toBe(true);
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('returns false when imageModelLoaded is false', async () => {
    const deps = makeGenerationDeps({ imageModelLoaded: false });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(result).toBe(false);
  });

  it('classifies intent via LLM when autoDetectMethod=llm', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    const deps = makeGenerationDeps({
      imageModelLoaded: true,
      settings: { ...makeGenerationDeps().settings, autoDetectMethod: 'llm' },
    });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(deps.setIsClassifying).toHaveBeenCalledWith(true);
    expect(result).toBe(true);
    expect(deps.setIsClassifying).toHaveBeenCalledWith(false);
  });

  it('resets image status when LLM returns non-image intent', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text');
    const deps = makeGenerationDeps({
      imageModelLoaded: true,
      settings: { ...makeGenerationDeps().settings, autoDetectMethod: 'llm' },
    });
    const result = await shouldRouteToImageGenerationFn(deps, 'hello');
    expect(result).toBe(false);
    expect(deps.setAppImageGenerationStatus).toHaveBeenCalledWith(null);
    expect(deps.setAppIsGeneratingImage).toHaveBeenCalledWith(false);
  });

  it('returns false and resets state when classification throws', async () => {
    mockClassifyIntent.mockRejectedValueOnce(new Error('network error'));
    const deps = makeGenerationDeps({ imageModelLoaded: true });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw');
    expect(result).toBe(false);
    expect(deps.setIsClassifying).toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────
// handleImageGenerationFn
// ─────────────────────────────────────────────

describe('handleImageGenerationFn', () => {
  it('shows alert when no image model loaded', async () => {
    const deps = makeGenerationDeps({ activeImageModel: null });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('adds user message when skipUserMessage is false (default)', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/img.png' });
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    });
    await handleImageGenerationFn(deps, { prompt: 'a dog', conversationId: 'conv-1' });
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user', content: 'a dog' }));
  });

  it('skips user message when skipUserMessage=true', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/img.png' });
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel, imageGenState: { isGenerating: false, error: null } });
    await handleImageGenerationFn(deps, { prompt: 'a dog', conversationId: 'conv-1', skipUserMessage: true });
    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('shows alert when image generation returns null and there is a non-cancel error', async () => {
    mockGenerateImage.mockResolvedValueOnce(null);
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, error: 'out of memory' },
    });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
  });

  it('does not show alert when error is "cancelled"', async () => {
    mockGenerateImage.mockResolvedValueOnce(null);
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, error: 'cancelled by user' },
    });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// executeDeleteConversationFn
// ─────────────────────────────────────────────

describe('executeDeleteConversationFn', () => {
  it('returns early when no activeConversationId', async () => {
    const deps = makeGenerationDeps({ activeConversationId: null });
    await executeDeleteConversationFn(deps);
    expect(deps.deleteConversation).not.toHaveBeenCalled();
  });

  it('stops streaming before deleting when isStreaming=true', async () => {
    const deps = makeGenerationDeps({ isStreaming: true });
    await executeDeleteConversationFn(deps);
    expect(mockStopLlmGeneration).toHaveBeenCalled();
    expect(deps.clearStreamingMessage).toHaveBeenCalled();
    expect(deps.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(deps.navigation.goBack).toHaveBeenCalled();
  });

  it('deletes generated images for the conversation', async () => {
    const deps = makeGenerationDeps();
    deps.removeImagesByConversationId.mockReturnValue(['img-1', 'img-2']);
    await executeDeleteConversationFn(deps);
    expect(mockDeleteGeneratedImage).toHaveBeenCalledTimes(2);
    expect(mockDeleteGeneratedImage).toHaveBeenCalledWith('img-1');
    expect(mockDeleteGeneratedImage).toHaveBeenCalledWith('img-2');
    expect(deps.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(deps.setActiveConversation).toHaveBeenCalledWith(null);
  });
});

// ─────────────────────────────────────────────
// regenerateResponseFn
// ─────────────────────────────────────────────

describe('regenerateResponseFn', () => {
  it('returns early when no activeConversationId', async () => {
    const deps = makeGenerationDeps({ activeConversationId: null, activeModel: undefined });
    const msg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg });
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('routes to image generation when shouldGenerate=true and imageModel loaded', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/out.png' });
    const deps = makeGenerationDeps({
      imageModelLoaded: true,
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    });
    const msg = { id: 'm1', role: 'user' as const, content: 'draw a fox', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg });
    // Should call generateImage instead of generateResponse
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('calls generateResponse with context messages', async () => {
    mockGenerateResponse.mockResolvedValueOnce(undefined);
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeConversation: { id: 'conv-1', messages: [userMsg] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(mockGenerateResponse).toHaveBeenCalledWith('conv-1', expect.any(Array));
    expect(deps.generatingForConversationRef.current).toBeNull();
  });

  it('shows alert when generateResponse throws', async () => {
    mockGenerateResponse.mockRejectedValueOnce(new Error('Server error'));
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeConversation: { id: 'conv-1', messages: [userMsg] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Generation Error' }));
  });
});

// ─────────────────────────────────────────────
// handleSendFn
// ─────────────────────────────────────────────

describe('handleSendFn', () => {
  it('shows alert when no activeConversationId', async () => {
    const deps = makeGenerationDeps({ activeConversationId: null });
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'auto',
      startGeneration: jest.fn(),
      setDebugInfo: jest.fn(),
    });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'No Model Selected' }));
  });

  it('shows alert when no activeModel', async () => {
    const deps = makeGenerationDeps({ activeModel: undefined });
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'auto',
      startGeneration: jest.fn(),
      setDebugInfo: jest.fn(),
    });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'No Model Selected' }));
  });

  it('calls startGeneration for a normal text message', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'auto',
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user' }));
    expect(startGeneration).toHaveBeenCalledWith('conv-1', 'hello');
  });
});

// ─────────────────────────────────────────────
// handleStopFn
// ─────────────────────────────────────────────

describe('handleStopFn', () => {
  it('stops generation and cancels image generation when isGeneratingImage=true', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: true });
    await handleStopFn(deps);
    expect(mockStopGenerationService).toHaveBeenCalled();
    expect(mockCancelGeneration).toHaveBeenCalled();
    expect(deps.generatingForConversationRef.current).toBeNull();
  });

  it('stops generation without cancelling image when not generating image', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: false });
    await handleStopFn(deps);
    expect(mockStopGenerationService).toHaveBeenCalled();
    expect(mockCancelGeneration).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// startGenerationFn
// ─────────────────────────────────────────────

describe('startGenerationFn', () => {
  it('returns early when no activeModel', async () => {
    const deps = makeGenerationDeps({ activeModel: undefined });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('calls generateResponse and invokes first-token callback', async () => {
    // Make generateResponse actually call the callback (3rd arg)
    mockGenerateResponse.mockImplementationOnce(async (_convId: string, _msgs: any, onFirstToken?: () => void) => {
      onFirstToken?.();
    });
    mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
    const deps = makeGenerationDeps();
    const setDebugInfo = jest.fn();
    await startGenerationFn(deps, { setDebugInfo, targetConversationId: 'conv-1', messageText: 'hello' });
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(deps.generatingForConversationRef.current).toBeNull();
  });

  it('clears cache when context usage is high', async () => {
    mockGetContextDebugInfo.mockResolvedValueOnce({ truncatedCount: 0, contextUsagePercent: 75 });
    mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'test' });
    expect(mockClearKVCache).toHaveBeenCalledWith(false);
  });

  it('shows alert when model is not loaded after ensureModelLoaded', async () => {
    mockGetLoadedModelPath.mockReturnValueOnce(null); // triggers needsModelLoad
    mockIsModelLoaded.mockReturnValueOnce(false); // model still not loaded after ensureModelLoaded
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// cache type nudge
// ─────────────────────────────────────────────

const { useAppStore: mockAppStore } = require('../../../src/stores/appStore');
const { showAlert: mockShowAlert } = require('../../../src/components');

describe('cache type nudge after generation', () => {
  it('shows nudge when hasSeenCacheTypeNudge=false and cacheType=q8_0', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'q8_0' } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Improve Output Quality', visible: true }));
    expect(mockSetHasSeenCacheTypeNudge).toHaveBeenCalledWith(true);
  });

  it('does NOT show nudge when hasSeenCacheTypeNudge is already true', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: true,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'q8_0' } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    expect(mockSetHasSeenCacheTypeNudge).not.toHaveBeenCalled();
    expect(deps.setAlertState).not.toHaveBeenCalled();
  });

  it('does NOT show nudge when cacheType is f16', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'f16' } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    expect(mockSetHasSeenCacheTypeNudge).not.toHaveBeenCalled();
    expect(deps.setAlertState).not.toHaveBeenCalled();
  });

  it('does NOT show nudge on generation error', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    mockGenerateResponse.mockRejectedValueOnce(new Error('fail'));
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'q8_0' } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Generation Error' }));
    expect(mockSetHasSeenCacheTypeNudge).not.toHaveBeenCalled();
  });

  it('"Go to Settings" opens the in-chat settings panel', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    const setShowSettingsPanel = jest.fn();
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'q8_0' }, setShowSettingsPanel });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    const alertCall = (mockShowAlert as jest.Mock).mock.calls.find((args: any[]) => args[0] === 'Improve Output Quality');
    const goToSettings = alertCall![2].find((b: any) => b.text === 'Go to Settings');
    goToSettings.onPress();
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ visible: false }));
    expect(setShowSettingsPanel).toHaveBeenCalledWith(true);
  });

  it('"Got it" button has cancel style', async () => {
    (mockAppStore.getState as jest.Mock).mockReturnValue({
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: mockSetHasSeenCacheTypeNudge,
    });
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, cacheType: 'q8_0' } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hello' });

    const alertCall = (mockShowAlert as jest.Mock).mock.calls.find((args: any[]) => args[0] === 'Improve Output Quality');
    const gotIt = alertCall![2].find((b: any) => b.text === 'Got it');
    expect(gotIt.style).toBe('cancel');
  });
});
