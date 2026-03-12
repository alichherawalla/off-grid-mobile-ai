/* eslint-disable max-lines, complexity */
import React, { useEffect, useState, useMemo } from 'react';
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
import { useAppStore, useRemoteServerStore } from '../../stores';
import { DownloadedModel, ONNXImageModel, RemoteModel } from '../../types';
import { activeModelService, hardwareService, remoteServerManager } from '../../services';
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
  remoteModels: Array<{ serverId: string; serverName: string; models: RemoteModel[] }>;
  currentModelPath: string | null;
  currentRemoteModelId: string | null;
  isAnyLoading: boolean;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectRemoteModel: (model: RemoteModel, serverId: string) => void;
  onUnloadModel: () => void;
  onAddServer: () => void;
}

const TextTab: React.FC<TextTabProps> = ({
  downloadedModels, remoteModels, currentModelPath, currentRemoteModelId, isAnyLoading, onSelectModel, onUnloadModel, onSelectRemoteModel, onAddServer,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoaded = currentModelPath !== null || currentRemoteModelId !== null;
  const activeLocalModel = downloadedModels.find(m => m.filePath === currentModelPath);

  // Find active remote model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!currentRemoteModelId) return null;
    for (const group of remoteModels) {
      const model = group.models.find(m => m.id === currentRemoteModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteModels, currentRemoteModelId]);

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
                {activeLocalModel?.name || activeRemoteModelInfo?.model?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeLocalModel
                  ? `${activeLocalModel.quantization} • ${hardwareService.formatModelSize(activeLocalModel)}`
                  : activeRemoteModelInfo
                    ? `Remote • ${activeRemoteModelInfo.serverName}`
                    : 'Remote Model'}
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

      {/* Empty state when no models at all */}
      {downloadedModels.length === 0 && remoteModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="package" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Text Models</Text>
          <Text style={styles.emptyText}>Download models from the Models tab</Text>
        </View>
      )}

      {/* Local Models Section */}
      {downloadedModels.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="hard-drive" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Local Models</Text>
          </View>
          {downloadedModels.map((model) => {
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
          })}
        </>
      )}

      {/* Remote Models Sections */}
      {remoteModels.map(({ serverId, serverName, models }) => (
        <View key={serverId}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="wifi" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>{serverName}</Text>
          </View>
          {models.map((model) => {
            const isCurrent = currentRemoteModelId === model.id;
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelItem, isCurrent && styles.modelItemSelectedRemote]}
                onPress={() => onSelectRemoteModel(model, serverId)}
                disabled={isAnyLoading || isCurrent}
              >
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedRemote]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <View style={styles.modelMeta}>
                    <Text style={styles.remoteBadge}>Remote</Text>
                    {model.capabilities.supportsVision && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <View style={styles.visionBadge}>
                          <Icon name="eye" size={10} color={colors.info} />
                          <Text style={styles.visionBadgeText}>Vision</Text>
                        </View>
                      </>
                    )}
                    {model.capabilities.supportsToolCalling && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <View style={styles.toolBadge}>
                          <Icon name="tool" size={10} color={colors.warning} />
                        </View>
                      </>
                    )}
                  </View>
                </View>
                {isCurrent && (
                  <View style={styles.checkmarkRemote}>
                    <Icon name="check" size={16} color={colors.background} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* Add Server Button */}
      <TouchableOpacity style={styles.addServerButton} onPress={onAddServer}>
        <Icon name="plus" size={16} color={colors.primary} />
        <Text style={styles.addServerButtonText}>Add Remote Server</Text>
      </TouchableOpacity>
    </>
  );
};

// ─── Image tab ───────────────────────────────────────────────────────────────

interface ImageTabProps {
  downloadedImageModels: ONNXImageModel[];
  remoteVisionModels: Array<{ serverId: string; serverName: string; models: RemoteModel[] }>;
  activeImageModelId: string | null;
  activeRemoteImageModelId: string | null;
  isAnyLoading: boolean;
  isLoadingImage: boolean;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onSelectRemoteVisionModel: (model: RemoteModel, serverId: string) => void;
  onUnloadImageModel: () => void;
}

