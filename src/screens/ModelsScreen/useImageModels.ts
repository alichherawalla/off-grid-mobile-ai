import { useState, useCallback, useMemo, useEffect } from 'react';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { modelManager, hardwareService, backgroundDownloadService } from '../../services';
import { fetchAvailableModels, HFImageModel, guessStyle } from '../../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../../services/coreMLModelBrowser';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../../utils/coreMLModelUtils';
import { ImageModelRecommendation, ONNXImageModel, PersistedDownloadInfo } from '../../types';
import { BackendFilter, ImageFilterDimension, ImageModelDescriptor } from './types';
import { matchesSdVersionFilter } from './utils';
import {
  ImageDownloadDeps,
  handleDownloadImageModel as downloadImageModel,
  wireDownloadListeners,
  registerAndNotify,
  cleanupDownloadState,
} from './imageDownloadActions';
import logger from '../../utils/logger';

/** Process a completed image download (zip or multifile) using persisted metadata. */
async function handleCompletedImageDownload(opts: {
  metadata: PersistedDownloadInfo;
  modelId: string;
  modelDir: string;
  imageModelsDir: string;
  downloadId: number;
  deps: ImageDownloadDeps;
}): Promise<void> {
  const { metadata, modelId, modelDir, imageModelsDir, downloadId, deps } = opts;

  if (metadata.imageDownloadType === 'zip') {
    const zipPath = `${imageModelsDir}/${metadata.fileName}`;
    if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
    await backgroundDownloadService.moveCompletedDownload(downloadId, zipPath);
    deps.updateModelProgress(modelId, 0.92);
    if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
    await unzip(zipPath, modelDir);
    const resolvedModelDir = metadata.imageModelBackend === 'coreml'
      ? await resolveCoreMLModelDir(modelDir) : modelDir;
    deps.updateModelProgress(modelId, 0.95);
    await RNFS.unlink(zipPath).catch(() => { });
    const imageModel: ONNXImageModel = {
      id: modelId, name: metadata.imageModelName!, description: metadata.imageModelDescription!,
      modelPath: resolvedModelDir, downloadedAt: new Date().toISOString(),
      size: metadata.imageModelSize!, style: metadata.imageModelStyle,
      backend: metadata.imageModelBackend as ONNXImageModel['backend'],
    };
    await registerAndNotify(deps, { imageModel, modelName: metadata.imageModelName!, downloadId });
  } else if (metadata.imageDownloadType === 'multifile') {
    const imageModel: ONNXImageModel = {
      id: modelId, name: metadata.imageModelName!, description: metadata.imageModelDescription!,
      modelPath: modelDir, downloadedAt: new Date().toISOString(),
      size: metadata.imageModelSize!, style: metadata.imageModelStyle,
      backend: metadata.imageModelBackend as ONNXImageModel['backend'],
    };
    await registerAndNotify(deps, { imageModel, modelName: metadata.imageModelName!, downloadId });
    // Fetch tokenizer files in background after model is registered
    if (metadata.imageModelBackend === 'coreml' && metadata.imageModelRepo) {
      downloadCoreMLTokenizerFiles(modelDir, metadata.imageModelRepo).catch(() => {});
    }
  }
}

