import RNFS from 'react-native-fs';
import { DownloadedModel, ModelFile, BackgroundDownloadInfo, PersistedDownloadInfo } from '../../types';
import { huggingFaceService } from '../huggingface';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
} from './types';
import {
  buildDownloadedModel,
  persistDownloadedModel,
  loadDownloadedModels,
  saveModelsList,
} from './storage';
import logger from '../../utils/logger';

export {
  getOrphanedTextFiles,
  getOrphanedImageDirs,
} from './downloadHelpers';

export interface PerformBackgroundDownloadOpts {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  backgroundDownloadContext: Map<number, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

export async function performBackgroundDownload(opts: PerformBackgroundDownloadOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress } = opts;
  const localPath = `${modelsDir}/${file.name}`;
  const mmProjLocalPath = file.mmProjFile ? `${modelsDir}/${file.mmProjFile.name}` : null;

  const mainExists = await RNFS.exists(localPath);
  const mmProjExists = await checkMmProjExists(mmProjLocalPath, file.mmProjFile?.size);

  if (mainExists && mmProjExists) {
    return handleAlreadyDownloaded({ modelId, file, localPath, mmProjLocalPath, backgroundDownloadContext });
  }

  const mmProjSize = file.mmProjFile?.size || 0;
  const combinedTotalBytes = file.size + mmProjSize;
  const mmProjDownloaded = await ensureMmProj({
    file, modelId, mmProjLocalPath, mmProjExists, combinedTotalBytes, onProgress,
  });

  return startBgDownload({ modelId, file, localPath, mmProjLocalPath, combinedTotalBytes, mmProjDownloaded, modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress });
}

async function checkMmProjExists(path: string | null, expectedSize?: number): Promise<boolean> {
  if (!path) return true;
  const exists = await RNFS.exists(path);
  if (!exists || !expectedSize) return exists;
  try {
    const stat = await RNFS.stat(path);
    const actualSize = typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size;
    if (actualSize < expectedSize) {
      logger.warn(`[ModelManager] mmproj partial (${actualSize}/${expectedSize}), re-downloading`);
      await RNFS.unlink(path).catch(() => {});
      return false;
    }
    return true;
  } catch {
    await RNFS.unlink(path).catch(() => {});
    return false;
  }
}

interface EnsureMmProjOpts {
  file: ModelFile;
  modelId: string;
  mmProjLocalPath: string | null;
  mmProjExists: boolean;
  combinedTotalBytes: number;
  onProgress?: DownloadProgressCallback;
}

async function ensureMmProj(opts: EnsureMmProjOpts): Promise<number> {
  const { file, modelId, mmProjLocalPath, mmProjExists, combinedTotalBytes, onProgress } = opts;
  const mmProjSize = file.mmProjFile?.size || 0;
  if (!file.mmProjFile || !mmProjLocalPath || mmProjExists) return mmProjExists ? mmProjSize : 0;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) logger.log(`[ModelManager] mmproj download retry ${attempt}/${maxRetries}`);
      await backgroundDownloadService.downloadFileTo({
        params: {
          url: file.mmProjFile.downloadUrl,
          fileName: file.mmProjFile.name,
          modelId,
          totalBytes: file.mmProjFile.size,
        },
        destPath: mmProjLocalPath,
        onProgress: (bytesDownloaded) => {
          onProgress?.({
            modelId,
            fileName: `${file.mmProjFile!.name} (vision)`,
            bytesDownloaded,
            totalBytes: combinedTotalBytes,
            progress: combinedTotalBytes > 0 ? bytesDownloaded / combinedTotalBytes : 0,
          });
        },
        silent: true,
      });
      return file.mmProjFile.size;
    } catch (e) {
      if (attempt < maxRetries) {
        logger.warn(`[ModelManager] mmproj download attempt ${attempt + 1} failed, retrying:`, e);
        await RNFS.unlink(mmProjLocalPath).catch(() => {});
      } else {
        logger.warn('[ModelManager] mmproj download failed after retries, vision will not be available:', e);
      }
    }
  }
  return 0;
}

interface AlreadyDownloadedOpts {
  modelId: string;
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
  backgroundDownloadContext: Map<number, BackgroundDownloadContext>;
}

async function handleAlreadyDownloaded(opts: AlreadyDownloadedOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, localPath, mmProjLocalPath, backgroundDownloadContext } = opts;
  const model = await buildDownloadedModel({ modelId, file, resolvedLocalPath: localPath, mmProjPath: mmProjLocalPath || undefined });
  const totalBytes = file.size + (file.mmProjFile?.size || 0);
  const completedInfo: BackgroundDownloadInfo = {
    downloadId: -1,
    fileName: file.name,
    modelId,
    status: 'completed',
    bytesDownloaded: totalBytes,
    totalBytes,
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
  backgroundDownloadContext.set(-1, { model, error: null });
  return completedInfo;
}

interface StartBgDownloadOpts {
  modelId: string;
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
  combinedTotalBytes: number;
  mmProjDownloaded: number;
  modelsDir: string;
  backgroundDownloadContext: Map<number, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

async function startBgDownload(opts: StartBgDownloadOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, localPath, mmProjLocalPath, combinedTotalBytes, mmProjDownloaded, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress } = opts;
  const downloadUrl = huggingFaceService.getDownloadUrl(modelId, file.name);
  const author = modelId.split('/')[0] || 'Unknown';

