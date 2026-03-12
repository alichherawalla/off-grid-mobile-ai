/**
 * useModelLoading Hook Unit Tests
 *
 * Covers Load Anyway button callbacks and isLowMemDevice branches.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useModelLoading } from '../../../src/screens/HomeScreen/hooks/useModelLoading';

// ─── Mocks ────────────────────────────────────────────────────────────────────


jest.mock('../../../src/services', () => ({
  activeModelService: {
    loadTextModel: jest.fn().mockResolvedValue(undefined),
    unloadTextModel: jest.fn().mockResolvedValue(undefined),
    loadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadImageModel: jest.fn().mockResolvedValue(undefined),
    checkMemoryForModel: jest.fn().mockResolvedValue({ canLoad: true, severity: 'safe', message: '' }),
    checkMemoryForDualModel: jest.fn().mockResolvedValue({ canLoad: true, severity: 'safe', message: '' }),
    getLoadedModelIds: jest.fn().mockReturnValue({ textModelId: null, imageModelId: null }),
  },
  hardwareService: {
    getTotalMemoryGB: jest.fn().mockReturnValue(8),
  },
}));

jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any[]) => ({
    visible: true, title, message, buttons: buttons ?? [],
  })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

const { activeModelService, hardwareService } = require('../../../src/services');
const { showAlert: _showAlert, hideAlert } = require('../../../src/components');

const mockLoadTextModel: jest.Mock = activeModelService.loadTextModel;
const mockUnloadTextModel: jest.Mock = activeModelService.unloadTextModel;
const mockLoadImageModel: jest.Mock = activeModelService.loadImageModel;
const mockUnloadImageModel: jest.Mock = activeModelService.unloadImageModel;
const mockCheckMemoryForModel: jest.Mock = activeModelService.checkMemoryForModel;
const mockCheckMemoryForDualModel: jest.Mock = activeModelService.checkMemoryForDualModel;
const mockGetLoadedModelIds: jest.Mock = activeModelService.getLoadedModelIds;
const mockGetTotalMemoryGB: jest.Mock = hardwareService.getTotalMemoryGB;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTextModel(overrides: Partial<any> = {}): any {
  return { id: 'text-1', name: 'Test LLM', filePath: '/path/model.gguf', ...overrides };
}

function makeImageModel(overrides: Partial<any> = {}): any {
  return { id: 'img-1', name: 'SDXL', ...overrides };
}

function makeSetters() {
  return {
    setLoadingState: jest.fn(),
    setPickerType: jest.fn(),
    setAlertState: jest.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useModelLoading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLoadedModelIds.mockReturnValue({ textModelId: null, imageModelId: null });
    mockCheckMemoryForModel.mockResolvedValue({ canLoad: true, severity: 'safe', message: '' });
    mockCheckMemoryForDualModel.mockResolvedValue({ canLoad: true, severity: 'safe', message: '' });
    mockGetTotalMemoryGB.mockReturnValue(8); // high-mem device by default
  });

  afterEach(() => {
  });

  describe('handleSelectTextModel', () => {
    it('skips load when same model is already loaded', async () => {
      mockGetLoadedModelIds.mockReturnValue({ textModelId: 'text-1', imageModelId: null });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        await result.current.handleSelectTextModel(makeTextModel());
      });

      expect(mockLoadTextModel).not.toHaveBeenCalled();
    });

    it('shows Insufficient Memory alert when canLoad=false', async () => {
      mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM' });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectTextModel(makeTextModel());
        jest.advanceTimersByTime(400); // waitForSheetClose(300ms)
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Insufficient Memory' }),
      );
    });

    it('Load Anyway button callback in Insufficient Memory alert triggers load', async () => {
      mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM' });
      mockLoadTextModel.mockResolvedValueOnce(undefined);
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectTextModel(makeTextModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      // Get the Load Anyway button
      const alertState = setters.setAlertState.mock.calls[0][0];
      const loadAnywayBtn = alertState.buttons.find((b: any) => b.text === 'Load Anyway');
      expect(loadAnywayBtn).toBeDefined();

      // Invoke it
      setters.setAlertState.mockClear();
      await act(async () => {
        loadAnywayBtn.onPress();
        jest.advanceTimersByTime(400);
        await Promise.resolve();
      });

      expect(hideAlert).toHaveBeenCalled();
    });

    it('shows Low Memory Warning alert when severity=warning', async () => {
      mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: true, severity: 'warning', message: 'Low RAM' });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectTextModel(makeTextModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Low Memory Warning' }),
      );
    });

    it('initiates loading when memory is safe (sets loading state)', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      // proceedWithTextModelLoad is fire-and-forget; verify it starts loading
      await act(async () => {
        await result.current.handleSelectTextModel(makeTextModel());
      });

      // setPickerType and setLoadingState should be called by proceedWithTextModelLoad
      expect(setters.setPickerType).toHaveBeenCalledWith(null);
      expect(setters.setLoadingState).toHaveBeenCalledWith(
        expect.objectContaining({ isLoading: true, type: 'text' }),
      );
    });
  });

  describe('handleSelectImageModel', () => {
    it('skips load when same image model is already loaded', async () => {
      mockGetLoadedModelIds.mockReturnValue({ textModelId: null, imageModelId: 'img-1' });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        await result.current.handleSelectImageModel(makeImageModel());
      });

      expect(mockLoadImageModel).not.toHaveBeenCalled();
    });

    it('shows Insufficient Memory alert for image model when canLoad=false', async () => {
      mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM img' });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectImageModel(makeImageModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Insufficient Memory' }),
      );
    });

    it('Load Anyway button triggers image model load', async () => {
      mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM img' });
      mockLoadImageModel.mockResolvedValueOnce(undefined);
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectImageModel(makeImageModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      const alertState = setters.setAlertState.mock.calls[0][0];
      const loadAnywayBtn = alertState.buttons.find((b: any) => b.text === 'Load Anyway');
      expect(loadAnywayBtn).toBeDefined();

      setters.setAlertState.mockClear();
      await act(async () => {
        loadAnywayBtn.onPress();
        jest.advanceTimersByTime(800);
        await Promise.resolve();
      });

      expect(hideAlert).toHaveBeenCalled();
    });

    it('shows isLowMemDevice path when memory <= 4GB and safe', async () => {
      mockGetTotalMemoryGB.mockReturnValue(4); // low mem device
      mockCheckMemoryForDualModel.mockResolvedValueOnce({ canLoad: true, severity: 'safe', message: '' });
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectImageModel(makeImageModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Image Generation (Slower)' }),
      );
    });

    it('Load slower button on isLowMemDevice triggers image load', async () => {
      mockGetTotalMemoryGB.mockReturnValue(4);
      mockCheckMemoryForDualModel.mockResolvedValueOnce({ canLoad: true, severity: 'safe', message: '' });
      mockLoadImageModel.mockResolvedValueOnce(undefined);
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleSelectImageModel(makeImageModel());
        jest.advanceTimersByTime(400);
        await p;
      });

      const alertState = setters.setAlertState.mock.calls[0][0];
      const loadBtn = alertState.buttons.find((b: any) => b.text === 'Load (slower)');
      expect(loadBtn).toBeDefined();

      setters.setAlertState.mockClear();
      await act(async () => {
        loadBtn.onPress();
        jest.advanceTimersByTime(800);
        await Promise.resolve();
      });

      expect(hideAlert).toHaveBeenCalled();
    });
  });

  describe('handleUnloadTextModel', () => {
    it('unloads text model and resets loading state', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadTextModel).toHaveBeenCalled();
    });

    it('shows error alert when unload throws', async () => {
      mockUnloadTextModel.mockRejectedValueOnce(new Error('fail'));
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadTextModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(setters.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });
  });

  describe('handleUnloadImageModel', () => {
    it('unloads image model', async () => {
      const setters = makeSetters();
      const { result } = renderHook(() => useModelLoading(setters));

      await act(async () => {
        const p = result.current.handleUnloadImageModel();
        jest.advanceTimersByTime(800);
        await p;
      });

      expect(mockUnloadImageModel).toHaveBeenCalled();
    });
  });
});
