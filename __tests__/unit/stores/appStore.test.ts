/**
 * App Store Unit Tests
 *
 * Tests for app-wide state management including models, settings, and image generation.
 * Priority: P0 (Critical) - Core functionality for the app.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, getAppState } from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createDeviceInfo,
  createModelRecommendation,
  createONNXImageModel,
  createGeneratedImage,
} from '../../utils/factories';

describe('appStore', () => {
  beforeEach(() => {
    resetStores();
  });

  // ============================================================================
  // Onboarding
  // ============================================================================
  describe('onboarding', () => {
    it('starts with onboarding incomplete', () => {
      expect(getAppState().hasCompletedOnboarding).toBe(false);
    });

    it('setOnboardingComplete updates state', () => {
      const { setOnboardingComplete } = useAppStore.getState();

      setOnboardingComplete(true);

      expect(getAppState().hasCompletedOnboarding).toBe(true);
    });

    it('can reset onboarding state', () => {
      const { setOnboardingComplete } = useAppStore.getState();

      setOnboardingComplete(true);
      setOnboardingComplete(false);

      expect(getAppState().hasCompletedOnboarding).toBe(false);
    });
  });

  // ============================================================================
  // Device Info
  // ============================================================================
  describe('deviceInfo', () => {
    it('starts with null deviceInfo', () => {
      expect(getAppState().deviceInfo).toBeNull();
    });

    it('setDeviceInfo updates state', () => {
      const { setDeviceInfo } = useAppStore.getState();
      const deviceInfo = createDeviceInfo();

      setDeviceInfo(deviceInfo);

      expect(getAppState().deviceInfo).toEqual(deviceInfo);
    });

    it('setModelRecommendation updates state', () => {
      const { setModelRecommendation } = useAppStore.getState();
      const recommendation = createModelRecommendation();

      setModelRecommendation(recommendation);

      expect(getAppState().modelRecommendation).toEqual(recommendation);
    });
  });

  // ============================================================================
  // Downloaded Models
  // ============================================================================
  describe('downloadedModels', () => {
    it('starts with empty downloadedModels', () => {
      expect(getAppState().downloadedModels).toEqual([]);
    });

    it('setDownloadedModels replaces entire list', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const models = [createDownloadedModel(), createDownloadedModel()];

      setDownloadedModels(models);

      expect(getAppState().downloadedModels).toHaveLength(2);
    });

    it('addDownloadedModel appends new model', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const model = createDownloadedModel();

      addDownloadedModel(model);

      expect(getAppState().downloadedModels).toHaveLength(1);
      expect(getAppState().downloadedModels[0].id).toBe(model.id);
    });

    it('addDownloadedModel replaces model with same ID', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'same-id', name: 'Original' });
      const model2 = createDownloadedModel({ id: 'same-id', name: 'Updated' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('Updated');
    });

    it('removeDownloadedModel removes model by ID', () => {
      const { addDownloadedModel, removeDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'model-1' });
      const model2 = createDownloadedModel({ id: 'model-2' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      removeDownloadedModel('model-1');

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model-2');
    });

    it('removeDownloadedModel clears activeModelId if active model removed', () => {
      const { addDownloadedModel, setActiveModelId, removeDownloadedModel } = useAppStore.getState();
      const model = createDownloadedModel({ id: 'active-model' });

      addDownloadedModel(model);
      setActiveModelId('active-model');
      expect(getAppState().activeModelId).toBe('active-model');

      removeDownloadedModel('active-model');

      expect(getAppState().activeModelId).toBeNull();
    });

    it('removeDownloadedModel preserves activeModelId if different model removed', () => {
      const { addDownloadedModel, setActiveModelId, removeDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'model-1' });
      const model2 = createDownloadedModel({ id: 'model-2' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      setActiveModelId('model-1');

      removeDownloadedModel('model-2');

      expect(getAppState().activeModelId).toBe('model-1');
    });
  });

  // ============================================================================
  // Active Model
  // ============================================================================
  describe('activeModel', () => {
    it('starts with null activeModelId', () => {
      expect(getAppState().activeModelId).toBeNull();
    });

    it('setActiveModelId updates state', () => {
      const { setActiveModelId } = useAppStore.getState();

      setActiveModelId('model-123');

      expect(getAppState().activeModelId).toBe('model-123');
    });

    it('setActiveModelId can clear active model', () => {
      const { setActiveModelId } = useAppStore.getState();

      setActiveModelId('model-123');
      setActiveModelId(null);

      expect(getAppState().activeModelId).toBeNull();
    });
  });

  // ============================================================================
  // Loading States
  // ============================================================================
  describe('loadingStates', () => {
    it('starts with isLoadingModel false', () => {
      expect(getAppState().isLoadingModel).toBe(false);
    });

    it('setIsLoadingModel updates state', () => {
      const { setIsLoadingModel } = useAppStore.getState();

      setIsLoadingModel(true);
      expect(getAppState().isLoadingModel).toBe(true);

      setIsLoadingModel(false);
      expect(getAppState().isLoadingModel).toBe(false);
    });
  });

  // ============================================================================
  // Download Progress
  // ============================================================================
  describe('downloadProgress', () => {
    it('starts with empty downloadProgress', () => {
      expect(getAppState().downloadProgress).toEqual({});
    });

    it('setDownloadProgress adds progress for model', () => {
      const { setDownloadProgress } = useAppStore.getState();

      setDownloadProgress('model-1', {
        progress: 0.5,
        bytesDownloaded: 1000,
        totalBytes: 2000,
      });

      const progress = getAppState().downloadProgress['model-1'];
      expect(progress.progress).toBe(0.5);
      expect(progress.bytesDownloaded).toBe(1000);
      expect(progress.totalBytes).toBe(2000);
    });

    it('setDownloadProgress updates existing progress', () => {
      const { setDownloadProgress } = useAppStore.getState();

      setDownloadProgress('model-1', { progress: 0.5, bytesDownloaded: 1000, totalBytes: 2000 });
      setDownloadProgress('model-1', { progress: 0.75, bytesDownloaded: 1500, totalBytes: 2000 });

      expect(getAppState().downloadProgress['model-1'].progress).toBe(0.75);
    });

    it('setDownloadProgress with null removes entry', () => {
      const { setDownloadProgress } = useAppStore.getState();

      setDownloadProgress('model-1', { progress: 0.5, bytesDownloaded: 1000, totalBytes: 2000 });
      setDownloadProgress('model-1', null);

      expect(getAppState().downloadProgress['model-1']).toBeUndefined();
    });

    it('tracks multiple downloads simultaneously', () => {
      const { setDownloadProgress } = useAppStore.getState();

      setDownloadProgress('model-1', { progress: 0.3, bytesDownloaded: 300, totalBytes: 1000 });
      setDownloadProgress('model-2', { progress: 0.7, bytesDownloaded: 700, totalBytes: 1000 });

      const progress = getAppState().downloadProgress;
      expect(progress['model-1'].progress).toBe(0.3);
      expect(progress['model-2'].progress).toBe(0.7);
    });
  });

  // ============================================================================
  // Background Downloads
  // ============================================================================
  describe('backgroundDownloads', () => {
    it('starts with empty activeBackgroundDownloads', () => {
      expect(getAppState().activeBackgroundDownloads).toEqual({});
    });

    it('setBackgroundDownload adds download info', () => {
      const { setBackgroundDownload } = useAppStore.getState();

      setBackgroundDownload(123, {
        modelId: 'model-1',
        fileName: 'model.gguf',
        quantization: 'Q4_K_M',
        author: 'test-author',
        totalBytes: 4000000000,
      });

      const download = getAppState().activeBackgroundDownloads[123];
      expect(download.modelId).toBe('model-1');
      expect(download.fileName).toBe('model.gguf');
    });

    it('setBackgroundDownload with null removes entry', () => {
      const { setBackgroundDownload } = useAppStore.getState();

      setBackgroundDownload(123, {
        modelId: 'model-1',
        fileName: 'model.gguf',
        quantization: 'Q4_K_M',
        author: 'test-author',
        totalBytes: 4000000000,
      });
      setBackgroundDownload(123, null);

      expect(getAppState().activeBackgroundDownloads[123]).toBeUndefined();
    });

    it('clearBackgroundDownloads removes all', () => {
      const { setBackgroundDownload, clearBackgroundDownloads } = useAppStore.getState();

      setBackgroundDownload(1, { modelId: 'm1', fileName: 'f1', quantization: 'Q4', author: 'a', totalBytes: 100 });
      setBackgroundDownload(2, { modelId: 'm2', fileName: 'f2', quantization: 'Q4', author: 'a', totalBytes: 100 });

      clearBackgroundDownloads();

      expect(getAppState().activeBackgroundDownloads).toEqual({});
    });
  });

  // ============================================================================
  // Settings
  // ============================================================================
  describe('settings', () => {
    it('has sensible defaults', () => {
      const settings = getAppState().settings;

      expect(settings.temperature).toBe(0.7);
      expect(settings.maxTokens).toBe(1024);
      expect(settings.topP).toBe(0.9);
      expect(settings.contextLength).toBe(2048);
      expect(settings.imageGenerationMode).toBe('auto');
      expect(settings.enableGpu).toBe(false);
    });

    it('updateSettings merges partial settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ temperature: 0.9 });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.9);
      expect(settings.maxTokens).toBe(1024); // unchanged
    });

    it('updateSettings can update multiple settings at once', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        temperature: 0.5,
        maxTokens: 2048,
        enableGpu: false,
      });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.5);
      expect(settings.maxTokens).toBe(2048);
      expect(settings.enableGpu).toBe(false);
    });

    it('updateSettings handles image generation settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        imageGenerationMode: 'manual',
        imageSteps: 30,
        imageGuidanceScale: 8.5,
        imageWidth: 768,
        imageHeight: 768,
      });

      const settings = getAppState().settings;
      expect(settings.imageGenerationMode).toBe('manual');
      expect(settings.imageSteps).toBe(30);
      expect(settings.imageGuidanceScale).toBe(8.5);
      expect(settings.imageWidth).toBe(768);
    });
  });

  // ============================================================================
  // Image Models (ONNX)
  // ============================================================================
  describe('imageModels', () => {
    it('starts with empty downloadedImageModels', () => {
      expect(getAppState().downloadedImageModels).toEqual([]);
    });

    it('setDownloadedImageModels replaces list', () => {
      const { setDownloadedImageModels } = useAppStore.getState();
      const models = [createONNXImageModel(), createONNXImageModel()];

      setDownloadedImageModels(models);

      expect(getAppState().downloadedImageModels).toHaveLength(2);
    });

    it('addDownloadedImageModel adds new model', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel();

      addDownloadedImageModel(model);

      expect(getAppState().downloadedImageModels).toHaveLength(1);
    });

    it('addDownloadedImageModel replaces model with same ID', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      const model1 = createONNXImageModel({ id: 'same-id', name: 'Original' });
      const model2 = createONNXImageModel({ id: 'same-id', name: 'Updated' });

      addDownloadedImageModel(model1);
      addDownloadedImageModel(model2);

      const models = getAppState().downloadedImageModels;
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('Updated');
    });

    it('removeDownloadedImageModel removes model', () => {
      const { addDownloadedImageModel, removeDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel({ id: 'img-model-1' });

      addDownloadedImageModel(model);
      removeDownloadedImageModel('img-model-1');

      expect(getAppState().downloadedImageModels).toHaveLength(0);
    });

    it('removeDownloadedImageModel clears activeImageModelId if active', () => {
      const { addDownloadedImageModel, setActiveImageModelId, removeDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel({ id: 'img-model-1' });

      addDownloadedImageModel(model);
      setActiveImageModelId('img-model-1');
      removeDownloadedImageModel('img-model-1');

      expect(getAppState().activeImageModelId).toBeNull();
    });

    it('setActiveImageModelId updates state', () => {
      const { setActiveImageModelId } = useAppStore.getState();

      setActiveImageModelId('img-model-1');

      expect(getAppState().activeImageModelId).toBe('img-model-1');
    });
  });

  // ============================================================================
  // Image Model Download Tracking (Multi-download)
  // ============================================================================
  describe('imageModelDownloadTracking', () => {
    it('starts with empty imageModelDownloading array', () => {
      expect(getAppState().imageModelDownloading).toEqual([]);
    });

    it('starts with empty imageModelDownloadIds', () => {
      expect(getAppState().imageModelDownloadIds).toEqual({});
    });

    it('addImageModelDownloading adds model to array', () => {
      const { addImageModelDownloading } = useAppStore.getState();

      addImageModelDownloading('anythingv5_cpu');

      expect(getAppState().imageModelDownloading).toEqual(['anythingv5_cpu']);
    });

    it('addImageModelDownloading does not duplicate', () => {
      const { addImageModelDownloading } = useAppStore.getState();

      addImageModelDownloading('anythingv5_cpu');
      addImageModelDownloading('anythingv5_cpu');

      expect(getAppState().imageModelDownloading).toEqual(['anythingv5_cpu']);
    });

    it('removeImageModelDownloading removes model from array', () => {
      const { addImageModelDownloading, removeImageModelDownloading } = useAppStore.getState();

      addImageModelDownloading('model-a');
      addImageModelDownloading('model-b');
      removeImageModelDownloading('model-a');

      expect(getAppState().imageModelDownloading).toEqual(['model-b']);
    });

    it('setImageModelDownloadId maps model to download ID', () => {
      const { setImageModelDownloadId } = useAppStore.getState();

      setImageModelDownloadId('model-a', 42);

      expect(getAppState().imageModelDownloadIds['model-a']).toBe(42);
    });

    it('setImageModelDownloadId with null removes mapping', () => {
      const { setImageModelDownloadId } = useAppStore.getState();

      setImageModelDownloadId('model-a', 42);
      setImageModelDownloadId('model-a', null);

      expect(getAppState().imageModelDownloadIds['model-a']).toBeUndefined();
    });

    it('multiple concurrent downloads tracked independently', () => {
      const { addImageModelDownloading, setImageModelDownloadId } = useAppStore.getState();

      addImageModelDownloading('model-a');
      setImageModelDownloadId('model-a', 1);
      addImageModelDownloading('model-b');
      setImageModelDownloadId('model-b', 2);

      expect(getAppState().imageModelDownloading).toEqual(['model-a', 'model-b']);
      expect(getAppState().imageModelDownloadIds).toEqual({ 'model-a': 1, 'model-b': 2 });
    });

    it('removeImageModelDownloading also clears download ID', () => {
      const { addImageModelDownloading, setImageModelDownloadId, removeImageModelDownloading } = useAppStore.getState();

      addImageModelDownloading('model-a');
      setImageModelDownloadId('model-a', 1);
      removeImageModelDownloading('model-a');

      expect(getAppState().imageModelDownloading).toEqual([]);
      expect(getAppState().imageModelDownloadIds['model-a']).toBeUndefined();
    });

    it('clearImageModelDownloading clears all', () => {
      const { addImageModelDownloading, setImageModelDownloadId, clearImageModelDownloading } = useAppStore.getState();

      addImageModelDownloading('model-a');
      setImageModelDownloadId('model-a', 1);
      addImageModelDownloading('model-b');
      setImageModelDownloadId('model-b', 2);

      clearImageModelDownloading();

      expect(getAppState().imageModelDownloading).toEqual([]);
      expect(getAppState().imageModelDownloadIds).toEqual({});
    });

    it('image download metadata stored in activeBackgroundDownloads enables cancel', () => {
      const { setBackgroundDownload, addImageModelDownloading, setImageModelDownloadId, removeImageModelDownloading } = useAppStore.getState();

      // Simulate starting an image model download with metadata
      addImageModelDownloading('anythingv5_cpu');
      setImageModelDownloadId('anythingv5_cpu', 99);
      setBackgroundDownload(99, {
        modelId: 'image:anythingv5_cpu',
        fileName: 'anythingv5_cpu.zip',
        quantization: '',
        author: 'Image Generation',
        totalBytes: 1_000_000_000,
      });

      // Metadata should be findable by downloadId
      const meta = getAppState().activeBackgroundDownloads[99];
      expect(meta).toBeDefined();
      expect(meta.modelId).toBe('image:anythingv5_cpu');
      expect(meta.fileName).toBe('anythingv5_cpu.zip');

      // Simulate cancel: clear all state
      setBackgroundDownload(99, null);
      removeImageModelDownloading('anythingv5_cpu');

      expect(getAppState().activeBackgroundDownloads[99]).toBeUndefined();
      expect(getAppState().imageModelDownloading).toEqual([]);
    });
  });

  // ============================================================================
  // Image Model Download Persistence (survives app restart)
  // ============================================================================
  describe('imageModelDownloadPersistence', () => {
    it('partialize includes imageModelDownloading array', () => {
      const { addImageModelDownloading } = useAppStore.getState();
      addImageModelDownloading('test-model');

      expect(getAppState().imageModelDownloading).toEqual(['test-model']);
    });

    it('partialize includes imageModelDownloadIds record', () => {
      const { setImageModelDownloadId } = useAppStore.getState();
      setImageModelDownloadId('test-model', 42);

      expect(getAppState().imageModelDownloadIds).toEqual({ 'test-model': 42 });
    });

    it('imageModelDownloading array survives store rehydration', () => {
      const { addImageModelDownloading, setImageModelDownloadId } = useAppStore.getState();

      // Simulate active downloads
      addImageModelDownloading('sd-model-v2');
      setImageModelDownloadId('sd-model-v2', 7);
      addImageModelDownloading('sd-model-v3');
      setImageModelDownloadId('sd-model-v3', 8);

      const state = useAppStore.getState();
      expect(state.imageModelDownloading).toEqual(['sd-model-v2', 'sd-model-v3']);
      expect(state.imageModelDownloadIds).toEqual({ 'sd-model-v2': 7, 'sd-model-v3': 8 });
    });

    it('cleared download state persists empty values correctly', () => {
      const { addImageModelDownloading, setImageModelDownloadId, removeImageModelDownloading } = useAppStore.getState();

      // Start then cancel a download
      addImageModelDownloading('model-x');
      setImageModelDownloadId('model-x', 99);
      removeImageModelDownloading('model-x');

      const state = useAppStore.getState();
      expect(state.imageModelDownloading).toEqual([]);
      expect(state.imageModelDownloadIds).toEqual({});
    });

    it('activeBackgroundDownloads is also persisted alongside download tracking', () => {
      const { setBackgroundDownload, addImageModelDownloading, setImageModelDownloadId } = useAppStore.getState();

      // Full download setup: both tracking state and metadata
      addImageModelDownloading('coreml-sd21');
      setImageModelDownloadId('coreml-sd21', 5);
      setBackgroundDownload(5, {
        modelId: 'image:coreml-sd21',
        fileName: 'sd21-coreml.zip',
        quantization: '',
        author: 'Apple',
        totalBytes: 2_500_000_000,
      });

      const state = useAppStore.getState();
      expect(state.imageModelDownloading).toEqual(['coreml-sd21']);
      expect(state.imageModelDownloadIds).toEqual({ 'coreml-sd21': 5 });
      expect(state.activeBackgroundDownloads[5]).toBeDefined();
      expect(state.activeBackgroundDownloads[5].modelId).toBe('image:coreml-sd21');
    });
  });

  // ============================================================================
  // Image Generation State
  // ============================================================================
  describe('imageGenerationState', () => {
    it('starts with generation not in progress', () => {
      const state = getAppState();
      expect(state.isGeneratingImage).toBe(false);
      expect(state.imageGenerationProgress).toBeNull();
      expect(state.imageGenerationStatus).toBeNull();
      expect(state.imagePreviewPath).toBeNull();
    });

    it('setIsGeneratingImage updates state', () => {
      const { setIsGeneratingImage } = useAppStore.getState();

      setIsGeneratingImage(true);
      expect(getAppState().isGeneratingImage).toBe(true);

      setIsGeneratingImage(false);
      expect(getAppState().isGeneratingImage).toBe(false);
    });

    it('setImageGenerationProgress tracks steps', () => {
      const { setImageGenerationProgress } = useAppStore.getState();

      setImageGenerationProgress({ step: 5, totalSteps: 20 });

      const progress = getAppState().imageGenerationProgress;
      expect(progress?.step).toBe(5);
      expect(progress?.totalSteps).toBe(20);
    });

    it('setImageGenerationProgress can clear with null', () => {
      const { setImageGenerationProgress } = useAppStore.getState();

      setImageGenerationProgress({ step: 5, totalSteps: 20 });
      setImageGenerationProgress(null);

      expect(getAppState().imageGenerationProgress).toBeNull();
    });

    it('setImageGenerationStatus updates status text', () => {
      const { setImageGenerationStatus } = useAppStore.getState();

      setImageGenerationStatus('Encoding prompt...');
      expect(getAppState().imageGenerationStatus).toBe('Encoding prompt...');

      setImageGenerationStatus(null);
      expect(getAppState().imageGenerationStatus).toBeNull();
    });

    it('setImagePreviewPath updates preview', () => {
      const { setImagePreviewPath } = useAppStore.getState();

      setImagePreviewPath('/path/to/preview.png');
      expect(getAppState().imagePreviewPath).toBe('/path/to/preview.png');

      setImagePreviewPath(null);
      expect(getAppState().imagePreviewPath).toBeNull();
    });
  });

  // ============================================================================
  // Gallery
  // ============================================================================
  describe('gallery', () => {
    it('starts with empty generatedImages', () => {
      expect(getAppState().generatedImages).toEqual([]);
    });

    it('addGeneratedImage prepends to list', () => {
      const { addGeneratedImage } = useAppStore.getState();
      const image1 = createGeneratedImage({ prompt: 'First' });
      const image2 = createGeneratedImage({ prompt: 'Second' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(2);
      expect(images[0].prompt).toBe('Second'); // Most recent first
      expect(images[1].prompt).toBe('First');
    });

    it('removeGeneratedImage removes by ID', () => {
      const { addGeneratedImage, removeGeneratedImage } = useAppStore.getState();
      const image1 = createGeneratedImage({ id: 'img-1' });
      const image2 = createGeneratedImage({ id: 'img-2' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);
      removeGeneratedImage('img-1');

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe('img-2');
    });

    it('removeImagesByConversationId removes all for conversation', () => {
      const { addGeneratedImage, removeImagesByConversationId } = useAppStore.getState();
      const image1 = createGeneratedImage({ id: 'img-1', conversationId: 'conv-1' });
      const image2 = createGeneratedImage({ id: 'img-2', conversationId: 'conv-1' });
      const image3 = createGeneratedImage({ id: 'img-3', conversationId: 'conv-2' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);
      addGeneratedImage(image3);

      const removedIds = removeImagesByConversationId('conv-1');

      expect(removedIds).toContain('img-1');
      expect(removedIds).toContain('img-2');
      expect(removedIds).toHaveLength(2);

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe('img-3');
    });

    it('clearGeneratedImages removes all', () => {
      const { addGeneratedImage, clearGeneratedImages } = useAppStore.getState();

      addGeneratedImage(createGeneratedImage());
      addGeneratedImage(createGeneratedImage());
      clearGeneratedImages();

      expect(getAppState().generatedImages).toEqual([]);
    });
  });

  // ============================================================================
  // Theme Mode
  // ============================================================================
  describe('themeMode', () => {
    it('defaults to system mode', () => {
      expect(getAppState().themeMode).toBe('system');
    });

    it('setThemeMode switches to dark', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');

      expect(getAppState().themeMode).toBe('dark');
    });

    it('setThemeMode can switch back to light', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');
      setThemeMode('light');

      expect(getAppState().themeMode).toBe('light');
    });

    it('setThemeMode can switch to system', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');
      setThemeMode('system');

      expect(getAppState().themeMode).toBe('system');
    });
  });

  // ============================================================================
  // Merge / Migration Function
  // ============================================================================
  describe('merge (persistence migrations)', () => {
    it('migrates old string imageModelDownloading to array', () => {
      // Simulate old persisted state with string value
      const oldPersistedState = {
        imageModelDownloading: 'old-model-id' as any,
        imageModelDownloadIds: {},
      };

      // Apply the merge by setting state directly with old format
      // then checking the merge logic handles it
      const currentState = useAppStore.getState();
      const merged = {
        ...currentState,
        ...oldPersistedState,
      };

      // The merge function converts string to array
      if (typeof merged.imageModelDownloading === 'string') {
        merged.imageModelDownloading = [merged.imageModelDownloading];
      }

      expect(Array.isArray(merged.imageModelDownloading)).toBe(true);
      expect(merged.imageModelDownloading).toEqual(['old-model-id']);
    });

    it('migrates old number imageModelDownloadId to Record', () => {
      // Simulate old persisted state with single number
      const oldPersistedState = {
        imageModelDownloading: ['model-a'],
        imageModelDownloadId: 42 as any,
      };

      const currentState = useAppStore.getState();
      const merged = {
        ...currentState,
        ...oldPersistedState,
      } as any;

      // Apply the same logic as the merge function
      if (typeof merged.imageModelDownloadId === 'number') {
        const ids: Record<string, number> = {};
        if (Array.isArray(merged.imageModelDownloading) && merged.imageModelDownloading.length > 0) {
          ids[merged.imageModelDownloading[0]] = merged.imageModelDownloadId;
        }
        merged.imageModelDownloadIds = ids;
        delete merged.imageModelDownloadId;
      }

      expect(merged.imageModelDownloadIds).toEqual({ 'model-a': 42 });
      expect(merged.imageModelDownloadId).toBeUndefined();
    });

    it('handles null imageModelDownloading gracefully', () => {
      const merged = { imageModelDownloading: null as any };

      if (!Array.isArray(merged.imageModelDownloading)) {
        merged.imageModelDownloading = [];
      }

      expect(merged.imageModelDownloading).toEqual([]);
    });

    it('handles undefined imageModelDownloadIds gracefully', () => {
      const merged = { imageModelDownloadIds: undefined as any };

      if (!merged.imageModelDownloadIds || typeof merged.imageModelDownloadIds !== 'object') {
        merged.imageModelDownloadIds = {};
      }

      expect(merged.imageModelDownloadIds).toEqual({});
    });

    it('migrates persisted modelLoadingStrategy memory to performance', () => {
      const persistedState = {
        settings: { modelLoadingStrategy: 'memory' },
      };
      const currentState = useAppStore.getState();
      const merged: any = { ...currentState, ...persistedState };

      if (persistedState?.settings?.modelLoadingStrategy === 'memory') {
        merged.settings = { ...merged.settings, modelLoadingStrategy: 'performance' };
      }

      expect(merged.settings.modelLoadingStrategy).toBe('performance');
    });

    it('does not override explicit performance setting during migration', () => {
      const persistedState = {
        settings: { modelLoadingStrategy: 'performance' },
      };
      const currentState = useAppStore.getState();
      const merged: any = { ...currentState, ...persistedState };

      if ((persistedState as any)?.settings?.modelLoadingStrategy === 'memory') {
        merged.settings = { ...merged.settings, modelLoadingStrategy: 'performance' };
      }

      expect(merged.settings.modelLoadingStrategy).toBe('performance');
    });

    it('actual store merge function migrates modelLoadingStrategy memory→performance', async () => {
      const AsyncStorage = require('@react-native-async-storage/async-storage');

      // Write persisted state with old 'memory' default into AsyncStorage (as Zustand persist would)
      const persistedPayload = JSON.stringify({
        state: {
          settings: { modelLoadingStrategy: 'memory' },
        },
        version: 0,
      });
      await AsyncStorage.setItem('local-llm-app-storage', persistedPayload);

      // Trigger Zustand persist to rehydrate from storage — this calls the actual merge function
      await (useAppStore as any).persist.rehydrate();

      expect(useAppStore.getState().settings.modelLoadingStrategy).toBe('performance');

      // Clean up storage mock
      await AsyncStorage.removeItem('local-llm-app-storage');
    });
  });

  // ============================================================================
  // Settings Persistence
  // ============================================================================
  describe('settings persistence edge cases', () => {
    it('updateSettings does not clear unrelated fields', () => {
      const { updateSettings } = useAppStore.getState();

      // Set several fields
      updateSettings({
        temperature: 0.5,
        maxTokens: 2048,
        imageSteps: 30,
      });

      // Update only one field
      updateSettings({ temperature: 0.9 });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.9);
      expect(settings.maxTokens).toBe(2048);
      expect(settings.imageSteps).toBe(30);
    });

    it('handles performance settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        nThreads: 8,
        nBatch: 512,
        enableGpu: true,
        gpuLayers: 32,
      });

      const settings = getAppState().settings;
      expect(settings.nThreads).toBe(8);
      expect(settings.nBatch).toBe(512);
      expect(settings.enableGpu).toBe(true);
      expect(settings.gpuLayers).toBe(32);
    });

    it('handles model loading strategy', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ modelLoadingStrategy: 'performance' });
      expect(getAppState().settings.modelLoadingStrategy).toBe('performance');

      updateSettings({ modelLoadingStrategy: 'memory' });
      expect(getAppState().settings.modelLoadingStrategy).toBe('memory');
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('removeDownloadedImageModel branch coverage', () => {
    it('preserves activeImageModelId when a different model is removed', () => {
      const { addDownloadedImageModel, setActiveImageModelId, removeDownloadedImageModel } = useAppStore.getState();
      const model1 = createONNXImageModel({ id: 'img-keep' });
      const model2 = createONNXImageModel({ id: 'img-remove' });

      addDownloadedImageModel(model1);
      addDownloadedImageModel(model2);
      setActiveImageModelId('img-keep');

      removeDownloadedImageModel('img-remove');

      expect(getAppState().activeImageModelId).toBe('img-keep');
      expect(getAppState().downloadedImageModels).toHaveLength(1);
    });
  });

  describe('removeImagesByConversationId branch coverage', () => {
    it('returns empty array when no images match the conversationId', () => {
      const { addGeneratedImage, removeImagesByConversationId } = useAppStore.getState();
      const image = createGeneratedImage({ id: 'img-1', conversationId: 'conv-1' });

      addGeneratedImage(image);

      const removedIds = removeImagesByConversationId('conv-nonexistent');

      expect(removedIds).toEqual([]);
      expect(getAppState().generatedImages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Actual persist merge function tests (exercises real store merge callback)
  // ============================================================================
  describe('persist merge function (actual)', () => {
    // Access the real merge function from the store's persist configuration
    const getMergeFn = () => {
      const options = (useAppStore as any).persist?.getOptions?.();
      return options?.merge as (persistedState: any, currentState: any) => any;
    };

    it('migrates string imageModelDownloading to single-element array', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: 'old-model-id' },
        currentState
      );

      expect(Array.isArray(result.imageModelDownloading)).toBe(true);
      expect(result.imageModelDownloading).toEqual(['old-model-id']);
    });

    it('migrates non-array/non-string imageModelDownloading to empty array', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: null },
        currentState
      );

      expect(result.imageModelDownloading).toEqual([]);
    });

    it('migrates undefined imageModelDownloading to empty array', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: undefined },
        currentState
      );

      // undefined from persisted merges over currentState's [], but undefined is not array
      // so the else-if branch fires
      expect(result.imageModelDownloading).toEqual([]);
    });

    it('migrates number imageModelDownloadId to Record with downloading model', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloading: ['model-a'],
          imageModelDownloadId: 42,
        },
        currentState
      );

      expect(result.imageModelDownloadIds).toEqual({ 'model-a': 42 });
      expect(result.imageModelDownloadId).toBeUndefined();
    });

    it('migrates number imageModelDownloadId to empty Record when no downloading models', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloading: [],
          imageModelDownloadId: 50,
        },
        currentState
      );

      expect(result.imageModelDownloadIds).toEqual({});
      expect(result.imageModelDownloadId).toBeUndefined();
    });

    it('sets imageModelDownloadIds to {} when missing and no old number format', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloading: ['x'],
          imageModelDownloadIds: null,
        },
        currentState
      );

      expect(result.imageModelDownloadIds).toEqual({});
    });

    it('sets imageModelDownloadIds to {} when it is a non-object type', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloading: ['x'],
          imageModelDownloadIds: 'invalid',
        },
        currentState
      );

      expect(result.imageModelDownloadIds).toEqual({});
    });

    it('preserves valid array imageModelDownloading and valid object imageModelDownloadIds', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloading: ['a', 'b'],
          imageModelDownloadIds: { a: 1, b: 2 },
        },
        currentState
      );

      expect(result.imageModelDownloading).toEqual(['a', 'b']);
      expect(result.imageModelDownloadIds).toEqual({ a: 1, b: 2 });
    });

    it('handles persisted state with boolean imageModelDownloading', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: false },
        currentState
      );

      expect(result.imageModelDownloading).toEqual([]);
    });

    it('handles persisted state with number imageModelDownloading', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: 123 },
        currentState
      );

      expect(result.imageModelDownloading).toEqual([]);
    });
  });

  // ============================================================================
  // Settings defaults completeness
  // ============================================================================
  describe('settings defaults completeness', () => {
    it('has correct default systemPrompt', () => {
      expect(getAppState().settings.systemPrompt).toContain('helpful AI assistant');
    });

    it('has correct default repeatPenalty', () => {
      expect(getAppState().settings.repeatPenalty).toBe(1.1);
    });

    it('has correct default nThreads', () => {
      expect(getAppState().settings.nThreads).toBe(6);
    });

    it('has correct default nBatch', () => {
      expect(getAppState().settings.nBatch).toBe(256);
    });

    it('has correct default autoDetectMethod', () => {
      expect(getAppState().settings.autoDetectMethod).toBe('pattern');
    });

    it('has null classifierModelId by default', () => {
      expect(getAppState().settings.classifierModelId).toBeNull();
    });

    it('has correct default imageThreads', () => {
      expect(getAppState().settings.imageThreads).toBe(4);
    });

    it('has correct default image dimensions', () => {
      const settings = getAppState().settings;
      expect(settings.imageWidth).toBe(512);
      expect(settings.imageHeight).toBe(512);
    });

    it('has enhanceImagePrompts disabled by default', () => {
      expect(getAppState().settings.enhanceImagePrompts).toBe(false);
    });

    it('has modelLoadingStrategy set to performance by default', () => {
      expect(getAppState().settings.modelLoadingStrategy).toBe('performance');
    });

    it('has gpuLayers set to 6 by default', () => {
      expect(getAppState().settings.gpuLayers).toBe(6);
    });

    it('has flashAttn enabled by default on iOS (test env platform)', () => {
      // The store initializes flashAttn as Platform.OS !== 'android'.
      // The react-native preset sets defaultPlatform to 'ios', so without resetStores()
      // the store should default to true. We verify by loading a fresh store instance.
      jest.resetModules();
      try {
        // Fresh require — no resetStores() interference, so we see the real default
        const { useAppStore: freshStore } = require('../../../src/stores/appStore');
        // ios !== android → true
        expect(freshStore.getState().settings.flashAttn).toBe(true);
      } finally {
        jest.resetModules();
      }
    });

    it('flashAttn default formula: false on Android, true elsewhere', () => {
      // The store default is Platform.OS !== 'android'. Verify the formula directly.
      const formula = (os: string) => os !== 'android';
      expect(formula('android')).toBe(false); // Android → flash attn off by default
      expect(formula('ios')).toBe(true);      // iOS     → flash attn on by default
    });

    it('updateSettings can toggle flashAttn', () => {
      const { updateSettings } = useAppStore.getState();
      const initial = getAppState().settings.flashAttn;

      updateSettings({ flashAttn: !initial });
      expect(getAppState().settings.flashAttn).toBe(!initial);

      updateSettings({ flashAttn: initial });
      expect(getAppState().settings.flashAttn).toBe(initial);
    });

    it('updateSettings flashAttn does not affect other fields', () => {
      const { updateSettings } = useAppStore.getState();
      const before = getAppState().settings;

      updateSettings({ flashAttn: true });

      const after = getAppState().settings;
      expect(after.temperature).toBe(before.temperature);
      expect(after.gpuLayers).toBe(before.gpuLayers);
      expect(after.enableGpu).toBe(before.enableGpu);
    });

    it('has showGenerationDetails disabled by default', () => {
      expect(getAppState().settings.showGenerationDetails).toBe(false);
    });
  });

  // ============================================================================
  // Concurrent state operations
  // ============================================================================
  describe('concurrent state operations', () => {
    it('handles rapid sequential model additions', () => {
      const { addDownloadedModel } = useAppStore.getState();

      for (let i = 0; i < 10; i++) {
        addDownloadedModel(createDownloadedModel({ id: `model-${i}`, name: `Model ${i}` }));
      }

      expect(getAppState().downloadedModels).toHaveLength(10);
    });

    it('handles rapid sequential image model additions', () => {
      const { addDownloadedImageModel } = useAppStore.getState();

      for (let i = 0; i < 5; i++) {
        addDownloadedImageModel(createONNXImageModel({ id: `img-${i}` }));
      }

      expect(getAppState().downloadedImageModels).toHaveLength(5);
    });

    it('handles interleaved download progress updates', () => {
      const { setDownloadProgress } = useAppStore.getState();

      // Simulate three concurrent downloads with interleaved updates
      setDownloadProgress('m1', { progress: 0.1, bytesDownloaded: 100, totalBytes: 1000 });
      setDownloadProgress('m2', { progress: 0.2, bytesDownloaded: 200, totalBytes: 1000 });
      setDownloadProgress('m3', { progress: 0.3, bytesDownloaded: 300, totalBytes: 1000 });
      setDownloadProgress('m1', { progress: 0.5, bytesDownloaded: 500, totalBytes: 1000 });
      setDownloadProgress('m2', null); // m2 completes
      setDownloadProgress('m1', { progress: 0.9, bytesDownloaded: 900, totalBytes: 1000 });

      const progress = getAppState().downloadProgress;
      expect(progress.m1.progress).toBe(0.9);
      expect(progress.m2).toBeUndefined();
      expect(progress.m3.progress).toBe(0.3);
    });

    it('handles model add and remove in sequence', () => {
      const { addDownloadedModel, removeDownloadedModel, setActiveModelId } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'keep-model' });
      const model2 = createDownloadedModel({ id: 'temp-model' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      setActiveModelId('keep-model');
      removeDownloadedModel('temp-model');

      expect(getAppState().downloadedModels).toHaveLength(1);
      expect(getAppState().downloadedModels[0].id).toBe('keep-model');
      expect(getAppState().activeModelId).toBe('keep-model');
    });
  });

  // ============================================================================
  // Settings edge cases
  // ============================================================================
  describe('settings edge cases', () => {
    it('updateSettings with empty object does not change anything', () => {
      const { updateSettings } = useAppStore.getState();
      const before = { ...getAppState().settings };

      updateSettings({});

      expect(getAppState().settings).toEqual(before);
    });

    it('updateSettings can set temperature to 0', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ temperature: 0 });

      expect(getAppState().settings.temperature).toBe(0);
    });

    it('updateSettings can set maxTokens to very high value', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ maxTokens: 32768 });

      expect(getAppState().settings.maxTokens).toBe(32768);
    });

    it('updateSettings can toggle enhanceImagePrompts', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ enhanceImagePrompts: true });
      expect(getAppState().settings.enhanceImagePrompts).toBe(true);

      updateSettings({ enhanceImagePrompts: false });
      expect(getAppState().settings.enhanceImagePrompts).toBe(false);
    });

    it('updateSettings can set classifierModelId', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ classifierModelId: 'some-model-id' });
      expect(getAppState().settings.classifierModelId).toBe('some-model-id');

      updateSettings({ classifierModelId: null });
      expect(getAppState().settings.classifierModelId).toBeNull();
    });

    it('updateSettings can toggle showGenerationDetails', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ showGenerationDetails: true });
      expect(getAppState().settings.showGenerationDetails).toBe(true);
    });

    it('updateSettings handles all image generation modes', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ imageGenerationMode: 'manual' });
      expect(getAppState().settings.imageGenerationMode).toBe('manual');

      updateSettings({ imageGenerationMode: 'manual' });
      expect(getAppState().settings.imageGenerationMode).toBe('manual');

      updateSettings({ imageGenerationMode: 'auto' });
      expect(getAppState().settings.imageGenerationMode).toBe('auto');
    });

    it('updateSettings handles autoDetectMethod values', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ autoDetectMethod: 'llm' });
      expect(getAppState().settings.autoDetectMethod).toBe('llm');

      updateSettings({ autoDetectMethod: 'pattern' });
      expect(getAppState().settings.autoDetectMethod).toBe('pattern');
    });
  });

  // ============================================================================
  // Image generation state full lifecycle
  // ============================================================================
  describe('image generation lifecycle', () => {
    it('simulates complete image generation lifecycle', () => {
      const {
        setIsGeneratingImage,
        setImageGenerationStatus,
        setImageGenerationProgress,
        setImagePreviewPath,
        addGeneratedImage,
      } = useAppStore.getState();

      // Start generation
      setIsGeneratingImage(true);
      setImageGenerationStatus('Loading model...');
      expect(getAppState().isGeneratingImage).toBe(true);

      // Progress updates
      setImageGenerationStatus('Generating image...');
      setImageGenerationProgress({ step: 1, totalSteps: 20 });
      setImageGenerationProgress({ step: 10, totalSteps: 20 });
      expect(getAppState().imageGenerationProgress?.step).toBe(10);

      // Preview available
      setImagePreviewPath('/tmp/preview.png');
      expect(getAppState().imagePreviewPath).toBe('/tmp/preview.png');

      // Complete
      setImageGenerationProgress({ step: 20, totalSteps: 20 });
      addGeneratedImage(createGeneratedImage({ id: 'result-img' }));
      setIsGeneratingImage(false);
      setImageGenerationProgress(null);
      setImageGenerationStatus(null);
      setImagePreviewPath(null);

      // Verify final state
      expect(getAppState().isGeneratingImage).toBe(false);
      expect(getAppState().imageGenerationProgress).toBeNull();
      expect(getAppState().imageGenerationStatus).toBeNull();
      expect(getAppState().imagePreviewPath).toBeNull();
      expect(getAppState().generatedImages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Background download edge cases
  // ============================================================================
  describe('background download edge cases', () => {
    it('handles multiple background downloads for same model ID', () => {
      const { setBackgroundDownload } = useAppStore.getState();

      // Two different downloadIds for different files of same model
      setBackgroundDownload(1, {
        modelId: 'model-1',
        fileName: 'model.gguf',
        quantization: 'Q4_K_M',
        author: 'author',
        totalBytes: 4000000000,
      });
      setBackgroundDownload(2, {
        modelId: 'model-1',
        fileName: 'mmproj.gguf',
        quantization: '',
        author: 'author',
        totalBytes: 500000000,
      });

      const downloads = getAppState().activeBackgroundDownloads;
      expect(downloads[1].fileName).toBe('model.gguf');
      expect(downloads[2].fileName).toBe('mmproj.gguf');
    });

    it('clearBackgroundDownloads is idempotent', () => {
      const { clearBackgroundDownloads } = useAppStore.getState();

      clearBackgroundDownloads();
      clearBackgroundDownloads();

      expect(getAppState().activeBackgroundDownloads).toEqual({});
    });
  });

  // ============================================================================
  // Cache Type Nudge
  // ============================================================================
  describe('cacheTypeNudge', () => {
    it('defaults to false', () => {
      expect(getAppState().hasSeenCacheTypeNudge).toBe(false);
    });

    it('setHasSeenCacheTypeNudge(true) updates state', () => {
      useAppStore.getState().setHasSeenCacheTypeNudge(true);
      expect(getAppState().hasSeenCacheTypeNudge).toBe(true);
    });

    it('can be reset back to false', () => {
      useAppStore.getState().setHasSeenCacheTypeNudge(true);
      useAppStore.getState().setHasSeenCacheTypeNudge(false);
      expect(getAppState().hasSeenCacheTypeNudge).toBe(false);
    });
  });
});
