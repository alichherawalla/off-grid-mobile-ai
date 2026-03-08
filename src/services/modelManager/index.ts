import RNFS from 'react-native-fs';
import { DownloadedModel, ModelFile, BackgroundDownloadInfo, ONNXImageModel, PersistedDownloadInfo } from '../../types';
import { APP_CONFIG } from '../../constants';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
} from './types';
import {
  MODELS_STORAGE_KEY,
  IMAGE_MODELS_STORAGE_KEY,
  saveModelsList,
  saveImageModelsList,
  loadDownloadedModels,
  loadDownloadedImageModels,
} from './storage';
import {
  performBackgroundDownload,
  watchBackgroundDownload,
  syncCompletedBackgroundDownloads,
  getOrphanedTextFiles,
  getOrphanedImageDirs,
} from './download';
import { syncCompletedImageDownloads as syncCompletedImageDownloadsHelper } from './imageSync';
import { restoreInProgressDownloads } from './restore';
import {
  deleteOrphanedFile as scanDeleteOrphanedFile,
  cleanupMMProjEntries as scanCleanupMMProjEntries,
  scanForUntrackedImageModels as scanUntrackedImage,
  scanForUntrackedTextModels as scanUntrackedText,
  importLocalModel as scanImportLocalModel,
  isMMProjFile,
} from './scan';
import { resolveStoredPath, determineCredibility } from './storage';

export type { BackgroundDownloadMetadataCallback };
export { MODELS_STORAGE_KEY, IMAGE_MODELS_STORAGE_KEY };

