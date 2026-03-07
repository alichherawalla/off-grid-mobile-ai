import React, { useEffect, useState } from 'react';
import {
  Alert,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { activeModelService, hardwareService } from '../../services';
import { createStyles } from './styles';
import logger from '../../utils/logger';

type TabType = 'text' | 'image';

interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectImageModel?: (model: ONNXImageModel) => void;
  onUnloadModel: () => void;
  onUnloadImageModel?: () => void;
  isLoading: boolean;
  currentModelPath: string | null;
  initialTab?: TabType;
}

// ─── Text tab ────────────────────────────────────────────────────────────────

interface TextTabProps {
  downloadedModels: DownloadedModel[];
  currentModelPath: string | null;
  isAnyLoading: boolean;
  onSelectModel: (model: DownloadedModel) => void;
  onUnloadModel: () => void;
}

const TextTab: React.FC<TextTabProps> = ({
  downloadedModels, currentModelPath, isAnyLoading, onSelectModel, onUnloadModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoaded = currentModelPath !== null;
  const activeModel = downloadedModels.find(m => m.filePath === currentModelPath);

  return (
    <>
      {hasLoaded && (
        <View style={styles.loadedSection}>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <View style={styles.loadedModelItem}>
            <View style={styles.loadedModelInfo}>
              <Text style={styles.loadedModelName} numberOfLines={1}>
                {activeModel?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeModel?.quantization} • {activeModel ? hardwareService.formatModelSize(activeModel) : '0 B'}
              </Text>
            </View>
            <TouchableOpacity style={styles.unloadButton} onPress={onUnloadModel} disabled={isAnyLoading}>
              <Icon name="power" size={16} color={colors.error} />
              <Text style={styles.unloadButtonText}>Unload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{hasLoaded ? 'Switch Model' : 'Available Models'}</Text>

      {downloadedModels.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="package" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Text Models</Text>
          <Text style={styles.emptyText}>Download models from the Models tab</Text>
        </View>
      ) : (
        downloadedModels.map((model) => {
          const isCurrent = currentModelPath === model.filePath;
          return (
            <TouchableOpacity
              key={model.id}
              style={[styles.modelItem, isCurrent && styles.modelItemSelected]}
              onPress={() => onSelectModel(model)}
              disabled={isAnyLoading || isCurrent}
            >
              <View style={styles.modelInfo}>
                <Text style={[styles.modelName, isCurrent && styles.modelNameSelected]} numberOfLines={1}>
                  {model.name}
                </Text>
                <View style={styles.modelMeta}>
                  <Text style={styles.modelSize}>{hardwareService.formatModelSize(model)}</Text>
                  {!!model.quantization && (
                    <>
                      <Text style={styles.metaSeparator}>•</Text>
                      <Text style={styles.modelQuant}>{model.quantization}</Text>
                    </>
                  )}
                  {model.isVisionModel && (
                    <>
                      <Text style={styles.metaSeparator}>•</Text>
                      <View style={styles.visionBadge}>
                        <Icon name="eye" size={10} color={colors.info} />
                        <Text style={styles.visionBadgeText}>Vision</Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
              {isCurrent && (
                <View style={styles.checkmark}>
                  <Icon name="check" size={16} color={colors.background} />
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}
    </>
  );
};

// ─── Image tab ───────────────────────────────────────────────────────────────

interface ImageTabProps {
  downloadedImageModels: ONNXImageModel[];
  activeImageModelId: string | null;
  isAnyLoading: boolean;
  isLoadingImage: boolean;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onUnloadImageModel: () => void;
}

const ImageTab: React.FC<ImageTabProps> = ({
  downloadedImageModels, activeImageModelId, isAnyLoading, isLoadingImage,
  onSelectImageModel, onUnloadImageModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoaded = !!activeImageModelId;
  const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);

  return (
    <>
      {hasLoaded && (
        <View style={[styles.loadedSection, styles.loadedSectionImage]}>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <View style={styles.loadedModelItem}>
            <View style={styles.loadedModelInfo}>
              <Text style={styles.loadedModelName} numberOfLines={1}>
                {activeModel?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeModel?.style || 'Image'} • {hardwareService.formatBytes(activeModel?.size ?? 0)}
              </Text>
            </View>
            <TouchableOpacity style={styles.unloadButton} onPress={onUnloadImageModel} disabled={isAnyLoading}>
              {isLoadingImage ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Icon name="power" size={16} color={colors.error} />
                  <Text style={styles.unloadButtonText}>Unload</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{hasLoaded ? 'Switch Model' : 'Available Models'}</Text>

      {downloadedImageModels.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="image" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Image Models</Text>
          <Text style={styles.emptyText}>Download image models from the Models tab</Text>
        </View>
      ) : (
        downloadedImageModels.map((model) => {
          const isCurrent = activeImageModelId === model.id;
          return (
            <TouchableOpacity
              key={model.id}
              style={[styles.modelItem, isCurrent && styles.modelItemSelectedImage]}
              onPress={() => onSelectImageModel(model)}
              disabled={isAnyLoading || isCurrent}
            >
              <View style={styles.modelInfo}>
                <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedImage]} numberOfLines={1}>
                  {model.name}
                </Text>
                <View style={styles.modelMeta}>
                  <Text style={styles.modelSize}>{hardwareService.formatBytes(model.size)}</Text>
                  {!!model.style && (
                    <>
                      <Text style={styles.metaSeparator}>•</Text>
                      <Text style={styles.modelStyle}>{model.style}</Text>
                    </>
                  )}
                </View>
              </View>
              {isCurrent && (
                <View style={[styles.checkmark, styles.checkmarkImage]}>
                  <Icon name="check" size={16} color={colors.background} />
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}
    </>
  );
};

// ─── Main modal ──────────────────────────────────────────────────────────────

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
  onSelectModel,
  onSelectImageModel,
  onUnloadModel,
  onUnloadImageModel,
  isLoading,
  currentModelPath,
  initialTab = 'text',
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { downloadedModels, downloadedImageModels, activeImageModelId } = useAppStore();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  useEffect(() => {
    if (visible) setActiveTab(initialTab);
  }, [visible, initialTab]);

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;
    setIsLoadingImage(true);
    try {
      await activeModelService.loadImageModel(model.id);
      onSelectImageModel?.(model);
    } catch (error) {
      logger.error('Failed to load image model:', error);
      Alert.alert('Failed to Load', (error as Error).message);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleUnloadImageModel = async () => {
    setIsLoadingImage(true);
    try {
      await activeModelService.unloadImageModel();
      onUnloadImageModel?.();
    } catch (error) {
      logger.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const isAnyLoading = isLoading || isLoadingImage;
  const hasLoadedTextModel = currentModelPath !== null;
  const hasLoadedImageModel = !!activeImageModelId;

  return (
    <AppSheet visible={visible} onClose={onClose} snapPoints={['40%', '75%']} title="Select Model">
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'text' && styles.tabActive]}
          onPress={() => setActiveTab('text')}
          disabled={isAnyLoading}
        >
          <Icon name="message-square" size={16} color={activeTab === 'text' ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>Text</Text>
          {hasLoadedTextModel && (
            <View style={styles.tabBadge}>
              <View style={styles.tabBadgeDot} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'image' && styles.tabActive]}
          onPress={() => setActiveTab('image')}
          disabled={isAnyLoading}
        >
          <Icon name="image" size={16} color={activeTab === 'image' ? colors.info : colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'image' && styles.tabTextActive, activeTab === 'image' && { color: colors.info }]}>
            Image
          </Text>
          {hasLoadedImageModel && (
            <View style={[styles.tabBadge, { backgroundColor: `${colors.info}30` }]}>
              <View style={[styles.tabBadgeDot, { backgroundColor: colors.info }]} />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {isAnyLoading && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading model...</Text>
        </View>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {activeTab === 'text' ? (
          <TextTab
            downloadedModels={downloadedModels}
            currentModelPath={currentModelPath}
            isAnyLoading={isAnyLoading}
            onSelectModel={onSelectModel}
            onUnloadModel={onUnloadModel}
          />
        ) : (
          <ImageTab
            downloadedImageModels={downloadedImageModels}
            activeImageModelId={activeImageModelId}
            isAnyLoading={isAnyLoading}
            isLoadingImage={isLoadingImage}
            onSelectImageModel={handleSelectImageModel}
            onUnloadImageModel={handleUnloadImageModel}
          />
        )}
      </ScrollView>
    </AppSheet>
  );
};
