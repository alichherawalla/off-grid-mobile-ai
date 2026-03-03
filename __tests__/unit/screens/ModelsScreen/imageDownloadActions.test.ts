import { Platform } from 'react-native';
import {
  downloadHuggingFaceModel,
  downloadCoreMLMultiFile,
  proceedWithDownload,
  handleDownloadImageModel,
  cleanupDownloadState,
  registerAndNotify,
  wireDownloadListeners,
  ImageDownloadDeps,
} from '../../../../src/screens/ModelsScreen/imageDownloadActions';
import { ImageModelDescriptor } from '../../../../src/screens/ModelsScreen/types';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('react-native-fs', () => ({
  exists: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/extracted')),
}));

jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((...args: any[]) => ({ visible: true, title: args[0], message: args[1], buttons: args[2] })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

const mockGetImageModelsDirectory = jest.fn(() => '/mock/image-models');
const mockAddDownloadedImageModel = jest.fn((_m?: any) => Promise.resolve());
const mockGetActiveBackgroundDownloads = jest.fn(() => Promise.resolve([]));

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: () => mockGetImageModelsDirectory(),
    addDownloadedImageModel: (m: any) => mockAddDownloadedImageModel(m),
    getActiveBackgroundDownloads: () => mockGetActiveBackgroundDownloads(),
  },
  hardwareService: {
    getSoCInfo: jest.fn(() => Promise.resolve({ hasNPU: true, qnnVariant: '8gen2' })),
  },
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    startDownload: jest.fn(() => Promise.resolve({ downloadId: 42 })),
    startMultiFileDownload: jest.fn(() => Promise.resolve({ downloadId: 99 })),
    downloadFileTo: jest.fn(() => ({
      promise: Promise.resolve(),
    })),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn((_id: number, cb: Function) => {
      // Store callback for manual invocation in tests
      (mockOnCompleteCallbacks as any[]).push(cb);
      return jest.fn();
    }),
    onError: jest.fn((_id: number, cb: Function) => {
      (mockOnErrorCallbacks as any[]).push(cb);
      return jest.fn();
    }),
    moveCompletedDownload: jest.fn(() => Promise.resolve()),
    startProgressPolling: jest.fn(),
  },
}));

jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn((path: string) => Promise.resolve(path)),
  downloadCoreMLTokenizerFiles: jest.fn(() => Promise.resolve()),
}));

let mockOnCompleteCallbacks: Function[] = [];
let mockOnErrorCallbacks: Function[] = [];

// ============================================================================
// Helpers
// ============================================================================

function makeDeps(overrides: Partial<ImageDownloadDeps> = {}): ImageDownloadDeps {
  return {
    addImageModelDownloading: jest.fn(),
    removeImageModelDownloading: jest.fn(),
    updateModelProgress: jest.fn(),
    clearModelProgress: jest.fn(),
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    setImageModelDownloadId: jest.fn(),
    setBackgroundDownload: jest.fn(),
    setAlertState: jest.fn(),
    triedImageGen: true,
    ...overrides,
  };
}

function makeHFModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-hf-model',
    name: 'Test HF Model',
    description: 'A test model',
    downloadUrl: 'https://example.com/model.zip',
    size: 1000000,
    style: 'creative',
    backend: 'mnn',
    huggingFaceRepo: 'test/repo',
    huggingFaceFiles: [
      { path: 'unet/model.onnx', size: 500000 },
      { path: 'vae/model.onnx', size: 500000 },
    ],
    ...overrides,
  };
}

function makeZipModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-zip-model',
    name: 'Test Zip Model',
    description: 'A zip model',
    downloadUrl: 'https://example.com/model.zip',
    size: 2000000,
    style: 'creative',
    backend: 'mnn',
    ...overrides,
  };
}

function makeCoreMLModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-coreml-model',
    name: 'Test CoreML Model',
    description: 'A CoreML model',
    downloadUrl: '',
    size: 3000000,
    style: 'photorealistic',
    backend: 'coreml',
    repo: 'apple/coreml-sd',
    coremlFiles: [
      { path: 'unet.mlmodelc', relativePath: 'unet.mlmodelc', size: 2000000, downloadUrl: 'https://example.com/unet' },
      { path: 'vae.mlmodelc', relativePath: 'vae.mlmodelc', size: 1000000, downloadUrl: 'https://example.com/vae' },
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('imageDownloadActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnCompleteCallbacks = [];
    mockOnErrorCallbacks = [];
  });

  // ==========================================================================
  // downloadHuggingFaceModel
  // ==========================================================================
  describe('downloadHuggingFaceModel', () => {
    it('shows error when huggingFaceRepo is missing', async () => {
      const deps = makeDeps();
      const model = makeHFModelInfo({ huggingFaceRepo: undefined, huggingFaceFiles: undefined });

      await downloadHuggingFaceModel(model, deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
      expect(deps.addImageModelDownloading).not.toHaveBeenCalled();
    });

    it('shows error when huggingFaceFiles is missing', async () => {
      const deps = makeDeps();
      const model = makeHFModelInfo({ huggingFaceFiles: undefined });

      await downloadHuggingFaceModel(model, deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });

    it('downloads all files and registers model on success', async () => {
      const deps = makeDeps();
      const model = makeHFModelInfo();

      await downloadHuggingFaceModel(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalledWith('test-hf-model');
      expect(deps.updateModelProgress).toHaveBeenCalled();
      expect(mockAddDownloadedImageModel).toHaveBeenCalled();
      expect(deps.addDownloadedImageModel).toHaveBeenCalled();
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-hf-model');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('test-hf-model');
      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Success' }),
      );
    });

    it('sets active image model when none is active', async () => {
      const deps = makeDeps({ activeImageModelId: null });
      const model = makeHFModelInfo();

      await downloadHuggingFaceModel(model, deps);

      expect(deps.setActiveImageModelId).toHaveBeenCalledWith('test-hf-model');
    });

    it('does not override active image model if one already set', async () => {
      const deps = makeDeps({ activeImageModelId: 'existing-model' });
      const model = makeHFModelInfo();

      await downloadHuggingFaceModel(model, deps);

      expect(deps.setActiveImageModelId).not.toHaveBeenCalled();
    });

    it('cleans up and shows error on download failure', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      backgroundDownloadService.downloadFileTo.mockReturnValueOnce({
        promise: Promise.reject(new Error('Network failed')),
      });

      const deps = makeDeps();
      const model = makeHFModelInfo();

      await downloadHuggingFaceModel(model, deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-hf-model');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('test-hf-model');
    });
  });

  // ==========================================================================
  // downloadCoreMLMultiFile
  // ==========================================================================
  describe('downloadCoreMLMultiFile', () => {
    it('shows alert when background downloads not available', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      backgroundDownloadService.isAvailable.mockReturnValueOnce(false);

      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Not Available' }),
      );
      expect(deps.addImageModelDownloading).not.toHaveBeenCalled();
    });

    it('returns early when coremlFiles is empty', async () => {
      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo({ coremlFiles: [] }), deps);

      expect(deps.addImageModelDownloading).not.toHaveBeenCalled();
    });

    it('starts multi-file download and sets up listeners', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      const deps = makeDeps();

      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalledWith('test-coreml-model');
      expect(backgroundDownloadService.startMultiFileDownload).toHaveBeenCalled();
      expect(deps.setImageModelDownloadId).toHaveBeenCalledWith('test-coreml-model', 99);
      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(99, expect.any(Object));
      expect(backgroundDownloadService.onProgress).toHaveBeenCalledWith(99, expect.any(Function));
      expect(backgroundDownloadService.onComplete).toHaveBeenCalledWith(99, expect.any(Function));
      expect(backgroundDownloadService.onError).toHaveBeenCalledWith(99, expect.any(Function));
      expect(backgroundDownloadService.startProgressPolling).toHaveBeenCalled();
    });

    it('handles completion callback', async () => {
      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      // Trigger the complete callback
      expect(mockOnCompleteCallbacks.length).toBe(1);
      await mockOnCompleteCallbacks[0]();

      expect(mockAddDownloadedImageModel).toHaveBeenCalled();
      expect(deps.addDownloadedImageModel).toHaveBeenCalled();
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-coreml-model');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('test-coreml-model');
      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Success' }),
      );
    });

    it('handles error callback', async () => {
      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      expect(mockOnErrorCallbacks.length).toBe(1);
      mockOnErrorCallbacks[0]({ reason: 'Disk full' });

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-coreml-model');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('test-coreml-model');
    });

    it('handles exception during startMultiFileDownload', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      backgroundDownloadService.startMultiFileDownload.mockRejectedValueOnce(new Error('Native crash'));

      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-coreml-model');
    });
  });

  // ==========================================================================
  // proceedWithDownload
  // ==========================================================================
  describe('proceedWithDownload', () => {
    it('delegates to downloadHuggingFaceModel for HF models', async () => {
      const deps = makeDeps();
      const model = makeHFModelInfo();

      await proceedWithDownload(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalledWith('test-hf-model');
    });

    it('delegates to downloadCoreMLMultiFile for CoreML models', async () => {
      const deps = makeDeps();
      const model = makeCoreMLModelInfo();

      await proceedWithDownload(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalledWith('test-coreml-model');
    });

    it('uses background download service for zip models', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      const deps = makeDeps();
      const model = makeZipModelInfo();

      await proceedWithDownload(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalledWith('test-zip-model');
      expect(backgroundDownloadService.startDownload).toHaveBeenCalled();
      expect(deps.setImageModelDownloadId).toHaveBeenCalledWith('test-zip-model', 42);
    });

    it('handles zip download completion with unzip', async () => {
      const deps = makeDeps();
      const model = makeZipModelInfo();

      await proceedWithDownload(model, deps);

      // Trigger completion
      expect(mockOnCompleteCallbacks.length).toBe(1);
      await mockOnCompleteCallbacks[0]();

      expect(mockAddDownloadedImageModel).toHaveBeenCalled();
      expect(deps.addDownloadedImageModel).toHaveBeenCalled();
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('test-zip-model');
      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Success' }),
      );
    });

    it('handles zip download error callback', async () => {
      const deps = makeDeps();
      const model = makeZipModelInfo();

      await proceedWithDownload(model, deps);

      expect(mockOnErrorCallbacks.length).toBe(1);
      mockOnErrorCallbacks[0]({ reason: 'Connection lost' });

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalled();
    });

    it('handles startDownload exception for zip models', async () => {
      const { backgroundDownloadService } = require('../../../../src/services');
      backgroundDownloadService.startDownload.mockRejectedValueOnce(new Error('Storage full'));

      const deps = makeDeps();
      await proceedWithDownload(makeZipModelInfo(), deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalled();
    });

    it('sets active model on zip download completion when none active', async () => {
      const deps = makeDeps({ activeImageModelId: null });
      const model = makeZipModelInfo();

      await proceedWithDownload(model, deps);
      await mockOnCompleteCallbacks[0]();

      expect(deps.setActiveImageModelId).toHaveBeenCalled();
    });

    it('does not set active model on zip download when one already active', async () => {
      const deps = makeDeps({ activeImageModelId: 'existing' });
      const model = makeZipModelInfo();

      await proceedWithDownload(model, deps);
      await mockOnCompleteCallbacks[0]();

      expect(deps.setActiveImageModelId).not.toHaveBeenCalled();
    });

    it('handles extraction failure on zip download completion', async () => {
      const { unzip } = require('react-native-zip-archive');
      unzip.mockRejectedValueOnce(new Error('Corrupt zip'));

      const deps = makeDeps();
      await proceedWithDownload(makeZipModelInfo(), deps);
      await mockOnCompleteCallbacks[0]();

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleDownloadImageModel
  // ==========================================================================
  describe('handleDownloadImageModel', () => {
    const originalPlatform = Platform.OS;

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: originalPlatform });
    });

    it('proceeds directly for non-QNN models', async () => {
      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'mnn' });

      await handleDownloadImageModel(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalled();
    });

    it('proceeds directly for QNN on non-Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios' });
      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'qnn' });

      await handleDownloadImageModel(model, deps);

      expect(deps.addImageModelDownloading).toHaveBeenCalled();
    });

    it('blocks QNN download on device without NPU (no "Download Anyway")', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android' });
      const { hardwareService } = require('../../../../src/services');
      hardwareService.getSoCInfo.mockResolvedValueOnce({ hasNPU: false });

      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'qnn' });

      await handleDownloadImageModel(model, deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Incompatible Model',
          buttons: [expect.objectContaining({ text: 'OK', style: 'cancel' })],
        }),
      );
      // Should not start download
      expect(deps.addImageModelDownloading).not.toHaveBeenCalled();
    });

    it('shows "Download Anyway" for variant mismatch (has NPU)', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android' });
      const { hardwareService } = require('../../../../src/services');
      hardwareService.getSoCInfo.mockResolvedValueOnce({ hasNPU: true, qnnVariant: 'min' });

      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'qnn', variant: '8gen2' });

      await handleDownloadImageModel(model, deps);

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Incompatible Model',
          buttons: expect.arrayContaining([
            expect.objectContaining({ text: 'Cancel' }),
            expect.objectContaining({ text: 'Download Anyway' }),
          ]),
        }),
      );
    });

    it.each([
      ['min', '8gen2', true, 'incompatible min device with 8gen2 model'],
      ['8gen2', '8gen2', false, 'compatible same variant'],
      ['8gen2', 'min', false, '8gen2 device compatible with all variants'],
      ['8gen1', '8gen2', true, '8gen1 incompatible with 8gen2 model'],
      ['8gen1', 'min', false, '8gen1 compatible with non-8gen2 variants'],
    ])('QNN variant: %s device + %s model → incompatible=%s (%s)', async (deviceVariant, modelVariant, expectIncompatible) => {
      Object.defineProperty(Platform, 'OS', { value: 'android' });
      const { hardwareService } = require('../../../../src/services');
      hardwareService.getSoCInfo.mockResolvedValueOnce({ hasNPU: true, qnnVariant: deviceVariant });
      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'qnn', variant: modelVariant });
      await handleDownloadImageModel(model, deps);
      if (expectIncompatible) {
        expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Incompatible Model' }));
      } else {
        expect(deps.addImageModelDownloading).toHaveBeenCalled();
      }
    });

    it('proceeds for QNN with NPU but no variant info', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android' });
      const { hardwareService } = require('../../../../src/services');
      hardwareService.getSoCInfo.mockResolvedValueOnce({ hasNPU: true, qnnVariant: undefined });
      const deps = makeDeps();
      const model = makeZipModelInfo({ backend: 'qnn' });
      await handleDownloadImageModel(model, deps);
      expect(deps.addImageModelDownloading).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // cleanupDownloadState
  // ==========================================================================
  describe('cleanupDownloadState', () => {
    it('calls removeImageModelDownloading, clearModelProgress, and setBackgroundDownload', () => {
      const deps = makeDeps();
      cleanupDownloadState(deps, 'model-1', 42);

      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('model-1');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('model-1');
      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(42, null);
    });

    it('skips setBackgroundDownload when downloadId is undefined', () => {
      const deps = makeDeps();
      cleanupDownloadState(deps, 'model-1');

      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('model-1');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('model-1');
      expect(deps.setBackgroundDownload).not.toHaveBeenCalled();
    });

    it('skips setBackgroundDownload when downloadId is null-ish (0 is valid)', () => {
      const deps = makeDeps();
      cleanupDownloadState(deps, 'model-1', 0);

      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(0, null);
    });
  });

  // ==========================================================================
  // registerAndNotify
  // ==========================================================================
  describe('registerAndNotify', () => {
    const imageModel = {
      id: 'img-1', name: 'Test', description: 'desc',
      modelPath: '/path', downloadedAt: '2026-01-01', size: 100, style: 'creative' as const,
    };

    it('registers model via modelManager and deps, then shows success alert', async () => {
      const deps = makeDeps();
      await registerAndNotify(deps, { imageModel, modelName: 'Test', downloadId: 10 });

      expect(mockAddDownloadedImageModel).toHaveBeenCalledWith(imageModel);
      expect(deps.addDownloadedImageModel).toHaveBeenCalledWith(imageModel);
      expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
      // cleanup was called
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('img-1');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('img-1');
      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(10, null);
    });

    it('sets active model when none is active', async () => {
      const deps = makeDeps({ activeImageModelId: null });
      await registerAndNotify(deps, { imageModel, modelName: 'Test' });

      expect(deps.setActiveImageModelId).toHaveBeenCalledWith('img-1');
    });

    it('does not set active model when one already exists', async () => {
      const deps = makeDeps({ activeImageModelId: 'existing' });
      await registerAndNotify(deps, { imageModel, modelName: 'Test' });

      expect(deps.setActiveImageModelId).not.toHaveBeenCalled();
    });

    it('does not auto-load when onboarding image flow is still active', async () => {
      const deps = makeDeps({ activeImageModelId: null, triedImageGen: false });
      await registerAndNotify(deps, { imageModel, modelName: 'Test' });

      expect(deps.setActiveImageModelId).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // wireDownloadListeners
  // ==========================================================================
  describe('wireDownloadListeners', () => {
    it('calls onCompleteWork on complete event', async () => {
      const deps = makeDeps();
      const onCompleteWork = jest.fn(() => Promise.resolve());

      wireDownloadListeners({ downloadId: 50, modelId: 'mdl', deps }, onCompleteWork);

      expect(mockOnCompleteCallbacks.length).toBe(1);
      await mockOnCompleteCallbacks[0]();
      expect(onCompleteWork).toHaveBeenCalled();
    });

    it('shows error alert and cleans up on error event', () => {
      const deps = makeDeps();
      const onCompleteWork = jest.fn(() => Promise.resolve());

      wireDownloadListeners({ downloadId: 50, modelId: 'mdl', deps }, onCompleteWork);

      expect(mockOnErrorCallbacks.length).toBe(1);
      mockOnErrorCallbacks[0]({ reason: 'Network lost' });

      expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Download Failed' }));
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('mdl');
      expect(deps.clearModelProgress).toHaveBeenCalledWith('mdl');
      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(50, null);
    });

    it('cleans up and shows error when onCompleteWork throws', async () => {
      const deps = makeDeps();
      const onCompleteWork = jest.fn(() => Promise.reject(new Error('Processing failed')));

      wireDownloadListeners({ downloadId: 50, modelId: 'mdl', deps }, onCompleteWork);

      await mockOnCompleteCallbacks[0]();

      expect(deps.setAlertState).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Download Failed', message: 'Processing failed' }),
      );
      expect(deps.removeImageModelDownloading).toHaveBeenCalledWith('mdl');
    });
  });

  // ==========================================================================
  // Metadata persistence
  // ==========================================================================
  describe('metadata persistence', () => {
    it('proceedWithDownload persists imageDownloadType: zip and metadata for zip models', async () => {
      const deps = makeDeps();
      await proceedWithDownload(makeZipModelInfo(), deps);

      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(42, expect.objectContaining({
        imageDownloadType: 'zip',
        imageModelName: 'Test Zip Model',
        imageModelDescription: 'A zip model',
        imageModelSize: 2000000,
        imageModelStyle: 'creative',
        imageModelBackend: 'mnn',
      }));
    });

    it('downloadCoreMLMultiFile persists imageDownloadType: multifile and repo', async () => {
      const deps = makeDeps();
      await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

      expect(deps.setBackgroundDownload).toHaveBeenCalledWith(99, expect.objectContaining({
        imageDownloadType: 'multifile',
        imageModelName: 'Test CoreML Model',
        imageModelBackend: 'coreml',
        imageModelRepo: 'apple/coreml-sd',
      }));
    });
  });
});
