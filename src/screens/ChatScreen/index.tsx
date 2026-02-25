import React from 'react';
import { View, Text, FlatList, Keyboard, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ChatInput, CustomAlert, hideAlert, ToolPickerSheet } from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import { llmService, generationService } from '../../services';
import { createStyles } from './styles';
import { useChatScreen, getPlaceholderText } from './useChatScreen';
import { MessageRenderer } from './MessageRenderer';
import {
  NoModelScreen, LoadingScreen, ChatHeader, EmptyChat, ImageProgressIndicator,
} from './ChatScreenComponents';
import { ChatModalSection } from './ChatModalSection';

function countConversationImages(activeConversation: any): number {
  const messages = activeConversation?.messages || [];
  let count = 0;
  for (const msg of messages) {
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === 'image') count++;
      }
    }
  }
  return count;
}

export const ChatScreen: React.FC = () => {
  const flatListRef = React.useRef<FlatList>(null);
  const isNearBottomRef = React.useRef(true);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const chat = useChatScreen();

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
    <SafeAreaView style={styles.container} edges={['top']}>
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
    </SafeAreaView>
  );
};

type ChatMessageAreaProps = {
  flatListRef: React.RefObject<FlatList | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  chat: ReturnType<typeof useChatScreen>;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  handleScroll: (event: any) => void;
  renderItem: (info: { item: any; index: number }) => React.JSX.Element;
};

const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  flatListRef, isNearBottomRef, chat, styles, colors, handleScroll, renderItem,
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
    />
    <ToolPickerSheet
      visible={chat.showToolPicker}
      onClose={() => chat.setShowToolPicker(false)}
      enabledTools={chat.enabledTools}
      onToggleTool={chat.handleToggleTool}
    />
  </>
);
