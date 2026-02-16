import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  BackHandler,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { Card, ModelCard, Button } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { CREDIBILITY_LABELS, TYPOGRAPHY, SPACING, RECOMMENDED_MODELS, MODEL_ORGS } from '../constants';
import { useAppStore } from '../stores';
import { huggingFaceService, modelManager, hardwareService, backgroundDownloadService } from '../services';
import { fetchAvailableModels, getVariantLabel, guessStyle, HFImageModel } from '../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../services/coreMLModelBrowser';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../utils/coreMLModelUtils';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { ModelInfo, ModelFile, DownloadedModel, ModelSource, ONNXImageModel, ImageModelRecommendation } from '../types';
import { RootStackParamList } from '../navigation/types';

type BackendFilter = 'all' | 'mnn' | 'qnn' | 'coreml';

interface ImageModelDescriptor {
  id: string;
  name: string;
  description: string;
  downloadUrl: string;
  size: number;
  style: string;
  backend: 'mnn' | 'qnn' | 'coreml';
  variant?: string;
  huggingFaceRepo?: string;
  huggingFaceFiles?: { path: string; size: number }[];
  /** Multi-file download manifest (Core ML full-precision models) */
  coremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
  /** HuggingFace repo slug (e.g. 'apple/coreml-stable-diffusion-2-1-base-palettized') */
  repo?: string;
}

type CredibilityFilter = 'all' | ModelSource;
type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen';

const CREDIBILITY_OPTIONS: { key: CredibilityFilter; label: string; color?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lmstudio', label: 'LM Studio', color: CREDIBILITY_LABELS.lmstudio.color },
  { key: 'official', label: 'Official', color: CREDIBILITY_LABELS.official.color },
  { key: 'verified-quantizer', label: 'Verified', color: CREDIBILITY_LABELS['verified-quantizer'].color },
  { key: 'community', label: 'Community', color: CREDIBILITY_LABELS.community.color },
];

const MODEL_TYPE_OPTIONS: { key: ModelTypeFilter; label: string }[] = [
  { key: 'all', label: 'All Types' },
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Vision' },
  { key: 'code', label: 'Code' },
];

type SizeFilter = 'all' | 'tiny' | 'small' | 'medium' | 'large';

const SIZE_OPTIONS: { key: SizeFilter; label: string; min: number; max: number }[] = [
  { key: 'all', label: 'All Sizes', min: 0, max: Infinity },
  { key: 'tiny', label: '< 1B', min: 0, max: 1 },
  { key: 'small', label: '1-3B', min: 1, max: 3 },
  { key: 'medium', label: '3-8B', min: 3, max: 8 },
  { key: 'large', label: '8B+', min: 8, max: Infinity },
];

const QUANT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'Q4_K_M', label: 'Q4_K_M' },
  { key: 'Q4_K_S', label: 'Q4_K_S' },
  { key: 'Q5_K_M', label: 'Q5_K_M' },
  { key: 'Q6_K', label: 'Q6_K' },
  { key: 'Q8_0', label: 'Q8_0' },
];

type FilterDimension = 'org' | 'type' | 'source' | 'size' | 'quant' | null;
type ImageFilterDimension = 'backend' | 'style' | 'sdVersion' | null;

const STYLE_OPTIONS = [
  { key: 'all', label: 'All Styles' },
  { key: 'photorealistic', label: 'Realistic' },
  { key: 'anime', label: 'Anime' },
];

const SD_VERSION_OPTIONS = [
  { key: 'all', label: 'All Versions' },
  { key: 'sd15', label: 'SD 1.5' },
  { key: 'sd21', label: 'SD 2.1' },
  { key: 'sdxl', label: 'SDXL' },
];

interface FilterState {
  orgs: string[];
  type: ModelTypeFilter;
  source: CredibilityFilter;
  size: SizeFilter;
  quant: string;
  expandedDimension: FilterDimension;
}