const ImageTab: React.FC<ImageTabProps> = ({
  downloadedImageModels, remoteVisionModels, activeImageModelId, activeRemoteImageModelId, isAnyLoading, isLoadingImage,
  onSelectImageModel, onUnloadImageModel, onSelectRemoteVisionModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoaded = !!activeImageModelId || !!activeRemoteImageModelId;
  const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);

  // Find active remote vision model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!activeRemoteImageModelId) return null;
    for (const group of remoteVisionModels) {
      const model = group.models.find(m => m.id === activeRemoteImageModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteVisionModels, activeRemoteImageModelId]);

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
                {activeModel?.name || activeRemoteModelInfo?.model?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeModel
                  ? `${activeModel.style || 'Image'} • ${hardwareService.formatBytes(activeModel.size ?? 0)}`
                  : activeRemoteModelInfo
                    ? `Remote • ${activeRemoteModelInfo.serverName}`
                    : 'Remote Model'}
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

      {/* Local Image Models */}
      {downloadedImageModels.length === 0 && remoteVisionModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="image" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Image Models</Text>
          <Text style={styles.emptyText}>Download image models from the Models tab</Text>
        </View>
      )}

      {downloadedImageModels.length > 0 && (
        <>
          <Text style={styles.sectionSubTitle}>📁 Local Models</Text>
          {downloadedImageModels.map((model) => {
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
          })}
        </>
      )}

      {/* Remote Vision Models */}
      {remoteVisionModels.map(({ serverId, serverName, models }) => (
        <View key={serverId}>
          <Text style={styles.sectionSubTitle}>🌐 {serverName}</Text>
          {models.map((model) => {
            const isCurrent = activeRemoteImageModelId === model.id;
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelItem, isCurrent && styles.modelItemSelectedImage]}
                onPress={() => onSelectRemoteVisionModel(model, serverId)}
                disabled={isAnyLoading || isCurrent}
              >
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedImage]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <View style={styles.modelMeta}>
                    <Text style={styles.remoteBadge}>Remote</Text>
                    <Text style={styles.metaSeparator}>•</Text>
                    <View style={styles.visionBadge}>
                      <Icon name="eye" size={10} color={colors.info} />
                      <Text style={styles.visionBadgeText}>Vision</Text>
                    </View>
                  </View>
                </View>
                {isCurrent && (
                  <View style={[styles.checkmark, styles.checkmarkImage]}>
                    <Icon name="check" size={16} color={colors.background} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
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
  const {
    servers,
    discoveredModels,
    serverHealth,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    setActiveRemoteImageModelId,
  } = useRemoteServerStore();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [showAddServerModal, setShowAddServerModal] = useState(false);

  useEffect(() => {
    if (visible) setActiveTab(initialTab);
  }, [visible, initialTab]);

  // Group remote models by server for TextTab — exclude servers known to be offline
  const remoteTextModels = useMemo(() => {
    return servers
      .filter(server => serverHealth[server.id]?.isHealthy !== false)
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: discoveredModels[server.id] || [],
      })).filter(group => group.models.length > 0);
  }, [servers, discoveredModels, serverHealth]);

  // Group remote vision models by server for ImageTab — exclude servers known to be offline
  const remoteVisionModels = useMemo(() => {
    return servers
      .filter(server => serverHealth[server.id]?.isHealthy !== false)
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: (discoveredModels[server.id] || []).filter(m => m.capabilities.supportsVision),
      })).filter(group => group.models.length > 0);
  }, [servers, discoveredModels, serverHealth]);

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;
    setIsLoadingImage(true);
    try {
      await activeModelService.loadImageModel(model.id);
      // Clear remote selection when selecting local
      setActiveRemoteImageModelId(null);
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
      setActiveRemoteImageModelId(null);
      onUnloadImageModel?.();
    } catch (error) {
      logger.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  // Handle selecting a remote text model
  const handleSelectRemoteTextModel = async (model: RemoteModel, serverId: string) => {
    try {
      await remoteServerManager.setActiveRemoteTextModel(serverId, model.id);
    } catch (error) {
      logger.error('[ModelSelectorModal] Failed to set remote text model:', error);
      Alert.alert('Failed to Select Model', (error as Error).message);
    }
  };

  // Handle selecting a remote vision model
  const handleSelectRemoteVisionModel = async (model: RemoteModel, serverId: string) => {
    try {
      await remoteServerManager.setActiveRemoteImageModel(serverId, model.id);
    } catch (error) {
      logger.error('[ModelSelectorModal] Failed to set remote vision model:', error);
      Alert.alert('Failed to Select Model', (error as Error).message);
    }
  };

  // Handle selecting a local model - clear remote selection
  const handleSelectLocalModel = (model: DownloadedModel) => {
    remoteServerManager.clearActiveRemoteModel();
    onSelectModel(model);
  };

  // Handle unload - also clear remote selection
  const handleUnloadModel = () => {
    remoteServerManager.clearActiveRemoteModel();
    onUnloadModel();
  };

  const isAnyLoading = isLoading || isLoadingImage;
  const hasLoadedTextModel = currentModelPath !== null || activeRemoteTextModelId !== null;
  const hasLoadedImageModel = !!activeImageModelId || activeRemoteImageModelId !== null;

  return (
    <>
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
              remoteModels={remoteTextModels}
              currentModelPath={currentModelPath}
              currentRemoteModelId={activeRemoteTextModelId}
              isAnyLoading={isAnyLoading}
              onSelectModel={handleSelectLocalModel}
              onSelectRemoteModel={handleSelectRemoteTextModel}
              onUnloadModel={handleUnloadModel}
              onAddServer={() => setShowAddServerModal(true)}
            />
          ) : (
            <ImageTab
              downloadedImageModels={downloadedImageModels}
              remoteVisionModels={remoteVisionModels}
              activeImageModelId={activeImageModelId}
              activeRemoteImageModelId={activeRemoteImageModelId}
              isAnyLoading={isAnyLoading}
              isLoadingImage={isLoadingImage}
              onSelectImageModel={handleSelectImageModel}
              onSelectRemoteVisionModel={handleSelectRemoteVisionModel}
              onUnloadImageModel={handleUnloadImageModel}
            />
          )}
        </ScrollView>
      </AppSheet>

      {/* Add Server Modal - will be implemented in separate component */}
      {showAddServerModal && (
        <View>
          {/* RemoteServerModal will be added here */}
        </View>
      )}
    </>
  );
};
