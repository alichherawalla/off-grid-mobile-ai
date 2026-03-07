import React, { useCallback, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSpotlightTour } from 'react-native-spotlight-tour';
import { Button, Card, CustomAlert, hideAlert } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { OnboardingSheet } from '../../components/onboarding/OnboardingSheet';
import { PulsatingIcon } from '../../components/onboarding/PulsatingIcon';
import { useOnboardingSheet } from '../../components/onboarding/useOnboardingSheet';
import { STEP_TAB_MAP, STEP_INDEX_MAP, CHAT_INPUT_STEP_INDEX, MODEL_SETTINGS_STEP_INDEX, PROJECT_EDIT_STEP_INDEX, DOWNLOAD_FILE_STEP_INDEX, MODEL_PICKER_STEP_INDEX, IMAGE_LOAD_STEP_INDEX, IMAGE_DOWNLOAD_STEP_INDEX, IMAGE_NEW_CHAT_STEP_INDEX, IMAGE_DRAW_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { setPendingSpotlight } from '../../components/onboarding/spotlightState';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import Icon from 'react-native-vector-icons/Feather';
import { useAppStore } from '../../stores/appStore';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';
import { useHomeScreen, HomeScreenNavigationProp } from './hooks/useHomeScreen';
import { ActiveModelsSection } from './components/ActiveModelsSection';
import { RecentConversations } from './components/RecentConversations';
import { ModelPickerSheet } from './components/ModelPickerSheet';
import { LoadingOverlay } from './components/LoadingOverlay';

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { sheetVisible, openSheet, closeSheet, showIcon } = useOnboardingSheet();
  const { goTo } = useSpotlightTour();

  const {
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
  } = useHomeScreen(navigation);

  // Reactive spotlight state for image gen flow
  const onboardingChecklist = useAppStore(s => s.onboardingChecklist);
  const shownSpotlights = useAppStore(s => s.shownSpotlights);
  const markSpotlightShown = useAppStore(s => s.markSpotlightShown);

  const handleStepPress = useCallback((stepId: string) => {
    closeSheet();

    // Image gen flow is state-aware: skip steps the user has already completed.
    if (stepId === 'triedImageGen') {
      if (activeImageModelId) {
        // Model already loaded → go straight to "start a new chat"
        // Queue step 15 so ChatScreen picks it up when "New Chat" is tapped
        setPendingSpotlight(IMAGE_DRAW_STEP_INDEX);
        navigation.navigate('ChatsTab' as any);
        setTimeout(() => goTo(IMAGE_NEW_CHAT_STEP_INDEX), 800);
      } else if (downloadedImageModels.length > 0) {
        // Model downloaded but not loaded → spotlight "load your image model" on HomeScreen
        markSpotlightShown('imageLoad');
        setTimeout(() => goTo(IMAGE_LOAD_STEP_INDEX), 600);
      } else {
        // No image model yet → navigate to ModelsTab and spotlight Image Models tab
        setPendingSpotlight(IMAGE_DOWNLOAD_STEP_INDEX);
        navigation.navigate('ModelsTab' as any);
        const idx = STEP_INDEX_MAP[stepId];
        if (idx !== undefined) setTimeout(() => goTo(idx), 800);
      }
      return;
    }

    const tab = STEP_TAB_MAP[stepId];
    const stepIndex = STEP_INDEX_MAP[stepId];

    // For multi-step flows, queue the continuation step.
    const pendingMap: Record<string, number> = {
      downloadedModel: DOWNLOAD_FILE_STEP_INDEX, loadedModel: MODEL_PICKER_STEP_INDEX,
      sentMessage: CHAT_INPUT_STEP_INDEX, exploredSettings: MODEL_SETTINGS_STEP_INDEX,
      createdProject: PROJECT_EDIT_STEP_INDEX,
    };
    if (pendingMap[stepId] !== undefined) setPendingSpotlight(pendingMap[stepId]);

    // Navigate to the correct tab
    if (tab && tab !== 'HomeTab') {
      navigation.navigate(tab as any);
    }

    // Delay spotlight to allow sheet close + navigation transition to complete.
    // Cross-tab navigations need more time for the target screen to mount and
    // measure AttachStep layout; 800ms covers sheet-close + tab-switch animation.
    if (stepIndex !== undefined) {
      const delay = tab && tab !== 'HomeTab' ? 800 : 600;
      setTimeout(() => goTo(stepIndex), delay);
    }
  }, [closeSheet, navigation, goTo, activeImageModelId, downloadedImageModels.length, markSpotlightShown]);

  // Reactive: image model downloaded but not loaded → spotlight ImageModelCard (step 13)
  useEffect(() => {
    if (
      downloadedImageModels.length > 0 &&
      !activeImageModelId &&
      !shownSpotlights.imageLoad &&
      !onboardingChecklist.triedImageGen
    ) {
      markSpotlightShown('imageLoad');
      setTimeout(() => goTo(IMAGE_LOAD_STEP_INDEX), 800);
    }
  }, [downloadedImageModels.length, activeImageModelId, shownSpotlights, onboardingChecklist.triedImageGen, markSpotlightShown, goTo]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="home-screen" style={styles.scrollView}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Off Grid</Text>
            {showIcon && <PulsatingIcon onPress={openSheet} />}
          </View>

          {/* Active Models Section */}
          <AnimatedEntry index={0} staggerMs={50} trigger={focusTrigger}>
            <ActiveModelsSection
              loadingState={loadingState}
              activeTextModel={activeTextModel}
              activeImageModel={activeImageModel}
              downloadedModels={downloadedModels}
              downloadedImageModels={downloadedImageModels}
              activeModelId={activeModelId}
              activeImageModelId={activeImageModelId}
              isEjecting={isEjecting}
              onPressTextModel={() => setPickerType('text')}
              onPressImageModel={() => setPickerType('image')}
              onEjectAll={handleEjectAll}
            />
          </AnimatedEntry>

          {/* New Chat Button */}
          {activeTextModel ? (
            <Button
              title="New Chat"
              onPress={startNewChat}
              style={styles.newChatButton}
              testID="new-chat-button"
            />
          ) : (
            <Card style={styles.setupCard} testID="setup-card">
              <Text style={styles.setupText}>
                {downloadedModels.length > 0
                  ? 'Select a text model to start chatting'
                  : 'Download a text model to start chatting'}
              </Text>
              <Button
                title={downloadedModels.length > 0 ? 'Select Model' : 'Browse Models'}
                variant="outline"
                size="small"
                onPress={() => downloadedModels.length > 0 ? setPickerType('text') : navigation.navigate('ModelsTab')}
                testID="browse-models-button"
              />
            </Card>
          )}

          {/* Recent Conversations */}
          {recentConversations.length > 0 && (
            <AnimatedEntry index={2} staggerMs={50} trigger={focusTrigger}>
              <RecentConversations
                conversations={recentConversations}
                focusTrigger={focusTrigger}
                onContinueChat={continueChat}
                onDeleteConversation={handleDeleteConversation}
                onSeeAll={() => navigation.navigate('ChatsTab')}
              />
            </AnimatedEntry>
          )}

          {/* Image Gallery */}
          <AnimatedPressable
            style={styles.galleryCard}
            onPress={() => navigation.navigate('Gallery')}
            hapticType="selection"
          >
            <Icon name="grid" size={18} color={colors.primary} />
            <View style={styles.galleryCardInfo}>
              <Text style={styles.galleryCardTitle}>Image Gallery</Text>
              <Text style={styles.galleryCardMeta}>
                {generatedImages.length} {generatedImages.length === 1 ? 'image' : 'images'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </AnimatedPressable>

          {/* Model Stats */}
          <AnimatedEntry index={3} staggerMs={50} trigger={focusTrigger}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{downloadedModels.length}</Text>
                <Text style={styles.statLabel}>Text models</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{downloadedImageModels.length}</Text>
                <Text style={styles.statLabel}>Image models</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{conversations.length}</Text>
                <Text style={styles.statLabel}>Chats</Text>
              </View>
            </View>
          </AnimatedEntry>
        </ScrollView>
      </View>

      {/* Model Picker Sheet */}
      <ModelPickerSheet
        pickerType={pickerType}
        loadingState={loadingState}
        downloadedModels={downloadedModels}
        downloadedImageModels={downloadedImageModels}
        activeModelId={activeModelId}
        activeImageModelId={activeImageModelId}
        memoryInfo={memoryInfo}
        onClose={() => setPickerType(null)}
        onSelectTextModel={handleSelectTextModel}
        onUnloadTextModel={handleUnloadTextModel}
        onSelectImageModel={handleSelectImageModel}
        onUnloadImageModel={handleUnloadImageModel}
        onBrowseModels={() => {
          setPickerType(null);
          navigation.navigate('ModelsTab');
        }}
      />

      {/* Full-screen loading overlay */}
      <LoadingOverlay loadingState={loadingState} />

      {/* Custom Alert Modal */}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />

      <OnboardingSheet
        visible={sheetVisible}
        onClose={closeSheet}
        onStepPress={handleStepPress}
      />
    </SafeAreaView>
  );
};
