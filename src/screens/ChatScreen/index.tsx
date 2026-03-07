import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Keyboard, KeyboardAvoidingView, ActivityIndicator, InteractionManager } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { ChatInput, CustomAlert, hideAlert, ToolPickerSheet, ThinkingIndicator, SharePromptSheet } from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { consumePendingSpotlight } from '../../components/onboarding/spotlightState';
import { subscribeSharePrompt } from '../../utils/sharePrompt';
import { VOICE_HINT_STEP_INDEX, IMAGE_SETTINGS_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { useAppStore } from '../../stores/appStore';
import type { Conversation, Message } from '../../types';
import { useTheme, useThemedStyles } from '../../theme';
import { llmService, generationService } from '../../services';
import { createStyles } from './styles';
import { useChatScreen, getPlaceholderText } from './useChatScreen';
import { MessageRenderer } from './MessageRenderer';
import {
  NoModelScreen, LoadingScreen, ChatHeader, EmptyChat, ImageProgressIndicator,
} from './ChatScreenComponents';
import { ChatModalSection } from './ChatModalSection';

function countConversationImages(conv: Conversation | undefined): number {
  return (conv?.messages || []).reduce((n: number, m: Message) =>
    n + (m.attachments?.filter((a) => a.type === 'image').length || 0), 0);
}

export const ChatScreen: React.FC = () => {
  const flatListRef = React.useRef<FlatList>(null);
  const isNearBottomRef = React.useRef(true);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const chat = useChatScreen();
  const { goTo, current } = useSpotlightTour();
  const pendingNextRef = useRef<number | null>(null);

  // Share prompt sheet
  const [sharePromptVisible, setSharePromptVisible] = useState(false);
  useEffect(() => subscribeSharePrompt(() => setSharePromptVisible(true)), []);

  // Only ONE AttachStep mounted at a time to avoid waypoint dots/lines.
  // chatSpotlight controls which index is active (3, 12, 15, or 16).
  const [chatSpotlight, setChatSpotlight] = useState<number | null>(null);

  // Reactive spotlight state
  const onboardingChecklist = useAppStore(s => s.onboardingChecklist);
  const shownSpotlights = useAppStore(s => s.shownSpotlights);
  const markSpotlightShown = useAppStore(s => s.markSpotlightShown);

  // Track whether step 3 has been shown so we know when it stops
  const step3ShownRef = useRef(false);

  // If user arrived here via onboarding spotlight flow, show input spotlight
  useEffect(() => {
    const pending = consumePendingSpotlight();
    if (pending === 3) {
      // Chain: step 3 (ChatInput) → step 12 (VoiceRecordButton)
      pendingNextRef.current = VOICE_HINT_STEP_INDEX;
      step3ShownRef.current = false;
      const task = InteractionManager.runAfterInteractions(() => {
        step3ShownRef.current = true;
        goTo(3);
      });
      return () => task.cancel();
    } else if (pending !== null) {
      const task = InteractionManager.runAfterInteractions(() => goTo(pending));
      return () => task.cancel();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether we're in the middle of chaining to avoid premature cleanup
  const chainingRef = useRef(false);

  // When the spotlight tour stops after step 3, fire the chained step 12
  useEffect(() => {
    if (current === undefined && step3ShownRef.current && pendingNextRef.current !== null) {
      step3ShownRef.current = false;
      chainingRef.current = true;
      const next = pendingNextRef.current;
      pendingNextRef.current = null;
      // Switch AttachStep index — need time for new AttachStep to mount + measure layout
      setChatSpotlight(next);
      setTimeout(() => {
        chainingRef.current = false;
        goTo(next);
      }, 800);
    } else if (current === undefined && !chainingRef.current && !step3ShownRef.current && pendingNextRef.current === null) {
      // Tour stopped and no chain pending — clear spotlight
      setChatSpotlight(null);
    }
  }, [current, goTo]);

  // Consume pending spotlights on focus (handles reused screen instances where
  // the mount-only useEffect above won't re-fire after navigation).
  useFocusEffect(
    useCallback(() => {
      const pending = consumePendingSpotlight();
      if (pending !== null) {
        const task = InteractionManager.runAfterInteractions(() => goTo(pending));
        return () => task.cancel();
      }
    }, [goTo]),
  );

  // Reactive: after first image generated → spotlight image mode toggle (step 16)
  const generatedImages = useAppStore(s => s.generatedImages);
  useEffect(() => {
    if (
      generatedImages.length > 0 &&
      !shownSpotlights.imageSettings &&
      onboardingChecklist.triedImageGen
    ) {
      markSpotlightShown('imageSettings');
      // No cleanup — markSpotlightShown guards against double-firing, and returning
      // a cleanup here would cancel the task when the store update re-triggers the effect.
      InteractionManager.runAfterInteractions(() => goTo(IMAGE_SETTINGS_STEP_INDEX));
    }
  }, [generatedImages.length, shownSpotlights, onboardingChecklist.triedImageGen, markSpotlightShown, goTo]);

  React.useEffect(() => {
    if (chat.activeConversation?.messages.length && isNearBottomRef.current) {
      setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 100);
    }
  }, [chat.activeConversation?.messages.length]);

  const alertEl = (
    <CustomAlert
      visible={chat.alertState.visible}
      title={chat.alertState.title}
      message={chat.alertState.message}
      buttons={chat.alertState.buttons}
      onClose={() => chat.setAlertState(hideAlert())}
    />
  );

  if (!chat.activeModelId || !chat.activeModel) {
    return (
      <>
        <NoModelScreen
          styles={styles} colors={colors}
          navigation={chat.navigation}
          downloadedModelsCount={chat.downloadedModels.length}
          showModelSelector={chat.showModelSelector}
          setShowModelSelector={chat.setShowModelSelector}
          onSelectModel={chat.handleModelSelect}
          onUnloadModel={chat.handleUnloadModel}
          isModelLoading={chat.isModelLoading}
        />
        {alertEl}
      </>
    );
  }

  if (chat.isModelLoading) {
    const sizeSource = chat.loadingModel ?? chat.activeModel;
    return (
      <>
        <LoadingScreen
          styles={styles} colors={colors}
          navigation={chat.navigation}
          loadingModelName={chat.loadingModel?.name || chat.activeModel.name}
          modelSize={sizeSource ? chat.hardwareService.formatModelSize(sizeSource) : ''}
          hasVision={!!(chat.loadingModel?.mmProjPath || chat.activeModel.mmProjPath)}
        />
        {alertEl}
      </>
    );
  }

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    isNearBottomRef.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 100;
    chat.setShowScrollToBottom(!isNearBottomRef.current);
  };

  const renderItem = ({ item, index }: { item: any; index: number }) => (
    <MessageRenderer
      item={item} index={index}
      displayMessagesLength={chat.displayMessages.length}
      animateLastN={chat.animateLastN}
      imageModelLoaded={chat.imageModelLoaded}
      isStreaming={chat.isStreaming}
      isGeneratingImage={chat.isGeneratingImage}
      showGenerationDetails={chat.settings.showGenerationDetails}
      onCopy={chat.handleCopyMessage}
      onRetry={chat.handleRetryMessage}
      onEdit={chat.handleEditMessage}
      onGenerateImage={chat.handleGenerateImageFromMessage}
      onImagePress={chat.handleImagePress}
    />
  );

  const imageCount = countConversationImages(chat.activeConversation);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView testID="chat-screen" style={styles.keyboardView} behavior="padding" keyboardVerticalOffset={0}>
        <ChatHeader
          styles={styles} colors={colors}
          activeConversation={chat.activeConversation}
          activeModel={chat.activeModel}
          activeImageModel={chat.activeImageModel}
          navigation={chat.navigation}
          setShowModelSelector={chat.setShowModelSelector}
          setShowSettingsPanel={chat.setShowSettingsPanel}
        />
        <ChatMessageArea
          flatListRef={flatListRef}
          isNearBottomRef={isNearBottomRef}
          chat={chat}
          styles={styles}
          colors={colors}
          handleScroll={handleScroll}
          renderItem={renderItem}
          chatSpotlight={chatSpotlight}
        />
        <ChatModalSection
          styles={styles} colors={colors}
          showProjectSelector={chat.showProjectSelector}
          setShowProjectSelector={chat.setShowProjectSelector}
          showDebugPanel={chat.showDebugPanel}
          setShowDebugPanel={chat.setShowDebugPanel}
          showModelSelector={chat.showModelSelector}
          setShowModelSelector={chat.setShowModelSelector}
          showSettingsPanel={chat.showSettingsPanel}
          setShowSettingsPanel={chat.setShowSettingsPanel}
          debugInfo={chat.debugInfo}
          activeProject={chat.activeProject}
          activeConversation={chat.activeConversation}
          settings={chat.settings}
          projects={chat.projects}
          handleSelectProject={chat.handleSelectProject}
          handleModelSelect={chat.handleModelSelect}
          handleUnloadModel={chat.handleUnloadModel}
          handleDeleteConversation={chat.handleDeleteConversation}
          isModelLoading={chat.isModelLoading}
          imageCount={imageCount}
          activeConversationId={chat.activeConversationId}
          navigation={chat.navigation}
          viewerImageUri={chat.viewerImageUri}
          setViewerImageUri={chat.setViewerImageUri}
          handleSaveImage={chat.handleSaveImage}
        />
      </KeyboardAvoidingView>
      {alertEl}
      <SharePromptSheet visible={sharePromptVisible} onClose={() => setSharePromptVisible(false)} />
    </SafeAreaView>
  );
};

/** Conditionally wraps children in AttachStep. When index is null, renders children directly. */
type ChatMessageAreaProps = {
  flatListRef: React.RefObject<FlatList | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  chat: ReturnType<typeof useChatScreen>;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  handleScroll: (event: any) => void;
  renderItem: (info: { item: any; index: number }) => React.JSX.Element;
  chatSpotlight: number | null;
};

const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  flatListRef, isNearBottomRef, chat, styles, colors, handleScroll, renderItem, chatSpotlight,
}) => (
  <>
    {chat.displayMessages.length === 0 ? (
      <EmptyChat
        styles={styles} colors={colors}
        activeModel={chat.activeModel}
        activeProject={chat.activeProject}
        setShowProjectSelector={chat.setShowProjectSelector}
      />
    ) : (
      <FlatList
        ref={flatListRef}
        data={chat.displayMessages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        onScroll={handleScroll}
        onContentSizeChange={(_w, _h) => { if (isNearBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false }); }}
        onLayout={() => {}}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onTouchStart={() => Keyboard.dismiss()}
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 100 }}
      />
    )}
    {chat.showScrollToBottom && chat.displayMessages.length > 0 && (
      <Animated.View entering={FadeIn.duration(150)} style={styles.scrollToBottomContainer}>
        <AnimatedPressable hapticType="impactLight" style={styles.scrollToBottomButton} onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}>
          <Icon name="chevron-down" size={20} color={colors.textSecondary} />
        </AnimatedPressable>
      </Animated.View>
    )}
    {chat.isGeneratingImage && (
      <ImageProgressIndicator
        styles={styles} colors={colors}
        imagePreviewPath={chat.imagePreviewPath}
        imageGenerationStatus={chat.imageGenerationStatus}
        imageGenerationProgress={chat.imageGenerationProgress}
        onStop={chat.handleStop}
      />
    )}
    {chat.isClassifying && (
      <View style={styles.classifyingBar}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.classifyingText}>Understanding your request...</Text>
      </View>
    )}
    {chat.isCompacting && (
      <Animated.View entering={FadeIn.duration(200)} style={styles.classifyingBar}>
        <ThinkingIndicator text="Compacting your conversation..." />
      </Animated.View>
    )}
    {/* Steps 3/15 share the same AttachStep wrapping ChatInput (multi-index).
         Steps 12/16 are handled inside ChatInput via activeSpotlight prop. */}
    <AttachStep index={[3, 15]} fill>
      <ChatInput
        onSend={chat.handleSend}
        onStop={chat.handleStop}
        disabled={!llmService.isModelLoaded()}
        isGenerating={chat.isStreaming || chat.isThinking}
        supportsVision={chat.supportsVision}
        conversationId={chat.activeConversationId}
        imageModelLoaded={chat.imageModelLoaded}
        onOpenSettings={() => chat.setShowSettingsPanel(true)}
        queueCount={chat.queueCount}
        queuedTexts={chat.queuedTexts}
        onClearQueue={() => generationService.clearQueue()}
        placeholder={getPlaceholderText(llmService.isModelLoaded(), chat.supportsVision)}
        onToolsPress={() => chat.setShowToolPicker(true)}
        enabledToolCount={chat.enabledTools.length}
        supportsToolCalling={chat.supportsToolCalling}
        supportsThinking={chat.supportsThinking}
        activeSpotlight={chatSpotlight === 12 ? chatSpotlight : null}
      />
    </AttachStep>
    <ToolPickerSheet
      visible={chat.showToolPicker}
      onClose={() => chat.setShowToolPicker(false)}
      enabledTools={chat.enabledTools}
      onToggleTool={chat.handleToggleTool}
    />
  </>
);