class ModelManager {
  private modelsDir: string;
  private imageModelsDir: string;
  private backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null = null;
  private backgroundDownloadContext: Map<number, BackgroundDownloadContext> = new Map();

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
  }

  private resolveStoredPath(p: string, d: string) { return resolveStoredPath(p, d); }
  private determineCredibility(a: string) { return determineCredibility(a); }
  private isMMProjFile(f: string) { return isMMProjFile(f); }

  async initialize(): Promise<void> {
    if (!(await RNFS.exists(this.modelsDir))) await RNFS.mkdir(this.modelsDir);
    if (!(await RNFS.exists(this.imageModelsDir))) await RNFS.mkdir(this.imageModelsDir);
    const exclude = (p: string) => backgroundDownloadService.excludeFromBackup(p);
    await Promise.all([exclude(this.modelsDir), exclude(this.imageModelsDir),
      exclude(`${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`)]);
  }

  async getDownloadedModels(): Promise<DownloadedModel[]> {
    try {
      return await loadDownloadedModels(this.modelsDir);
    } catch {
      return [];
    }
  }

  async deleteModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedModels();
    const model = models.find(m => m.id === modelId);

    if (!model) throw new Error('Model not found');
    if (!model.filePath.startsWith(this.modelsDir)) {
      throw new Error('Invalid model path: outside app directory');
    }
    if (model.mmProjPath && !model.mmProjPath.startsWith(this.modelsDir)) {
      throw new Error('Invalid mmproj path: outside app directory');
    }
    await RNFS.unlink(model.filePath);
    if (model.mmProjPath) await RNFS.unlink(model.mmProjPath).catch(() => {});
    await saveModelsList(models.filter(m => m.id !== modelId));
  }

  async getModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedModels();
    return models.find(m => m.id === modelId)?.filePath || null;
  }

  async getStorageUsed(): Promise<number> {
    const models = await this.getDownloadedModels();
    return models.reduce((total, model) => total + model.fileSize + (model.mmProjFileSize || 0), 0);
  }

  async getAvailableStorage(): Promise<number> {
    const freeSpace = await RNFS.getFSInfo();
    return freeSpace.freeSpace;
  }

  async getOrphanedFiles(): Promise<Array<{ name: string; path: string; size: number }>> {
    await this.initialize();
    try {
      const textOrphans = await getOrphanedTextFiles(this.modelsDir, () => this.getDownloadedModels());
      const imageOrphans = await getOrphanedImageDirs(this.imageModelsDir, () => this.getDownloadedImageModels());
      return [...textOrphans, ...imageOrphans];
    } catch {
      return [];
    }
  }

  async deleteOrphanedFile(filePath: string): Promise<void> {
    await scanDeleteOrphanedFile(filePath);
  }

  setBackgroundDownloadMetadataCallback(callback: BackgroundDownloadMetadataCallback): void {
    this.backgroundDownloadMetadataCallback = callback;
  }

  isBackgroundDownloadSupported(): boolean {
    return backgroundDownloadService.isAvailable();
  }

  async downloadModelBackground(
    modelId: string,
    file: ModelFile,
    onProgress?: DownloadProgressCallback,
  ): Promise<BackgroundDownloadInfo> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    await this.initialize();
    return performBackgroundDownload({
      modelId,
      file,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  watchDownload(
    downloadId: number,
    onComplete?: DownloadCompleteCallback,
    onError?: DownloadErrorCallback,
  ): void {
    watchBackgroundDownload({
      downloadId,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onComplete,
      onError,
    });
  }

  async cancelBackgroundDownload(downloadId: number): Promise<void> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (ctx && 'file' in ctx && ctx.mmProjDownloadId) {
      backgroundDownloadService.unmarkSilent(ctx.mmProjDownloadId);
      await backgroundDownloadService.cancelDownload(ctx.mmProjDownloadId).catch(() => {});
    }

    await backgroundDownloadService.cancelDownload(downloadId);
    this.backgroundDownloadMetadataCallback?.(downloadId, null);
  }

  async syncBackgroundDownloads(
    persistedDownloads: Record<number, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: number) => void,
  ): Promise<DownloadedModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedBackgroundDownloads({ persistedDownloads, modelsDir: this.modelsDir, clearDownloadCallback });
  }
  async syncCompletedImageDownloads(
    persistedDownloads: Record<number, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: number) => void,
  ): Promise<ONNXImageModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedImageDownloadsHelper({
      imageModelsDir: this.imageModelsDir,
      persistedDownloads,
      clearDownloadCallback,
      getDownloadedImageModels: () => this.getDownloadedImageModels(),
      addDownloadedImageModel: (model) => this.addDownloadedImageModel(model),
    });
  }

  async restoreInProgressDownloads(
    persistedDownloads: Record<number, PersistedDownloadInfo>,
    onProgress?: DownloadProgressCallback,
  ): Promise<number[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return restoreInProgressDownloads({
      persistedDownloads,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  async getActiveBackgroundDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    return backgroundDownloadService.getActiveDownloads();
  }
  startBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.startProgressPolling();
  }

  stopBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.stopProgressPolling();
  }
  async repairMmProj(
    modelId: string,
    file: ModelFile,
    opts?: { onProgress?: DownloadProgressCallback; onDownloadIdReady?: (id: number) => void },
  ): Promise<void> {
    if (!file.mmProjFile) throw new Error('Model file has no associated mmproj');
    await this.initialize();
    const mmProjLocalPath = `${this.modelsDir}/${file.mmProjFile.name}`;
    const totalBytes = file.mmProjFile.size;
    if (await RNFS.exists(mmProjLocalPath)) await RNFS.unlink(mmProjLocalPath).catch(() => {});

    const download = backgroundDownloadService.downloadFileTo({
      params: { url: file.mmProjFile.downloadUrl, fileName: file.mmProjFile.name, modelId, totalBytes },
      destPath: mmProjLocalPath,
      onProgress: (bytesDownloaded: number) => {
        opts?.onProgress?.({ modelId, fileName: file.mmProjFile!.name, bytesDownloaded, totalBytes, progress: totalBytes > 0 ? bytesDownloaded / totalBytes : 0 });
      },
      silent: true,
    });
    const { promise, downloadIdPromise } = download;

    if (opts?.onDownloadIdReady) {
      downloadIdPromise
        .then((downloadId) => {
          if (downloadId !== 0) opts.onDownloadIdReady?.(downloadId);
        })
        .catch(() => {});
    }
    await promise;
    await this.saveModelWithMmproj(`${modelId}/${file.name}`, mmProjLocalPath);
  }

  async saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void> {
    const mmProjFileName = mmProjPath.split('/').pop() || mmProjPath;
    const stat = await RNFS.stat(mmProjPath);
    const mmProjFileSize = typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size;

    const models = await this.getDownloadedModels();
    const updated = models.map(m =>
      m.id === modelId ? { ...m, mmProjPath, mmProjFileName, mmProjFileSize, isVisionModel: true } : m
    );
    await saveModelsList(updated);
  }

  async cleanupMMProjEntries(): Promise<number> {
    return scanCleanupMMProjEntries(this.modelsDir);
  }

  async importLocalModel(
    sourceUri: string,
    fileName: string,
    onProgress?: (progress: { fraction: number; fileName: string }) => void,
  ): Promise<DownloadedModel> {
    await this.initialize();
    return scanImportLocalModel({ sourceUri, fileName, modelsDir: this.modelsDir, onProgress });
  }

  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    try {
      return await loadDownloadedImageModels(this.imageModelsDir);
    } catch {
      return [];
    }
  }

  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    const models = await this.getDownloadedImageModels();
    const idx = models.findIndex(m => m.id === model.id);
    if (idx >= 0) models[idx] = model;
    else models.push(model);
    await saveImageModelsList(models);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedImageModels();
    const model = models.find(m => m.id === modelId);
    if (!model) throw new Error('Image model not found');
    const topLevelDir = `${this.imageModelsDir}/${modelId}`;
    if (!topLevelDir.startsWith(`${this.imageModelsDir}/`)) {
      throw new Error('Invalid image model path: outside app directory');
    }
    if (await RNFS.exists(topLevelDir)) await RNFS.unlink(topLevelDir);
    await saveImageModelsList(models.filter(m => m.id !== modelId));
  }

  async getImageModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedImageModels();
    return models.find(m => m.id === modelId)?.modelPath || null;
  }

  async getImageModelsStorageUsed(): Promise<number> {
    const models = await this.getDownloadedImageModels();
    return models.reduce((total, model) => total + model.size, 0);
  }

  getImageModelsDirectory(): string {
    return this.imageModelsDir;
  }

  async scanForUntrackedImageModels(): Promise<ONNXImageModel[]> {
    await this.initialize();
    return scanUntrackedImage({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: (model) => this.addDownloadedImageModel(model),
    });
  }

  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();
    return scanUntrackedText(this.modelsDir, () => this.getDownloadedModels());
  }

  async refreshModelLists(): Promise<{ textModels: DownloadedModel[]; imageModels: ONNXImageModel[] }> {
    await this.scanForUntrackedTextModels();
    await this.scanForUntrackedImageModels();
    return {
      textModels: await this.getDownloadedModels(),
      imageModels: await this.getDownloadedImageModels(),
    };
  }
}

export const modelManager = new ModelManager();
export type { ModelManager };