const initialFilterState: FilterState = {
  orgs: [],
  type: 'all',
  source: 'all',
  size: 'all',
  quant: 'all',
  expandedDimension: null,
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type ModelTab = 'text' | 'image';

export const ModelsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [activeTab, setActiveTab] = useState<ModelTab>('text');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const {
    downloadedModels,
    setDownloadedModels,
    downloadProgress,
    setDownloadProgress,
    addDownloadedModel,
    downloadedImageModels,
    setDownloadedImageModels,
    addDownloadedImageModel,
    activeImageModelId,
    setActiveImageModelId,
    imageModelDownloading,
    addImageModelDownloading,
    removeImageModelDownloading,
    imageModelDownloadIds: _imageModelDownloadIds,
    setImageModelDownloadId,
    setBackgroundDownload,
  } = useAppStore();

  const [imageModelProgress, setImageModelProgress] = useState<Record<string, number>>({});
  const updateModelProgress = (modelId: string, progress: number) =>
    setImageModelProgress(prev => ({ ...prev, [modelId]: progress }));
  const clearModelProgress = (modelId: string) =>
    setImageModelProgress(prev => { const next = { ...prev }; delete next[modelId]; return next; });

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ fraction: number; fileName: string } | null>(null);

  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>([]);
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sdVersionFilter, setSdVersionFilter] = useState<string>('all');
  const [imageFilterExpanded, setImageFilterExpanded] = useState<ImageFilterDimension>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [textFiltersVisible, setTextFiltersVisible] = useState(false);
  const [imageFiltersVisible, setImageFiltersVisible] = useState(false);
  const [imageRec, setImageRec] = useState<ImageModelRecommendation | null>(null);
  const [userChangedBackendFilter, setUserChangedBackendFilter] = useState(false);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(true);

  // Fetched details for recommended models (real downloads, likes, files from HF API)
  const [recommendedModelDetails, setRecommendedModelDetails] = useState<Record<string, ModelInfo>>({});

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true);
    setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        // Map CoreMLImageModel to HFImageModel shape for unified rendering
        const mapped: HFImageModel[] = coremlModels.map((m) => ({
          id: m.id,
          name: m.name,
          displayName: m.displayName,
          backend: 'coreml' as any, // actual backend — HFImageModel type doesn't include 'coreml'
          fileName: m.fileName,
          downloadUrl: m.downloadUrl,
          size: m.size,
          repo: m.repo,
          _coreml: true, // marker for badge rendering
          _coremlFiles: m.files, // multi-file download manifest (if no zip available)
        }));
        setAvailableHFModels(mapped);
      } else {
        const models = await fetchAvailableModels(forceRefresh);
        setAvailableHFModels(models);
      }
    } catch (error: any) {
      setHfModelsError(error?.message || 'Failed to fetch models');
    } finally {
      setHfModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDownloadedModels();
    loadDownloadedImageModels();
    restoreActiveImageDownloads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch real details for recommended models from HuggingFace API
  useEffect(() => {
    let cancelled = false;
    const fetchRecommendedDetails = async () => {
      const details: Record<string, ModelInfo> = {};
      await Promise.allSettled(
        RECOMMENDED_MODELS.map(async (m) => {
          try {
            const info = await huggingFaceService.getModelDetails(m.id);
            if (!cancelled) {
              details[m.id] = info;
            }
          } catch (e) {
            console.warn(`[ModelsScreen] Failed to fetch details for ${m.id}:`, e);
          }
        })
      );
      if (!cancelled) {
        setRecommendedModelDetails(details);
      }
    };
    fetchRecommendedDetails();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activeTab === 'image' && availableHFModels.length === 0 && !hfModelsLoading) {
      loadHFModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Fetch image model recommendation on mount and auto-set backend filter
  useEffect(() => {
    let cancelled = false;
    hardwareService.getImageModelRecommendation().then((rec) => {
      if (cancelled) return;
      setImageRec(rec);
      // Auto-set backend filter to recommended backend (unless user already changed it)
      if (!userChangedBackendFilter && Platform.OS !== 'ios') {
        const autoBackend = rec.recommendedBackend === 'qnn' ? 'qnn' as BackendFilter
          : rec.recommendedBackend === 'mnn' ? 'mnn' as BackendFilter
          : 'all' as BackendFilter;
        setBackendFilter(autoBackend);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore active image model downloads on mount (after app restart)
  const restoreActiveImageDownloads = async () => {
    if (!backgroundDownloadService.isAvailable()) return;

    try {
      const activeDownloads = await modelManager.getActiveBackgroundDownloads();
      const imageDownloads = activeDownloads.filter(d =>
        d.modelId.startsWith('image:') &&
        (d.status === 'running' || d.status === 'pending' || d.status === 'paused')
      );

      // Clean stale downloads: imageModelDownloading has models with no matching native download
      const activeNativeModelIds = new Set(imageDownloads.map(d => d.modelId.replace('image:', '')));
      for (const modelId of imageModelDownloading) {
        if (!activeNativeModelIds.has(modelId)) {
          removeImageModelDownloading(modelId);
        }
      }

      // Restore each active download
      for (const download of imageDownloads) {
        const modelId = download.modelId.replace('image:', '');
        addImageModelDownloading(modelId);
        setImageModelDownloadId(modelId, download.downloadId);
        const progress = download.totalBytes > 0 ? download.bytesDownloaded / download.totalBytes : 0;
        updateModelProgress(modelId, progress);
        console.log('[ModelsScreen] Restored image download state:', modelId, `${Math.round(progress * 100)}%`);
      }
    } catch (error) {
      console.warn('[ModelsScreen] Failed to restore image downloads:', error);
    }
  };

  // Handle system back button when model detail view is shown
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) {
          setSelectedModel(null);
          setModelFiles([]);
          return true; // Prevent default back behavior
        }
        return false; // Let default back behavior happen
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [selectedModel])
  );

  const loadDownloadedModels = async () => {
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  const loadDownloadedImageModels = async () => {
    const models = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(models);
  };

  const handleSearch = async () => {
    Keyboard.dismiss();
    setFilterState(prev => ({ ...prev, expandedDimension: null }));
    if (!searchQuery.trim()) {
      setHasSearched(false);
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    try {
      const results = await huggingFaceService.searchModels(searchQuery, {
        limit: 30,
      });
      setSearchResults(results);
    } catch (_error) {
      setAlertState(showAlert('Search Error', 'Failed to search models. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDownloadedModels();
    await loadDownloadedImageModels();
    if (hasSearched && searchQuery.trim()) {
      await handleSearch();
    }
    if (activeTab === 'image') {
      await loadHFModels(true);
    }
    setIsRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loadHFModels, hasSearched, searchQuery]);

  const handleImportLocalModel = async () => {
    try {
      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
      });

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
        // Import as image model zip
        await handleImportImageModelZip(file.uri, fileName);
      } else {
        // Import as text model (.gguf)
        const model = await modelManager.importLocalModel(
          file.uri,
          fileName,
          (progress) => setImportProgress(progress)
        );

        addDownloadedModel(model);
        setAlertState(showAlert('Success', `${model.name} imported successfully!`));
      }
    } catch (error: any) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        return; // User cancelled picker, do nothing
      }
      setAlertState(showAlert('Import Failed', error?.message || 'Unknown error'));
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const handleImportImageModelZip = async (sourceUri: string, fileName: string) => {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelId = `local_${fileName.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
    const modelDir = `${imageModelsDir}/${modelId}`;
    const zipPath = `${imageModelsDir}/${modelId}.zip`;

    // Ensure image models directory exists
    if (!(await RNFS.exists(imageModelsDir))) {
      await RNFS.mkdir(imageModelsDir);
    }

    // Move on iOS (avoids duplicating large files), copy on Android (content:// URIs can't be moved)
    setImportProgress({ fraction: 0.1, fileName });
    if (Platform.OS === 'ios') {
      await RNFS.moveFile(sourceUri, zipPath);
    } else {
      await RNFS.copyFile(sourceUri, zipPath);
    }

    setImportProgress({ fraction: 0.5, fileName });

    // Create model directory and extract
    if (!(await RNFS.exists(modelDir))) {
      await RNFS.mkdir(modelDir);
    }

    setImportProgress({ fraction: 0.6, fileName });
    await unzip(zipPath, modelDir);

    setImportProgress({ fraction: 0.85, fileName });

    // Detect backend from directory contents
    const dirContents = await RNFS.readDir(modelDir);
    const hasMLModelC = dirContents.some(f => f.name.endsWith('.mlmodelc'));
    const hasNestedMLModelC = !hasMLModelC && dirContents.some(f => f.isDirectory());
    let resolvedModelDir = modelDir;
    let backend: 'mnn' | 'qnn' | 'coreml' | undefined;

    if (hasMLModelC || hasNestedMLModelC) {
      backend = 'coreml';
      resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    } else {
      // Check for MNN or QNN files
      const hasMNN = dirContents.some(f => f.name.endsWith('.mnn'));
      const hasQNN = dirContents.some(f => f.name.endsWith('.bin') || f.name.includes('qnn'));
      if (hasMNN) backend = 'mnn';
      else if (hasQNN) backend = 'qnn';
    }

    // Clean up zip
    await RNFS.unlink(zipPath).catch(() => {});

    // Get total size by summing all files in the directory (stat on a dir returns 0 on Android)
    const totalSize = await getDirectorySize(resolvedModelDir);

    setImportProgress({ fraction: 0.95, fileName });

    // Register the model
    const modelName = fileName.replace(/\.zip$/i, '').replace(/[_-]/g, ' ');
    const imageModel: ONNXImageModel = {
      id: modelId,
      name: modelName,
      description: 'Locally imported image model',
      modelPath: resolvedModelDir,
      downloadedAt: new Date().toISOString(),
      size: totalSize,
      backend,
    };

    await modelManager.addDownloadedImageModel(imageModel);
    addDownloadedImageModel(imageModel);

    if (!activeImageModelId) {
      setActiveImageModelId(imageModel.id);
    }

    setImportProgress({ fraction: 1, fileName });
    setAlertState(showAlert('Success', `${modelName} imported successfully!`));
  };

  // Download from HuggingFace (multi-file download)
  const handleDownloadHuggingFaceModel = async (modelInfo: ImageModelDescriptor) => {
    if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
      setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
      return;
    }

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;

      // Create directories if needed
      if (!(await RNFS.exists(imageModelsDir))) {
        await RNFS.mkdir(imageModelsDir);
      }
      if (!(await RNFS.exists(modelDir))) {
        await RNFS.mkdir(modelDir);
      }

      const files = modelInfo.huggingFaceFiles;
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      let downloadedSize = 0;

      // Download each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileUrl = `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`;
        const filePath = `${modelDir}/${file.path}`;

        // Create subdirectory if needed
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await RNFS.exists(fileDir))) {
          await RNFS.mkdir(fileDir);
        }

        console.log(`[HuggingFace] Downloading ${file.path} (${i + 1}/${files.length})`);

        // Download file with progress
        const downloadResult = RNFS.downloadFile({
          fromUrl: fileUrl,
          toFile: filePath,
          background: true,
          discretionary: false,
          progressInterval: 500,
          progress: (res) => {
            const overallProgress = (downloadedSize + res.bytesWritten) / totalSize;
            updateModelProgress(modelInfo.id, overallProgress * 0.95);
          },
        });

        const result = await downloadResult.promise;

        if (result.statusCode !== 200) {
          throw new Error(`Failed to download ${file.path}: HTTP ${result.statusCode}`);
        }

        downloadedSize += file.size;
        updateModelProgress(modelInfo.id, (downloadedSize / totalSize) * 0.95);
      }

      // Register the model
      const imageModel: ONNXImageModel = {
        id: modelInfo.id,
        name: modelInfo.name,
        description: modelInfo.description,
        modelPath: modelDir,
        downloadedAt: new Date().toISOString(),
        size: modelInfo.size,
        style: modelInfo.style,
        backend: modelInfo.backend,
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      updateModelProgress(modelInfo.id, 1);
      setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
    } catch (error: any) {
      console.error('[HuggingFace] Download error:', error);
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      // Clean up partial download
      try {
        const modelDir = `${modelManager.getImageModelsDirectory()}/${modelInfo.id}`;
        if (await RNFS.exists(modelDir)) {
          await RNFS.unlink(modelDir);
        }
      } catch (e) {
        console.warn('[HuggingFace] Failed to clean up:', e);
      }
    } finally {
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Image model download — checks compatibility before proceeding
  const handleDownloadImageModel = async (modelInfo: ImageModelDescriptor) => {
    // Guard: warn user before downloading incompatible NPU models
    if (modelInfo.backend === 'qnn' && Platform.OS === 'android') {
      const socInfo = await hardwareService.getSoCInfo();

      let warningMessage: string | null = null;

      if (!socInfo.hasNPU) {
        warningMessage = 'NPU models require a Qualcomm Snapdragon processor. ' +
          'Your device does not have a compatible NPU and this model will not work. ' +
          'Consider downloading a CPU model instead.';
      } else if (modelInfo.variant && socInfo.qnnVariant) {
        // Check variant compatibility
        const deviceVariant = socInfo.qnnVariant;
        const modelVariant = modelInfo.variant;
        const compatible =
          modelVariant === deviceVariant ||
          deviceVariant === '8gen2' || // flagship runs everything
          (deviceVariant === '8gen1' && modelVariant !== '8gen2');
        if (!compatible) {
          warningMessage = `This model is built for ${modelVariant === '8gen2' ? 'flagship' : modelVariant} Snapdragon chips. ` +
            `Your device uses a ${deviceVariant === 'min' ? 'non-flagship' : deviceVariant} chip and this model will likely crash. ` +
            `Download the non-flagship variant instead.`;
        }
      }

      if (warningMessage) {
        setAlertState(showAlert(
          'Incompatible Model',
          warningMessage,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Download Anyway',
              style: 'destructive',
              onPress: () => {
                setAlertState(hideAlert());
                proceedWithImageModelDownload(modelInfo);
              },
            },
          ],
        ));
        return;
      }
    }

    await proceedWithImageModelDownload(modelInfo);
  };

  // Proceed with image model download (after compatibility checks)
  const proceedWithImageModelDownload = async (modelInfo: ImageModelDescriptor) => {
    // Route to HuggingFace downloader if it's a HuggingFace model
    if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
      await handleDownloadHuggingFaceModel(modelInfo);
      return;
    }

    // Route to multi-file downloader for Core ML models without zip archives
    if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
      await handleDownloadCoreMLMultiFile(modelInfo);
      return;
    }

    // Check if background download service is available
    if (!backgroundDownloadService.isAvailable()) {
      // Fall back to RNFS download for iOS or if native module unavailable
      await handleDownloadImageModelFallback(modelInfo);
      return;
    }

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const fileName = `${modelInfo.id}.zip`;

      // Start background download
      const downloadInfo = await backgroundDownloadService.startDownload({
        url: modelInfo.downloadUrl!,
        fileName: fileName,
        modelId: `image:${modelInfo.id}`,
        title: `Downloading ${modelInfo.name}`,
        description: 'Image generation model',
        totalBytes: modelInfo.size,
      });

      setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);

      // Store metadata so DownloadManagerScreen can find and cancel this download
      setBackgroundDownload(downloadInfo.downloadId, {
        modelId: `image:${modelInfo.id}`,
        fileName: fileName,
        quantization: '',
        author: 'Image Generation',
        totalBytes: modelInfo.size,
      });

      // Subscribe to progress events
      const unsubProgress = backgroundDownloadService.onProgress(downloadInfo.downloadId, (event) => {
        const progress = event.totalBytes > 0
          ? (event.bytesDownloaded / event.totalBytes) * 0.9
          : 0;
        updateModelProgress(modelInfo.id, progress);
      });

      // Subscribe to completion
      const unsubComplete = backgroundDownloadService.onComplete(downloadInfo.downloadId, async (_event) => {
        unsubProgress();
        unsubComplete();
        unsubError();

        try {
          updateModelProgress(modelInfo.id, 0.9);

          // Move the downloaded file to the image models directory
          const imageModelsDir = modelManager.getImageModelsDirectory();
          const zipPath = `${imageModelsDir}/${fileName}`;
          const modelDir = `${imageModelsDir}/${modelInfo.id}`;

          // Create directories if needed
          if (!(await RNFS.exists(imageModelsDir))) {
            await RNFS.mkdir(imageModelsDir);
          }

          // Move the completed download
          await backgroundDownloadService.moveCompletedDownload(downloadInfo.downloadId, zipPath);

          updateModelProgress(modelInfo.id, 0.92);

          // Create the model directory
          if (!(await RNFS.exists(modelDir))) {
            await RNFS.mkdir(modelDir);
          }

          // Extract the zip file
          console.log(`[ImageModels] Extracting ${zipPath} to ${modelDir}`);
          await unzip(zipPath, modelDir);

          // Resolve nested directory for Core ML zips
          const resolvedModelDir = modelInfo.backend === 'coreml'
            ? await resolveCoreMLModelDir(modelDir)
            : modelDir;

          updateModelProgress(modelInfo.id, 0.95);

          // Clean up the ZIP file
          try {
            await RNFS.unlink(zipPath);
            console.log(`[ImageModels] Cleaned up ZIP file: ${zipPath}`);
          } catch (e) {
            console.warn(`[ImageModels] Failed to delete ZIP file: ${e}`);
          }

          // Register the model
          const imageModel: ONNXImageModel = {
            id: modelInfo.id,
            name: modelInfo.name,
            description: modelInfo.description,
            modelPath: resolvedModelDir,
            downloadedAt: new Date().toISOString(),
            size: modelInfo.size,
            style: modelInfo.style,
          };

          await modelManager.addDownloadedImageModel(imageModel);
          addDownloadedImageModel(imageModel);

          // Set as active if it's the first image model
          if (!activeImageModelId) {
            setActiveImageModelId(imageModel.id);
          }

          updateModelProgress(modelInfo.id, 1);
          setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
        } catch (extractError: any) {
          setAlertState(showAlert('Extraction Failed', extractError?.message || 'Failed to extract model'));
        } finally {
          removeImageModelDownloading(modelInfo.id);
          clearModelProgress(modelInfo.id);
          setBackgroundDownload(downloadInfo.downloadId, null);
        }
      });

      // Subscribe to errors
      const unsubError = backgroundDownloadService.onError(downloadInfo.downloadId, (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();
        setAlertState(showAlert('Download Failed', event.reason || 'Unknown error'));
        removeImageModelDownloading(modelInfo.id);
        clearModelProgress(modelInfo.id);
        setBackgroundDownload(downloadInfo.downloadId, null);
      });

      // Start polling after listeners are attached
      backgroundDownloadService.startProgressPolling();

    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Fallback download method using RNFS (for iOS or when native module unavailable)
  const handleDownloadImageModelFallback = async (modelInfo: ImageModelDescriptor) => {
    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;
      const zipPath = `${imageModelsDir}/${modelInfo.id}.zip`;

      // Create directory if needed
      if (!(await RNFS.exists(imageModelsDir))) {
        await RNFS.mkdir(imageModelsDir);
      }

      // Download the zip file
      const downloadResult = RNFS.downloadFile({
        fromUrl: modelInfo.downloadUrl,
        toFile: zipPath,
        background: true,
        discretionary: true,
        progressInterval: 500,
        progress: (res) => {
          const progress = res.bytesWritten / res.contentLength;
          updateModelProgress(modelInfo.id, progress * 0.9);
        },
      });

      const result = await downloadResult.promise;

      if (result.statusCode !== 200) {
        throw new Error(`Download failed with status ${result.statusCode}`);
      }

      updateModelProgress(modelInfo.id, 0.9);

      // Create the model directory
      if (!(await RNFS.exists(modelDir))) {
        await RNFS.mkdir(modelDir);
      }

      // Extract the zip file
      await unzip(zipPath, modelDir);

      // Resolve nested directory for Core ML zips
      const resolvedModelDir = modelInfo.backend === 'coreml'
        ? await resolveCoreMLModelDir(modelDir)
        : modelDir;

      updateModelProgress(modelInfo.id, 0.95);

      // Clean up the ZIP file
      await RNFS.unlink(zipPath).catch(() => { });

      // Register the model with resolved path (handles nested zip extraction)
      const imageModel: ONNXImageModel = {
        id: modelInfo.id,
        name: modelInfo.name,
        description: modelInfo.description,
        modelPath: resolvedModelDir,
        downloadedAt: new Date().toISOString(),
        size: modelInfo.size,
        style: modelInfo.style,
        backend: modelInfo.backend,
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      updateModelProgress(modelInfo.id, 1);
      setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
    } finally {
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Multi-file download handler for Core ML models without zip archives
  const handleDownloadCoreMLMultiFile = async (modelInfo: ImageModelDescriptor) => {
    if (!backgroundDownloadService.isAvailable()) {
      setAlertState(showAlert('Not Available', 'Background downloads not available'));
      return;
    }
    if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;

      // Start multi-file background download
      const downloadInfo = await backgroundDownloadService.startMultiFileDownload({
        files: modelInfo.coremlFiles.map(f => ({
          url: f.downloadUrl,
          relativePath: f.relativePath,
          size: f.size,
        })),
        fileName: modelInfo.id,
        modelId: `image:${modelInfo.id}`,
        destinationDir: modelDir,
        totalBytes: modelInfo.size,
      });

      setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);

      // Store metadata so DownloadManagerScreen can find and cancel this download
      setBackgroundDownload(downloadInfo.downloadId, {
        modelId: `image:${modelInfo.id}`,
        fileName: modelInfo.id,
        quantization: 'Core ML',
        author: 'Image Generation',
        totalBytes: modelInfo.size,
      });

      const unsubProgress = backgroundDownloadService.onProgress(downloadInfo.downloadId, (event) => {
        const progress = event.totalBytes > 0
          ? (event.bytesDownloaded / event.totalBytes)
          : 0;
        updateModelProgress(modelInfo.id, progress * 0.95);
      });

      const unsubComplete = backgroundDownloadService.onComplete(downloadInfo.downloadId, async () => {
        unsubProgress();
        unsubComplete();
        unsubError();

        try {
          // Download tokenizer files for Core ML models (not included in compiled dir)
          if (modelInfo.backend === 'coreml' && modelInfo.repo) {
            await downloadCoreMLTokenizerFiles(modelDir, modelInfo.repo);
          }

          // Register the model (files are already in modelDir)
          const imageModel: ONNXImageModel = {
            id: modelInfo.id,
            name: modelInfo.name,
            description: modelInfo.description,
            modelPath: modelDir,
            downloadedAt: new Date().toISOString(),
            size: modelInfo.size,
            style: modelInfo.style,
            backend: modelInfo.backend,
          };

          await modelManager.addDownloadedImageModel(imageModel);
          addDownloadedImageModel(imageModel);

          if (!activeImageModelId) {
            setActiveImageModelId(imageModel.id);
          }

          updateModelProgress(modelInfo.id, 1);
          setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
        } catch (regError: any) {
          setAlertState(showAlert('Registration Failed', regError?.message || 'Failed to register model'));
        } finally {
          removeImageModelDownloading(modelInfo.id);
          clearModelProgress(modelInfo.id);
          setBackgroundDownload(downloadInfo.downloadId, null);
        }
      });

      const unsubError = backgroundDownloadService.onError(downloadInfo.downloadId, (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();
        setAlertState(showAlert('Download Failed', event.reason || 'Unknown error'));
        removeImageModelDownloading(modelInfo.id);
        clearModelProgress(modelInfo.id);
        setBackgroundDownload(downloadInfo.downloadId, null);
      });

      backgroundDownloadService.startProgressPolling();
    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  const handleSelectModel = async (model: ModelInfo) => {
    setSelectedModel(model);
    setIsLoadingFiles(true);

    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      setModelFiles(files);
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    const downloadKey = `${model.id}/${file.name}`;

    const onProgress = (progress: { progress: number; bytesDownloaded: number; totalBytes: number }) => {
      setDownloadProgress(downloadKey, {
        progress: progress.progress,
        bytesDownloaded: progress.bytesDownloaded,
        totalBytes: progress.totalBytes,
      });
    };
    const onComplete = (downloadedModel: DownloadedModel) => {
      setDownloadProgress(downloadKey, null);
      addDownloadedModel(downloadedModel);
      setAlertState(showAlert('Success', `${model.name} downloaded successfully!`));
    };
    const onError = (error: Error) => {
      setDownloadProgress(downloadKey, null);
      setAlertState(showAlert('Download Failed', error.message));
    };

    try {
      if (modelManager.isBackgroundDownloadSupported()) {
        await modelManager.downloadModelBackground(model.id, file, onProgress, onComplete, onError);
      } else {
        await modelManager.downloadModel(model.id, file, onProgress, onComplete, onError);
      }
    } catch (error) {
      setAlertState(showAlert('Download Failed', (error as Error).message));
    }
  };

  const isModelDownloaded = (modelId: string, fileName: string): boolean => {
    return downloadedModels.some(
      (m) => m.id === `${modelId}/${fileName}`
    );
  };

  const getDownloadedModel = (
    modelId: string,
    fileName: string
  ): DownloadedModel | undefined => {
    return downloadedModels.find(
      (m) => m.id === `${modelId}/${fileName}`
    );
  };

  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceRecommendation = useMemo(() => hardwareService.getModelRecommendation(), []);

  const hasActiveFilters = filterState.orgs.length > 0 || filterState.type !== 'all' || filterState.source !== 'all' || filterState.size !== 'all' || filterState.quant !== 'all';
  const hasActiveImageFilters = backendFilter !== 'all' || styleFilter !== 'all' || sdVersionFilter !== 'all';

  const clearFilters = useCallback(() => {
    setFilterState(initialFilterState);
  }, []);

  const clearImageFilters = useCallback(() => {
    setBackendFilter('all');
    setUserChangedBackendFilter(true);
    setStyleFilter('all');
    setSdVersionFilter('all');
    setImageFilterExpanded(null);
  }, []);

  const toggleFilterDimension = useCallback((dim: FilterDimension) => {
    setFilterState(prev => ({
      ...prev,
      expandedDimension: prev.expandedDimension === dim ? null : dim,
    }));
  }, []);

  const toggleOrg = useCallback((orgKey: string) => {
    setFilterState(prev => ({
      ...prev,
      orgs: prev.orgs.includes(orgKey)
        ? prev.orgs.filter(o => o !== orgKey)
        : [...prev.orgs, orgKey],
    }));
  }, []);

  const setTypeFilter = useCallback((type: ModelTypeFilter) => {
    setFilterState(prev => ({
      ...prev,
      type,
      expandedDimension: null,
    }));
  }, []);

  const setSourceFilter = useCallback((source: CredibilityFilter) => {
    setFilterState(prev => ({
      ...prev,
      source,
      expandedDimension: null,
    }));
  }, []);

  const setSizeFilter = useCallback((size: SizeFilter) => {
    setFilterState(prev => ({
      ...prev,
      size,
      expandedDimension: null,
    }));
  }, []);

  const setQuantFilter = useCallback((quant: string) => {
    setFilterState(prev => ({
      ...prev,
      quant,
      expandedDimension: null,
    }));
  }, []);

  // Parse approximate param count from model name/ID (e.g. "Llama-3.2-3B" → 3)
  const parseParamCount = useCallback((model: ModelInfo): number | null => {
    const match = model.name.match(/(\d+\.?\d*)\s*[Bb]\b/) || model.id.match(/(\d+\.?\d*)\s*[Bb]\b/);
    return match ? parseFloat(match[1]) : null;
  }, []);

  // Match org filter against search results (handles quantizer repos like bartowski/Llama-...)
  const matchesOrgFilter = useCallback((model: ModelInfo, orgs: string[]): boolean => {
    if (orgs.length === 0) return true;
    return orgs.some(orgKey => {
      // Direct author match
      if (model.author === orgKey) return true;
      // Name/ID contains the org label (catches quantizer repos)
      const orgLabel = MODEL_ORGS.find(o => o.key === orgKey)?.label || orgKey;
      const idLower = model.id.toLowerCase();
      const nameLower = model.name.toLowerCase();
      const labelLower = orgLabel.toLowerCase();
      return idLower.includes(labelLower) || nameLower.includes(labelLower);
    });
  }, []);

  // Helper to detect model type from tags
  const getModelType = (model: ModelInfo): ModelTypeFilter => {
    const tags = model.tags.map(t => t.toLowerCase());
    const name = model.name.toLowerCase();
    const id = model.id.toLowerCase();

    // Check for image generation models (Stable Diffusion, etc.)
    if (tags.some(t => t.includes('diffusion') || t.includes('text-to-image') || t.includes('image-generation')) ||
      name.includes('stable-diffusion') || name.includes('sd-') || name.includes('sdxl') ||
      id.includes('stable-diffusion') || id.includes('coreml-stable') ||
      tags.some(t => t.includes('diffusers'))) {
      return 'image-gen';
    }

    // Check for vision/multimodal models
    if (tags.some(t => t.includes('vision') || t.includes('multimodal') || t.includes('image-text')) ||
      name.includes('vision') || name.includes('vlm') || name.includes('llava') ||
      id.includes('vision') || id.includes('vlm') || id.includes('llava')) {
      return 'vision';
    }

    // Check for code models
    if (tags.some(t => t.includes('code')) ||
      name.includes('code') || name.includes('coder') || name.includes('starcoder') ||
      id.includes('code') || id.includes('coder')) {
      return 'code';
    }

    return 'text';
  };

  // Check if model has any compatible files
  const hasCompatibleFiles = (model: ModelInfo): boolean => {
    if (!model.files || model.files.length === 0) return true; // No file info yet — show it, filter on detail page
    const filesWithSize = model.files.filter(f => f.size > 0);
    if (filesWithSize.length === 0) return true; // Sizes unknown — show it
    return filesWithSize.some(file => {
      const fileSizeGB = file.size / (1024 * 1024 * 1024);
      return fileSizeGB < ramGB * 0.6;
    });
  };

  // Filter search results by credibility, type, org, size, and compatibility
  const filteredResults = useMemo(() => {
    return searchResults.filter((model) => {
      // Source filter
      if (filterState.source !== 'all' && model.credibility?.source !== filterState.source) {
        return false;
      }

      // Model type filter
      if (filterState.type !== 'all' && getModelType(model) !== filterState.type) {
        return false;
      }

      // Org filter
      if (!matchesOrgFilter(model, filterState.orgs)) {
        return false;
      }

      // Size filter
      if (filterState.size !== 'all') {
        const params = parseParamCount(model);
        if (params !== null) {
          const sizeOpt = SIZE_OPTIONS.find(s => s.key === filterState.size);
          if (sizeOpt && (params < sizeOpt.min || params >= sizeOpt.max)) {
            return false;
          }
        }
      }

      // Compatibility filter — always applied
      if (!hasCompatibleFiles(model)) {
        return false;
      }

      return true;
    }).map(model => {
      // Enrich search results with inferred type & param count for badge rendering
      const type = getModelType(model);
      const params = parseParamCount(model);
      return {
        ...model,
        modelType: type !== 'image-gen' ? type as 'text' | 'vision' | 'code' : undefined,
        paramCount: params ?? undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults, filterState.source, filterState.type, filterState.orgs, filterState.size, matchesOrgFilter, parseParamCount, ramGB]);

  // Recommended models as ModelInfo[], filtered by device RAM + active filters, excluding downloaded
  const recommendedAsModelInfo = useMemo((): ModelInfo[] => {
    return RECOMMENDED_MODELS
      .filter(m => m.params <= deviceRecommendation.maxParameters)
      .filter(m => !downloadedModels.some(d => d.id.startsWith(m.id)))
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
        if (fetched) {
          return {
            ...fetched,
            name: m.name, // Keep our curated display name
            description: m.description, // Keep our curated description
            ...curatedFields,
          };
        }
        return {
          id: m.id,
          name: m.name,
          author: m.id.split('/')[0],
          description: m.description,
          downloads: -1,
          likes: 0,
          tags: [],
          lastModified: '',
          files: [],
          ...curatedFields,
        };
      });
  }, [deviceRecommendation.maxParameters, downloadedModels, filterState.type, filterState.orgs, filterState.size, recommendedModelDetails]);

  // Check if a model matches the recommended variant
  const isRecommendedModel = useCallback((model: HFImageModel): boolean => {
    if (!imageRec) return false;
    // Match backend
    if (model.backend !== imageRec.recommendedBackend && imageRec.recommendedBackend !== 'all') return false;
    // For QNN, match the specific variant
    if (imageRec.qnnVariant && model.variant) {
      return model.variant.includes(imageRec.qnnVariant);
    }
    // Match against recommended model patterns (check repo, id, and name)
    if (imageRec.recommendedModels?.length) {
      const fields = [model.name, model.repo, model.id].map(s => s.toLowerCase());
      return imageRec.recommendedModels.some(p => fields.some(f => f.includes(p)));
    }
    return true;
  }, [imageRec]);

  // Filter HuggingFace image models - must be before any conditional returns
  const filteredHFModels = useMemo(() => {
    const query = imageSearchQuery.toLowerCase().trim();
    const filtered = availableHFModels.filter((m) => {
      if (showRecommendedOnly && imageRec && !isRecommendedModel(m)) return false;
      // Skip backend filter when recommended is active (recommendation already handles backend)
      if (!showRecommendedOnly && backendFilter !== 'all' && m.backend !== backendFilter) return false;
      if (styleFilter !== 'all' && guessStyle(m.name) !== styleFilter) return false;
      // SD version filter (iOS Core ML)
      if (sdVersionFilter !== 'all') {
        const nameLower = m.name.toLowerCase();
        if (sdVersionFilter === 'sdxl' && !nameLower.includes('sdxl') && !nameLower.includes('xl')) return false;
        if (sdVersionFilter === 'sd21' && !nameLower.includes('2.1') && !nameLower.includes('2-1')) return false;
        if (sdVersionFilter === 'sd15' && !nameLower.includes('1.5') && !nameLower.includes('1-5') && !nameLower.includes('v1-5')) return false;
      }
      if (downloadedImageModels.some((d) => d.id === m.id)) return false;
      if (query && !m.displayName.toLowerCase().includes(query) && !m.name.toLowerCase().includes(query)) return false;
      return true;
    });
    // Sort recommended models first when showing all
    if (!showRecommendedOnly && imageRec) {
      filtered.sort((a, b) => {
        const aRec = isRecommendedModel(a) ? 0 : 1;
        const bRec = isRecommendedModel(b) ? 0 : 1;
        return aRec - bRec;
      });
    }
    return filtered;
  }, [availableHFModels, backendFilter, styleFilter, sdVersionFilter, downloadedImageModels, imageSearchQuery, imageRec, isRecommendedModel, showRecommendedOnly]);

  const renderModelItem = ({ item, index }: { item: ModelInfo; index: number }) => {
    // Check if any file from this model is downloaded
    const isAnyFileDownloaded = downloadedModels.some((m) =>
      m.id.startsWith(item.id)
    );

    return (
      <AnimatedEntry index={index} staggerMs={30} trigger={focusTrigger}>
        <ModelCard
          model={item}
          isDownloaded={isAnyFileDownloaded}
          onPress={() => handleSelectModel(item)}
          testID={`model-card-${index}`}
          compact
        />
      </AnimatedEntry>
    );
  };

  // Count of active downloads for badge
  const activeDownloadCount = Object.keys(downloadProgress).length;

  // Total count: downloaded text models + downloaded image models + currently downloading
  const totalModelCount = downloadedModels.length + downloadedImageModels.length + activeDownloadCount;

  const hfModelToDescriptor = (hfModel: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] }): ImageModelDescriptor => ({
    id: hfModel.id,
    name: hfModel.displayName,
    description: hfModel._coreml
      ? `Core ML model from ${hfModel.repo}`
      : `${hfModel.backend === 'qnn' ? 'NPU' : 'CPU'} model from ${hfModel.repo}`,
    downloadUrl: hfModel.downloadUrl,
    size: hfModel.size,
    style: guessStyle(hfModel.name),
    backend: hfModel._coreml ? 'coreml' : hfModel.backend,
    variant: hfModel.variant,
    coremlFiles: hfModel._coremlFiles,
    repo: hfModel.repo,
  });

  // Image model recommendation text from hardware-aware recommendation
  const imageRecommendation = imageRec?.bannerText ?? (
    Platform.OS === 'ios' ? 'Loading recommendation...' : 'Loading recommendation...'
  );

  const renderFileItem = ({ item, index }: { item: ModelFile; index: number }) => {
    if (!selectedModel) return null;

    const downloadKey = `${selectedModel.id}/${item.name}`;
    const progress = downloadProgress[downloadKey];
    const isDownloading = !!progress;
    const isDownloaded = isModelDownloaded(selectedModel.id, item.name);
    const downloadedModel = getDownloadedModel(selectedModel.id, item.name);

    // Estimate if file will fit in memory
    const fileSizeGB = item.size / (1024 * 1024 * 1024);
    const isCompatible = fileSizeGB < ramGB * 0.6;

    return (
      <ModelCard
        model={{
          id: selectedModel.id,
          name: item.name.replace('.gguf', ''),
          author: selectedModel.author,
          credibility: selectedModel.credibility,
        }}
        file={item}
        downloadedModel={downloadedModel}
        isDownloaded={isDownloaded}
        isDownloading={isDownloading}
        downloadProgress={progress?.progress}
        isCompatible={isCompatible}
        testID={`file-card-${index}`}
        onDownload={
          !isDownloaded && !isDownloading
            ? () => handleDownload(selectedModel, item)
            : undefined
        }
      />
    );
  };

  if (selectedModel) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View testID="model-detail-screen" style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => { setSelectedModel(null); setModelFiles([]); }}
              testID="model-detail-back"
              style={{ padding: 4, marginRight: 8 }}
            >
              <Icon name="arrow-left" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
              {selectedModel.name}
            </Text>
          </View>

          <Card style={styles.modelInfoCard}>
            <View style={styles.authorRow}>
              <Text style={styles.modelAuthor}>{selectedModel.author}</Text>
              {selectedModel.credibility && (
                <View style={[
                  styles.credibilityBadge,
                  { backgroundColor: CREDIBILITY_LABELS[selectedModel.credibility.source].color + '25' }
                ]}>
                  {selectedModel.credibility.source === 'lmstudio' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>★</Text>
                  )}
                  {selectedModel.credibility.source === 'official' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>✓</Text>
                  )}
                  {selectedModel.credibility.source === 'verified-quantizer' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>◆</Text>
                  )}
                  <Text style={[styles.credibilityText, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>
                    {CREDIBILITY_LABELS[selectedModel.credibility.source].label}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.modelDescription}>{selectedModel.description}</Text>
            <View style={styles.modelStats}>
              <Text style={styles.statText}>
                {formatNumber(selectedModel.downloads)} downloads
              </Text>
              <Text style={styles.statText}>
                {formatNumber(selectedModel.likes)} likes
              </Text>
            </View>
          </Card>

          <Text style={styles.sectionTitle}>Available Files</Text>
          <Text style={styles.sectionSubtitle}>
            Choose a quantization level. Q4_K_M is recommended for mobile.
            {modelFiles.some(f => f.mmProjFile) && ' Vision files include mmproj.'}
          </Text>

          {isLoadingFiles ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={modelFiles.filter(f => {
                if (f.size <= 0) return false;
                const sizeGB = f.size / (1024 * 1024 * 1024);
                if (sizeGB >= ramGB * 0.6) return false;
                if (filterState.quant !== 'all' && !f.name.includes(filterState.quant)) return false;
                return true;
              })}
              renderItem={renderFileItem}
              keyExtractor={(item) => item.name}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyText}>
                    No compatible files found for this model.
                  </Text>
                </Card>
              }
            />
          )}
        </View>
        <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
      </SafeAreaView>
    );
  }

  // Render image models section
  const renderImageModelsSection = () => (
    <View style={styles.imageModelsSection}>
      {/* Search */}
      <View style={[styles.searchContainer, { paddingHorizontal: 0 }]}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search models..."
          placeholderTextColor={colors.textMuted}
          value={imageSearchQuery}
          onChangeText={setImageSearchQuery}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[styles.recToggle, showRecommendedOnly && styles.recToggleActive]}
          onPress={() => {
            setShowRecommendedOnly(v => {
              // When toggling off recommended, reset backend filter so all models show
              if (v) setBackendFilter('all');
              return !v;
            });
          }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Icon name="star" size={14} color={showRecommendedOnly ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterToggle, (imageFiltersVisible || hasActiveImageFilters) && styles.filterToggleActive]}
          onPress={() => setImageFiltersVisible(v => !v)}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Icon name="sliders" size={14} color={(imageFiltersVisible || hasActiveImageFilters) ? colors.primary : colors.textMuted} />
          {hasActiveImageFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {/* Device recommendation */}
      <View style={styles.deviceBanner}>
        <Text style={styles.deviceBannerText}>
          {Math.round(ramGB)}GB RAM — {imageRecommendation}
        </Text>
        {imageRec?.warning && (
          <Text style={[styles.deviceBannerText, { color: colors.error, marginTop: 2 }]}>
            {imageRec.warning}
          </Text>
        )}
      </View>

      {/* Image filter pill bar — negative margin to cancel parent padding */}
      {imageFiltersVisible && <View style={[styles.filterBar, { marginHorizontal: -SPACING.lg }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPillRow}
          keyboardShouldPersistTaps="handled"
        >
          {/* Backend pill — Android only */}
          {Platform.OS !== 'ios' && (
            <TouchableOpacity
              style={[styles.filterPill, backendFilter !== 'all' && styles.filterPillActive]}
              onPress={() => setImageFilterExpanded(prev => prev === 'backend' ? null : 'backend')}
            >
              <Text style={[styles.filterPillText, backendFilter !== 'all' && styles.filterPillTextActive]}>
                {backendFilter === 'all' ? 'Backend' : backendFilter === 'mnn' ? 'CPU' : backendFilter === 'qnn' ? 'NPU' : 'Core ML'} {imageFilterExpanded === 'backend' ? '\u25B4' : '\u25BE'}
              </Text>
            </TouchableOpacity>
          )}

          {/* SD Version pill — iOS only */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.filterPill, sdVersionFilter !== 'all' && styles.filterPillActive]}
              onPress={() => setImageFilterExpanded(prev => prev === 'sdVersion' ? null : 'sdVersion')}
            >
              <Text style={[styles.filterPillText, sdVersionFilter !== 'all' && styles.filterPillTextActive]}>
                {sdVersionFilter === 'all' ? 'Version' : SD_VERSION_OPTIONS.find(o => o.key === sdVersionFilter)?.label} {imageFilterExpanded === 'sdVersion' ? '\u25B4' : '\u25BE'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Style pill — Android only (Core ML models don't have style variants) */}
          {Platform.OS !== 'ios' && (
            <TouchableOpacity
              style={[styles.filterPill, styleFilter !== 'all' && styles.filterPillActive]}
              onPress={() => setImageFilterExpanded(prev => prev === 'style' ? null : 'style')}
            >
              <Text style={[styles.filterPillText, styleFilter !== 'all' && styles.filterPillTextActive]}>
                {styleFilter === 'all' ? 'Style' : STYLE_OPTIONS.find(o => o.key === styleFilter)?.label} {imageFilterExpanded === 'style' ? '\u25B4' : '\u25BE'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Clear */}
          {hasActiveImageFilters && (
            <TouchableOpacity style={styles.clearFiltersButton} onPress={clearImageFilters}>
              <Text style={styles.clearFiltersText}>Clear</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Expanded: backend */}
        {imageFilterExpanded === 'backend' && Platform.OS !== 'ios' && (
          <View style={styles.filterExpandedContent}>
            <View style={styles.filterChipWrap}>
              {([
                { key: 'all' as BackendFilter, label: 'All' },
                { key: 'mnn' as BackendFilter, label: 'CPU' },
                { key: 'qnn' as BackendFilter, label: 'NPU' },
              ]).map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.filterChip, backendFilter === option.key && styles.filterChipActive]}
                  onPress={() => { setBackendFilter(option.key); setUserChangedBackendFilter(true); setImageFilterExpanded(null); }}
                >
                  <Text style={[styles.filterChipText, backendFilter === option.key && styles.filterChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Expanded: SD version */}
        {imageFilterExpanded === 'sdVersion' && Platform.OS === 'ios' && (
          <View style={styles.filterExpandedContent}>
            <View style={styles.filterChipWrap}>
              {SD_VERSION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.filterChip, sdVersionFilter === option.key && styles.filterChipActive]}
                  onPress={() => { setSdVersionFilter(option.key); setImageFilterExpanded(null); }}
                >
                  <Text style={[styles.filterChipText, sdVersionFilter === option.key && styles.filterChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Expanded: style */}
        {imageFilterExpanded === 'style' && Platform.OS !== 'ios' && (
          <View style={styles.filterExpandedContent}>
            <View style={styles.filterChipWrap}>
              {STYLE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.filterChip, styleFilter === option.key && styles.filterChipActive]}
                  onPress={() => { setStyleFilter(option.key); setImageFilterExpanded(null); }}
                >
                  <Text style={[styles.filterChipText, styleFilter === option.key && styles.filterChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>}

      {/* Loading / Error / List */}
      {hfModelsLoading && (
        <View style={styles.hfLoadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      )}

      {hfModelsError && !hfModelsLoading && (
        <View style={styles.hfErrorContainer}>
          <Text style={styles.hfErrorText}>{hfModelsError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadHFModels(true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!hfModelsLoading && !hfModelsError && filteredHFModels.map((model, index) => {
        const recommended = isRecommendedModel(model);
        const backendCompatible = !imageRec?.compatibleBackends ||
          imageRec.compatibleBackends.includes(model.backend as any);
        // Check variant compatibility: e.g. a 'min' device can't run '8gen2' or '8gen1' models
        const variantCompatible = !model.variant || !imageRec?.qnnVariant ||
          model.variant === imageRec.qnnVariant ||
          // Flagship devices can run all variants
          (imageRec.qnnVariant === '8gen2') ||
          // 8gen1 devices can run 8gen1 and min
          (imageRec.qnnVariant === '8gen1' && model.variant !== '8gen2');
        const isModelCompatible = backendCompatible && variantCompatible;
        const incompatibleReason = !backendCompatible
          ? 'Incompatible'
          : !variantCompatible
          ? 'Wrong chip variant'
          : undefined;
        return (
          <View key={model.id}>
            {recommended && (
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedBadgeText}>RECOMMENDED</Text>
              </View>
            )}
            <ModelCard
              compact
              model={{
                id: model.id,
                name: model.displayName,
                author: (model as any)._coreml ? 'Core ML' : model.backend === 'qnn' ? 'NPU' : 'CPU',
                description: `${formatBytes(model.size)}${model.variant ? ' \u00B7 ' + getVariantLabel(model.variant) : ''}`,
              }}
              isDownloading={imageModelDownloading.includes(model.id)}
              downloadProgress={imageModelProgress[model.id] || 0}
              isCompatible={isModelCompatible}
              incompatibleReason={incompatibleReason}
              testID={`image-model-card-${index}`}
              onDownload={
                !imageModelDownloading.includes(model.id)
                  ? () => handleDownloadImageModel(hfModelToDescriptor(model))
                  : undefined
              }
            />
          </View>
        );
      })}

      {!hfModelsLoading && !hfModelsError && filteredHFModels.length === 0 && availableHFModels.length > 0 && (
        <Text style={styles.allDownloadedText}>
          {imageSearchQuery.trim()
            ? 'No models match your search'
            : hasActiveImageFilters
              ? 'No models match your filters'
              : 'All available models are downloaded'}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="models-screen">
        <View style={styles.header}>
          <Text style={styles.title}>Models</Text>
          <TouchableOpacity
            style={styles.downloadManagerButton}
            onPress={() => navigation.navigate('DownloadManager')}
            testID="downloads-icon"
          >
            <Icon name="download" size={20} color={colors.text} />
            {totalModelCount > 0 && (
              <View style={styles.downloadBadge}>
                <Text style={styles.downloadBadgeText}>
                  {totalModelCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Import Local File — above tabs, always visible */}
        {isImporting && importProgress ? (
          <View style={styles.importProgressCard}>
            <View style={styles.importProgressHeader}>
              <Icon name="file" size={18} color={colors.primary} />
              <Text style={styles.importProgressText} numberOfLines={1}>
                Importing {importProgress.fileName}
              </Text>
            </View>
            <View style={styles.imageProgressBar}>
              <View
                style={[
                  styles.imageProgressFill,
                  { width: `${Math.round(importProgress.fraction * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.importProgressPercent}>
              {Math.round(importProgress.fraction * 100)}%
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.importButton}
            onPress={handleImportLocalModel}
            testID="import-local-model"
          >
            <Icon name="folder-plus" size={20} color={colors.primary} />
            <Text style={styles.importButtonText}>Import Local File</Text>
          </TouchableOpacity>
        )}

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => { setActiveTab('text'); setFilterState(initialFilterState); setTextFiltersVisible(false); setImageFiltersVisible(false); }}
          >
            <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>
              Text Models
            </Text>
            {activeTab === 'text' && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => { setActiveTab('image'); setFilterState(initialFilterState); setTextFiltersVisible(false); setImageFiltersVisible(false); }}
          >
            <Text style={[styles.tabText, activeTab === 'image' && styles.tabTextActive]}>
              Image Models
            </Text>
            {activeTab === 'image' && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        </View>

        {/* Text Models Tab */}
        {activeTab === 'text' && (
          <>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search models..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                testID="search-input"
              />
              <TouchableOpacity
                style={[styles.filterToggle, (textFiltersVisible || hasActiveFilters) && styles.filterToggleActive]}
                onPress={() => setTextFiltersVisible(v => !v)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                testID="text-filter-toggle"
              >
                <Icon name="sliders" size={14} color={(textFiltersVisible || hasActiveFilters) ? colors.primary : colors.textMuted} />
                {hasActiveFilters && <View style={styles.filterDot} />}
              </TouchableOpacity>
              <Button title="Search" size="small" onPress={handleSearch} testID="search-button" />
            </View>

            {/* Unified Filter Bar */}
            {textFiltersVisible && <View style={styles.filterBar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterPillRow}
                keyboardShouldPersistTaps="handled"
              >
                {/* Org pill */}
                <TouchableOpacity
                  style={[styles.filterPill, filterState.orgs.length > 0 && styles.filterPillActive]}
                  onPress={() => toggleFilterDimension('org')}
                >
                  <Text style={[styles.filterPillText, filterState.orgs.length > 0 && styles.filterPillTextActive]}>
                    Org {filterState.expandedDimension === 'org' ? '\u25B4' : '\u25BE'}
                  </Text>
                  {filterState.orgs.length > 0 && (
                    <View style={styles.filterCountBadge}>
                      <Text style={styles.filterCountText}>{filterState.orgs.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Type pill */}
                <TouchableOpacity
                  style={[styles.filterPill, filterState.type !== 'all' && styles.filterPillActive]}
                  onPress={() => toggleFilterDimension('type')}
                >
                  <Text style={[styles.filterPillText, filterState.type !== 'all' && styles.filterPillTextActive]}>
                    {filterState.type === 'all' ? 'Type' : MODEL_TYPE_OPTIONS.find(o => o.key === filterState.type)?.label} {filterState.expandedDimension === 'type' ? '\u25B4' : '\u25BE'}
                  </Text>
                </TouchableOpacity>

                {/* Source pill */}
                <TouchableOpacity
                  style={[styles.filterPill, filterState.source !== 'all' && styles.filterPillActive]}
                  onPress={() => toggleFilterDimension('source')}
                >
                  <Text style={[styles.filterPillText, filterState.source !== 'all' && styles.filterPillTextActive]}>
                    {filterState.source === 'all' ? 'Source' : CREDIBILITY_OPTIONS.find(o => o.key === filterState.source)?.label} {filterState.expandedDimension === 'source' ? '\u25B4' : '\u25BE'}
                  </Text>
                </TouchableOpacity>

                {/* Size pill */}
                <TouchableOpacity
                  style={[styles.filterPill, filterState.size !== 'all' && styles.filterPillActive]}
                  onPress={() => toggleFilterDimension('size')}
                >
                  <Text style={[styles.filterPillText, filterState.size !== 'all' && styles.filterPillTextActive]}>
                    {filterState.size === 'all' ? 'Size' : SIZE_OPTIONS.find(o => o.key === filterState.size)?.label} {filterState.expandedDimension === 'size' ? '\u25B4' : '\u25BE'}
                  </Text>
                </TouchableOpacity>

                {/* Quant pill */}
                <TouchableOpacity
                  style={[styles.filterPill, filterState.quant !== 'all' && styles.filterPillActive]}
                  onPress={() => toggleFilterDimension('quant')}
                >
                  <Text style={[styles.filterPillText, filterState.quant !== 'all' && styles.filterPillTextActive]}>
                    {filterState.quant === 'all' ? 'Quant' : filterState.quant} {filterState.expandedDimension === 'quant' ? '\u25B4' : '\u25BE'}
                  </Text>
                </TouchableOpacity>

                {/* Clear button */}
                {hasActiveFilters && (
                  <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                    <Text style={styles.clearFiltersText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>

              {/* Expanded filter content */}
              {filterState.expandedDimension === 'org' && (
                <View style={styles.filterExpandedContent}>
                  <View style={styles.filterChipWrap}>
                    {MODEL_ORGS.map((org) => (
                      <TouchableOpacity
                        key={org.key}
                        style={[styles.filterChip, filterState.orgs.includes(org.key) && styles.filterChipActive]}
                        onPress={() => toggleOrg(org.key)}
                      >
                        <Text style={[styles.filterChipText, filterState.orgs.includes(org.key) && styles.filterChipTextActive]}>
                          {org.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {filterState.expandedDimension === 'type' && (
                <View style={styles.filterExpandedContent}>
                  <View style={styles.filterChipWrap}>
                    {MODEL_TYPE_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.filterChip, filterState.type === option.key && styles.filterChipActive]}
                        onPress={() => setTypeFilter(option.key)}
                      >
                        <Text style={[styles.filterChipText, filterState.type === option.key && styles.filterChipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {filterState.expandedDimension === 'source' && (
                <View style={styles.filterExpandedContent}>
                  <View style={styles.filterChipWrap}>
                    {CREDIBILITY_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.filterChip,
                          filterState.source === option.key && styles.filterChipActive,
                          filterState.source === option.key && option.color && {
                            backgroundColor: option.color + '25',
                            borderColor: option.color,
                          },
                        ]}
                        onPress={() => setSourceFilter(option.key)}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            filterState.source === option.key && styles.filterChipTextActive,
                            filterState.source === option.key && option.color && { color: option.color },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {filterState.expandedDimension === 'size' && (
                <View style={styles.filterExpandedContent}>
                  <View style={styles.filterChipWrap}>
                    {SIZE_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.filterChip, filterState.size === option.key && styles.filterChipActive]}
                        onPress={() => setSizeFilter(option.key)}
                      >
                        <Text style={[styles.filterChipText, filterState.size === option.key && styles.filterChipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {filterState.expandedDimension === 'quant' && (
                <View style={styles.filterExpandedContent}>
                  <View style={styles.filterChipWrap}>
                    {QUANT_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.filterChip, filterState.quant === option.key && styles.filterChipActive]}
                        onPress={() => setQuantFilter(option.key)}
                      >
                        <Text style={[styles.filterChipText, filterState.quant === option.key && styles.filterChipTextActive]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>}

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading models...</Text>
              </View>
            ) : (
              <FlatList
                data={hasSearched ? filteredResults : recommendedAsModelInfo}
                renderItem={renderModelItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                testID="models-list"
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    tintColor={colors.primary}
                  />
                }
                ListHeaderComponent={
                  !hasSearched ? (
                    <View>
                      <View style={styles.deviceBanner}>
                        <Text style={styles.deviceBannerText}>
                          {Math.round(ramGB)}GB RAM — models up to {deviceRecommendation.maxParameters}B recommended ({deviceRecommendation.recommendedQuantization})
                        </Text>
                      </View>
                      {recommendedAsModelInfo.length > 0 && (
                        <Text style={styles.recommendedTitle}>Recommended for your device</Text>
                      )}
                    </View>
                  ) : null
                }
                ListEmptyComponent={
                  <Card style={styles.emptyCard}>
                    <Text style={styles.emptyText}>
                      {hasSearched
                        ? hasActiveFilters
                          ? 'No models match your filters. Try adjusting or clearing them.'
                          : 'No models found. Try a different search term.'
                        : 'No recommended models available.'}
                    </Text>
                  </Card>
                }
              />
            )}
          </>
        )}

        {/* Image Models Tab */}
        {
          activeTab === 'image' && (
            <ScrollView style={styles.imageTabContent}>
              {renderImageModelsSection()}
            </ScrollView>
          )
        }
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let total = 0;
  const items = await RNFS.readDir(dirPath);
  for (const item of items) {
    if (item.isDirectory()) {
      total += await getDirectorySize(item.path);
    } else {
      const s = typeof item.size === 'string' ? parseInt(item.size, 10) : (item.size || 0);
      total += s;
    }
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadows.small,
    zIndex: 1,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    flex: 1,
  },
  downloadManagerButton: {
    padding: 8,
    position: 'relative' as const,
  },
  downloadBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
  },
  downloadBadgeText: {
    ...TYPOGRAPHY.label,
    color: colors.text,
  },
  tabBar: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
  },
  tabItem: {
    paddingVertical: 10,
    alignItems: 'center' as const,
  },
  tabText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: '700' as const,
  },
  tabIndicator: {
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
    marginTop: 4,
    alignSelf: 'stretch' as const,
  },
  imageTabContent: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  recToggle: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  recToggleActive: {
    backgroundColor: colors.primary + '15',
  },
  filterToggle: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  filterToggleActive: {
    backgroundColor: colors.primary + '15',
  },
  filterDot: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  searchInput: {
    ...TYPOGRAPHY.body,
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
  },
  importButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 12,
    borderWidth: 2,
    borderStyle: 'dashed' as const,
    borderColor: colors.primary + '60',
    borderRadius: 12,
    backgroundColor: colors.primary + '08',
  },
  importButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  importProgressCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  importProgressHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  importProgressText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    flex: 1,
  },
  importProgressPercent: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  filterBar: {
    marginBottom: 4,
    paddingBottom: 4,
  },
  filterPillRow: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center' as const,
  },
  filterPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  filterPillActive: {
    backgroundColor: colors.primary + '25',
    borderColor: colors.primary,
  },
  filterPillText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.primary,
  },
  filterCountBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
  },
  filterCountText: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.background,
    fontWeight: '700' as const,
  },
  clearFiltersButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  clearFiltersText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
  },
  filterExpandedContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  filterChipWrap: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary + '25',
    borderColor: colors.primary,
  },
  filterChipText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  deviceBanner: {
    backgroundColor: colors.primary + '12',
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  deviceBannerText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  recommendedBadge: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginLeft: 12,
    marginBottom: -1,
  },
  recommendedBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.background,
    fontWeight: '700' as const,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  recommendedTitle: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: SPACING.md,
  },
  modelInfoCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  authorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
    gap: 8,
  },
  modelAuthor: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  credibilityBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  credibilityIcon: {
    ...TYPOGRAPHY.label,
  },
  credibilityText: {
    ...TYPOGRAPHY.meta,
  },
  modelDescription: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: 12,
  },
  modelStats: {
    flexDirection: 'row' as const,
    gap: 16,
  },
  statText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionSubtitle: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  emptyCard: {
    alignItems: 'center' as const,
    padding: 32,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  // Image models section styles
  imageModelsSection: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  imageSectionTitle: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    marginBottom: 4,
  },
  imageSectionSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  downloadedImageModels: {
    marginBottom: 16,
  },
  imageModelCard: {
    marginBottom: 12,
  },
  imageModelHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 12,
  },
  imageModelInfo: {
    flex: 1,
  },
  imageModelName: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: 4,
  },
  imageModelDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  imageModelSize: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  activeBadge: {
    backgroundColor: colors.info + '25',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  activeBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.info,
  },
  imageModelActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  setActiveButton: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  setActiveButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
  },
  deleteImageButton: {
    padding: 8,
  },
  // Compact downloaded image model rows
  imageModelCompactRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: 6,
    gap: 8,
  },
  imageModelCompactInfo: {
    flex: 1,
    gap: 2,
  },
  imageModelCompactName: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    fontWeight: '600' as const,
  },
  imageModelCompactMeta: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
  },
  activeBadgeCompact: {
    backgroundColor: colors.info + '25',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  activeBadgeCompactText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.info,
    fontWeight: '600' as const,
  },
  setActiveButtonCompact: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  setActiveButtonCompactText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  deleteImageButtonCompact: {
    padding: 4,
  },
  availableTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginBottom: 8,
  },
  downloadImageButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'transparent' as const,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  downloadImageButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  imageDownloadProgress: {
    alignItems: 'center' as const,
    gap: 8,
  },
  imageDownloadText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  imageProgressBar: {
    width: '100%' as const,
    height: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden' as const,
  },
  imageProgressFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  allDownloadedText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    paddingVertical: 16,
  },
  textModelsSectionTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: 12,
    marginTop: 8,
  },
  imageSearchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 12,
  },
  imageSearchInput: {
    ...TYPOGRAPHY.body,
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backendFilterRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
  },
  modelNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 4,
  },
  backendBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cpuBadge: {
    backgroundColor: colors.primary + '25',
  },
  npuBadge: {
    backgroundColor: '#FF990025',
  },
  backendBadgeText: {
    ...TYPOGRAPHY.label,
    color: colors.text,
  },
  variantBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  variantBadgeText: {
    ...TYPOGRAPHY.label,
    color: colors.textSecondary,
  },
  variantHint: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    marginBottom: 2,
  },
  hfLoadingContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 24,
  },
  hfErrorContainer: {
    alignItems: 'center' as const,
    paddingVertical: 20,
    gap: 12,
  },
  hfErrorText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
    textAlign: 'center' as const,
  },
  retryButton: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
  },
});
