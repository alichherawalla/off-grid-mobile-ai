import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { LoadingState } from '../hooks/useHomeScreen';

type TextModelCardProps = {
  loadingState: LoadingState;
  activeTextModel: DownloadedModel | undefined;
  downloadedModels: DownloadedModel[];
  onPress: () => void;
};

const TextModelCard: React.FC<TextModelCardProps> = ({
  loadingState,
  activeTextModel,
  downloadedModels,
  onPress,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isLoading = loadingState.isLoading && loadingState.type === 'text';

  return (
    <AnimatedPressable style={styles.modelCard} onPress={onPress} hapticType="selection">
      <View style={styles.modelCardHeader}>
        <Icon name="message-square" size={16} color={colors.textMuted} />
        <Text style={styles.modelCardLabel}>Text</Text>
        {isLoading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Icon name="chevron-down" size={14} color={colors.textMuted} />}
      </View>
      {isLoading ? (
        <>
          <Text style={styles.modelCardName} numberOfLines={1}>
            {loadingState.modelName || 'Unloading...'}
          </Text>
          <Text style={styles.modelCardLoading}>Loading...</Text>
        </>
      ) : activeTextModel ? (
        <>
          <Text style={styles.modelCardName} numberOfLines={1}>{activeTextModel.name}</Text>
          <Text style={styles.modelCardMeta}>
            {activeTextModel.quantization} · ~{(((activeTextModel.fileSize + (activeTextModel.mmProjFileSize || 0)) * 1.5) / (1024 * 1024 * 1024)).toFixed(1)} GB
          </Text>
        </>
      ) : (
        <Text style={styles.modelCardEmpty}>
          {downloadedModels.length > 0 ? 'Tap to select' : 'No models'}
        </Text>
      )}
    </AnimatedPressable>
  );
};

type ImageModelCardProps = {
  loadingState: LoadingState;
  activeImageModel: ONNXImageModel | undefined;
  downloadedImageModels: ONNXImageModel[];
  onPress: () => void;
};

const ImageModelCard: React.FC<ImageModelCardProps> = ({
  loadingState,
  activeImageModel,
  downloadedImageModels,
  onPress,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isLoading = loadingState.isLoading && loadingState.type === 'image';

  return (
    <AnimatedPressable
      style={styles.modelCard}
      onPress={onPress}
      testID="image-model-card"
      hapticType="selection"
    >
      <View style={styles.modelCardHeader}>
        <Icon name="image" size={16} color={colors.textMuted} />
        <Text style={styles.modelCardLabel}>Image</Text>
        {isLoading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Icon name="chevron-down" size={14} color={colors.textMuted} />}
      </View>
      {isLoading ? (
        <>
          <Text style={styles.modelCardName} numberOfLines={1}>
            {loadingState.modelName || 'Unloading...'}
          </Text>
          <Text style={styles.modelCardLoading}>Loading...</Text>
        </>
      ) : activeImageModel ? (
        <>
          <Text style={styles.modelCardName} numberOfLines={1}>{activeImageModel.name}</Text>
          <Text style={styles.modelCardMeta}>
            {activeImageModel.style || 'Ready'} · ~{((activeImageModel.size * 1.8) / (1024 * 1024 * 1024)).toFixed(1)} GB
          </Text>
        </>
      ) : (
        <Text style={styles.modelCardEmpty}>
          {downloadedImageModels.length > 0 ? 'Tap to select' : 'No models'}
        </Text>
      )}
    </AnimatedPressable>
  );
};

type Props = {
  loadingState: LoadingState;
  activeTextModel: DownloadedModel | undefined;
  activeImageModel: ONNXImageModel | undefined;
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
  activeModelId: string | null;
  activeImageModelId: string | null;
  isEjecting: boolean;
  onPressTextModel: () => void;
  onPressImageModel: () => void;
  onEjectAll: () => void;
};

export const ActiveModelsSection: React.FC<Props> = ({
  loadingState,
  activeTextModel,
  activeImageModel,
  downloadedModels,
  downloadedImageModels,
  activeModelId,
  activeImageModelId,
  isEjecting,
  onPressTextModel,
  onPressImageModel,
  onEjectAll,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <View style={styles.modelsRow}>
        <TextModelCard
          loadingState={loadingState}
          activeTextModel={activeTextModel}
          downloadedModels={downloadedModels}
          onPress={onPressTextModel}
        />
        <ImageModelCard
          loadingState={loadingState}
          activeImageModel={activeImageModel}
          downloadedImageModels={downloadedImageModels}
          onPress={onPressImageModel}
        />
      </View>
      {(activeModelId || activeImageModelId) && (
        <TouchableOpacity
          style={styles.ejectAllButton}
          onPress={onEjectAll}
          disabled={isEjecting || loadingState.isLoading}
        >
          {isEjecting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <>
              <Icon name="power" size={14} color={colors.error} />
              <Text style={styles.ejectAllText}>Eject All Models</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </>
  );
};
