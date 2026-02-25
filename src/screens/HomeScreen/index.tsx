import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, CustomAlert, hideAlert } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import { useThemedStyles } from '../../theme';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="home-screen" style={styles.scrollView}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Off Grid</Text>
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
            onPress={() => (navigation as any).navigate('Gallery')}
            hapticType="selection"
          >
            <Icon name="grid" size={18} color={colors.primary} />
            <View style={styles.galleryCardInfo}>
              <Text style={styles.galleryCardTitle}>Image Gallery</Text>
              <Text style={styles.galleryCardMeta}>
                {generatedImages.length} image{generatedImages.length !== 1 ? 's' : ''}
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
    </SafeAreaView>
  );
};
