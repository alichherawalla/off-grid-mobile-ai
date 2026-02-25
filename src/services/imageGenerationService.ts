/**
 * ImageGenerationService - Handles image generation independently of UI lifecycle
 * This allows generation to continue even when the user navigates away from the screen
 * Follows the same pattern as generationService.ts for text LLM generation
 */

import { Platform } from 'react-native';
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage, GenerationMeta, Message } from '../types';
import logger from '../utils/logger';

export interface ImageGenerationState {
  isGenerating: boolean;
  progress: { step: number; totalSteps: number } | null;
  status: string | null;
  previewPath: string | null;
  prompt: string | null;
  conversationId: string | null;
  error: string | null;
  result: GeneratedImage | null;
}

type ImageGenerationListener = (state: ImageGenerationState) => void;

interface GenerateImageParams {
  prompt: string;
  conversationId?: string;
  negativePrompt?: string;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  previewInterval?: number;
}

interface ActiveImageModel {
  id: string;
  name: string;
  modelPath: string;
  backend?: string;
}

interface RunGenerationOptions {
  params: GenerateImageParams;
  enhancedPrompt: string;
  activeImageModel: ActiveImageModel;
  steps: number;
  guidanceScale: number;
  imageWidth: number;
  imageHeight: number;
}

interface UpdateEnhancementOptions {
  conversationId: string | undefined;
  tempMessageId: string | null;
  enhancedPrompt: string;
  originalPrompt: string;
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function buildEnhancementMessages(prompt: string, contextMessages: Message[]): Message[] {
  const hasContext = contextMessages.length > 0;
  const systemContent = hasContext
    ? `You are an expert at creating detailed image generation prompts. The user is in a conversation and wants to generate an image. Use the conversation history to understand context and references (e.g. "make it darker", "same but at night"). Enhance the user's latest request into a detailed, descriptive prompt for an image generation model. Include artistic style, lighting, composition, and quality modifiers. Keep it under 75 words. Only respond with the enhanced prompt, no explanation.`
    : `You are an expert at creating detailed image generation prompts. Take the user's request and enhance it into a detailed, descriptive prompt that will produce better results from an image generation model. Include artistic style, lighting, composition, and quality modifiers. Keep it under 75 words. Only respond with the enhanced prompt, no explanation.`;
  return [
    { id: 'system-enhance', role: 'system', content: systemContent, timestamp: Date.now() },
    ...contextMessages,
    { id: 'user-enhance', role: 'user', content: prompt, timestamp: Date.now() },
  ];
}

function getConversationContext(conversationId: string): Message[] {
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  if (!conversation?.messages) return [];
  return conversation.messages
    .slice(-10)
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({ id: `ctx-${msg.id}`, role: msg.role, content: msg.content.slice(0, 500), timestamp: msg.timestamp }));
}

