import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo, DownloadedModel, ModelRecommendation, ONNXImageModel, ImageGenerationMode, AutoDetectMethod, ModelLoadingStrategy, CacheType, GeneratedImage, PersistedDownloadInfo } from '../types';

interface AppState {
  // Theme
  themeMode: 'system' | 'light' | 'dark';
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;

  // Onboarding
  hasCompletedOnboarding: boolean;
  setOnboardingComplete: (complete: boolean) => void;

  // Device info
  deviceInfo: DeviceInfo | null;
  modelRecommendation: ModelRecommendation | null;
  setDeviceInfo: (info: DeviceInfo) => void;
  setModelRecommendation: (rec: ModelRecommendation) => void;

  // Downloaded models
  downloadedModels: DownloadedModel[];
  setDownloadedModels: (models: DownloadedModel[]) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
  removeDownloadedModel: (modelId: string) => void;

  // Active model
  activeModelId: string | null;
  setActiveModelId: (modelId: string | null) => void;

  // Loading states
  isLoadingModel: boolean;
  setIsLoadingModel: (loading: boolean) => void;

  // Download progress
  downloadProgress: Record<string, {
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
  }>;
  setDownloadProgress: (modelId: string, progress: {
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
  } | null) => void;

  // Background downloads (Android)
  activeBackgroundDownloads: Record<number, PersistedDownloadInfo>;
  setBackgroundDownload: (downloadId: number, info: PersistedDownloadInfo | null) => void;
  clearBackgroundDownloads: () => void;
  // Settings
  settings: {
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    repeatPenalty: number;
    contextLength: number;
    // Performance settings
    nThreads: number;
    nBatch: number;
    // Image generation settings
    imageGenerationMode: ImageGenerationMode;
    autoDetectMethod: AutoDetectMethod;
    classifierModelId: string | null;
    imageSteps: number;
    imageGuidanceScale: number;
    imageThreads: number;
    imageWidth: number;
    imageHeight: number;
    // Use text LLM to enhance/refine image prompts before generation
    enhanceImagePrompts: boolean;
    // Model loading strategy: 'performance' keeps models loaded, 'memory' loads on demand
    modelLoadingStrategy: ModelLoadingStrategy;
    // GPU acceleration for text model inference (requires model reload)
    enableGpu: boolean;
    // Number of model layers offloaded to GPU (higher = more GPU usage, 0 = CPU only)
    gpuLayers: number;
    // Flash attention: faster but incompatible with Android Hexagon/OpenCL multi-layer GPU offload
    flashAttn: boolean;
    // KV cache quantization type: q8_0 (default), f16 (full precision), q4_0 (max compression)
    cacheType: CacheType;
    // Show generation details (GPU, model, tok/s, steps, etc.) in chat messages
    showGenerationDetails: boolean;
    // Tool calling: list of enabled tool IDs
    enabledTools: string[];
  };
  updateSettings: (settings: Partial<AppState['settings']>) => void;
  resetSettings: () => void;
  downloadedImageModels: ONNXImageModel[];
  activeImageModelId: string | null;
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  removeDownloadedImageModel: (modelId: string) => void;
  setActiveImageModelId: (modelId: string | null) => void;
  // Image model download tracking (global so cancel works across screens)
  imageModelDownloading: string[];
  imageModelDownloadIds: Record<string, number>;
  addImageModelDownloading: (modelId: string) => void;
  removeImageModelDownloading: (modelId: string) => void;
  clearImageModelDownloading: () => void;
  setImageModelDownloadId: (modelId: string, downloadId: number | null) => void;
  // Image generation state
  isGeneratingImage: boolean;
  imageGenerationProgress: { step: number; totalSteps: number } | null;
  imageGenerationStatus: string | null;
  imagePreviewPath: string | null;
  setIsGeneratingImage: (generating: boolean) => void;
  setImageGenerationProgress: (progress: { step: number; totalSteps: number } | null) => void;
  setImageGenerationStatus: (status: string | null) => void;
  setImagePreviewPath: (path: string | null) => void;
  // Gallery - persisted metadata of all generated images
  generatedImages: GeneratedImage[];
  addGeneratedImage: (image: GeneratedImage) => void;
  removeGeneratedImage: (imageId: string) => void;
  removeImagesByConversationId: (conversationId: string) => string[];
  clearGeneratedImages: () => void;
  // Cache type nudge (shown once after first generation when using default q8_0)
  hasSeenCacheTypeNudge: boolean;
  setHasSeenCacheTypeNudge: (v: boolean) => void;
}

