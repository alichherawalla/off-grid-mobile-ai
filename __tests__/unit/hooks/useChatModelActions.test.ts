/**
 * Unit tests for useChatModelActions
 *
 * Tests the exported async functions directly, covering uncovered branches:
 * - addSystemMsg: no-op when activeConversationId missing or showGenerationDetails false
 * - initiateModelLoad: memory check failure path
 * - proceedWithModelLoadFn: success path with system message, createConversation path
 * - handleUnloadModelFn: success path with system message
 */

import { initiateModelLoad, proceedWithModelLoadFn, handleModelSelectFn, handleUnloadModelFn } from '../../../src/screens/ChatScreen/useChatModelActions';
import { createDownloadedModel } from '../../utils/factories';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: jest.fn(),
    unloadTextModel: jest.fn(),
    checkMemoryForModel: jest.fn(),
    getActiveModels: jest.fn(),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    getMultimodalSupport: jest.fn(),
    getLoadedModelPath: jest.fn(),
    stopGeneration: jest.fn(),
    isModelLoaded: jest.fn(),
  },
}));

// Get mock references after hoisting
const { activeModelService } = require('../../../src/services/activeModelService');
const { llmService } = require('../../../src/services/llm');

const mockLoadTextModel = activeModelService.loadTextModel as jest.Mock;
const mockUnloadTextModel = activeModelService.unloadTextModel as jest.Mock;
const mockCheckMemoryForModel = activeModelService.checkMemoryForModel as jest.Mock;
const mockGetActiveModels = activeModelService.getActiveModels as jest.Mock;
const mockGetMultimodalSupport = llmService.getMultimodalSupport as jest.Mock;
const mockGetLoadedModelPath = llmService.getLoadedModelPath as jest.Mock;
const mockStopGeneration = llmService.stopGeneration as jest.Mock;
const mockIsModelLoaded = llmService.isModelLoaded as jest.Mock;

// Mock CustomAlert helpers
jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any[]) => ({
    visible: true,
    title,
    message,
    buttons: buttons ?? [],
  })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** waitForRenderFrame in the module uses requestAnimationFrame + setTimeout.
 *  Stub it out globally so tests don't time out. */
(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => {
  cb(0);
  return 0;
};

beforeEach(() => {
  mockLoadTextModel.mockResolvedValue(undefined);
  mockUnloadTextModel.mockResolvedValue(undefined);
  mockCheckMemoryForModel.mockResolvedValue({ canLoad: true, severity: 'safe', message: '' });
  mockGetActiveModels.mockReturnValue({ text: { isLoading: false } });
  mockGetMultimodalSupport.mockReturnValue(null);
  mockGetLoadedModelPath.mockReturnValue(null);
  mockStopGeneration.mockResolvedValue(undefined);
  mockIsModelLoaded.mockReturnValue(true);
});

function makeRef<T>(value: T): React.MutableRefObject<T> {
  return { current: value } as React.MutableRefObject<T>;
}

function makeDeps(overrides: Partial<any> = {}) {
  const model = createDownloadedModel({ id: 'model-1', name: 'Test Model', filePath: '/path/model.gguf' });
  return {
    activeModel: model,
    activeModelId: 'model-1',
    activeConversationId: 'conv-1',
    isStreaming: false,
    settings: { showGenerationDetails: true },
    clearStreamingMessage: jest.fn(),
    createConversation: jest.fn(() => 'new-conv-id'),
    addMessage: jest.fn(),
    setIsModelLoading: jest.fn(),
    setLoadingModel: jest.fn(),
    setSupportsVision: jest.fn(),
    setShowModelSelector: jest.fn(),
    setAlertState: jest.fn(),
    modelLoadStartTimeRef: makeRef<number | null>(null),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// initiateModelLoad
// ─────────────────────────────────────────────

describe('initiateModelLoad', () => {
  it('returns early when activeModel is undefined', async () => {
    const deps = makeDeps({ activeModel: undefined, activeModelId: null });
    await initiateModelLoad(deps, false);
    expect(mockLoadTextModel).not.toHaveBeenCalled();
  });

  it('shows alert and returns when memory check fails', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'Not enough RAM', severity: 'critical' });
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
    expect(deps.setIsModelLoading).not.toHaveBeenCalled();
  });

  it('loads model successfully when not already loading', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce({ vision: true });
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);
    expect(deps.setSupportsVision).toHaveBeenCalledWith(true);
    expect(deps.addMessage).toHaveBeenCalled(); // system msg with load time
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(false);
  });

  it('skips memory check and UI updates when alreadyLoading=true', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    await initiateModelLoad(deps, true);
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    expect(deps.setIsModelLoading).not.toHaveBeenCalled();
  });

  it('shows error alert when load throws and not already loading', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('Load failed'));
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});

