// ActiveModelService — THE ONLY PLACE models should be loaded/unloaded from.
import { llmService } from '../llm';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { hardwareService } from '../hardware';
import { useAppStore } from '../../stores';
import { ONNXImageModel } from '../../types';
import type {
  ActiveModelInfo,
  ResourceUsage,
  ModelType,
  MemoryCheckResult,
  ModelChangeListener,
} from './types';
import {
  checkMemoryForModel as _checkMemoryForModel,
  checkMemoryForDualModel as _checkMemoryForDualModel,
} from './memory';
import { doLoadTextModel, doLoadImageModel } from './loaders';
import {
  getResourceUsage as _getResourceUsage,
  syncWithNativeState as _syncWithNativeState,
} from './utils';
import { getCurrentlyLoadedMemoryGB as _getCurrentlyLoadedMemoryGB } from './memory';
export type {
  ModelType,
  MemoryCheckSeverity,
  MemoryCheckResult,
  ActiveModelInfo,
  ResourceUsage,
} from './types';
class ActiveModelService {
  private readonly listeners: Set<ModelChangeListener> = new Set();
  private readonly loadingState = { text: false, image: false };
  private loadedTextModelId: string | null = null;
  private loadedImageModelId: string | null = null;
  private loadedImageModelThreads: number | null = null;
  private textLoadPromise: Promise<void> | null = null;
  private imageLoadPromise: Promise<void> | null = null;
  getActiveModels(): ActiveModelInfo {
    const store = useAppStore.getState();
    const textModel =
      store.downloadedModels.find(m => m.id === store.activeModelId) ?? null;
    const imageModel =
      store.downloadedImageModels.find(
        m => m.id === store.activeImageModelId,
      ) ?? null;
    return {
      text: {
        model: textModel,
        isLoaded: llmService.isModelLoaded(),
        isLoading: this.loadingState.text,
      },
      image: {
        model: imageModel,
        isLoaded: this.loadedImageModelId != null,
        isLoading: this.loadingState.image,
      },
    };
  }
  hasAnyModelLoaded(): boolean {
    const info = this.getActiveModels();
    return info.text.isLoaded || info.image.isLoaded;
  }
  getLoadedModelIds(): {
    textModelId: string | null;
    imageModelId: string | null;
  } {
    return {
      textModelId: this.loadedTextModelId,
      imageModelId: this.loadedImageModelId,
    };
  }
  getPerformanceStats() {
    return llmService.getPerformanceStats();
  }
  async loadTextModel(
    modelId: string,
    timeoutMs: number = 120000,
  ): Promise<void> {
    if (this.loadedTextModelId === modelId && llmService.isModelLoaded()) {
      // Model already loaded natively — ensure store reflects it
      const store = useAppStore.getState();
      if (store.activeModelId !== modelId) {
        store.setActiveModelId(modelId);
      }
      return;
    }
    if (this.textLoadPromise !== null) {
      await this.textLoadPromise;
      if (this.loadedTextModelId === modelId) {
        const store = useAppStore.getState();
        if (store.activeModelId !== modelId) {
          store.setActiveModelId(modelId);
        }
        return;
      }
    }
    const store = useAppStore.getState();
    const model = store.downloadedModels.find(m => m.id === modelId);
    if (!model) {
      throw new Error('Model not found');
    }
    this.loadingState.text = true;
    this.notifyListeners();
    this.textLoadPromise = doLoadTextModel({
      model,
      modelId,
      store,
      timeoutMs,
      loadedTextModelId: this.loadedTextModelId,
      onLoaded: id => {
        this.loadedTextModelId = id;
      },
      onError: () => {
        this.loadedTextModelId = null;
      },
      onFinally: () => {
        this.loadingState.text = false;
        this.textLoadPromise = null;
        this.notifyListeners();
      },
    });
    await this.textLoadPromise;
  }
  async unloadTextModel(): Promise<void> {
    if (this.textLoadPromise !== null) {
      await this.textLoadPromise;
    }
    const storeActiveModelId = useAppStore.getState().activeModelId;
    const isNativeLoaded = llmService.isModelLoaded();
    if (!storeActiveModelId && !this.loadedTextModelId && !isNativeLoaded) {
      return;
    }
    this.loadingState.text = true;
    this.notifyListeners();
    try {
      if (isNativeLoaded) {
        await llmService.unloadModel();
      }
      this.loadedTextModelId = null;
      useAppStore.getState().setActiveModelId(null);
    } finally {
      this.loadingState.text = false;
      this.notifyListeners();
    }
  }
  private async checkImageModelCanLoad(
    modelId: string,
    model: ONNXImageModel,
  ): Promise<{ canLoad: boolean; error?: string }> {
    if (model.backend === 'qnn') {
      const socInfo = await hardwareService.getSoCInfo();
      if (!socInfo.hasNPU) {
        return {
          canLoad: false,
          error:
            'NPU models require a Qualcomm Snapdragon processor. Your device does not have a compatible NPU. Please use a GPU model instead.',
        };
      }
    }
    const totalMemGB = hardwareService.getTotalMemoryGB();
    if (totalMemGB <= 4 && this.loadedTextModelId && llmService.isModelLoaded()) {
      await this.unloadTextModel();
    }
    const memCheck = await this.checkMemoryForModel(modelId, 'image');
    if (memCheck.severity === 'critical') {
      return { canLoad: false, error: memCheck.message };
    }
    return { canLoad: true };
  }

