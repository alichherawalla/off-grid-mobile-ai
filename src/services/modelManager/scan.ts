import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { DownloadedModel, ModelFile, ONNXImageModel } from '../../types';
import { buildDownloadedModel, persistDownloadedModel, loadDownloadedModels, saveModelsList } from './storage';

export function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.includes('mmproj') ||
    lower.includes('projector') ||
    (lower.includes('clip') && lower.endsWith('.gguf'));
}

function parseSizeInt(size: string | number): number {
  return typeof size === 'string' ? parseInt(size, 10) : size;
}

async function getDirSize(dirPath: string): Promise<number> {
  try {
    const dirFiles = await RNFS.readDir(dirPath);
    return dirFiles.reduce((total, f) => total + (f.isFile() ? parseSizeInt(f.size) : 0), 0);
  } catch {
    return 0;
  }
}

export async function deleteOrphanedFile(filePath: string): Promise<void> {
  const exists = await RNFS.exists(filePath);
  if (exists) {
    await RNFS.unlink(filePath);
  }
}

function looksLikeVisionModel(model: DownloadedModel): boolean {
  const nameLower = model.name.toLowerCase();
  const fileLower = model.fileName.toLowerCase();
  return nameLower.includes('vl') || nameLower.includes('vision') || nameLower.includes('smolvlm') ||
    fileLower.includes('vl') || fileLower.includes('vision');
}

function extractBaseName(fileName: string): string {
  const match = fileName.match(/^(.+?)[-_](?:Q\d|q\d|F\d|f\d)/i);
  return match ? match[1].toLowerCase() : fileName.toLowerCase().replace('.gguf', '');
}

function findMatchingMmProj(
  baseName: string,
  mmProjFiles: RNFS.ReadDirItem[],
): RNFS.ReadDirItem | undefined {
  const noSeparators = baseName.replace(/-/g, '').replace(/_/g, '');
  return mmProjFiles.find(mf => {
    const lower = mf.name.toLowerCase();
    return lower.includes(noSeparators) || lower.includes(baseName);
  });
}

export async function cleanupMMProjEntries(modelsDir: string): Promise<number> {
  const models = await loadDownloadedModels(modelsDir);
  const cleanedModels = models.filter(m => !isMMProjFile(m.fileName));
  const removedCount = models.length - cleanedModels.length;

  try {
    const dirExists = await RNFS.exists(modelsDir);
    if (dirExists) {
      const files = await RNFS.readDir(modelsDir);
      const mmProjFiles = files.filter(f => f.isFile() && isMMProjFile(f.name));

      for (const model of cleanedModels) {
        if (model.mmProjPath) continue;
        if (!looksLikeVisionModel(model)) continue;

        const baseName = extractBaseName(model.fileName);
        const match = findMatchingMmProj(baseName, mmProjFiles);
        if (match) {
          model.mmProjPath = match.path;
          model.mmProjFileName = match.name;
          model.mmProjFileSize = parseSizeInt(match.size);
          model.isVisionModel = true;
        }
      }
    }
  } catch {
    // Scan errors are non-fatal
  }

  await saveModelsList(cleanedModels);
  return removedCount;
}

function detectBackend(dirName: string): 'mnn' | 'qnn' | 'coreml' {
  if (dirName.includes('qnn') || dirName.includes('8gen')) return 'qnn';
  if (dirName.includes('coreml')) return 'coreml';
  return 'mnn';
}

export interface ScanImageModelsOpts {
  imageModelsDir: string;
  getImageModels: () => Promise<ONNXImageModel[]>;
  addImageModel: (model: ONNXImageModel) => Promise<void>;
}