const DEFAULT_SETTINGS: AppState['settings'] = {
  systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 2048,
  nThreads: 6,
  nBatch: 256,
  imageGenerationMode: 'auto' as ImageGenerationMode,
  autoDetectMethod: 'pattern' as AutoDetectMethod,
  classifierModelId: null,
  imageSteps: 20,
  imageGuidanceScale: 7.5,
  imageThreads: 4,
  imageWidth: 512,
  imageHeight: 512,
  enhanceImagePrompts: false,
  modelLoadingStrategy: 'performance' as ModelLoadingStrategy,
  enableGpu: false,
  gpuLayers: 1,
  flashAttn: true,
  cacheType: 'q8_0' as CacheType,
  showGenerationDetails: false,
  enabledTools: ['calculator', 'get_current_datetime'],
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      themeMode: 'system' as 'system' | 'light' | 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
      hasCompletedOnboarding: false,
      setOnboardingComplete: (complete) =>
        set({ hasCompletedOnboarding: complete }),
      deviceInfo: null,
      modelRecommendation: null,
      setDeviceInfo: (info) => set({ deviceInfo: info }),
      setModelRecommendation: (rec) => set({ modelRecommendation: rec }),
      downloadedModels: [],
      setDownloadedModels: (models) => set({ downloadedModels: models }),
      addDownloadedModel: (model) =>
        set((state) => ({
          downloadedModels: [...state.downloadedModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedModel: (modelId) =>
        set((state) => ({
          downloadedModels: state.downloadedModels.filter((m) => m.id !== modelId),
          activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
        })),
      activeModelId: null,
      setActiveModelId: (modelId) => set({ activeModelId: modelId }),
      isLoadingModel: false,
      setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),
      downloadProgress: {},
      setDownloadProgress: (modelId, progress) =>
        set((state) => {
          if (progress === null) {
            const { [modelId]: _removed, ...rest } = state.downloadProgress;
            return { downloadProgress: rest };
          }
          return {
            downloadProgress: {
              ...state.downloadProgress,
              [modelId]: progress,
            },
          };
        }),
      activeBackgroundDownloads: {},
      setBackgroundDownload: (downloadId, info) =>
        set((state) => {
          if (info === null) {
            const { [downloadId]: _removed, ...rest } = state.activeBackgroundDownloads;
            return { activeBackgroundDownloads: rest };
          }
          return {
            activeBackgroundDownloads: {
              ...state.activeBackgroundDownloads,
              [downloadId]: info,
            },
          };
        }),
      clearBackgroundDownloads: () =>
        set({ activeBackgroundDownloads: {} }),
      // Settings
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),

      // Image models (ONNX-based)
      downloadedImageModels: [],
      activeImageModelId: null,
      setDownloadedImageModels: (models) => set({ downloadedImageModels: models }),
      addDownloadedImageModel: (model) =>
        set((state) => ({
          downloadedImageModels: [...state.downloadedImageModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedImageModel: (modelId) =>
        set((state) => ({
          downloadedImageModels: state.downloadedImageModels.filter((m) => m.id !== modelId),
          activeImageModelId: state.activeImageModelId === modelId ? null : state.activeImageModelId,
        })),
      setActiveImageModelId: (modelId) => set({ activeImageModelId: modelId }),
      // Image model download tracking
      imageModelDownloading: [],
      imageModelDownloadIds: {},
      addImageModelDownloading: (modelId) =>
        set((state) => ({
          imageModelDownloading: [...state.imageModelDownloading.filter(id => id !== modelId), modelId],
        })),
      removeImageModelDownloading: (modelId) =>
        set((state) => {
          const { [modelId]: _removed, ...restIds } = state.imageModelDownloadIds;
          return {
            imageModelDownloading: state.imageModelDownloading.filter(id => id !== modelId),
            imageModelDownloadIds: restIds,
          };
        }),
      clearImageModelDownloading: () =>
        set({ imageModelDownloading: [], imageModelDownloadIds: {} }),
      setImageModelDownloadId: (modelId, downloadId) =>
        set((state) => {
          if (downloadId === null) {
            const { [modelId]: _removed, ...rest } = state.imageModelDownloadIds;
            return { imageModelDownloadIds: rest };
          }
          return {
            imageModelDownloadIds: { ...state.imageModelDownloadIds, [modelId]: downloadId },
          };
        }),
      // Image generation state
      isGeneratingImage: false,
      imageGenerationProgress: null,
      imageGenerationStatus: null,
      imagePreviewPath: null,
      setIsGeneratingImage: (generating) => set({ isGeneratingImage: generating }),
      setImageGenerationProgress: (progress) => set({ imageGenerationProgress: progress }),
      setImageGenerationStatus: (status) => set({ imageGenerationStatus: status }),
      setImagePreviewPath: (path) => set({ imagePreviewPath: path }),
      // Gallery
      generatedImages: [],
      addGeneratedImage: (image) =>
        set((state) => ({
          generatedImages: [image, ...state.generatedImages],
        })),
      removeGeneratedImage: (imageId) =>
        set((state) => ({
          generatedImages: state.generatedImages.filter((img) => img.id !== imageId),
        })),
      removeImagesByConversationId: (conversationId) => {
        const state = get();
        const imagesToRemove = state.generatedImages.filter(
          (img) => img.conversationId === conversationId
        );
        const imageIds = imagesToRemove.map((img) => img.id);
        set({
          generatedImages: state.generatedImages.filter(
            (img) => img.conversationId !== conversationId
          ),
        });
        return imageIds;
      },
      clearGeneratedImages: () =>
        set({ generatedImages: [] }),

      // Cache type nudge
      hasSeenCacheTypeNudge: false,
      setHasSeenCacheTypeNudge: (v) => set({ hasSeenCacheTypeNudge: v }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persistedState: any, currentState) => {
        const merged = { ...currentState, ...persistedState };
        // Migrate old string|null → string[]
        if (typeof merged.imageModelDownloading === 'string') {
          merged.imageModelDownloading = [merged.imageModelDownloading];
        } else if (!Array.isArray(merged.imageModelDownloading)) {
          merged.imageModelDownloading = [];
        }
        // Migrate default modelLoadingStrategy from 'memory' → 'performance'
        // Only migrate if the settings object itself was persisted (i.e. came from storage)
        // and the value matches the old default exactly, indicating the user never changed it.
        if (persistedState && (persistedState as any).settings?.modelLoadingStrategy === 'memory') {
          merged.settings = { ...merged.settings, modelLoadingStrategy: 'performance' };
        }
        // Migrate: add cacheType if missing, derive from old flashAttn value
        if (persistedState && (persistedState as any).settings && !((persistedState as any).settings.cacheType)) {
          const oldFlashAttn = (persistedState as any).settings.flashAttn;
          const derivedCacheType = oldFlashAttn ? 'q8_0' : 'f16';
          merged.settings = { ...merged.settings, cacheType: derivedCacheType, flashAttn: true };
        }
        // Migrate old number|null → Record
        if (typeof merged.imageModelDownloadId === 'number') {
          const ids: Record<string, number> = {};
          if (Array.isArray(merged.imageModelDownloading) && merged.imageModelDownloading.length > 0) {
            ids[merged.imageModelDownloading[0]] = merged.imageModelDownloadId;
          }
          merged.imageModelDownloadIds = ids;
          delete merged.imageModelDownloadId;
        } else if (!merged.imageModelDownloadIds || typeof merged.imageModelDownloadIds !== 'object') {
          merged.imageModelDownloadIds = {};
        }
        return merged as AppState;
      },
      partialize: (state) => ({
        themeMode: state.themeMode,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        activeModelId: state.activeModelId,
        settings: state.settings,
        activeBackgroundDownloads: state.activeBackgroundDownloads,
        // Persist image model state
        activeImageModelId: state.activeImageModelId,
        // Persist image model download tracking (survives app restart)
        imageModelDownloading: state.imageModelDownloading,
        imageModelDownloadIds: state.imageModelDownloadIds,
        // Persist gallery
        generatedImages: state.generatedImages,
        // Cache type nudge
        hasSeenCacheTypeNudge: state.hasSeenCacheTypeNudge,
      }),
    }
  )
);
