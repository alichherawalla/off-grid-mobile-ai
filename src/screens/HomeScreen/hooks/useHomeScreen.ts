import { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { AlertState, initialAlertState, showAlert, hideAlert } from '../../../components';
import { useAppStore, useChatStore } from '../../../stores';
import { modelManager, hardwareService, activeModelService, ResourceUsage } from '../../../services';
import { Conversation } from '../../../types';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainTabParamList, RootStackParamList } from '../../../navigation/types';
import { useModelLoading } from './useModelLoading';
import logger from '../../../utils/logger';

export type HomeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'HomeTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export type ModelPickerType = 'text' | 'image' | null;

export type LoadingState = {
  isLoading: boolean;
  type: 'text' | 'image' | null;
  modelName: string | null;
};

// Track if we've synced native state to avoid repeated calls
let hasInitializedNativeSync = false;

export const useHomeScreen = (navigation: HomeScreenNavigationProp) => {
  const [pickerType, setPickerType] = useState<ModelPickerType>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    type: null,
    modelName: null,
  });
  const [isEjecting, setIsEjecting] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [memoryInfo, setMemoryInfo] = useState<ResourceUsage | null>(null);
  const isFirstMount = useRef(true);

  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    setActiveModelId: _setActiveModelId,
    downloadedImageModels,
    setDownloadedImageModels,
    activeImageModelId,
    setActiveImageModelId: _setActiveImageModelId,
    deviceInfo,
    setDeviceInfo,
    generatedImages,
  } = useAppStore();

  const { conversations, createConversation, setActiveConversation, deleteConversation } = useChatStore();

  const {
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
  } = useModelLoading({
    setLoadingState,
    setPickerType,
    setAlertState,
  });

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadData();
      if (!hasInitializedNativeSync) {
        hasInitializedNativeSync = true;
        activeModelService.syncWithNativeState();
      }
    });
    isFirstMount.current = false;
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMemoryInfo = useCallback(async () => {
    try {
      const info = await activeModelService.getResourceUsage();
      setMemoryInfo(info);
    } catch (error) {
      logger.warn('[HomeScreen] Failed to get memory info:', error);
    }
  }, []);

  useEffect(() => {
    refreshMemoryInfo();
    const unsubscribe = activeModelService.subscribe(() => { refreshMemoryInfo(); });
    return () => unsubscribe();
  }, [refreshMemoryInfo]);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
    const imageModels = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(imageModels);
  };

  const handleEjectAll = () => {
    const hasModels = activeModelId || activeImageModelId;
    if (!hasModels) { return; }
    const doEjectAll = async () => {
      setAlertState(hideAlert());
      setIsEjecting(true);
      setLoadingState({ isLoading: true, type: 'text', modelName: 'Ejecting models...' });
      // Let the overlay render before blocking the bridge
      await new Promise<void>(resolve =>
        InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350))
      );
      try {
        const results = await activeModelService.unloadAllModels();
        const count = (results.textUnloaded ? 1 : 0) + (results.imageUnloaded ? 1 : 0);
        if (count > 0) {
          setAlertState(showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`));
        }
      } catch (_error) {
        setAlertState(showAlert('Error', 'Failed to unload models'));
      } finally {
        setIsEjecting(false);
        setLoadingState({ isLoading: false, type: null, modelName: null });
      }
    };
    setAlertState(showAlert(
      'Eject All Models',
      'Unload all active models to free up memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eject All',
          style: 'destructive',
          onPress: () => { doEjectAll(); },
        },
      ]
    ));
  };

  const startNewChat = () => {
    if (!activeModelId) { return; }
    const conversationId = createConversation(activeModelId);
    setActiveConversation(conversationId);
    navigation.navigate('Chat', { conversationId });
  };

  const continueChat = (conversationId: string) => {
    setActiveConversation(conversationId);
    navigation.navigate('Chat', { conversationId });
  };

  const handleDeleteConversation = (conversation: Conversation) => {
    setAlertState(showAlert(
      'Delete Conversation',
      `Delete "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            deleteConversation(conversation.id);
          },
        },
      ]
    ));
  };

  const activeTextModel = downloadedModels.find((m) => m.id === activeModelId);
  const activeImageModel = downloadedImageModels.find((m) => m.id === activeImageModelId);
  const recentConversations = conversations.slice(0, 4);

  return {
    pickerType,
    setPickerType,
    loadingState,
    isEjecting,
    alertState,
    setAlertState,
    memoryInfo,
    downloadedModels,
    activeModelId,
    downloadedImageModels,
    activeImageModelId,
    generatedImages,
    conversations,
    activeTextModel,
    activeImageModel,
    recentConversations,
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
    handleEjectAll,
    startNewChat,
    continueChat,
    handleDeleteConversation,
  };
};