  async loadImageModel(
    modelId: string,
    timeoutMs: number = 180000,
  ): Promise<void> {
    const store = useAppStore.getState();
    const imageThreads = store.settings?.imageThreads ?? 4;
    const needsThreadReload =
      this.loadedImageModelId === modelId &&
      this.loadedImageModelThreads !== imageThreads;
    if (this.loadedImageModelId === modelId) {
      const isLoaded = await onnxImageGeneratorService.isModelLoaded();
      if (isLoaded && !needsThreadReload) {
        if (store.activeImageModelId !== modelId) {
          store.setActiveImageModelId(modelId);
        }
        return;
      }
    }
    if (this.imageLoadPromise !== null) {
      await this.imageLoadPromise;
      if (
        this.loadedImageModelId === modelId &&
        this.loadedImageModelThreads === imageThreads
      ) {
        return;
      }
    }
    const model = store.downloadedImageModels.find(m => m.id === modelId);
    if (!model) {
      throw new Error('Model not found');
    }
    const check = await this.checkImageModelCanLoad(modelId, model);
    if (!check.canLoad) {
      throw new Error(check.error);
    }
    this.loadingState.image = true;
    this.notifyListeners();
    this.imageLoadPromise = doLoadImageModel({
      model,
      modelId,
      imageThreads,
      needsThreadReload,
      cpuOnly: false,
      store,
      timeoutMs,
      loadedImageModelId: this.loadedImageModelId,
      onLoaded: (id, threads) => {
        this.loadedImageModelId = id;
        this.loadedImageModelThreads = threads;
      },
      onError: () => {
        this.loadedImageModelId = null;
        this.loadedImageModelThreads = null;
      },
      onFinally: () => {
        this.loadingState.image = false;
        this.imageLoadPromise = null;
        this.notifyListeners();
      },
    });
    await this.imageLoadPromise;
  }
  async unloadImageModel(): Promise<void> {
    if (this.imageLoadPromise !== null) {
      await this.imageLoadPromise;
    }
    const store = useAppStore.getState();
    const isNativeLoaded = await onnxImageGeneratorService.isModelLoaded();
    if (
      !store.activeImageModelId &&
      !this.loadedImageModelId &&
      !isNativeLoaded
    ) {
      return;
    }
    this.loadingState.image = true;
    this.notifyListeners();
    try {
      if (isNativeLoaded) {
        await onnxImageGeneratorService.unloadModel();
      }
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
      store.setActiveImageModelId(null);
    } finally {
      this.loadingState.image = false;
      this.notifyListeners();
    }
  }
  async unloadAllModels(): Promise<{
    textUnloaded: boolean;
    imageUnloaded: boolean;
  }> {
    const store = useAppStore.getState();
    const results = { textUnloaded: false, imageUnloaded: false };
    const hasTextModel =
      !!store.activeModelId ||
      !!this.loadedTextModelId ||
      llmService.isModelLoaded();
    const hasImageModel =
      !!store.activeImageModelId || !!this.loadedImageModelId;
    if (hasTextModel) {
      try {
        await this.unloadTextModel();
        results.textUnloaded = true;
      } catch {
        /* partial */
      }
    }
    if (hasImageModel) {
      try {
        await this.unloadImageModel();
        results.imageUnloaded = true;
      } catch {
        /* partial */
      }
    }
    return results;
  }
  async getResourceUsage(): Promise<ResourceUsage> {
    return _getResourceUsage();
  }
  private getIds() {
    return { loadedTextModelId: this.loadedTextModelId, loadedImageModelId: this.loadedImageModelId };
  }
  private getLists() {
    const s = useAppStore.getState();
    return { downloadedModels: s.downloadedModels, downloadedImageModels: s.downloadedImageModels };
  }
  private getCurrentlyLoadedMemoryGB(): number {
    return _getCurrentlyLoadedMemoryGB(this.getIds(), this.getLists());
  }
  async checkMemoryForModel(modelId: string, modelType: ModelType): Promise<MemoryCheckResult> {
    return _checkMemoryForModel({ modelId, modelType, ids: this.getIds(), lists: this.getLists() });
  }
  async checkMemoryForDualModel(textModelId: string | null, imageModelId: string | null): Promise<MemoryCheckResult> {
    return _checkMemoryForDualModel({ textModelId, imageModelId, lists: this.getLists() });
  }
  async clearTextModelCache(): Promise<void> {
    if (llmService.isModelLoaded()) {
      await llmService.clearKVCache(false);
    }
  }
  async syncWithNativeState(): Promise<void> {
    await _syncWithNativeState({
      loadedTextModelId: this.loadedTextModelId,
      loadedImageModelId: this.loadedImageModelId,
      setLoadedTextModelId: id => {
        this.loadedTextModelId = id;
      },
      setLoadedImageModelId: id => {
        this.loadedImageModelId = id;
      },
      setLoadedImageModelThreads: n => {
        this.loadedImageModelThreads = n;
      },
    });
  }
  subscribe(listener: ModelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notifyListeners(): void {
    const info = this.getActiveModels();
    this.listeners.forEach(listener => listener(info));
  }
}
export const activeModelService = new ActiveModelService();
