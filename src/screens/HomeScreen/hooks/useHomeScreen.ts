/* eslint-disable max-lines-per-function, max-lines */
import { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { AlertState, initialAlertState, showAlert, hideAlert } from '../../../components';
import { useAppStore, useChatStore, useRemoteServerStore } from '../../../stores';
import { modelManager, hardwareService, activeModelService, ResourceUsage, remoteServerManager } from '../../../services';
import { discoverLANServers } from '../../../services/networkDiscovery';
import { Conversation, RemoteModel } from '../../../types';
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
let hasRunLANDiscovery = false;

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

  // Remote server store for remote models
  const {
    servers: remoteServers,
    discoveredModels: remoteDiscoveredModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    activeServerId,
  } = useRemoteServerStore();

  const {
    handleSelectTextModel: _handleSelectTextModel,
    handleUnloadTextModel: _handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
  } = useModelLoading({
    setLoadingState,
    setPickerType,
    setAlertState,
  });

  // Wrap local model handlers to clear any active remote server first
  const handleSelectTextModel = useCallback(
    (model: Parameters<typeof _handleSelectTextModel>[0]) => {
      remoteServerManager.clearActiveRemoteModel();
      return _handleSelectTextModel(model);
    },
    [_handleSelectTextModel],
  );

  const handleUnloadTextModel = useCallback(
    () => {
      remoteServerManager.clearActiveRemoteModel();
      return _handleUnloadTextModel();
    },
    [_handleUnloadTextModel],
  );

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadData();
      if (!hasInitializedNativeSync) {
        hasInitializedNativeSync = true;
        activeModelService.syncWithNativeState();
      }
      if (!hasRunLANDiscovery) {
        hasRunLANDiscovery = true;
        runLANDiscovery();
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
    } catch (_error) {
      logger.warn('[HomeScreen] Failed to get memory info:', _error);
    }
  }, []);

  useEffect(() => {
    refreshMemoryInfo();
    const unsubscribe = activeModelService.subscribe(() => { refreshMemoryInfo(); });
    return () => unsubscribe();
  }, [refreshMemoryInfo]);

  const getPort = (endpoint: string): string | null => {
    try { return new URL(endpoint).port; } catch { return null; }
  };

  const updateExistingServerAtNewIP = async (
    store: ReturnType<typeof useRemoteServerStore.getState>,
    samePortServer: NonNullable<ReturnType<typeof useRemoteServerStore.getState>['servers'][0]>,
    discovered: { endpoint: string; name: string }
  ) => {
    logger.log('[HomeScreen] Server moved to new IP, updating:', samePortServer.name, '->', discovered.endpoint);
    await remoteServerManager.updateServer(samePortServer.id, { endpoint: discovered.endpoint, name: discovered.name });
    try { await useRemoteServerStore.getState().discoverModels(samePortServer.id); } catch { /* offline */ }
    if (store.activeServerId === samePortServer.id && store.activeRemoteTextModelId) {
      try {
        await remoteServerManager.setActiveRemoteTextModel(samePortServer.id, store.activeRemoteTextModelId);
      } catch { /* user can re-select */ }
    }
  };

  const addNewServersAndNotify = async (
    newServersToAdd: Awaited<ReturnType<typeof discoverLANServers>>
  ) => {
    for (const server of newServersToAdd) {
      logger.log('[HomeScreen] Auto-adding discovered server:', server.name);
      const added = await remoteServerManager.addServer({
        name: server.name,
        endpoint: server.endpoint,
        providerType: 'openai-compatible',
      });
      remoteServerManager.testConnection(added.id).catch(() => {});
    }

    if (newServersToAdd.length === 0) return;

    const names = newServersToAdd.map(s => s.name).join(', ');
    const title = newServersToAdd.length === 1
      ? 'LLM Server Found'
      : `${newServersToAdd.length} LLM Servers Found`;
    setAlertState(showAlert(
      title,
      `Discovered on your network: ${names}. You can select a model from the model picker.`,
      [
        { text: 'Dismiss', style: 'cancel' },
        { text: 'View Servers', onPress: () => {
          setAlertState(hideAlert());
          navigation.navigate('RemoteServers');
        }},
      ],
    ));
  };

  const runLANDiscovery = async () => {
    let discovered: Awaited<ReturnType<typeof discoverLANServers>>;
    try {
      discovered = await discoverLANServers();
    } catch (error) {
      logger.warn('[HomeScreen] LAN discovery skipped:', (error as Error).message);
      return;
    }
    if (discovered.length === 0) return;

    const store = useRemoteServerStore.getState();
    const existingServers = store.servers;
    const existingEndpoints = new Set(existingServers.map(s => s.endpoint.replace(/\/$/, '')));

    const newServersToAdd: typeof discovered = [];

    for (const d of discovered) {
      if (existingEndpoints.has(d.endpoint.replace(/\/$/, ''))) continue;

      const dPort = getPort(d.endpoint);
      const samePortServer = dPort
        ? existingServers.find(s => getPort(s.endpoint) === dPort)
        : null;

      if (samePortServer) {
        await updateExistingServerAtNewIP(store, samePortServer, d);
      } else {
        newServersToAdd.push(d);
      }
    }

    await addNewServersAndNotify(newServersToAdd);
  };

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
    const hasLocalModels = activeModelId || activeImageModelId;
    const hasRemoteModel = activeRemoteTextModelId || activeRemoteImageModelId;
    if (!hasLocalModels && !hasRemoteModel) { return; }

    const doEjectAll = async () => {
      setAlertState(hideAlert());
      setIsEjecting(true);
      setLoadingState({ isLoading: true, type: 'text', modelName: 'Ejecting models...' });
      // Let the overlay render before blocking the bridge
      await new Promise<void>(resolve =>
        InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350))
      );
      try {
        let count = 0;
        // Unload local models
        if (hasLocalModels) {
          const results = await activeModelService.unloadAllModels();
          count = (results.textUnloaded ? 1 : 0) + (results.imageUnloaded ? 1 : 0);
        }
        // Disconnect remote server
        if (hasRemoteModel) {
          remoteServerManager.clearActiveRemoteModel();
          count += 1;
        }
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
    // Use local model ID if active, otherwise use remote model ID
    const modelId = activeModelId || activeRemoteTextModelId;
    if (!modelId) { return; }
    const conversationId = createConversation(modelId);
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

  // Compute active remote text model reactively (using selected state, not getter)
  const activeRemoteTextModel = activeRemoteTextModelId && activeServerId
    ? (remoteDiscoveredModels[activeServerId] || []).find((m) => m.id === activeRemoteTextModelId)
    : null;

  const activeRemoteImageModel = activeRemoteImageModelId && activeServerId
    ? (remoteDiscoveredModels[activeServerId] || []).find((m) => m.id === activeRemoteImageModelId)
    : null;

  const activeTextModel = activeRemoteTextModel || downloadedModels.find((m) => m.id === activeModelId) || null;
  const activeImageModel = activeRemoteImageModel || downloadedImageModels.find((m) => m.id === activeImageModelId) || null;
  const recentConversations = conversations.slice(0, 4);

  // Get all remote text models (non-vision)
  const remoteTextModels: RemoteModel[] = remoteServers.flatMap(server =>
    (remoteDiscoveredModels[server.id] || []).filter(m => !m.capabilities.supportsVision)
  );

  // Get all remote image models (vision-capable)
  const remoteImageModels: RemoteModel[] = remoteServers.flatMap(server =>
    (remoteDiscoveredModels[server.id] || []).filter(m => m.capabilities.supportsVision)
  );

  // Handlers for remote model selection
  const handleSelectRemoteTextModel = useCallback(async (model: RemoteModel) => {
    logger.log('[useHomeScreen] handleSelectRemoteTextModel called:', model.id, model.serverId);
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
    try {
      // Unload any active local model first — only one active model at a time
      if (activeModelId) {
        await activeModelService.unloadTextModel();
      }
      await remoteServerManager.setActiveRemoteTextModel(model.serverId, model.id);
      logger.log('[useHomeScreen] Remote text model set successfully');
    } catch (_error) {
      logger.error('[useHomeScreen] Failed to set remote text model:', _error);
      setAlertState(showAlert('Error', `Failed to connect to remote model: ${(_error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [activeModelId, setPickerType, setLoadingState, setAlertState]);

  const handleUnloadRemoteTextModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    try {
      remoteServerManager.clearActiveRemoteModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to disconnect remote model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleSelectRemoteImageModel = useCallback(async (model: RemoteModel) => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: model.name });
    try {
      await remoteServerManager.setActiveRemoteImageModel(model.serverId, model.id);
    } catch (_error) {
      setAlertState(showAlert('Error', `Failed to connect to remote model: ${(_error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleUnloadRemoteImageModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    try {
      remoteServerManager.clearActiveRemoteModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to disconnect remote model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

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
    // Remote model state
    remoteTextModels,
    remoteImageModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
    // Remote model handlers
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
    handleEjectAll,
    startNewChat,
    continueChat,
    handleDeleteConversation,
  };
};
