/**
 * Standalone async image download handlers — no hooks.
 * Each function accepts an explicit `deps` object instead of closing over hook state.
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { showAlert, hideAlert, AlertState } from '../../components/CustomAlert';
import { modelManager, hardwareService, backgroundDownloadService } from '../../services';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../../utils/coreMLModelUtils';
import { ONNXImageModel } from '../../types';
import { ImageModelDescriptor } from './types';

/** Remove downloading indicator and clear progress for a model. */
export function cleanupDownloadState(deps: ImageDownloadDeps, modelId: string, downloadId?: number) {
  deps.removeImageModelDownloading(modelId);
  deps.clearModelProgress(modelId);
  if (downloadId != null) deps.setBackgroundDownload(downloadId, null);
}

/** Register a downloaded image model, activate if first, then cleanup + alert. */
export async function registerAndNotify(
  deps: ImageDownloadDeps,
  opts: { imageModel: ONNXImageModel; modelName: string; downloadId?: number },
) {
  const { imageModel, modelName, downloadId } = opts;
  await modelManager.addDownloadedImageModel(imageModel);
  deps.addDownloadedImageModel(imageModel);
  // Auto-load the first image model unless the onboarding spotlight flow is
  // still active — Step 13 needs activeImageModelId to be null so the
  // "Load your image model" spotlight can fire on HomeScreen.
  if (!deps.activeImageModelId && deps.triedImageGen) deps.setActiveImageModelId(imageModel.id);
  cleanupDownloadState(deps, imageModel.id, downloadId);
  deps.setAlertState(showAlert('Success', `${modelName} downloaded successfully!`));
}

/** Wire error + complete listeners that unsub on completion and share cleanup logic. */
export function wireDownloadListeners(
  ctx: { downloadId: number; modelId: string; deps: ImageDownloadDeps },
  onCompleteWork: () => Promise<void>,
) {
  const { downloadId, modelId, deps } = ctx;
  let unsubProgress: (() => void) | null = null;
  const unsubComplete = backgroundDownloadService.onComplete(downloadId, async () => {
    unsubProgress?.(); unsubComplete(); unsubError();
    try { await onCompleteWork(); } catch (e: any) {
      deps.setAlertState(showAlert('Download Failed', e?.message || 'Failed to process model'));
      cleanupDownloadState(deps, modelId, downloadId);
    }
  });
  const unsubError = backgroundDownloadService.onError(downloadId, (ev) => {
    unsubProgress?.(); unsubComplete(); unsubError();
    deps.setAlertState(showAlert('Download Failed', ev.reason || 'Unknown error'));
    cleanupDownloadState(deps, modelId, downloadId);
  });
  return {
    setProgressUnsub: (fn: () => void) => { unsubProgress = fn; },
  };
}

export interface ImageDownloadDeps {
  addImageModelDownloading: (id: string) => void;
  removeImageModelDownloading: (id: string) => void;
  updateModelProgress: (id: string, n: number) => void;
  clearModelProgress: (id: string) => void;
  addDownloadedImageModel: (m: ONNXImageModel) => void;
  activeImageModelId: string | null;
  setActiveImageModelId: (id: string) => void;
  setImageModelDownloadId: (modelId: string, downloadId: number | null) => void;
  setBackgroundDownload: (downloadId: number, data: any) => void;
  setAlertState: (s: AlertState) => void;
  /** When false, skip auto-load so the onboarding spotlight can guide the user to load manually. */
  triedImageGen: boolean;
}

