import RNFS from 'react-native-fs';
import { ModelFile, BackgroundDownloadInfo } from '../../types';
import { huggingFaceService } from '../huggingface';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
} from './types';
import { buildDownloadedModel, persistDownloadedModel, loadDownloadedModels, saveModelsList } from './storage';
import logger from '../../utils/logger';

export {
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  syncCompletedBackgroundDownloads,
} from './downloadHelpers';
export type { SyncDownloadsOpts } from './downloadHelpers';

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

  return startBgDownload({
    modelId, file, localPath, mmProjLocalPath, mmProjExists,
    modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress,
  });
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
    downloadId: -1, fileName: file.name, modelId, status: 'completed',
    bytesDownloaded: totalBytes, totalBytes, startedAt: Date.now(), completedAt: Date.now(),
  };
  backgroundDownloadContext.set(-1, { model, error: null });
  return completedInfo;
}

interface StartBgDownloadOpts {
  modelId: string;
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
  mmProjExists: boolean;
  modelsDir: string;
  backgroundDownloadContext: Map<number, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

async function startBgDownload(opts: StartBgDownloadOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, localPath, mmProjLocalPath, mmProjExists, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress } = opts;

  const mmProjSize = file.mmProjFile?.size || 0;
  const combinedTotalBytes = file.size + mmProjSize;
  const downloadUrl = huggingFaceService.getDownloadUrl(modelId, file.name);
  const author = modelId.split('/')[0] || 'Unknown';

  const downloadInfo = await backgroundDownloadService.startDownload({
    url: downloadUrl, fileName: file.name, modelId,
    title: `Downloading ${file.name}`, description: `${modelId} - ${file.quantization}`, totalBytes: file.size,
  });

  // Start mmproj download in parallel if needed
  const needsMmProj = !!(file.mmProjFile && mmProjLocalPath && !mmProjExists);
  let mmProjDownloadId: number | undefined;
  if (needsMmProj) {
    const mmProjInfo = await backgroundDownloadService.startDownload({
      url: file.mmProjFile!.downloadUrl, fileName: file.mmProjFile!.name, modelId,
      title: `Downloading ${file.mmProjFile!.name} (vision)`,
      description: `${modelId} - vision projection`, totalBytes: file.mmProjFile!.size,
    });
    mmProjDownloadId = mmProjInfo.downloadId;
    backgroundDownloadService.markSilent(mmProjDownloadId);
  }

  backgroundDownloadMetadataCallback?.(downloadInfo.downloadId, {
    modelId, fileName: file.name, quantization: file.quantization, author,
    totalBytes: combinedTotalBytes, mainFileSize: file.size,
    mmProjFileName: file.mmProjFile?.name, mmProjFileSize: mmProjSize,
    mmProjLocalPath, mmProjDownloadId,
  });

  // Combined progress tracking
  let mainBytesDownloaded = 0;
  let mmProjBytesDownloaded = mmProjExists ? mmProjSize : 0;
  const reportProgress = () => {
    const combinedDownloaded = mainBytesDownloaded + mmProjBytesDownloaded;
    onProgress?.({
      modelId, fileName: file.name, bytesDownloaded: combinedDownloaded,
      totalBytes: combinedTotalBytes,
      progress: combinedTotalBytes > 0 ? combinedDownloaded / combinedTotalBytes : 0,
    });
  };

  const removeProgressListener = backgroundDownloadService.onProgress(
    downloadInfo.downloadId, (event) => { mainBytesDownloaded = event.bytesDownloaded; reportProgress(); },
  );

  let removeMmProjProgressListener: (() => void) | undefined;
  if (mmProjDownloadId) {
    removeMmProjProgressListener = backgroundDownloadService.onProgress(
      mmProjDownloadId, (event) => { mmProjBytesDownloaded = event.bytesDownloaded; reportProgress(); },
    );
  }

  backgroundDownloadContext.set(downloadInfo.downloadId, {
    modelId, file, localPath, mmProjLocalPath, removeProgressListener,
    mmProjDownloadId, mmProjCompleted: !needsMmProj, mainCompleted: false,
    removeMmProjProgressListener,
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

  let removeMmProjComplete: (() => void) | undefined;
  let removeMmProjError: (() => void) | undefined;

  const cleanupListeners = () => {
    ctx.removeProgressListener();
    ctx.removeMmProjProgressListener?.();
    removeMainComplete();
    removeMainError();
    removeMmProjComplete?.();
    removeMmProjError?.();
    if (ctx.mmProjDownloadId) backgroundDownloadService.unmarkSilent(ctx.mmProjDownloadId);
  };

  const handleError = (error: Error, cancelDownloadId?: number) => {
    if (cancelDownloadId) backgroundDownloadService.cancelDownload(cancelDownloadId).catch(() => {});
    cleanupListeners();
    backgroundDownloadContext.delete(downloadId);
    backgroundDownloadMetadataCallback?.(downloadId, null);
    onError?.(error);
  };

  const tryFinalize = async () => {
    if (!ctx.mainCompleted || !ctx.mmProjCompleted) return;
    cleanupListeners();
    backgroundDownloadContext.delete(downloadId);
    try {
      const finalPath = await backgroundDownloadService.moveCompletedDownload(downloadId, ctx.localPath);
      const mmProjFileExists = ctx.mmProjLocalPath ? await RNFS.exists(ctx.mmProjLocalPath) : false;
      const finalMmProjPath = ctx.mmProjLocalPath && mmProjFileExists ? ctx.mmProjLocalPath : undefined;

      const model = await buildDownloadedModel({
        modelId: ctx.modelId, file: ctx.file, resolvedLocalPath: finalPath, mmProjPath: finalMmProjPath,
      });
      await persistDownloadedModel(model, modelsDir);
      backgroundDownloadMetadataCallback?.(downloadId, null);
      onComplete?.(model);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const removeMainComplete = backgroundDownloadService.onComplete(downloadId, async () => {
    ctx.mainCompleted = true;
    await tryFinalize();
  });
  const removeMainError = backgroundDownloadService.onError(downloadId, (event) => {
    handleError(new Error(event.reason || 'Download failed'), ctx.mmProjDownloadId);
  });

  if (ctx.mmProjDownloadId && !ctx.mmProjCompleted) {
    removeMmProjComplete = backgroundDownloadService.onComplete(ctx.mmProjDownloadId, async (event) => {
      try {
        await backgroundDownloadService.moveCompletedDownload(event.downloadId, ctx.mmProjLocalPath!);
        ctx.mmProjCompleted = true;
        await tryFinalize();
      } catch (error) { handleError(error as Error, downloadId); }
    });
    removeMmProjError = backgroundDownloadService.onError(ctx.mmProjDownloadId, (event) => {
      handleError(new Error(`Vision projection download failed: ${event.reason || 'Unknown error'}`), downloadId);
    });
  }
}

export { loadDownloadedModels, saveModelsList };
