import { useState, useCallback, useMemo, useEffect } from 'react';
import { Keyboard, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { RECOMMENDED_MODELS, MODEL_ORGS } from '../../constants';
import { useAppStore } from '../../stores';
import { huggingFaceService, modelManager, hardwareService } from '../../services';
import { ModelInfo, ModelFile, DownloadedModel } from '../../types';
import { FilterDimension, FilterState, ModelTypeFilter, CredibilityFilter, SizeFilter } from './types';
import { initialFilterState, SIZE_OPTIONS, VISION_PIPELINE_TAG, CODE_FALLBACK_QUERY } from './constants';
import { getModelType } from './utils';
import logger from '../../utils/logger';

const PARAM_COUNT_REGEX = /\b(\d+[.]\d+|\d+)\s?[Bb]\b/;

export function useTextModels(setAlertState: (s: AlertState) => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState);
  const [textFiltersVisible, setTextFiltersVisible] = useState(false);
  const [recommendedModelDetails, setRecommendedModelDetails] = useState<Record<string, ModelInfo>>({});

  const { downloadedModels, setDownloadedModels, downloadProgress, setDownloadProgress, addDownloadedModel } = useAppStore();
  const [downloadIds, setDownloadIds] = useState<Record<string, number>>({});

  const loadDownloadedModels = async () => {
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  useEffect(() => {
    loadDownloadedModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const details: Record<string, ModelInfo> = {};
      await Promise.allSettled(RECOMMENDED_MODELS.map(async (m) => {
        try {
          const info = await huggingFaceService.getModelDetails(m.id);
          if (!cancelled) details[m.id] = info;
        } catch (e) {
          logger.warn(`[ModelsScreen] Failed to fetch details for ${m.id}:`, e);
        }
      }));
      if (!cancelled) setRecommendedModelDetails(details);
    })();
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) { setSelectedModel(null); setModelFiles([]); return true; }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [selectedModel])
  );

  const handleSearch = async () => {
    Keyboard.dismiss();
    setFilterState(prev => ({ ...prev, expandedDimension: null }));
    const hasQuery = searchQuery.trim().length > 0;
    const hasTypeFilter = filterState.type !== 'all';
    const hasOrgFilter = filterState.orgs.length > 0;
    const hasSizeFilter = filterState.size !== 'all';
    if (!hasQuery && !hasTypeFilter && !hasOrgFilter && !hasSizeFilter) {
      setHasSearched(false); setSearchResults([]); return;
    }
    let pipelineTag: string | undefined;
    let effectiveQuery = searchQuery.trim();
    if (filterState.type === 'vision') pipelineTag = VISION_PIPELINE_TAG;
    else if (filterState.type === 'code' && !effectiveQuery) effectiveQuery = CODE_FALLBACK_QUERY;
    setIsLoading(true); setHasSearched(true);
    try {
      const results = await huggingFaceService.searchModels(effectiveQuery, { limit: 30, pipelineTag });
      setSearchResults(results);
    } catch {
      setAlertState(showAlert('Search Error', 'Failed to search models. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectModel = async (model: ModelInfo) => {
    setSelectedModel(model); setIsLoadingFiles(true);
    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      setModelFiles(files);
    } catch {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleRepairMmProj = async (model: ModelInfo, file: ModelFile) => {
    const downloadKey = `${model.id}/${file.name}-mmproj`;
    const clearRepairState = () => { setDownloadProgress(downloadKey, null); setDownloadIds(prev => { const { [downloadKey]: _r, ...rest } = prev; return rest; }); };
    setDownloadProgress(downloadKey, { progress: 0, bytesDownloaded: 0, totalBytes: file.mmProjFile?.size || 0 });
    try {
      await modelManager.repairMmProj(model.id, file, {
        onProgress: (p) => setDownloadProgress(downloadKey, p),
        onDownloadIdReady: (id) => setDownloadIds(prev => ({ ...prev, [downloadKey]: id })),
      });
      clearRepairState();
      await loadDownloadedModels();
      setAlertState(showAlert('Vision Repaired', `Vision file restored for ${model.name}. Reload the model to enable vision.`));
    } catch (e) { clearRepairState(); setAlertState(showAlert('Repair Failed', (e as Error).message)); }
  };

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    const downloadKey = `${model.id}/${file.name}`;
    setDownloadProgress(downloadKey, { progress: 0, bytesDownloaded: 0, totalBytes: file.size || 0 });
    const onProgress = (p: { progress: number; bytesDownloaded: number; totalBytes: number }) =>
      setDownloadProgress(downloadKey, p);
    const onComplete = (dm: DownloadedModel) => {
      setDownloadProgress(downloadKey, null);
      setDownloadIds(prev => { const { [downloadKey]: _r, ...rest } = prev; return rest; });
      addDownloadedModel(dm);
      setAlertState(showAlert('Success', `${model.name} downloaded successfully!`));
    };
    const onError = (err: Error) => {
      setDownloadProgress(downloadKey, null);
      setDownloadIds(prev => { const { [downloadKey]: _r, ...rest } = prev; return rest; });
      setAlertState(showAlert('Download Failed', err.message));
    };
    try {
      const info = await modelManager.downloadModelBackground(model.id, file, onProgress);
      setDownloadIds(prev => ({ ...prev, [downloadKey]: info.downloadId }));
      modelManager.watchDownload(info.downloadId, onComplete, onError);
    } catch (e) { onError(e as Error); }
  };

  const handleCancelDownload = async (downloadKey: string) => {
    const downloadId = downloadIds[downloadKey];
    if (downloadId == null) return;
    try {
      await modelManager.cancelBackgroundDownload(downloadId);
    } catch { /* ignore cancel errors */ }
    setDownloadProgress(downloadKey, null);
    setDownloadIds(prev => { const { [downloadKey]: _r, ...rest } = prev; return rest; });
  };

  const isModelDownloaded = (modelId: string, fileName: string) =>
    downloadedModels.some(m => m.id === `${modelId}/${fileName}`);

  const getDownloadedModel = (modelId: string, fileName: string): DownloadedModel | undefined =>
    downloadedModels.find(m => m.id === `${modelId}/${fileName}`);

  // Filter actions
  const clearFilters = useCallback(() => setFilterState(initialFilterState), []);
  const toggleFilterDimension = useCallback((dim: FilterDimension) => {
    setFilterState(prev => ({ ...prev, expandedDimension: prev.expandedDimension === dim ? null : dim }));
  }, []);
  const toggleOrg = useCallback((orgKey: string) => {
    setFilterState(prev => ({
      ...prev,
      orgs: prev.orgs.includes(orgKey) ? prev.orgs.filter(o => o !== orgKey) : [...prev.orgs, orgKey],
    }));
  }, []);
  const setTypeFilter = useCallback((type: ModelTypeFilter) =>
    setFilterState(prev => ({ ...prev, type, expandedDimension: null })), []);
  const setSourceFilter = useCallback((source: CredibilityFilter) =>
    setFilterState(prev => ({ ...prev, source, expandedDimension: null })), []);
  const setSizeFilter = useCallback((size: SizeFilter) =>
    setFilterState(prev => ({ ...prev, size, expandedDimension: null })), []);
  const setQuantFilter = useCallback((quant: string) =>
    setFilterState(prev => ({ ...prev, quant, expandedDimension: null })), []);

  // Computed
  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceRecommendation = useMemo(() => hardwareService.getModelRecommendation(), []);
  const hasActiveFilters = filterState.orgs.length > 0 || filterState.type !== 'all' ||
    filterState.source !== 'all' || filterState.size !== 'all' || filterState.quant !== 'all';

  const parseParamCount = useCallback((model: ModelInfo): number | null => {
    const match = PARAM_COUNT_REGEX.exec(model.name) ?? PARAM_COUNT_REGEX.exec(model.id);
    return match ? Number.parseFloat(match[1]) : null;
  }, []);

  const matchesOrgFilter = useCallback((model: ModelInfo, orgs: string[]): boolean => {
    if (orgs.length === 0) return true;
    return orgs.some(orgKey => {
      if (model.author === orgKey) return true;
      const orgLabel = MODEL_ORGS.find(o => o.key === orgKey)?.label || orgKey;
      return model.id.toLowerCase().includes(orgLabel.toLowerCase()) ||
        model.name.toLowerCase().includes(orgLabel.toLowerCase());
    });
  }, []);

  const filteredResults = useMemo(() => {
    const filtered = searchResults.filter(model => {
      if (filterState.source !== 'all' && model.credibility?.source !== filterState.source) return false;
      if (filterState.type !== 'all' && getModelType(model) !== filterState.type) return false;
      if (!matchesOrgFilter(model, filterState.orgs)) return false;
      if (filterState.size !== 'all') {
        const params = parseParamCount(model);
        if (params !== null) {
          const sizeOpt = SIZE_OPTIONS.find(s => s.key === filterState.size);
          if (sizeOpt && (params < sizeOpt.min || params >= sizeOpt.max)) return false;
        }
      }
      const filesWithSize = (model.files || []).filter(f => f.size > 0);
      if (filesWithSize.length > 0 && !filesWithSize.some(f => f.size / (1024 ** 3) < ramGB * 0.6)) return false;
      return true;
    });
    return filtered.map(model => {
      const type = getModelType(model);
      const params = parseParamCount(model);
      return { ...model, modelType: type === 'image-gen' ? undefined : type as 'text' | 'vision' | 'code', paramCount: params ?? undefined };
    });
  }, [searchResults, filterState.source, filterState.type, filterState.orgs, filterState.size, matchesOrgFilter, parseParamCount, ramGB]);

  const recommendedAsModelInfo = useMemo((): ModelInfo[] => {
    return RECOMMENDED_MODELS
      .filter(m => m.params <= deviceRecommendation.maxParameters)
      .filter(m => {
        if (filterState.type !== 'all' && m.type !== filterState.type) return false;
        if (filterState.orgs.length > 0 && !filterState.orgs.includes(m.org)) return false;
        if (filterState.size !== 'all') {
          const sizeOpt = SIZE_OPTIONS.find(s => s.key === filterState.size);
          if (sizeOpt && (m.params < sizeOpt.min || m.params >= sizeOpt.max)) return false;
        }
        return true;
      })
      .map(m => {
        const fetched = recommendedModelDetails[m.id];
        const curatedFields = { modelType: m.type, paramCount: m.params, minRamGB: m.minRam };
        if (fetched) return { ...fetched, name: m.name, description: m.description, ...curatedFields };
        return { id: m.id, name: m.name, author: m.id.split('/')[0], description: m.description, downloads: -1, likes: 0, tags: [], lastModified: '', files: [], ...curatedFields };
      });
  }, [deviceRecommendation.maxParameters, filterState.type, filterState.orgs, filterState.size, recommendedModelDetails]);

  return {
    searchQuery, setSearchQuery,
    isLoading, isRefreshing, setIsRefreshing,
    hasSearched,
    selectedModel, setSelectedModel,
    modelFiles, setModelFiles,
    isLoadingFiles,
    filterState, setFilterState,
    textFiltersVisible, setTextFiltersVisible,
    downloadedModels, downloadProgress,
    hasActiveFilters, ramGB, deviceRecommendation,
    filteredResults, recommendedAsModelInfo,
    handleSearch, handleSelectModel, handleDownload, handleRepairMmProj, handleCancelDownload, loadDownloadedModels,
    clearFilters, toggleFilterDimension, toggleOrg,
    setTypeFilter, setSourceFilter, setSizeFilter, setQuantFilter,
    isModelDownloaded, getDownloadedModel,
    downloadIds,
  };
}