export async function downloadHuggingFaceModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
    deps.setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
    return;
  }
  deps.addImageModelDownloading(modelInfo.id);
  deps.updateModelProgress(modelInfo.id, 0);
  try {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
    if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);

    const files = modelInfo.huggingFaceFiles;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    let downloadedSize = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileUrl = `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`;
      const filePath = `${modelDir}/${file.path}`;
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!(await RNFS.exists(fileDir))) await RNFS.mkdir(fileDir);

      // Use a flattened temp filename to avoid path issues in the Downloads dir.
      const tempFileName = `${modelInfo.id}_${file.path.replace(/\//g, '_')}`;
      const capturedDownloadedSize = downloadedSize;
      const { promise } = backgroundDownloadService.downloadFileTo({
        params: {
          url: fileUrl,
          fileName: tempFileName,
          modelId: `image:${modelInfo.id}`,
          totalBytes: file.size,
        },
        destPath: filePath,
        onProgress: (bytesDownloaded) => {
          deps.updateModelProgress(
            modelInfo.id,
            ((capturedDownloadedSize + bytesDownloaded) / totalSize) * 0.95,
          );
        },
      });
      await promise;
      downloadedSize += file.size;
      deps.updateModelProgress(modelInfo.id, (downloadedSize / totalSize) * 0.95);
    }
    const imageModel: ONNXImageModel = {
      id: modelInfo.id, name: modelInfo.name, description: modelInfo.description,
      modelPath: modelDir, downloadedAt: new Date().toISOString(),
      size: modelInfo.size, style: modelInfo.style, backend: modelInfo.backend,
    };
    await registerAndNotify(deps, { imageModel, modelName: modelInfo.name });
  } catch (error: any) {
    deps.setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
    try {
      const dir = `${modelManager.getImageModelsDirectory()}/${modelInfo.id}`;
      if (await RNFS.exists(dir)) await RNFS.unlink(dir);
    } catch { /* ignore cleanup errors */ }
    cleanupDownloadState(deps, modelInfo.id);
  }
}

export async function downloadCoreMLMultiFile(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!backgroundDownloadService.isAvailable()) {
    deps.setAlertState(showAlert('Not Available', 'Background downloads not available'));
    return;
  }
  if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

  deps.addImageModelDownloading(modelInfo.id);
  deps.updateModelProgress(modelInfo.id, 0);
  try {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    const downloadInfo = await backgroundDownloadService.startMultiFileDownload({
      files: modelInfo.coremlFiles.map(f => ({ url: f.downloadUrl, relativePath: f.relativePath, size: f.size })),
      fileName: modelInfo.id, modelId: `image:${modelInfo.id}`, destinationDir: modelDir, totalBytes: modelInfo.size,
    });
    deps.setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);
    deps.setBackgroundDownload(downloadInfo.downloadId, {
      modelId: `image:${modelInfo.id}`, fileName: modelInfo.id, quantization: 'Core ML', author: 'Image Generation', totalBytes: modelInfo.size,
      imageModelName: modelInfo.name, imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size, imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend, imageModelRepo: modelInfo.repo,
      imageDownloadType: 'multifile',
    });
    const listeners = wireDownloadListeners({ downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps }, async () => {
      if (modelInfo.backend === 'coreml' && modelInfo.repo) await downloadCoreMLTokenizerFiles(modelDir, modelInfo.repo);
      const imageModel: ONNXImageModel = {
        id: modelInfo.id, name: modelInfo.name, description: modelInfo.description,
        modelPath: modelDir, downloadedAt: new Date().toISOString(),
        size: modelInfo.size, style: modelInfo.style, backend: modelInfo.backend,
      };
      await registerAndNotify(deps, { imageModel, modelName: modelInfo.name, downloadId: downloadInfo.downloadId });
    });
    listeners.setProgressUnsub(backgroundDownloadService.onProgress(downloadInfo.downloadId, (ev) => {
      deps.updateModelProgress(modelInfo.id, ev.totalBytes > 0 ? (ev.bytesDownloaded / ev.totalBytes) * 0.95 : 0);
    }));
    backgroundDownloadService.startProgressPolling();
  } catch (error: any) {
    deps.setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
    cleanupDownloadState(deps, modelInfo.id);
  }
}

