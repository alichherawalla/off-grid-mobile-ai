import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';
import { BackgroundDownloadInfo, BackgroundDownloadStatus } from '../types';

const { DownloadManagerModule } = NativeModules;

interface DownloadParams {
  url: string;
  fileName: string;
  modelId: string;
  title?: string;
  description?: string;
  totalBytes?: number;
}

interface MultiFileDownloadParams {
  files: { url: string; relativePath: string; size: number }[];
  fileName: string;
  modelId: string;
  destinationDir: string;
  totalBytes?: number;
}

interface DownloadProgressEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: BackgroundDownloadStatus;
  reason?: string;
}

interface DownloadCompleteEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: 'completed';
  localUri: string;
}

interface DownloadErrorEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  status: 'failed';
  reason: string;
}

type DownloadProgressCallback = (event: DownloadProgressEvent) => void;
type DownloadCompleteCallback = (event: DownloadCompleteEvent) => void;
type DownloadErrorCallback = (event: DownloadErrorEvent) => void;

class BackgroundDownloadService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListeners: Map<string, DownloadProgressCallback> = new Map();
  private completeListeners: Map<string, DownloadCompleteCallback> = new Map();
  private errorListeners: Map<string, DownloadErrorCallback> = new Map();
  private subscriptions: { remove: () => void }[] = [];
  private isPolling = false;
  private silentDownloadIds: Set<number> = new Set();

  constructor() {
    if (this.isAvailable()) {
      this.eventEmitter = new NativeEventEmitter(DownloadManagerModule);
      this.setupEventListeners();
    }
  }

  isAvailable(): boolean {
    return DownloadManagerModule != null;
  }

  async startDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    const result = await DownloadManagerModule.startDownload({
      url: params.url,
      fileName: params.fileName,
      modelId: params.modelId,
      title: params.title || `Downloading ${params.fileName}`,
      description: params.description || 'Model download in progress...',
      totalBytes: params.totalBytes || 0,
    });

    return {
      downloadId: result.downloadId,
      fileName: result.fileName,
      modelId: result.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes || 0,
      startedAt: Date.now(),
    };
  }

  async startMultiFileDownload(params: MultiFileDownloadParams): Promise<BackgroundDownloadInfo> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    const result = await DownloadManagerModule.startMultiFileDownload({
      files: params.files,
      fileName: params.fileName,
      modelId: params.modelId,
      destinationDir: params.destinationDir,
      totalBytes: params.totalBytes || 0,
    });

    return {
      downloadId: result.downloadId,
      fileName: result.fileName,
      modelId: result.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes || 0,
      startedAt: Date.now(),
    };
  }

  async cancelDownload(downloadId: number): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    await DownloadManagerModule.cancelDownload(downloadId);
  }

  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isAvailable()) {
      return [];
    }
    const downloads = await DownloadManagerModule.getActiveDownloads();
    return downloads.map((d: any) => ({
      downloadId: d.downloadId,
      fileName: d.fileName,
      modelId: d.modelId,
      status: d.status as BackgroundDownloadStatus,
      bytesDownloaded: d.bytesDownloaded,
      totalBytes: d.totalBytes,
      localUri: d.localUri,
      startedAt: d.startedAt,
    }));
  }

  async getDownloadProgress(downloadId: number): Promise<{
    bytesDownloaded: number;
    totalBytes: number;
    status: BackgroundDownloadStatus;
    localUri?: string;
    reason?: string;
  }> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    const progress = await DownloadManagerModule.getDownloadProgress(downloadId);
    return {
      bytesDownloaded: progress.bytesDownloaded,
      totalBytes: progress.totalBytes,
      status: progress.status as BackgroundDownloadStatus,
      localUri: progress.localUri || undefined,
      reason: progress.reason || undefined,
    };
  }

  async moveCompletedDownload(downloadId: number, targetPath: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    return await DownloadManagerModule.moveCompletedDownload(downloadId, targetPath);
  }

  onProgress(downloadId: number, callback: DownloadProgressCallback): () => void {
    const key = `progress_${downloadId}`;
    this.progressListeners.set(key, callback);
    return () => this.progressListeners.delete(key);
  }

  onComplete(downloadId: number, callback: DownloadCompleteCallback): () => void {
    const key = `complete_${downloadId}`;
    this.completeListeners.set(key, callback);
    return () => this.completeListeners.delete(key);
  }

  onError(downloadId: number, callback: DownloadErrorCallback): () => void {
    const key = `error_${downloadId}`;
    this.errorListeners.set(key, callback);
    return () => this.errorListeners.delete(key);
  }

  onAnyProgress(callback: DownloadProgressCallback): () => void {
    const key = 'progress_all';
    this.progressListeners.set(key, callback);
    return () => this.progressListeners.delete(key);
  }

  onAnyComplete(callback: DownloadCompleteCallback): () => void {
    const key = 'complete_all';
    this.completeListeners.set(key, callback);
    return () => this.completeListeners.delete(key);
  }

  onAnyError(callback: DownloadErrorCallback): () => void {
    const key = 'error_all';
    this.errorListeners.set(key, callback);
    return () => this.errorListeners.delete(key);
  }

  startProgressPolling(): void {
    if (!this.isAvailable() || this.isPolling) {
      return;
    }
    this.isPolling = true;
    DownloadManagerModule.startProgressPolling();
  }

  stopProgressPolling(): void {
    if (!this.isAvailable() || !this.isPolling) {
      return;
    }
    this.isPolling = false;
    DownloadManagerModule.stopProgressPolling();
  }

  async requestNotificationPermission(): Promise<void> {
    if (Platform.OS !== 'android' || Platform.Version < 33) return;
    try {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    } catch {
      // Non-fatal — download still works, just no system notification
    }
  }

  /** Start a background download, wait for completion, then move to destPath. */
  downloadFileTo(opts: {
    params: DownloadParams;
    destPath: string;
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void;
    silent?: boolean;
  }): { downloadId: number; downloadIdPromise: Promise<number>; promise: Promise<void> } {
    const { params, destPath, onProgress, silent } = opts;
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    let resolvedDownloadId = 0;
    let resolveDownloadId!: (id: number) => void;
    let rejectDownloadId!: (error: unknown) => void;
    const downloadIdPromise = new Promise<number>((resolve, reject) => {
      resolveDownloadId = resolve;
      rejectDownloadId = reject;
    });
    const promise = (async () => {
      try {
        const info = await DownloadManagerModule.startDownload({
          url: params.url,
          fileName: params.fileName,
          modelId: params.modelId,
          title: params.title ?? `Downloading ${params.fileName}`,
          description: params.description ?? 'Downloading…',
          totalBytes: params.totalBytes ?? 0,
          hideNotification: silent === true,
        });
        this.startProgressPolling();
        const downloadId: number = info.downloadId;
        resolvedDownloadId = downloadId;
        resolveDownloadId(downloadId);
        if (silent) this.silentDownloadIds.add(downloadId);
        await new Promise<void>((resolve, reject) => {
          const removeProgress = onProgress
            ? this.onProgress(downloadId, (event) => {
                onProgress(event.bytesDownloaded, event.totalBytes);
              })
            : () => {};
          const removeComplete = this.onComplete(downloadId, async () => {
            removeProgress();
            removeComplete();
            removeError();
            this.silentDownloadIds.delete(downloadId);
            try {
              await this.moveCompletedDownload(downloadId, destPath);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
          const removeError = this.onError(downloadId, (event) => {
            removeProgress();
            removeComplete();
            removeError();
            this.silentDownloadIds.delete(downloadId);
            reject(new Error(event.reason ?? 'Download failed'));
          });
        });
      } catch (error) {
        if (resolvedDownloadId === 0) rejectDownloadId(error);
        throw error;
      }
    })();
    return { get downloadId() { return resolvedDownloadId; }, downloadIdPromise, promise };
  }

  markSilent(downloadId: number): void { this.silentDownloadIds.add(downloadId); }
  unmarkSilent(downloadId: number): void { this.silentDownloadIds.delete(downloadId); }

  async excludeFromBackup(path: string): Promise<boolean> {
    if (!this.isAvailable() || typeof DownloadManagerModule.excludePathFromBackup !== 'function') return false;
    return DownloadManagerModule.excludePathFromBackup(path).catch(() => false);
  }

  cleanup(): void {
    this.stopProgressPolling();
    this.subscriptions.forEach(sub => sub.remove());
    this.subscriptions = [];
    this.progressListeners.clear();
    this.completeListeners.clear();
    this.errorListeners.clear();
  }

  private setupEventListeners(): void {
    if (!this.eventEmitter) return;
    const push = (s: { remove: () => void }) => this.subscriptions.push(s);
    push(this.eventEmitter.addListener('DownloadProgress', (e: DownloadProgressEvent) => {
      this.progressListeners.get(`progress_${e.downloadId}`)?.(e);
      if (!this.silentDownloadIds.has(e.downloadId)) {
        this.progressListeners.get('progress_all')?.(e);
      }
    }));
    push(this.eventEmitter.addListener('DownloadComplete', (e: DownloadCompleteEvent) => {
      this.completeListeners.get(`complete_${e.downloadId}`)?.(e);
      if (!this.silentDownloadIds.has(e.downloadId)) {
        this.completeListeners.get('complete_all')?.(e);
      }
    }));
    push(this.eventEmitter.addListener('DownloadError', (e: DownloadErrorEvent) => {
      this.errorListeners.get(`error_${e.downloadId}`)?.(e);
      if (!this.silentDownloadIds.has(e.downloadId)) {
        this.errorListeners.get('error_all')?.(e);
      }
    }));
  }
}

export const backgroundDownloadService = new BackgroundDownloadService();
