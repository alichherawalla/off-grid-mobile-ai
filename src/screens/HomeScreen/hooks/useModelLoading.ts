import { useCallback } from 'react';
import { showAlert, hideAlert, AlertState } from '../../../components';
import { activeModelService } from '../../../services';
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { LoadingState, ModelPickerType } from './useHomeScreen';

type Setters = {
  setLoadingState: (s: LoadingState) => void;
  setPickerType: (t: ModelPickerType) => void;
  setAlertState: (s: AlertState) => void;
};

const idle: LoadingState = { isLoading: false, type: null, modelName: null };

const waitFrame = () => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)))
);

export const useModelLoading = (
  activeModelId: string | null,
  activeImageModelId: string | null,
  { setLoadingState, setPickerType, setAlertState }: Setters,
) => {
  const proceedWithTextModelLoad = useCallback(async (model: DownloadedModel) => {
    setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
    setPickerType(null);
    await waitFrame();
    try {
      await activeModelService.loadTextModel(model.id);
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  const handleSelectTextModel = useCallback(async (model: DownloadedModel) => {
    if (activeModelId === model.id) { return; }
    const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'text');
    if (!memoryCheck.canLoad) {
      setAlertState(showAlert('Insufficient Memory', memoryCheck.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load Anyway', style: 'destructive', onPress: () => {
          setAlertState(hideAlert());
          proceedWithTextModelLoad(model);
        }},
      ]));
      return;
    }
    if (memoryCheck.severity === 'warning') {
      setAlertState(showAlert('Low Memory Warning', memoryCheck.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load Anyway', style: 'default', onPress: () => {
          setAlertState(hideAlert());
          proceedWithTextModelLoad(model);
        }},
      ]));
      return;
    }
    proceedWithTextModelLoad(model);
  }, [activeModelId, setAlertState, proceedWithTextModelLoad]);

  const handleUnloadTextModel = useCallback(async () => {
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    setPickerType(null);
    try {
      await activeModelService.unloadTextModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  const proceedWithImageModelLoad = useCallback(async (model: ONNXImageModel) => {
    setLoadingState({ isLoading: true, type: 'image', modelName: model.name });
    setPickerType(null);
    await waitFrame();
    try {
      await activeModelService.loadImageModel(model.id);
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  const handleSelectImageModel = useCallback(async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) { return; }
    const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'image');
    if (!memoryCheck.canLoad) {
      setAlertState(showAlert('Insufficient Memory', memoryCheck.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load Anyway', style: 'destructive', onPress: () => {
          setAlertState(hideAlert());
          proceedWithImageModelLoad(model);
        }},
      ]));
      return;
    }
    if (memoryCheck.severity === 'warning') {
      setAlertState(showAlert('Low Memory Warning', memoryCheck.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load Anyway', style: 'default', onPress: () => {
          setAlertState(hideAlert());
          proceedWithImageModelLoad(model);
        }},
      ]));
      return;
    }
    proceedWithImageModelLoad(model);
  }, [activeImageModelId, setAlertState, proceedWithImageModelLoad]);

  const handleUnloadImageModel = useCallback(async () => {
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    setPickerType(null);
    try {
      await activeModelService.unloadImageModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  return {
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
  };
};
