import { Dispatch, SetStateAction } from 'react';
import {
  AlertState,
  showAlert,
  hideAlert,
} from '../../components';
import { llmService, activeModelService } from '../../services';
import { DownloadedModel } from '../../types';

type SetState<T> = Dispatch<SetStateAction<T>>;

type ModelActionDeps = {
  activeModel: DownloadedModel | undefined;
  activeModelId: string | null;
  activeConversationId: string | null | undefined;
  isStreaming: boolean;
  settings: { showGenerationDetails: boolean };
  clearStreamingMessage: () => void;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  addMessage: (convId: string, msg: any) => void;
  setIsModelLoading: SetState<boolean>;
  setLoadingModel: SetState<DownloadedModel | null>;
  setSupportsVision: SetState<boolean>;
  setShowModelSelector: SetState<boolean>;
  setAlertState: SetState<AlertState>;
  modelLoadStartTimeRef: React.MutableRefObject<number | null>;
};

function waitForRenderFrame(): Promise<void> {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { setTimeout(resolve, 200); });
    });
  });
}

function addSystemMsg(
  deps: Pick<ModelActionDeps, 'activeConversationId' | 'settings' | 'addMessage'>,
  content: string,
) {
  if (!deps.activeConversationId || !deps.settings.showGenerationDetails) return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${content}_`,
    isSystemInfo: true,
  });
}

async function doLoadTextModel(deps: ModelActionDeps): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;
  try {
    await activeModelService.loadTextModel(activeModelId);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(multimodalSupport?.vision || false);
    if (deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
  } catch (error: any) {
    deps.setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.modelLoadStartTimeRef.current = null;
  }
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;

  if (!alreadyLoading) {
    const memoryCheck = await activeModelService.checkMemoryForModel(activeModelId, 'text');
    if (!memoryCheck.canLoad) {
      deps.setAlertState(showAlert(
        'Insufficient Memory',
        `Cannot load ${activeModel.name}. ${memoryCheck.message}\n\nTry unloading other models from the Home screen.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Load Anyway', style: 'destructive', onPress: () => {
            deps.setAlertState(hideAlert());
            deps.setIsModelLoading(true);
            deps.setLoadingModel(activeModel);
            deps.modelLoadStartTimeRef.current = Date.now();
            waitForRenderFrame().then(() => doLoadTextModel(deps));
          }},
        ],
      ));
      return;
    }
    deps.setIsModelLoading(true);
    deps.setLoadingModel(activeModel);
    deps.modelLoadStartTimeRef.current = Date.now();
    await waitForRenderFrame();
  }

  try {
    await activeModelService.loadTextModel(activeModelId);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(multimodalSupport?.vision || false);
    if (!alreadyLoading && deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
  } catch (error: any) {
    if (!alreadyLoading) {
      deps.setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
    }
  } finally {
    if (!alreadyLoading) {
      deps.setIsModelLoading(false);
      deps.setLoadingModel(null);
      deps.modelLoadStartTimeRef.current = null;
    }
  }
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;
  const loadedPath = llmService.getLoadedModelPath();
  const currentVisionSupport = llmService.getMultimodalSupport()?.vision || false;
  const needsReload = loadedPath !== activeModel.filePath ||
    (activeModel.mmProjPath && !currentVisionSupport);
  if (!needsReload && loadedPath === activeModel.filePath) {
    deps.setSupportsVision(currentVisionSupport);
    return;
  }
  const alreadyLoading = activeModelService.getActiveModels().text.isLoading;
  await initiateModelLoad(deps, alreadyLoading);
}

export async function proceedWithModelLoadFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  deps.setIsModelLoading(true);
  deps.setLoadingModel(model);
  deps.modelLoadStartTimeRef.current = Date.now();
  await waitForRenderFrame();
  try {
    await activeModelService.loadTextModel(model.id);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(multimodalSupport?.vision || false);
    if (deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      const convId = deps.activeConversationId || deps.createConversation(model.id);
      if (convId) {
        deps.addMessage(convId, {
          role: 'assistant',
          content: `_Model loaded: ${model.name} (${loadTime}s)_`,
          isSystemInfo: true,
        });
      }
    } else if (!deps.activeConversationId) {
      deps.createConversation(model.id);
    }
  } catch (error) {
    deps.setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
    deps.modelLoadStartTimeRef.current = null;
  }
}

export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  if (llmService.getLoadedModelPath() === model.filePath) {
    deps.setShowModelSelector(false);
    return;
  }
  const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'text');
  if (!memoryCheck.canLoad) {
    deps.setAlertState(showAlert('Insufficient Memory', memoryCheck.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Load Anyway', style: 'destructive', onPress: () => {
        deps.setAlertState(hideAlert());
        proceedWithModelLoadFn(deps, model);
      }},
    ]));
    return;
  }
  if (memoryCheck.severity === 'warning') {
    deps.setAlertState(showAlert(
      'Low Memory Warning',
      memoryCheck.message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load Anyway',
          style: 'default',
          onPress: () => {
            deps.setAlertState(hideAlert());
            proceedWithModelLoadFn(deps, model);
          },
        },
      ],
    ));
    return;
  }
  proceedWithModelLoadFn(deps, model);
}

export async function handleUnloadModelFn(deps: ModelActionDeps): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    await llmService.stopGeneration();
    clearStreamingMessage();
  }
  const modelName = activeModel?.name;
  deps.setIsModelLoading(true);
  deps.setLoadingModel(activeModel ?? null);
  try {
    await activeModelService.unloadTextModel();
    deps.setSupportsVision(false);
    if (deps.settings.showGenerationDetails && modelName) {
      addSystemMsg(deps, `Model unloaded: ${modelName}`);
    }
  } catch (error) {
    deps.setAlertState(showAlert('Error', `Failed to unload model: ${(error as Error).message}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
  }
}
