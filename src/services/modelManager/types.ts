import { DownloadedModel, DownloadProgress, ModelFile } from '../../types';

export type DownloadProgressCallback = (progress: DownloadProgress) => void;
export type DownloadCompleteCallback = (model: DownloadedModel) => void;
export type DownloadErrorCallback = (error: Error) => void;

// Callback for background download metadata persistence
export type BackgroundDownloadMetadataCallback = (
  downloadId: number,
  info: {
    modelId: string;
    fileName: string;
    quantization: string;
    author: string;
    totalBytes: number;
    mainFileSize?: number;
    mmProjFileName?: string;
    mmProjFileSize?: number;
    mmProjLocalPath?: string | null;
    mmProjDownloadId?: number;
  } | null
) => void;

export type BackgroundDownloadContext =
  | {
      modelId: string;
      file: ModelFile;
      localPath: string;
      mmProjLocalPath: string | null;
      removeProgressListener: () => void;
      // Parallel mmproj download tracking
      mmProjDownloadId?: number;
      mmProjCompleted: boolean;
      mainCompleted: boolean;
      removeMmProjProgressListener?: () => void;
    }
  | { model: DownloadedModel; error: null }
  | { model: null; error: Error };
