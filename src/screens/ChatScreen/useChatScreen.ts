import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AlertState, showAlert, initialAlertState } from '../../components';
import { useAppStore, useChatStore, useProjectStore } from '../../stores';
import {
  llmService, modelManager, activeModelService,
  generationService, imageGenerationService,
  ImageGenerationState, hardwareService, QueuedMessage,
  contextCompactionService,
} from '../../services';
import { Message, MediaAttachment, Project, DownloadedModel, DebugInfo } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { ensureModelLoadedFn, handleModelSelectFn, handleUnloadModelFn } from './useChatModelActions';
import {
  startGenerationFn, handleSendFn, handleStopFn, executeDeleteConversationFn,
  regenerateResponseFn, handleImageGenerationFn, handleSelectProjectFn,
} from './useChatGenerationActions';
import { getDisplayMessages, getPlaceholderText, ChatMessageItem, StreamingState } from './types';
import { saveImageToGallery } from './useSaveImage';
import logger from '../../utils/logger';

export type { AlertState, ChatMessageItem, StreamingState };
export { getDisplayMessages, getPlaceholderText };

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

export const useChatScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState<DownloadedModel | null>(null);
  const [supportsVision, setSupportsVision] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [animateLastN, setAnimateLastN] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedTexts, setQueuedTexts] = useState<string[]>([]);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(imageGenerationService.getState());
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [supportsToolCalling, setSupportsToolCalling] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const lastMessageCountRef = useRef(0);
  const generatingForConversationRef = useRef<string | null>(null);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const startGenerationRef = useRef<(id: string, text: string) => Promise<void>>(null as any);
  const addMessageRef = useRef<typeof addMessage>(null as any);

  const {
    activeModelId, downloadedModels, settings, activeImageModelId,
    downloadedImageModels, setDownloadedImageModels,
    setIsGeneratingImage: setAppIsGeneratingImage,
    setImageGenerationStatus: setAppImageGenerationStatus,
    removeImagesByConversationId,
  } = useAppStore();

  const {
    activeConversationId, conversations, createConversation, addMessage,
    updateMessageContent, deleteMessagesAfter, streamingMessage,
    streamingForConversationId, isStreaming, isThinking, clearStreamingMessage,
    deleteConversation, setActiveConversation, setConversationProject,
  } = useChatStore();

  const { projects, getProject } = useProjectStore();
  addMessageRef.current = addMessage;

  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const activeModel = downloadedModels.find(m => m.id === activeModelId);
  const activeProject = activeConversation?.projectId ? getProject(activeConversation.projectId) : null;
  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const imageModelLoaded = !!activeImageModel;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation = streamingForConversationId === activeConversationId;

  const genDeps = {
    activeModelId, activeModel, activeConversationId, activeConversation, activeProject,
    activeImageModel, imageModelLoaded, isStreaming, isGeneratingImage, imageGenState, settings,
    downloadedModels, setAlertState, setIsClassifying, setAppImageGenerationStatus,
    setAppIsGeneratingImage, addMessage, clearStreamingMessage, deleteConversation,
    setActiveConversation, removeImagesByConversationId, generatingForConversationRef, navigation, setShowSettingsPanel,
    ensureModelLoaded: async () => ensureModelLoadedFn(modelDeps),
  };

  const modelDeps = {
    activeModel, activeModelId, activeConversationId, isStreaming, settings,
    clearStreamingMessage, createConversation, addMessage,
    setIsModelLoading, setLoadingModel, setSupportsVision, setShowModelSelector,
    setAlertState, modelLoadStartTimeRef,
  };

  useEffect(() => {
    const unsub1 = imageGenerationService.subscribe(state => setImageGenState(state));
    const unsub2 = contextCompactionService.subscribeCompacting(setIsCompacting);
    return () => { unsub1(); unsub2(); };
  }, []);
  useEffect(() => {
    return generationService.subscribe(state => {
      setQueueCount(state.queuedMessages.length);
      setQueuedTexts(state.queuedMessages.map((m: QueuedMessage) => m.text));
    });
  }, []);

  const handleQueuedSend = useCallback(async (item: QueuedMessage) => {
    addMessageRef.current(item.conversationId, { role: 'user', content: item.text, attachments: item.attachments });
    await startGenerationRef.current(item.conversationId, item.messageText);
  }, []);

  useEffect(() => {
    generationService.setQueueProcessor(handleQueuedSend);
    return () => generationService.setQueueProcessor(null);
  }, [handleQueuedSend]);

  useEffect(() => {
    const { conversationId, projectId } = route.params || {};
    if (conversationId) { setActiveConversation(conversationId); }
    else if (activeModelId) { createConversation(activeModelId, undefined, projectId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.conversationId, route.params?.projectId]);

  useEffect(() => {
    if (generatingForConversationRef.current && generatingForConversationRef.current !== activeConversationId) {
      generatingForConversationRef.current = null;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && llmService.isModelLoaded()) { llmService.clearKVCache(false).catch(() => {}); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeConversationId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) {
        const models = await modelManager.getDownloadedImageModels();
        if (!cancelled) setDownloadedImageModels(models);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const preload = async () => {
      if (
        settings.imageGenerationMode === 'auto' && settings.autoDetectMethod === 'llm' &&
        settings.classifierModelId && activeImageModelId && settings.modelLoadingStrategy === 'performance'
      ) {
        const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);
        if (classifierModel?.filePath && !llmService.getLoadedModelPath()) {
          try { await activeModelService.loadTextModel(settings.classifierModelId!); }
          catch (error) { logger.warn('[ChatScreen] Failed to preload classifier model:', error); }
        }
      }
    };
    preload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.imageGenerationMode, settings.autoDetectMethod, settings.classifierModelId, activeImageModelId, settings.modelLoadingStrategy]);

  useEffect(() => {
    if (activeModelId && activeModel) { ensureModelLoadedFn(modelDeps); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelId]);

  useEffect(() => {
    if (activeModel?.mmProjPath && llmService.isModelLoaded()) {
      const support = llmService.getMultimodalSupport();
      if (support?.vision) setSupportsVision(true);
    } else if (!activeModel?.mmProjPath) { setSupportsVision(false); }
  }, [activeModel?.mmProjPath]);

  useEffect(() => {
    setSupportsToolCalling(llmService.isModelLoaded() ? llmService.supportsToolCalling() : false);
  }, [activeModelId, isModelLoading]);

  const displayMessages = getDisplayMessages(activeConversation?.messages || [], { isThinking, streamingMessage, isStreamingForThisConversation });

  useEffect(() => {
    const prev = lastMessageCountRef.current, curr = displayMessages.length;
    if (curr > prev && prev > 0) setAnimateLastN(curr - prev);
    lastMessageCountRef.current = curr;
  }, [displayMessages.length]);
  useEffect(() => { lastMessageCountRef.current = 0; setAnimateLastN(0); }, [activeConversationId]);

  const startGeneration = async (targetConversationId: string, messageText: string) => {
    await startGenerationFn(genDeps, { setDebugInfo, targetConversationId, messageText });
  };
  startGenerationRef.current = startGeneration;
  const enabledTools = supportsToolCalling ? (settings.enabledTools || []) : [];
  const handleToggleTool = (toolId: string) => {
    const cur = settings.enabledTools || [];
    useAppStore.getState().updateSettings({ enabledTools: cur.includes(toolId) ? cur.filter((id: string) => id !== toolId) : [...cur, toolId] });
  };
  return {
    isModelLoading, loadingModel, supportsVision,
    showProjectSelector, setShowProjectSelector,
    showDebugPanel, setShowDebugPanel,
    showModelSelector, setShowModelSelector,
    showSettingsPanel, setShowSettingsPanel,
    showToolPicker, setShowToolPicker, supportsToolCalling,
    debugInfo, alertState, setAlertState,
    showScrollToBottom, setShowScrollToBottom,
    isClassifying, animateLastN, queueCount, queuedTexts,
    viewerImageUri, setViewerImageUri, imageGenState,
    enabledTools, handleToggleTool,
    activeModelId, activeConversationId, activeConversation, activeModel,
    activeProject, activeImageModel, imageModelLoaded, isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming, isThinking, isCompacting, displayMessages, downloadedModels, projects, settings,
    navigation, hardwareService,
    handleSend: (text: string, attachments?: MediaAttachment[], imageMode?: 'auto' | 'force' | 'disabled') =>
      handleSendFn(genDeps, { text, attachments, imageMode, startGeneration, setDebugInfo }),
    handleStop: () => handleStopFn(genDeps),
    handleModelSelect: (model: DownloadedModel) => handleModelSelectFn(modelDeps, model),
    handleUnloadModel: () => handleUnloadModelFn(modelDeps),
    handleDeleteConversation: () => {
      if (!activeConversationId || !activeConversation) return;
      setAlertState(showAlert(
        'Delete Conversation',
        'Are you sure you want to delete this conversation? This will also delete all images generated in this chat.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { executeDeleteConversationFn(genDeps).catch(() => {}); } },
        ],
      ));
    },
    handleCopyMessage: (_content: string) => {},
    handleRetryMessage: async (message: Message) => {
      if (!activeConversationId || !activeModel) return;
      if (message.role === 'user') {
        const msgs = activeConversation?.messages || [];
        const idx = msgs.findIndex((m: Message) => m.id === message.id);
        if (idx !== -1 && idx < msgs.length - 1) deleteMessagesAfter(activeConversationId, message.id);
        await regenerateResponseFn(genDeps, { setDebugInfo, userMessage: message });
      } else {
        const msgs = activeConversation?.messages || [];
        const idx = msgs.findIndex((m: Message) => m.id === message.id);
        if (idx > 0) {
          const prevUserMsg = msgs.slice(0, idx).reverse().find((m: Message) => m.role === 'user');
          if (prevUserMsg) {
            deleteMessagesAfter(activeConversationId, prevUserMsg.id);
            await regenerateResponseFn(genDeps, { setDebugInfo, userMessage: prevUserMsg });
          }
        }
      }
    },
    handleEditMessage: async (message: Message, newContent: string) => {
      if (!activeConversationId || !activeModel) return;
      updateMessageContent(activeConversationId, message.id, newContent);
      deleteMessagesAfter(activeConversationId, message.id);
      await regenerateResponseFn(genDeps, { setDebugInfo, userMessage: { ...message, content: newContent } });
    },
    handleSelectProject: (project: Project | null) =>
      handleSelectProjectFn({ activeConversationId, setConversationProject, setShowProjectSelector }, project),
    handleGenerateImageFromMessage: async (prompt: string) => {
      if (!activeConversationId || !activeImageModel) {
        setAlertState(showAlert('No Image Model', 'Please load an image model first from the Models screen.'));
        return;
      }
      await handleImageGenerationFn(genDeps, { prompt, conversationId: activeConversationId, skipUserMessage: true });
    },
    handleImagePress: (uri: string) => setViewerImageUri(uri),
    handleSaveImage: () => saveImageToGallery(viewerImageUri, setAlertState),
  };
};