  const downloadInfo = await backgroundDownloadService.startDownload({
    url: downloadUrl,
    fileName: file.name,
    modelId,
    title: `Downloading ${file.name}`,
    description: `${modelId} - ${file.quantization}`,
    totalBytes: file.size,
  });

  backgroundDownloadMetadataCallback?.(downloadInfo.downloadId, {
    modelId,
    fileName: file.name,
    quantization: file.quantization,
    author,
    totalBytes: combinedTotalBytes,
    mmProjFileName: file.mmProjFile?.name,
    mmProjLocalPath,
  });

  const capturedMmProjDownloaded = mmProjDownloaded;
  const removeProgressListener = backgroundDownloadService.onProgress(
    downloadInfo.downloadId,
    (event) => {
      const combinedDownloaded = capturedMmProjDownloaded + event.bytesDownloaded;
      onProgress?.({
        modelId,
        fileName: file.name,
        bytesDownloaded: combinedDownloaded,
        totalBytes: combinedTotalBytes,
        progress: combinedTotalBytes > 0 ? combinedDownloaded / combinedTotalBytes : 0,
      });
    },
  );

  backgroundDownloadContext.set(downloadInfo.downloadId, {
    modelId,
    file,
    localPath,
    mmProjLocalPath,
    removeProgressListener,
  });

  backgroundDownloadService.startProgressPolling();
  return downloadInfo;
}

export interface WatchDownloadOpts {
  downloadId: number;
  modelsDir: string;
  backgroundDownloadContext: Map<number, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onComplete?: DownloadCompleteCallback;
  onError?: DownloadErrorCallback;
}

export function watchBackgroundDownload(opts: WatchDownloadOpts): void {
  const { downloadId, modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onComplete, onError } = opts;
  const ctx = backgroundDownloadContext.get(downloadId);

  if (downloadId === -1 && ctx && 'model' in ctx) {
    if (ctx.model) onComplete?.(ctx.model);
    else if (ctx.error) onError?.(ctx.error);
    backgroundDownloadContext.delete(downloadId);
    return;
  }

  if (!ctx || !('file' in ctx)) return;
  const { modelId, file, localPath, mmProjLocalPath, removeProgressListener } = ctx;

  const removeCompleteListener = backgroundDownloadService.onComplete(
    downloadId,
    async (event) => {
      removeProgressListener();
      removeCompleteListener();
      removeErrorListener();
      backgroundDownloadContext.delete(downloadId);

      try {
        const finalPath = await backgroundDownloadService.moveCompletedDownload(event.downloadId, localPath);
        const mmProjFileExists = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : false;
        const finalMmProjPath = mmProjLocalPath && mmProjFileExists ? mmProjLocalPath : undefined;

        const model = await buildDownloadedModel({ modelId, file, resolvedLocalPath: finalPath, mmProjPath: finalMmProjPath });
        await persistDownloadedModel(model, modelsDir);
        backgroundDownloadMetadataCallback?.(event.downloadId, null);
        onComplete?.(model);
      } catch (error) {
        onError?.(error as Error);
      }
    },
  );

  const removeErrorListener = backgroundDownloadService.onError(
    downloadId,
    (event) => {
      removeProgressListener();
      removeCompleteListener();
      removeErrorListener();
      backgroundDownloadContext.delete(downloadId);
      backgroundDownloadMetadataCallback?.(event.downloadId, null);
      onError?.(new Error(event.reason || 'Download failed'));
    },
  );
}

export interface SyncDownloadsOpts {
  persistedDownloads: Record<number, PersistedDownloadInfo>;
  modelsDir: string;
  clearDownloadCallback: (downloadId: number) => void;
}

export async function syncCompletedBackgroundDownloads(opts: SyncDownloadsOpts): Promise<DownloadedModel[]> {
  const { persistedDownloads, modelsDir, clearDownloadCallback } = opts;
  const completedModels: DownloadedModel[] = [];
  const activeDownloads = await backgroundDownloadService.getActiveDownloads();

  for (const download of activeDownloads) {
    const metadata = persistedDownloads[download.downloadId];
    if (!metadata) continue;

    if (download.status === 'completed') {
      try {
        const localPath = `${modelsDir}/${metadata.fileName}`;
        await backgroundDownloadService.moveCompletedDownload(download.downloadId, localPath);

        // Recover mmproj path from persisted metadata
        const mmProjLocalPath = metadata.mmProjLocalPath ?? null;
        let finalMmProjPath: string | undefined;
        if (mmProjLocalPath) {
          const mmProjExists = await RNFS.exists(mmProjLocalPath);
          if (mmProjExists) {
            finalMmProjPath = mmProjLocalPath;
          }
        }

        const fileInfo: ModelFile = {
          name: metadata.fileName,
          size: metadata.totalBytes,
          quantization: metadata.quantization,
          downloadUrl: '',
          mmProjFile: metadata.mmProjFileName ? { name: metadata.mmProjFileName, size: 0, downloadUrl: '' } : undefined,
        };

        const model = await buildDownloadedModel({ modelId: metadata.modelId, file: fileInfo, resolvedLocalPath: localPath, mmProjPath: finalMmProjPath });
        await persistDownloadedModel(model, modelsDir);
        completedModels.push(model);
        clearDownloadCallback(download.downloadId);
      } catch {
        // Skip failed syncs
      }
    } else if (download.status === 'failed') {
      clearDownloadCallback(download.downloadId);
    }
  }

  return completedModels;
}

export { loadDownloadedModels, saveModelsList };