export async function proceedWithDownload(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
    await downloadHuggingFaceModel(modelInfo, deps);
    return;
  }
  if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
    await downloadCoreMLMultiFile(modelInfo, deps);
    return;
  }

  deps.addImageModelDownloading(modelInfo.id);
  deps.updateModelProgress(modelInfo.id, 0);
  try {
    const fileName = `${modelInfo.id}.zip`;
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: modelInfo.downloadUrl!, fileName, modelId: `image:${modelInfo.id}`,
      title: `Downloading ${modelInfo.name}`, description: 'Image generation model', totalBytes: modelInfo.size,
    });
    deps.setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);
    deps.setBackgroundDownload(downloadInfo.downloadId, {
      modelId: `image:${modelInfo.id}`, fileName, quantization: '', author: 'Image Generation', totalBytes: modelInfo.size,
      imageModelName: modelInfo.name, imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size, imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend, imageDownloadType: 'zip',
    });
    const listeners = wireDownloadListeners({ downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps }, async () => {
      deps.updateModelProgress(modelInfo.id, 0.9);
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const zipPath = `${imageModelsDir}/${fileName}`;
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;
      if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
      await backgroundDownloadService.moveCompletedDownload(downloadInfo.downloadId, zipPath);
      deps.updateModelProgress(modelInfo.id, 0.92);
      if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
      await unzip(zipPath, modelDir);
      const resolvedModelDir = modelInfo.backend === 'coreml' ? await resolveCoreMLModelDir(modelDir) : modelDir;
      deps.updateModelProgress(modelInfo.id, 0.95);
      await RNFS.unlink(zipPath).catch(() => {});
      const imageModel: ONNXImageModel = {
        id: modelInfo.id, name: modelInfo.name, description: modelInfo.description,
        modelPath: resolvedModelDir, downloadedAt: new Date().toISOString(), size: modelInfo.size, style: modelInfo.style,
      };
      await registerAndNotify(deps, { imageModel, modelName: modelInfo.name, downloadId: downloadInfo.downloadId });
    });
    listeners.setProgressUnsub(backgroundDownloadService.onProgress(downloadInfo.downloadId, (ev) => {
      deps.updateModelProgress(modelInfo.id, ev.totalBytes > 0 ? (ev.bytesDownloaded / ev.totalBytes) * 0.9 : 0);
    }));
    backgroundDownloadService.startProgressPolling();
  } catch (error: any) {
    deps.setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
    cleanupDownloadState(deps, modelInfo.id);
  }
}

export async function handleDownloadImageModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (modelInfo.backend === 'qnn' && Platform.OS === 'android') {
    const socInfo = await hardwareService.getSoCInfo();
    let warningMessage: string | null = null;
    if (!socInfo.hasNPU) {
      warningMessage = 'NPU models require a Qualcomm Snapdragon processor. ' +
        'Your device does not have a compatible NPU and this model will not work. ' +
        'Consider downloading a CPU model instead.';
    } else if (modelInfo.variant && socInfo.qnnVariant) {
      const deviceVariant = socInfo.qnnVariant;
      const modelVariant = modelInfo.variant;
      const compatible =
        modelVariant === deviceVariant || deviceVariant === '8gen2' ||
        (deviceVariant === '8gen1' && modelVariant !== '8gen2');
      if (!compatible) {
        warningMessage = `This model is built for ${modelVariant === '8gen2' ? 'flagship' : modelVariant} Snapdragon chips. ` +
          `Your device uses a ${deviceVariant === 'min' ? 'non-flagship' : deviceVariant} chip and this model will likely crash. ` +
          `Download the non-flagship variant instead.`;
      }
    }
    if (warningMessage) {
      if (socInfo.hasNPU) {
        // Variant mismatch — allow "Download Anyway" since it might still work
        deps.setAlertState(showAlert('Incompatible Model', warningMessage, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Download Anyway', style: 'destructive', onPress: () => { deps.setAlertState(hideAlert()); proceedWithDownload(modelInfo, deps); } },
        ]));
      } else {
        // Device has no NPU — block download entirely, no escape hatch
        deps.setAlertState(showAlert('Incompatible Model', warningMessage, [
          { text: 'OK', style: 'cancel' },
        ]));
      }
      return;
    }
  }
  await proceedWithDownload(modelInfo, deps);
}
