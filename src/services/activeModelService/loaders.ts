/**
 * Low-level load/unload helpers for ActiveModelService.
 * Extracted to keep index.ts under the max-lines limit.
 */

import { useAppStore } from '../../stores';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { llmService } from '../llm';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { modelManager } from '../modelManager';
import RNFS from 'react-native-fs';

// ---------------------------------------------------------------------------
// mmproj path resolver
// ---------------------------------------------------------------------------

function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gguf')) return false;
  return (
    lower.includes('mmproj') ||
    lower.includes('projector') ||
    // LLaVA/InternVL-style CLIP vision encoder projectors, e.g.
    // "mmproj-model-f16-clip-vit-large-patch14-336.gguf"
    (lower.includes('clip') && lower.includes('vit'))
  );
}

async function scanDirForMmProj(modelFilePath: string): Promise<RNFS.ReadDirItem | undefined> {
  const modelDir = modelFilePath.substring(0, modelFilePath.lastIndexOf('/'));
  const files = await RNFS.readDir(modelDir);
  return files.find((f: { name: string; isFile: () => boolean }) =>
    f.isFile() && isMMProjFile(f.name),
  );
}

export async function resolveMmProjPath(
  model: DownloadedModel,
  modelId: string,
): Promise<string | undefined> {
  // Fast path: persisted mmProjPath still exists on disk
  if (model.mmProjPath) {
    if (await RNFS.exists(model.mmProjPath)) {
      return model.mmProjPath;
    }
    // Path is stale — fall through to directory scan
  }

  // Scan the model directory for any mmproj file regardless of model name.
  // Previous code only scanned for models whose name contained "vl"/"vision"/
  // "smolvlm", which silently broke vision for models like llava, pixtral,
  // moondream, internvl, minicpm, etc.
  try {
    const mmProjFile = await scanDirForMmProj(model.filePath);
    if (!mmProjFile) {
      return undefined;
    }

    const { downloadedModels, setDownloadedModels } = useAppStore.getState();
    const updatedModels = downloadedModels.map(m => {
      if (m.id !== modelId) {
        return m;
      }
      return {
        ...m,
        mmProjPath: mmProjFile.path,
        mmProjFileName: mmProjFile.name,
        mmProjFileSize:
          typeof mmProjFile.size === 'string'
            ? Number.parseInt(mmProjFile.size, 10)
            : mmProjFile.size,
        isVisionModel: true,
      };
    });
    setDownloadedModels(updatedModels);
    await modelManager.saveModelWithMmproj(modelId, mmProjFile.path);
    return mmProjFile.path;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Text model loader
// ---------------------------------------------------------------------------

export interface TextLoadContext {
  model: DownloadedModel;
  modelId: string;
  store: ReturnType<typeof useAppStore.getState>;
  timeoutMs: number;
  loadedTextModelId: string | null;
  onLoaded: (modelId: string) => void;
  onError: () => void;
  onFinally: () => void;
}

export async function doLoadTextModel(ctx: TextLoadContext): Promise<void> {
  try {
    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      try {
        await llmService.unloadModel();
      } catch (unloadErr) {
        // Log but continue — loadModel will also attempt to release the old context
        console.warn('[ActiveModel] Error unloading previous model, continuing:', unloadErr);
      }
      ctx.onError(); // resets loadedTextModelId to null before reassignment
    }

    const mmProjPath = await resolveMmProjPath(ctx.model, ctx.modelId);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `Text model loading timed out after ${ctx.timeoutMs / 1000}s. ` +
                'Try a smaller model or reduce context length in settings.',
            ),
          ),
        ctx.timeoutMs,
      );
    });

    try {
      await Promise.race([
        llmService.loadModel(ctx.model.filePath, mmProjPath),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    // Capture settings that require model reload
    const { settings } = ctx.store;
    const reloadSettings = {
      enableGpu: settings.enableGpu,
      gpuLayers: settings.gpuLayers,
      nThreads: settings.nThreads,
      nBatch: settings.nBatch,
      contextLength: settings.contextLength,
      flashAttn: settings.flashAttn,
      cacheType: settings.cacheType,
    };
    ctx.store.setLoadedSettings(reloadSettings);

    ctx.onLoaded(ctx.modelId);
    ctx.store.setActiveModelId(ctx.modelId);
  } catch (error) {
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}

// ---------------------------------------------------------------------------
// Image model loader
// ---------------------------------------------------------------------------

export interface ImageLoadContext {
  model: ONNXImageModel;
  modelId: string;
  imageThreads: number;
  needsThreadReload: boolean;
  cpuOnly: boolean;
  store: ReturnType<typeof useAppStore.getState>;
  timeoutMs: number;
  loadedImageModelId: string | null;
  onLoaded: (modelId: string, threads: number) => void;
  onError: () => void;
  onFinally: () => void;
}

export async function doLoadImageModel(ctx: ImageLoadContext): Promise<void> {
  try {
    if (
      ctx.loadedImageModelId &&
      (ctx.loadedImageModelId !== ctx.modelId || ctx.needsThreadReload)
    ) {
      await onnxImageGeneratorService.unloadModel();
      ctx.onError(); // resets loadedImageModelId/threads to null
    }

    let imgTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      imgTimeoutId = setTimeout(
        () => reject(new Error('Image model loading timed out')),
        ctx.timeoutMs,
      );
    });

    try {
      await Promise.race([
        onnxImageGeneratorService.loadModel(
          ctx.model.modelPath,
          ctx.imageThreads,
          {
            backend: ctx.model.backend === 'coreml' ? 'auto' : (ctx.model.backend ?? 'auto'),
            cpuOnly: ctx.cpuOnly,
            attentionVariant: ctx.model.attentionVariant,
          },
        ),
        timeoutPromise,
      ]);
    } finally {
      if (imgTimeoutId !== null) clearTimeout(imgTimeoutId);
    }

    ctx.onLoaded(ctx.modelId, ctx.imageThreads);
    ctx.store.setActiveImageModelId(ctx.modelId);
  } catch (error) {
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}