export async function scanForUntrackedImageModels(opts: ScanImageModelsOpts): Promise<ONNXImageModel[]> {
  const { imageModelsDir, getImageModels, addImageModel } = opts;
  const discoveredModels: ONNXImageModel[] = [];
  const registeredModels = await getImageModels();
  const registeredPaths = new Set(registeredModels.map(m => m.modelPath));

  const dirExists = await RNFS.exists(imageModelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(imageModelsDir);

  for (const item of items) {
    if (!item.isDirectory() || registeredPaths.has(item.path)) continue;

    const totalSize = await getDirSize(item.path);
    if (totalSize === 0) continue;

    const newModel: ONNXImageModel = {
      id: `recovered_${item.name}_${Date.now()}`,
      name: item.name.replace(/_/g, ' ').replace(/\.(zip|tar|gz)$/i, ''),
      description: `Recovered ${item.name} model`,
      modelPath: item.path,
      size: totalSize,
      downloadedAt: new Date().toISOString(),
      backend: detectBackend(item.name),
    };

    await addImageModel(newModel);
    discoveredModels.push(newModel);
  }

  return discoveredModels;
}

export async function scanForUntrackedTextModels(
  modelsDir: string,
  getModels: () => Promise<DownloadedModel[]>,
): Promise<DownloadedModel[]> {
  const discoveredModels: DownloadedModel[] = [];

  try {
    return await doScanForUntrackedTextModels(modelsDir, getModels);
  } catch {
    return discoveredModels;
  }
}

async function doScanForUntrackedTextModels(
  modelsDir: string,
  getModels: () => Promise<DownloadedModel[]>,
): Promise<DownloadedModel[]> {
  const discoveredModels: DownloadedModel[] = [];
  const registeredModels = await getModels();
  const registeredPaths = new Set(registeredModels.map(m => m.filePath));

  const dirExists = await RNFS.exists(modelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(modelsDir);

  for (const item of items) {
    const lowerName = item.name.toLowerCase();
    const isMmProj = isMMProjFile(lowerName);
    if (!item.isFile() || !item.name.endsWith('.gguf') || registeredPaths.has(item.path) || isMmProj) {
      continue;
    }

    const fileSize = parseSizeInt(item.size);
    if (fileSize < 1_000_000) continue;

    const quantMatch = item.name.match(/[_-](Q\d+[_\w]*|f16|f32)/i);
    const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';

    const newModel: DownloadedModel = {
      id: `recovered_${item.name}_${Date.now()}`,
      name: item.name.replace(/\.gguf$/i, '').replace(/[_-]Q\d+.*/i, ''),
      author: 'Unknown',
      filePath: item.path,
      fileName: item.name,
      fileSize,
      quantization,
      downloadedAt: new Date().toISOString(),
      credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
    };

    const models = await getModels();
    models.push(newModel);
    await saveModelsList(models);
    discoveredModels.push(newModel);
  }

  return discoveredModels;
}

export interface ImportLocalModelOpts {
  sourceUri: string;
  fileName: string;
  modelsDir: string;
  onProgress?: (progress: { fraction: number; fileName: string }) => void;
}

export async function importLocalModel(opts: ImportLocalModelOpts): Promise<DownloadedModel> {
  const { sourceUri, fileName, modelsDir, onProgress } = opts;

  if (!fileName.toLowerCase().endsWith('.gguf')) {
    throw new Error('Only .gguf files can be imported');
  }

  let resolvedSource = sourceUri;
  let tempCachePath: string | null = null;

  if (Platform.OS === 'android' && sourceUri.startsWith('content://')) {
    tempCachePath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
    await RNFS.copyFile(sourceUri, tempCachePath);
    resolvedSource = tempCachePath;
  }

  try {
    const destPath = `${modelsDir}/${fileName}`;
    const destExists = await RNFS.exists(destPath);
    if (destExists) throw new Error(`A model file named "${fileName}" already exists`);

    await copyFileWithProgress(
      resolvedSource,
      destPath,
      onProgress ? (fraction) => onProgress({ fraction, fileName }) : undefined,
    );

    const quantMatch = fileName.match(/[_-](Q\d+[_\w]*|f16|f32)/i);
    const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';
    const modelName = fileName.replace(/\.gguf$/i, '').replace(/[_-]Q\d+.*/i, '');
    const destStat = await RNFS.stat(destPath);
    const fileSize = parseSizeInt(destStat.size);

    const pseudoFile: ModelFile = { name: fileName, size: fileSize, quantization, downloadUrl: '' };
    const model = await buildDownloadedModel({ modelId: 'local_import', file: pseudoFile, resolvedLocalPath: destPath });
    const builtModel: DownloadedModel = {
      ...model,
      id: `local_import/${fileName}`,
      name: modelName,
      author: 'Local Import',
      credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
    };

    await persistDownloadedModel(builtModel, modelsDir);
    return builtModel;
  } finally {
    if (tempCachePath) {
      await RNFS.unlink(tempCachePath).catch(() => {});
    }
  }
}

async function copyFileWithProgress(
  source: string,
  dest: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const sourceStat = await RNFS.stat(source);
  const totalBytes = parseSizeInt(sourceStat.size);
  let polling = true;

  const pollInterval = setInterval(async () => {
    if (!polling) return;
    try {
      const exists = await RNFS.exists(dest);
      if (exists) {
        const stat = await RNFS.stat(dest);
        const written = parseSizeInt(stat.size);
        onProgress?.(totalBytes > 0 ? Math.min(written / totalBytes, 0.99) : 0);
      }
    } catch {
      // File may not exist yet, ignore
    }
  }, 500);

  try {
    await RNFS.copyFile(source, dest);
    polling = false;
    clearInterval(pollInterval);
    onProgress?.(1);
  } catch (error) {
    polling = false;
    clearInterval(pollInterval);
    await RNFS.unlink(dest).catch(() => {});
    throw error;
  }
}
