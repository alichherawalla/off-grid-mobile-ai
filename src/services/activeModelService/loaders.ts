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

export async function resolveMmProjPath(
  model: DownloadedModel,
  modelId: string,
): Promise<string | undefined> {
  if (model.mmProjPath) {
    return model.mmProjPath;
  }

  const modelNameLower = model.name.toLowerCase();
  const looksLikeVisionModel =
    modelNameLower.includes('vl') ||
    modelNameLower.includes('vision') ||
    modelNameLower.includes('smolvlm');

  if (!looksLikeVisionModel) {
    return undefined;
  }

  const modelDir = model.filePath.substring(0, model.filePath.lastIndexOf('/'));
  try {
    const files = await RNFS.readDir(modelDir);
    const mmProjFile = files.find(
      (f: { name: string }) =>
        f.name.toLowerCase().includes('mmproj') && f.name.endsWith('.gguf'),
    );
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
      await llmService.unloadModel();
      ctx.onError(); // resets loadedTextModelId to null before reassignment
    }

    const mmProjPath = await resolveMmProjPath(ctx.model, ctx.modelId);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
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

    await Promise.race([
      llmService.loadModel(ctx.model.filePath, mmProjPath),
      timeoutPromise,
    ]);

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Image model loading timed out')),
        ctx.timeoutMs,
      );
    });

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

    ctx.onLoaded(ctx.modelId, ctx.imageThreads);
    ctx.store.setActiveImageModelId(ctx.modelId);
  } catch (error) {
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}