export function useImageModels(setAlertState: (s: AlertState) => void) {
  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>([]);
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sdVersionFilter, setSdVersionFilter] = useState<string>('all');
  const [imageFilterExpanded, setImageFilterExpanded] = useState<ImageFilterDimension>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageFiltersVisible, setImageFiltersVisible] = useState(false);
  const [imageRec, setImageRec] = useState<ImageModelRecommendation | null>(null);
  const [userChangedBackendFilter, setUserChangedBackendFilter] = useState(false);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(true);
  const [showRecHint, setShowRecHint] = useState(true);
  const [imageModelProgress, setImageModelProgress] = useState<Record<string, number>>({});

  const {
    downloadedImageModels, setDownloadedImageModels, addDownloadedImageModel,
    activeImageModelId, setActiveImageModelId,
    imageModelDownloading, addImageModelDownloading, removeImageModelDownloading,
    setImageModelDownloadId, setBackgroundDownload,
    onboardingChecklist,
  } = useAppStore();

  const updateModelProgress = (modelId: string, n: number) =>
    setImageModelProgress(prev => ({ ...prev, [modelId]: n }));
  const clearModelProgress = (modelId: string) =>
    setImageModelProgress(prev => { const next = { ...prev }; delete next[modelId]; return next; });

  const makeDeps = (): ImageDownloadDeps => ({
    addImageModelDownloading, removeImageModelDownloading,
    updateModelProgress, clearModelProgress,
    addDownloadedImageModel, activeImageModelId,
    setActiveImageModelId, setImageModelDownloadId,
    setBackgroundDownload, setAlertState,
    triedImageGen: onboardingChecklist.triedImageGen,
  });

  const loadDownloadedImageModels = async () => {
    const models = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(models);
  };

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true); setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        setAvailableHFModels(coremlModels.map(m => ({
          id: m.id, name: m.name, displayName: m.displayName, backend: 'coreml' as any,
          fileName: m.fileName, downloadUrl: m.downloadUrl, size: m.size, repo: m.repo,
          _coreml: true, _coremlFiles: m.files,
          _coremlAttentionVariant: m.attentionVariant,
        })));
      } else {
        const socInfo = await hardwareService.getSoCInfo();
        setAvailableHFModels(await fetchAvailableModels(forceRefresh, { skipQnn: !socInfo.hasNPU }));
      }
    } catch (error: any) {
      setHfModelsError(error?.message || 'Failed to fetch models');
    } finally {
      setHfModelsLoading(false);
    }
  }, []);

  const restoreDownloadWithoutMetadata = (
    download: { downloadId: number; status: string; bytesDownloaded: number; totalBytes: number },
    modelId: string,
  ) => {
    if (!['running', 'pending', 'paused'].includes(download.status)) return;
    addImageModelDownloading(modelId);
    setImageModelDownloadId(modelId, download.downloadId);
    updateModelProgress(modelId, download.totalBytes > 0 ? download.bytesDownloaded / download.totalBytes : 0);
  };

  const restoreCompletedDownload = async (
    download: { downloadId: number; modelId: string },
    info: { modelId: string; metadata: PersistedDownloadInfo; deps: ImageDownloadDeps },
  ) => {
    const { modelId, metadata, deps } = info;
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelId}`;
    addImageModelDownloading(modelId);
    updateModelProgress(modelId, 0.9);
    try {
      await handleCompletedImageDownload({
        metadata, modelId, modelDir, imageModelsDir, downloadId: download.downloadId, deps,
      });
    } catch (e: any) {
      logger.warn('[ModelsScreen] Failed to process completed image download:', e);
      cleanupDownloadState(deps, modelId, download.downloadId);
    }
  };

  const restoreInProgressDownload = (
    download: { downloadId: number; modelId: string; bytesDownloaded: number; totalBytes: number },
    info: { modelId: string; metadata: PersistedDownloadInfo; deps: ImageDownloadDeps },
  ) => {
    const { modelId, metadata, deps } = info;
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelId}`;
    addImageModelDownloading(modelId);
    setImageModelDownloadId(modelId, download.downloadId);
    updateModelProgress(modelId, download.totalBytes > 0 ? download.bytesDownloaded / download.totalBytes : 0);

    wireDownloadListeners(
      { downloadId: download.downloadId, modelId, deps },
      () => handleCompletedImageDownload({
        metadata, modelId, modelDir, imageModelsDir, downloadId: download.downloadId, deps,
      }),
    ).setProgressUnsub(backgroundDownloadService.onProgress(download.downloadId, (ev) => {
      const scale = metadata.imageDownloadType === 'zip' ? 0.9 : 0.95;
      deps.updateModelProgress(modelId, ev.totalBytes > 0 ? (ev.bytesDownloaded / ev.totalBytes) * scale : 0);
    }));
  };

  const restoreActiveImageDownloads = async () => {
    if (!backgroundDownloadService.isAvailable()) return;
    try {
      const activeDownloads = await modelManager.getActiveBackgroundDownloads();
      const imageDownloads = activeDownloads.filter(d => d.modelId.startsWith('image:'));
      const activeNativeIds = new Set(imageDownloads.map(d => d.modelId.replace('image:', '')));
      for (const modelId of imageModelDownloading) {
        if (!activeNativeIds.has(modelId)) removeImageModelDownloading(modelId);
      }

      const persistedDownloads = useAppStore.getState().activeBackgroundDownloads;
      const deps = makeDeps();
      let hasActiveDownloads = false;

      for (const download of imageDownloads) {
        const modelId = download.modelId.replace('image:', '');
        const metadata = persistedDownloads[download.downloadId];

        if (!metadata?.imageDownloadType) {
          restoreDownloadWithoutMetadata(download, modelId);
          continue;
        }

        if (download.status === 'completed') {
          await restoreCompletedDownload(download, { modelId, metadata, deps });
        } else if (['running', 'pending', 'paused'].includes(download.status)) {
          restoreInProgressDownload(download, { modelId, metadata, deps });
          hasActiveDownloads = true;
        }
      }

      if (hasActiveDownloads) backgroundDownloadService.startProgressPolling();
    } catch (e) { logger.warn('[ModelsScreen] Failed to restore image downloads:', e); }
  };

  useEffect(() => {
    loadDownloadedImageModels();
    restoreActiveImageDownloads();

  }, []);

  useEffect(() => {
    let cancelled = false;
    hardwareService.getImageModelRecommendation().then(rec => {
      if (cancelled) return;
      setImageRec(rec);
      if (!userChangedBackendFilter && Platform.OS !== 'ios') {
        let filter: 'qnn' | 'mnn' | 'all';
        if (rec.recommendedBackend === 'qnn') filter = 'qnn';
        else if (rec.recommendedBackend === 'mnn') filter = 'mnn';
        else filter = 'all';
        setBackendFilter(filter);
      }
    });
    return () => { cancelled = true; };

  }, []);

  const clearImageFilters = useCallback(() => {
    setBackendFilter('all'); setUserChangedBackendFilter(true);
    setStyleFilter('all'); setSdVersionFilter('all'); setImageFilterExpanded(null);
  }, []);

  const isRecommendedModel = useCallback((model: HFImageModel): boolean => {
    if (!imageRec) return false;
    if (model.backend !== imageRec.recommendedBackend && imageRec.recommendedBackend !== 'all') return false;
    if (imageRec.qnnVariant && model.variant) return model.variant.includes(imageRec.qnnVariant);
    if (imageRec.recommendedModels?.length) {
      const fields = [model.name, model.repo, model.id].map(s => s.toLowerCase());
      return imageRec.recommendedModels.some(p => fields.some(f => f.includes(p)));
    }
    return true;
  }, [imageRec]);

  const filteredHFModels = useMemo(() => {
    const query = imageSearchQuery.toLowerCase().trim();
    const filtered = availableHFModels.filter(m => {
      if (showRecommendedOnly && imageRec && !isRecommendedModel(m)) return false;
      if (backendFilter !== 'all' && m.backend !== backendFilter) return false;
      if (styleFilter !== 'all' && guessStyle(m.name) !== styleFilter) return false;
      if (!matchesSdVersionFilter(m.name, sdVersionFilter)) return false;
      if (downloadedImageModels.some(d => d.id === m.id)) return false;
      if (query && !m.displayName.toLowerCase().includes(query) && !m.name.toLowerCase().includes(query)) return false;
      return true;
    });
    if (!showRecommendedOnly) filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return filtered;
  }, [availableHFModels, backendFilter, styleFilter, sdVersionFilter, downloadedImageModels, imageSearchQuery, imageRec, isRecommendedModel, showRecommendedOnly]);

  const hasActiveImageFilters = backendFilter !== 'all' || styleFilter !== 'all' || sdVersionFilter !== 'all';
  const imageRecommendation = imageRec?.bannerText ?? 'Loading recommendation...';

  const handleDownloadImageModel = (modelInfo: ImageModelDescriptor) =>
    downloadImageModel(modelInfo, makeDeps());

  return {
    availableHFModels, hfModelsLoading, hfModelsError,
    backendFilter, setBackendFilter,
    styleFilter, setStyleFilter,
    sdVersionFilter, setSdVersionFilter,
    imageFilterExpanded, setImageFilterExpanded,
    imageSearchQuery, setImageSearchQuery,
    imageFiltersVisible, setImageFiltersVisible,
    imageRec, showRecommendedOnly, setShowRecommendedOnly,
    showRecHint, setShowRecHint,
    imageModelProgress, downloadedImageModels, imageModelDownloading,
    hasActiveImageFilters, filteredHFModels, imageRecommendation,
    loadHFModels, loadDownloadedImageModels, restoreActiveImageDownloads,
    clearImageFilters, isRecommendedModel, handleDownloadImageModel,
    setUserChangedBackendFilter,
  };
}
