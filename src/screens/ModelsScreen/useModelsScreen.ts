import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { showAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import { useAppStore } from '../../stores';
import { modelManager } from '../../services';
import { resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';
import { ONNXImageModel } from '../../types';
import { ModelTab, NavigationProp } from './types';
import { initialFilterState } from './constants';
import { getDirectorySize } from './utils';
import { useTextModels } from './useTextModels';
import { useImageModels } from './useImageModels';
import { useNotifRationale } from './useNotifRationale';

export function useModelsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const [activeTab, setActiveTabRaw] = useState<ModelTab>('text');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ fraction: number; fileName: string } | null>(null);

  const { addDownloadedModel, activeImageModelId, setActiveImageModelId, addDownloadedImageModel } = useAppStore();

  const text = useTextModels(setAlertState);
  const image = useImageModels(setAlertState);

  const isFirstDownload =
    text.downloadedModels.length === 0 && image.downloadedImageModels.length === 0;
  const {
    showNotifRationale,
    maybeShowNotifRationale,
    handleNotifRationaleAllow,
    handleNotifRationaleDismiss,
  } = useNotifRationale(isFirstDownload);

  useEffect(() => {
    if (activeTab === 'image' && image.availableHFModels.length === 0 && !image.hfModelsLoading) {
      image.loadHFModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const setActiveTab = (tab: ModelTab) => {
    setActiveTabRaw(tab);
    text.setFilterState(initialFilterState);
    text.setTextFiltersVisible(false);
    image.setImageFiltersVisible(false);
  };

  const handleRefresh = async () => {
    text.setIsRefreshing(true);
    await text.loadDownloadedModels();
    await image.loadDownloadedImageModels();
    if (text.hasSearched && text.searchQuery.trim()) await text.handleSearch();
    if (activeTab === 'image') await image.loadHFModels(true);
    text.setIsRefreshing(false);
  };

  const handleImportImageModelZip = async (sourceUri: string, fileName: string) => {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelId = `local_${fileName.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
    const modelDir = `${imageModelsDir}/${modelId}`;
    const zipPath = `${imageModelsDir}/${modelId}.zip`;
    if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
    setImportProgress({ fraction: 0.1, fileName });
    if (Platform.OS === 'ios') await RNFS.moveFile(sourceUri, zipPath);
    else await RNFS.copyFile(sourceUri, zipPath);
    setImportProgress({ fraction: 0.5, fileName });
    if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
    setImportProgress({ fraction: 0.6, fileName });
    await unzip(zipPath, modelDir);
    setImportProgress({ fraction: 0.85, fileName });
    const dirContents = await RNFS.readDir(modelDir);
    const hasMLModelC = dirContents.some(f => f.name.endsWith('.mlmodelc'));
    const hasNestedMLModelC = !hasMLModelC && dirContents.some(f => f.isDirectory());
    let resolvedModelDir = modelDir;
    let backend: 'mnn' | 'qnn' | 'coreml' | undefined;
    if (hasMLModelC || hasNestedMLModelC) {
      backend = 'coreml';
      resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    } else {
      const hasMNN = dirContents.some(f => f.name.endsWith('.mnn'));
      const hasQNN = dirContents.some(f => f.name.endsWith('.bin') || f.name.includes('qnn'));
      if (hasMNN) backend = 'mnn';
      else if (hasQNN) backend = 'qnn';
    }
    await RNFS.unlink(zipPath).catch(() => {});
    const totalSize = await getDirectorySize(resolvedModelDir);
    setImportProgress({ fraction: 0.95, fileName });
    const modelName = fileName.replace(/\.zip$/i, '').replace(/[_-]/g, ' ');
    const imageModel: ONNXImageModel = {
      id: modelId, name: modelName, description: 'Locally imported image model',
      modelPath: resolvedModelDir, downloadedAt: new Date().toISOString(), size: totalSize, backend,
    };
    await modelManager.addDownloadedImageModel(imageModel);
    addDownloadedImageModel(imageModel);
    if (!activeImageModelId) setActiveImageModelId(imageModel.id);
    setImportProgress({ fraction: 1, fileName });
    setAlertState(showAlert('Success', `${modelName} imported successfully!`));
  };

  const handleImportLocalModel = async () => {
    try {
      const result = await pick({ type: [types.allFiles], allowMultiSelection: false });
      const file = result[0];
      if (!file) return;
      const fileName = file.name || 'unknown';
      const lowerName = fileName.toLowerCase();
      if (!lowerName.endsWith('.gguf') && !lowerName.endsWith('.zip')) {
        setAlertState(showAlert('Invalid File', 'Supported formats: .gguf (text models) and .zip (image models).'));
        return;
      }
      setIsImporting(true);
      setImportProgress({ fraction: 0, fileName });
      if (lowerName.endsWith('.zip')) {
        await handleImportImageModelZip(file.uri, fileName);
      } else {
        const model = await modelManager.importLocalModel(file.uri, fileName, p => setImportProgress(p));
        addDownloadedModel(model);
        setAlertState(showAlert('Success', `${model.name} imported successfully!`));
      }
    } catch (error: any) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return;
      setAlertState(showAlert('Import Failed', error?.message || 'Unknown error'));
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const totalModelCount =
    text.downloadedModels.length +
    image.downloadedImageModels.length +
    Object.keys(text.downloadProgress).length;

  const handleDownload = useCallback(
    (...args: Parameters<typeof text.handleDownload>) => {
      maybeShowNotifRationale(() => text.handleDownload(...args));
    },
    [maybeShowNotifRationale, text],
  );

  const handleDownloadImageModel = useCallback(
    (...args: Parameters<typeof image.handleDownloadImageModel>) => {
      maybeShowNotifRationale(() => image.handleDownloadImageModel(...args));
    },
    [maybeShowNotifRationale, image],
  );

  return {
    navigation,
    focusTrigger,
    activeTab,
    setActiveTab,
    alertState,
    setAlertState,
    isImporting,
    importProgress,
    totalModelCount,
    handleImportLocalModel,
    handleRefresh,
    // text model state & handlers
    searchQuery: text.searchQuery,
    setSearchQuery: text.setSearchQuery,
    isLoading: text.isLoading,
    isRefreshing: text.isRefreshing,
    hasSearched: text.hasSearched,
    selectedModel: text.selectedModel,
    setSelectedModel: text.setSelectedModel,
    modelFiles: text.modelFiles,
    setModelFiles: text.setModelFiles,
    isLoadingFiles: text.isLoadingFiles,
    filterState: text.filterState,
    setFilterState: text.setFilterState,
    textFiltersVisible: text.textFiltersVisible,
    setTextFiltersVisible: text.setTextFiltersVisible,
    downloadedModels: text.downloadedModels,
    downloadProgress: text.downloadProgress,
    hasActiveFilters: text.hasActiveFilters,
    ramGB: text.ramGB,
    deviceRecommendation: text.deviceRecommendation,
    filteredResults: text.filteredResults,
    recommendedAsModelInfo: text.recommendedAsModelInfo,
    handleSearch: text.handleSearch,
    handleSelectModel: text.handleSelectModel,
    handleDownload,
    handleRepairMmProj: text.handleRepairMmProj,
    handleCancelDownload: text.handleCancelDownload,
    downloadIds: text.downloadIds,
    clearFilters: text.clearFilters,
    toggleFilterDimension: text.toggleFilterDimension,
    toggleOrg: text.toggleOrg,
    setTypeFilter: text.setTypeFilter,
    setSourceFilter: text.setSourceFilter,
    setSizeFilter: text.setSizeFilter,
    setQuantFilter: text.setQuantFilter,
    isModelDownloaded: text.isModelDownloaded,
    getDownloadedModel: text.getDownloadedModel,
    // image model state & handlers
    availableHFModels: image.availableHFModels,
    hfModelsLoading: image.hfModelsLoading,
    hfModelsError: image.hfModelsError,
    backendFilter: image.backendFilter,
    setBackendFilter: image.setBackendFilter,
    styleFilter: image.styleFilter,
    setStyleFilter: image.setStyleFilter,
    sdVersionFilter: image.sdVersionFilter,
    setSdVersionFilter: image.setSdVersionFilter,
    imageFilterExpanded: image.imageFilterExpanded,
    setImageFilterExpanded: image.setImageFilterExpanded,
    imageSearchQuery: image.imageSearchQuery,
    setImageSearchQuery: image.setImageSearchQuery,
    imageFiltersVisible: image.imageFiltersVisible,
    setImageFiltersVisible: image.setImageFiltersVisible,
    imageRec: image.imageRec,
    showRecommendedOnly: image.showRecommendedOnly,
    setShowRecommendedOnly: image.setShowRecommendedOnly,
    showRecHint: image.showRecHint,
    setShowRecHint: image.setShowRecHint,
    imageModelProgress: image.imageModelProgress,
    downloadedImageModels: image.downloadedImageModels,
    imageModelDownloading: image.imageModelDownloading,
    hasActiveImageFilters: image.hasActiveImageFilters,
    filteredHFModels: image.filteredHFModels,
    imageRecommendation: image.imageRecommendation,
    loadHFModels: image.loadHFModels,
    clearImageFilters: image.clearImageFilters,
    isRecommendedModel: image.isRecommendedModel,
    handleDownloadImageModel,
    showNotifRationale,
    handleNotifRationaleAllow,
    handleNotifRationaleDismiss,
    setUserChangedBackendFilter: image.setUserChangedBackendFilter,
  };
}

export type ModelsScreenViewModel = ReturnType<typeof useModelsScreen>;
