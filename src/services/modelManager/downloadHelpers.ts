/**
 * Low-level download helper functions extracted from modelManagerDownload
 * to keep each file within the max-lines limit.
 */
import RNFS from 'react-native-fs';
import { DownloadedModel, ModelFile, PersistedDownloadInfo } from '../../types';
import { backgroundDownloadService } from '../backgroundDownloadService';
import { buildDownloadedModel, persistDownloadedModel } from './storage';

export async function getOrphanedTextFiles(
  modelsDir: string,
  modelsGetter: () => Promise<DownloadedModel[]>,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const orphaned: Array<{ name: string; path: string; size: number }> = [];
  const modelsDirExists = await RNFS.exists(modelsDir);
  if (!modelsDirExists) return orphaned;

  const files = await RNFS.readDir(modelsDir);
  const models = await modelsGetter();

  const trackedPaths = new Set<string>();
  for (const model of models) {
    trackedPaths.add(model.filePath);
    if (model.mmProjPath) trackedPaths.add(model.mmProjPath);
  }

  for (const file of files) {
    if (file.isFile() && !trackedPaths.has(file.path)) {
      orphaned.push({
        name: file.name,
        path: file.path,
        size: typeof file.size === 'string' ? parseInt(file.size, 10) : file.size,
      });
    }
  }

  return orphaned;
}

export async function getOrphanedImageDirs(
  imageModelsDir: string,
  imageModelsGetter: () => Promise<import('../../types').ONNXImageModel[]>,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const orphaned: Array<{ name: string; path: string; size: number }> = [];
  const imageDirExists = await RNFS.exists(imageModelsDir);
  if (!imageDirExists) return orphaned;

  const items = await RNFS.readDir(imageModelsDir);
  const imageModels = await imageModelsGetter();
  const trackedImagePaths = imageModels.map(m => m.modelPath);

  for (const item of items) {
    const isTracked = trackedImagePaths.some(
      p => p === item.path || p.startsWith(`${item.path}/`),
    );
    if (isTracked) continue;

    let totalSize = 0;
    if (item.isDirectory()) {
      try {
        const dirFiles = await RNFS.readDir(item.path);
        for (const f of dirFiles) {
          if (f.isFile()) {
            totalSize += typeof f.size === 'string' ? parseInt(f.size, 10) : f.size;
          }
        }
      } catch {
        // Can't read directory, use 0
      }
    } else {
      totalSize = typeof item.size === 'string' ? parseInt(item.size, 10) : item.size;
    }

    orphaned.push({ name: item.name, path: item.path, size: totalSize });
  }

  return orphaned;
}

export interface SyncDownloadsOpts {
  persistedDownloads: Record<number, PersistedDownloadInfo>;
  modelsDir: string;
  clearDownloadCallback: (downloadId: number) => void;
}

/** Resolve the final mmproj path for a completed sync download. */
async function resolveMmProjPath(metadata: PersistedDownloadInfo): Promise<string | undefined> {
  const mmProjLocalPath = metadata.mmProjLocalPath ?? null;
  if (metadata.mmProjDownloadId && mmProjLocalPath) {
    try {
      await backgroundDownloadService.moveCompletedDownload(metadata.mmProjDownloadId, mmProjLocalPath);
      return mmProjLocalPath;
    } catch {
      return (await RNFS.exists(mmProjLocalPath)) ? mmProjLocalPath : undefined;
    }
  }
  if (mmProjLocalPath && await RNFS.exists(mmProjLocalPath)) return mmProjLocalPath;
  return undefined;
}

/** Check whether a parallel mmproj download is still in progress. */
function isMmProjStillRunning(
  metadata: PersistedDownloadInfo,
  activeDownloads: Array<{ downloadId: number; status: string }>,
): boolean {
  if (!metadata.mmProjDownloadId) return false;
  const mmProjDl = activeDownloads.find(d => d.downloadId === metadata.mmProjDownloadId);
  return !!mmProjDl && mmProjDl.status !== 'completed' && mmProjDl.status !== 'failed';
}

export async function syncCompletedBackgroundDownloads(opts: SyncDownloadsOpts): Promise<DownloadedModel[]> {
  const { persistedDownloads, modelsDir, clearDownloadCallback } = opts;
  const completedModels: DownloadedModel[] = [];
  const activeDownloads = await backgroundDownloadService.getActiveDownloads();

  for (const download of activeDownloads) {
    const metadata = persistedDownloads[download.downloadId];
    if (!metadata) continue;
    if (metadata.modelId.startsWith('image:')) continue;

    if (download.status === 'completed') {
      if (isMmProjStillRunning(metadata, activeDownloads)) continue;

      try {
        const localPath = `${modelsDir}/${metadata.fileName}`;
        await backgroundDownloadService.moveCompletedDownload(download.downloadId, localPath);
        const finalMmProjPath = await resolveMmProjPath(metadata);

        const mainFileSize = metadata.mainFileSize ?? metadata.totalBytes;
        const mmProjFileSize = metadata.mmProjFileSize ?? 0;
        const fileInfo: ModelFile = {
          name: metadata.fileName, size: mainFileSize,
          quantization: metadata.quantization, downloadUrl: '',
          mmProjFile: metadata.mmProjFileName
            ? { name: metadata.mmProjFileName, size: mmProjFileSize, downloadUrl: '' }
            : undefined,
        };

        const model = await buildDownloadedModel({ modelId: metadata.modelId, file: fileInfo, resolvedLocalPath: localPath, mmProjPath: finalMmProjPath });
        await persistDownloadedModel(model, modelsDir);
        completedModels.push(model);
        clearDownloadCallback(download.downloadId);
      } catch { /* Skip failed syncs */ }
    } else if (download.status === 'failed') {
      if (metadata.mmProjDownloadId) {
        backgroundDownloadService.cancelDownload(metadata.mmProjDownloadId).catch(() => {});
      }
      clearDownloadCallback(download.downloadId);
    }
  }

  return completedModels;
}