// ─────────────────────────────────────────────
// proceedWithModelLoadFn
// ─────────────────────────────────────────────

describe('proceedWithModelLoadFn', () => {
  it('loads model and posts system message when showGenerationDetails=true', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce(null);
    const deps = makeDeps({ activeConversationId: 'conv-1', settings: { showGenerationDetails: true } });
    deps.modelLoadStartTimeRef.current = Date.now() - 1000;
    const model = createDownloadedModel({ id: 'model-1', name: 'Fast Model' });
    await proceedWithModelLoadFn(deps, model);
    expect(deps.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ isSystemInfo: true }),
    );
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  it('calls createConversation when no active conversation and showGenerationDetails=false', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps({ activeConversationId: null, settings: { showGenerationDetails: false } });
    const model = createDownloadedModel({ id: 'model-2' });
    await proceedWithModelLoadFn(deps, model);
    expect(deps.createConversation).toHaveBeenCalledWith('model-2');
    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('shows error alert when load throws', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('GGUF error'));
    const deps = makeDeps();
    const model = createDownloadedModel();
    await proceedWithModelLoadFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});

// ─────────────────────────────────────────────
// handleModelSelectFn
// ─────────────────────────────────────────────

describe('handleModelSelectFn', () => {
  it('closes selector immediately when same model is already loaded', async () => {
    const model = createDownloadedModel({ filePath: '/loaded/model.gguf' });
    mockGetLoadedModelPath.mockReturnValueOnce('/loaded/model.gguf');
    const deps = makeDeps();
    await handleModelSelectFn(deps, model);
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
    expect(mockLoadTextModel).not.toHaveBeenCalled();
  });

  it('shows alert when memory check fails', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM' });
    const deps = makeDeps();
    const model = createDownloadedModel();
    await handleModelSelectFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
  });

  it('shows warning alert when memory severity is warning', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: true, severity: 'warning', message: 'Low memory' });
    const deps = makeDeps();
    const model = createDownloadedModel();
    await handleModelSelectFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Low Memory Warning' }),
    );
  });
});

// ─────────────────────────────────────────────
// handleUnloadModelFn
// ─────────────────────────────────────────────

describe('handleUnloadModelFn', () => {
  it('stops streaming before unloading when isStreaming=true', async () => {
    mockUnloadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps({ isStreaming: true, settings: { showGenerationDetails: false } });
    await handleUnloadModelFn(deps);
    expect(mockStopGeneration).toHaveBeenCalled();
    expect(deps.clearStreamingMessage).toHaveBeenCalled();
    expect(mockUnloadTextModel).toHaveBeenCalled();
  });

  it('posts system message after unloading when showGenerationDetails=true', async () => {
    mockUnloadTextModel.mockResolvedValueOnce(undefined);
    const model = createDownloadedModel({ name: 'My Model' });
    const deps = makeDeps({ activeModel: model, isStreaming: false, settings: { showGenerationDetails: true } });
    await handleUnloadModelFn(deps);
    expect(deps.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ content: expect.stringContaining('My Model'), isSystemInfo: true }),
    );
  });

  it('shows error alert when unload throws', async () => {
    mockUnloadTextModel.mockRejectedValueOnce(new Error('Unload failed'));
    const deps = makeDeps({ isStreaming: false, settings: { showGenerationDetails: false } });
    await handleUnloadModelFn(deps);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});