function cleanEnhancedPrompt(raw: string): string {
  return raw.trim().replace(/(^["'])|(["']$)/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildImageGenMeta(
  model: ActiveImageModel,
  opts: { steps: number; guidanceScale: number; result: GeneratedImage },
): GenerationMeta {
  const backend = model.backend ?? 'mnn';
  const gpuBackend = Platform.OS === 'ios' ? 'Core ML (ANE)' : backend === 'qnn' ? 'QNN (NPU)' : 'MNN (CPU)';
  return {
    gpu: Platform.OS === 'ios' ? true : backend === 'qnn',
    gpuBackend,
    modelName: model.name,
    steps: opts.steps,
    guidanceScale: opts.guidanceScale,
    resolution: `${opts.result.width}x${opts.result.height}`,
  };
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

class ImageGenerationService {
  private state: ImageGenerationState = {
    isGenerating: false, progress: null, status: null, previewPath: null,
    prompt: null, conversationId: null, error: null, result: null,
  };

  private listeners: Set<ImageGenerationListener> = new Set();
  private cancelRequested: boolean = false;

  getState(): ImageGenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: ImageGenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private updateState(partial: Partial<ImageGenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
    const appStore = useAppStore.getState();
    if ('isGenerating' in partial) appStore.setIsGeneratingImage(this.state.isGenerating);
    if ('progress' in partial) appStore.setImageGenerationProgress(this.state.progress);
    if ('status' in partial) appStore.setImageGenerationStatus(this.state.status);
    if ('previewPath' in partial) appStore.setImagePreviewPath(this.state.previewPath);
  }

  private async _resetLlmAfterEnhancement(): Promise<void> {
    logger.log('[ImageGen] 🔄 Starting cleanup - generating:', llmService.isCurrentlyGenerating());
    try {
      await llmService.stopGeneration();
      logger.log('[ImageGen] ✓ stopGeneration() called');
      logger.log('[ImageGen] ✅ LLM service reset complete - generating:', llmService.isCurrentlyGenerating());
    } catch (resetError) {
      logger.error('[ImageGen] ❌ Failed to reset LLM service:', resetError);
    }
  }

  private async _updateEnhancementMessage(opts: UpdateEnhancementOptions): Promise<void> {
    const { conversationId, tempMessageId, enhancedPrompt, originalPrompt } = opts;
    if (!conversationId || !tempMessageId) return;
    const chatStore = useChatStore.getState();
    if (enhancedPrompt && enhancedPrompt !== originalPrompt) {
      chatStore.updateMessageContent(conversationId, tempMessageId, `<think>__LABEL:Enhanced prompt__\n${enhancedPrompt}</think>`);
      chatStore.updateMessageThinking(conversationId, tempMessageId, false);
    } else {
      logger.warn('[ImageGen] Enhancement produced no change, deleting thinking message');
      chatStore.deleteMessage(conversationId, tempMessageId);
    }
  }

  private async _enhancePrompt(params: GenerateImageParams, steps: number): Promise<string> {
    const { settings } = useAppStore.getState();
    if (!settings.enhanceImagePrompts) {
      logger.log('[ImageGen] Enhancement disabled, using original prompt');
      return params.prompt;
    }
    const isTextModelLoaded = llmService.isModelLoaded();
    const isLlmGenerating = llmService.isCurrentlyGenerating();
    logger.log('[ImageGen] 🎨 Starting prompt enhancement - Model loaded:', isTextModelLoaded, 'LLM generating:', isLlmGenerating);
    if (!isTextModelLoaded) {
      logger.warn('[ImageGen] No text model loaded, skipping enhancement');
      return params.prompt;
    }
    this.updateState({
      isGenerating: true, prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Enhancing prompt with AI...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });
    const contextMessages = params.conversationId ? getConversationContext(params.conversationId) : [];
    let tempMessageId: string | null = null;
    if (params.conversationId) {
      const tempMessage = useChatStore.getState().addMessage(params.conversationId, {
        role: 'assistant', content: 'Enhancing your prompt...', isThinking: true,
      });
      tempMessageId = tempMessage.id;
    }
    try {
      logger.log('[ImageGen] 📤 Calling llmService.generateResponse for enhancement...');
      let raw = await llmService.generateResponse(buildEnhancementMessages(params.prompt, contextMessages), (_token) => {});
      logger.log('[ImageGen] 📥 llmService.generateResponse returned');
      logger.log('[ImageGen] LLM state after enhancement - generating:', llmService.isCurrentlyGenerating());
      raw = cleanEnhancedPrompt(raw);
      logger.log('[ImageGen] ✅ Original prompt:', params.prompt);
      logger.log('[ImageGen] ✅ Enhanced prompt:', raw);
      await this._resetLlmAfterEnhancement();
      const enhancedPrompt = raw || params.prompt;
      await this._updateEnhancementMessage({ conversationId: params.conversationId, tempMessageId, enhancedPrompt, originalPrompt: params.prompt });
      return enhancedPrompt;
    } catch (error: any) {
      logger.error('[ImageGen] ❌ Prompt enhancement failed:', error);
      logger.error('[ImageGen] Error details:', error?.message || 'Unknown error');
      await this._resetLlmAfterEnhancement();
      if (params.conversationId && tempMessageId) {
        useChatStore.getState().deleteMessage(params.conversationId, tempMessageId);
      }
      return params.prompt;
    }
  }

  private async _ensureImageModelLoaded(activeImageModelId: string | null, activeImageModel: ActiveImageModel, desiredThreads: number): Promise<boolean> {
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
    const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
    const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
    const needsThreadReload = loadedThreads == null || loadedThreads !== desiredThreads;
    if (isImageModelLoaded && loadedPath === activeImageModel.modelPath && !needsThreadReload) return true;
    if (!activeImageModelId) {
      this.updateState({ error: 'No image model selected', isGenerating: false });
      return false;
    }
    try {
      this.updateState({ status: `Loading ${activeImageModel.name}...` });
      await activeModelService.loadImageModel(activeImageModelId);
      return true;
    } catch (error: any) {
      this.updateState({ isGenerating: false, progress: null, status: null, error: `Failed to load image model: ${error?.message || 'Unknown error'}` });
      return false;
    }
  }

  private async _runGenerationAndSave(opts: RunGenerationOptions): Promise<GeneratedImage | null> {
    const { params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight } = opts;
    this.updateState({ status: 'Starting image generation...' });
    const startTime = Date.now();
    try {
      const result = await onnxImageGeneratorService.generateImage(
        { prompt: enhancedPrompt, negativePrompt: params.negativePrompt || '', steps, guidanceScale, seed: params.seed, width: imageWidth, height: imageHeight, previewInterval: params.previewInterval ?? 2 },
        (progress) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(progress.step, steps);
          this.updateState({ progress: { step: displayStep, totalSteps: steps }, status: `Generating image (${displayStep}/${steps})...` });
        },
        (preview) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(preview.step, steps);
          this.updateState({ previewPath: `file://${preview.previewPath}?t=${Date.now()}`, status: `Refining image (${displayStep}/${steps})...` });
        },
      );
      if (this.cancelRequested) { this.resetState(); return null; }
      if (!result?.imagePath) { this.resetState(); return null; }
      result.modelId = activeImageModel.id;
      if (params.conversationId) result.conversationId = params.conversationId;
      useAppStore.getState().addGeneratedImage(result);
      if (params.conversationId) {
        const genTime = Date.now() - startTime;
        useChatStore.getState().addMessage(params.conversationId, {
          role: 'assistant',
          content: `Generated image for: "${params.prompt}"`,
          attachments: [{ id: result.id, type: 'image', uri: `file://${result.imagePath}`, width: result.width, height: result.height }],
          generationTimeMs: genTime,
          generationMeta: buildImageGenMeta(activeImageModel, { steps, guidanceScale, result }),
        });
      }
      this.updateState({ isGenerating: false, progress: null, status: null, previewPath: null, result, error: null });
      return result;
    } catch (error: any) {
      if (!error?.message?.includes('cancelled')) {
        logger.error('[ImageGenerationService] Generation error:', error);
        this.updateState({ isGenerating: false, progress: null, status: null, previewPath: null, error: error?.message || 'Image generation failed' });
      } else {
        this.resetState();
      }
      return null;
    }
  }

  /**
   * Generate an image. Runs independently of UI lifecycle.
   * If conversationId is provided, the result will be added as a chat message.
   */
  async generateImage(params: GenerateImageParams): Promise<GeneratedImage | null> {
    if (this.state.isGenerating) {
      logger.log('[ImageGenerationService] Already generating, ignoring request');
      return null;
    }
    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeImageModel) { this.updateState({ error: 'No image model selected' }); return null; }

    const steps = params.steps || settings.imageSteps || 8;
    const guidanceScale = params.guidanceScale || settings.imageGuidanceScale || 2.0;
    const imageWidth = settings.imageWidth || 256;
    const imageHeight = settings.imageHeight || 256;

    const enhancedPrompt = await this._enhancePrompt(params, steps);
    logger.log('[ImageGen] enhanceImagePrompts setting:', settings.enhanceImagePrompts);
    this.cancelRequested = false;

    if (!settings.enhanceImagePrompts) {
      this.updateState({
        isGenerating: true, prompt: params.prompt, conversationId: params.conversationId || null,
        status: 'Preparing image generation...', previewPath: null,
        progress: { step: 0, totalSteps: steps }, error: null, result: null,
      });
    } else {
      this.updateState({ status: 'Preparing image generation...' });
    }

    const loaded = await this._ensureImageModelLoaded(activeImageModelId, activeImageModel, settings.imageThreads ?? 4);
    if (!loaded) return null;
    if (this.cancelRequested) { this.resetState(); return null; }

    return this._runGenerationAndSave({ params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight });
  }

  async cancelGeneration(): Promise<void> {
    if (!this.state.isGenerating) return;
    this.cancelRequested = true;
    try { await onnxImageGeneratorService.cancelGeneration(); } catch { /* Ignore */ }
    this.resetState();
  }

  private resetState(): void {
    this.updateState({
      isGenerating: false, progress: null, status: null, previewPath: null,
      prompt: null, conversationId: null, error: null,
      // Keep result so the last generated image is still accessible
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
