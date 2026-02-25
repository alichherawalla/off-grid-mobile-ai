import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DownloadedModel, ModelFile, ModelCredibility, ONNXImageModel } from '../../types';
import { LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../../constants';

export const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';
export const IMAGE_MODELS_STORAGE_KEY = '@local_llm/downloaded_image_models';

export function determineCredibility(author: string): ModelCredibility {
  if (LMSTUDIO_AUTHORS.includes(author)) {
    return {
      source: 'lmstudio',
      isOfficial: false,
      isVerifiedQuantizer: true,
      verifiedBy: 'LM Studio',
    };
  }

  if (OFFICIAL_MODEL_AUTHORS[author]) {
    return {
      source: 'official',
      isOfficial: true,
      isVerifiedQuantizer: false,
      verifiedBy: OFFICIAL_MODEL_AUTHORS[author],
    };
  }

  if (VERIFIED_QUANTIZERS[author]) {
    return {
      source: 'verified-quantizer',
      isOfficial: false,
      isVerifiedQuantizer: true,
      verifiedBy: VERIFIED_QUANTIZERS[author],
    };
  }

  return {
    source: 'community',
    isOfficial: false,
    isVerifiedQuantizer: false,
  };
}

export function resolveStoredPath(storedPath: string, currentBaseDir: string): string | null {
  const baseDirName = currentBaseDir.substring(currentBaseDir.lastIndexOf('/') + 1);
  const marker = `/${baseDirName}/`;
  const markerIndex = storedPath.indexOf(marker);

  if (markerIndex === -1) return null;

  const relativePart = storedPath.substring(markerIndex + marker.length);
  if (!relativePart) return null;

  return `${currentBaseDir}/${relativePart}`;
}

export async function saveModelsList(models: DownloadedModel[]): Promise<void> {
  await AsyncStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
}

export async function saveImageModelsList(models: ONNXImageModel[]): Promise<void> {
  await AsyncStorage.setItem(IMAGE_MODELS_STORAGE_KEY, JSON.stringify(models));
}

async function tryResolveTextModelPath(
  model: DownloadedModel,
  modelsDir: string,
): Promise<{ exists: boolean; updated: boolean }> {
  const resolved = resolveStoredPath(model.filePath, modelsDir);
  if (!resolved || resolved === model.filePath) return { exists: false, updated: false };
  const exists = await RNFS.exists(resolved);
  if (exists) {
    model.filePath = resolved;
    return { exists: true, updated: true };
  }
  return { exists: false, updated: false };
}

async function tryResolveMmProjPath(
  model: DownloadedModel,
  modelsDir: string,
): Promise<boolean> {
  if (!model.mmProjPath) return false;
  const mmExists = await RNFS.exists(model.mmProjPath);
  if (mmExists) return false;
  const resolvedMm = resolveStoredPath(model.mmProjPath, modelsDir);
  if (!resolvedMm || resolvedMm === model.mmProjPath) return false;
  const mmResolvedExists = await RNFS.exists(resolvedMm);
  if (mmResolvedExists) {
    model.mmProjPath = resolvedMm;
    return true;
  }
  return false;
}

export async function loadDownloadedModels(modelsDir: string): Promise<DownloadedModel[]> {
  const stored = await AsyncStorage.getItem(MODELS_STORAGE_KEY);
  if (!stored) return [];

  const models: DownloadedModel[] = JSON.parse(stored);
  const validModels: DownloadedModel[] = [];
  let pathsUpdated = false;

  for (const model of models) {
    let exists = await RNFS.exists(model.filePath);
    if (!exists) {
      const result = await tryResolveTextModelPath(model, modelsDir);
      exists = result.exists;
      if (result.updated) pathsUpdated = true;
    }
    if (exists) {
      const mmUpdated = await tryResolveMmProjPath(model, modelsDir);
      if (mmUpdated) pathsUpdated = true;
      validModels.push(model);
    }
  }

  if (validModels.length !== models.length || pathsUpdated) {
    await saveModelsList(validModels);
  }

  return validModels;
}

async function tryResolveImageModelPath(
  model: ONNXImageModel,
  imageModelsDir: string,
): Promise<{ exists: boolean; updated: boolean }> {
  const resolved = resolveStoredPath(model.modelPath, imageModelsDir);
  if (!resolved || resolved === model.modelPath) return { exists: false, updated: false };
  const exists = await RNFS.exists(resolved);
  if (exists) {
    model.modelPath = resolved;
    return { exists: true, updated: true };
  }
  return { exists: false, updated: false };
}

export async function loadDownloadedImageModels(imageModelsDir: string): Promise<ONNXImageModel[]> {
  const stored = await AsyncStorage.getItem(IMAGE_MODELS_STORAGE_KEY);
  if (!stored) return [];

  const models: ONNXImageModel[] = JSON.parse(stored);
  const validModels: ONNXImageModel[] = [];
  let pathsUpdated = false;

  for (const model of models) {
    let exists = await RNFS.exists(model.modelPath);
    if (!exists) {
      const result = await tryResolveImageModelPath(model, imageModelsDir);
      exists = result.exists;
      if (result.updated) pathsUpdated = true;
    }
    if (exists) {
      validModels.push(model);
    }
  }

  if (validModels.length !== models.length || pathsUpdated) {
    await saveImageModelsList(validModels);
  }

  return validModels;
}

export interface BuildModelOpts {
  modelId: string;
  file: ModelFile;
  resolvedLocalPath: string;
  mmProjPath?: string;
}

export async function buildDownloadedModel(opts: BuildModelOpts): Promise<DownloadedModel> {
  const { modelId, file, resolvedLocalPath, mmProjPath } = opts;
  const stat = await RNFS.stat(resolvedLocalPath);
  const author = modelId.split('/')[0] || 'Unknown';
  const mmProjFile = file.mmProjFile;
  let mmProjFileSize = mmProjPath ? mmProjFile?.size : undefined;
  if (mmProjPath) {
    try {
      const mmStat = await RNFS.stat(mmProjPath);
      mmProjFileSize = typeof mmStat.size === 'string' ? parseInt(mmStat.size, 10) : mmStat.size;
    } catch {
      // Keep fallback size from metadata.
    }
  }

  return {
    id: `${modelId}/${file.name}`,
    name: modelId.split('/').pop() || modelId,
    author,
    filePath: resolvedLocalPath,
    fileName: file.name,
    fileSize: typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size,
    quantization: file.quantization,
    downloadedAt: new Date().toISOString(),
    credibility: determineCredibility(author),
    isVisionModel: !!mmProjPath,
    mmProjPath,
    mmProjFileName: mmProjPath ? mmProjFile?.name : undefined,
    mmProjFileSize,
  };
}

export async function persistDownloadedModel(
  model: DownloadedModel,
  modelsDir: string,
): Promise<void> {
  const models = await loadDownloadedModels(modelsDir);
  const existingIndex = models.findIndex(m => m.id === model.id);
  if (existingIndex >= 0) {
    models[existingIndex] = model;
  } else {
    models.push(model);
  }
  await saveModelsList(models);
}
