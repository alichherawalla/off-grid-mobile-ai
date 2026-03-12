/* eslint-disable max-lines, max-lines-per-function, complexity */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../../components/AppSheet';
import { consumePendingSpotlight } from '../../../components/onboarding/spotlightState';
import { MODEL_PICKER_STEP_INDEX } from '../../../components/onboarding/spotlightConfig';
import { Button } from '../../../components';
import { useTheme, useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { hardwareService, ResourceUsage } from '../../../services';
import { DownloadedModel, ONNXImageModel, RemoteModel } from '../../../types';
import { ModelPickerType, LoadingState } from '../hooks/useHomeScreen';
import { useRemoteServerStore } from '../../../stores';

type Props = {
  pickerType: ModelPickerType;
  loadingState: LoadingState;
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
  activeModelId: string | null;
  activeImageModelId: string | null;
  memoryInfo: ResourceUsage | null;
  // Remote models
  remoteTextModels: RemoteModel[];
  remoteImageModels: RemoteModel[];
  activeRemoteTextModelId: string | null;
  activeRemoteImageModelId: string | null;
  onClose: () => void;
  onSelectTextModel: (model: DownloadedModel) => void;
  onUnloadTextModel: () => void;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onUnloadImageModel: () => void;
  // Remote model handlers
  onSelectRemoteTextModel: (model: RemoteModel) => void;
  onUnloadRemoteTextModel: () => void;
  onSelectRemoteImageModel: (model: RemoteModel) => void;
  onUnloadRemoteImageModel: () => void;
  onBrowseModels: (tab: 'text' | 'image') => void;
};

export const ModelPickerSheet: React.FC<Props> = ({
  pickerType,
  loadingState,
  downloadedModels,
  downloadedImageModels,
  activeModelId,
  activeImageModelId,
  memoryInfo,
  remoteTextModels,
  remoteImageModels,
  activeRemoteTextModelId,
  activeRemoteImageModelId,
  onClose,
  onSelectTextModel,
  onUnloadTextModel,
  onSelectImageModel,
  onUnloadImageModel,
  onSelectRemoteTextModel,
  onUnloadRemoteTextModel,
  onSelectRemoteImageModel,
  onUnloadRemoteImageModel,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [highlightFirst, setHighlightFirst] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

  // Get server info for remote models
  const servers = useRemoteServerStore((s) => s.servers);
  const activeServerId = useRemoteServerStore((s) => s.activeServerId);
  const getServerName = (serverId: string): string => {
    const server = servers.find((s) => s.id === serverId);
    return server?.name || 'Remote Server';
  };

  // When sheet opens after loadedModel flow, consume pending spotlight and highlight first model
  // NOTE: Can't use AttachStep/spotlight-tour inside Modal (separate view hierarchy).
  // Instead, pulse the first model's border as a visual hint.
  useEffect(() => {
    if (pickerType === 'text') {
      const pending = consumePendingSpotlight();
      if (pending === MODEL_PICKER_STEP_INDEX) {
        setHighlightFirst(true);
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
            Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
          ]),
          { iterations: 3 },
        ).start(() => setHighlightFirst(false));
      }
    } else {
      setHighlightFirst(false);
    }
  }, [pickerType, pulseAnim]);

  const highlightBorderColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  return (
    <AppSheet
      visible={pickerType !== null}
      onClose={onClose}
      title={pickerType === 'text' ? 'Text Models' : 'Image Models'}
      snapPoints={['70%']}
    >
      <ScrollView style={styles.modalScroll}>
        {pickerType === 'text' && (
          <>
            {/* Local Models Section */}
            {downloadedModels.length === 0 && remoteTextModels.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.emptyPickerText}>No text models available</Text>
                <Button
                  title="Browse Models"
                  variant="outline"
                  size="small"
                  onPress={() => onBrowseModels('text')}
                />
              </View>
            ) : (
              <>
                {/* Active Model Unload Button */}
                {(activeModelId || activeRemoteTextModelId) && (
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={activeRemoteTextModelId ? onUnloadRemoteTextModel : onUnloadTextModel}
                    disabled={loadingState.isLoading}
                  >
                    <Icon name="power" size={16} color={colors.error} />
                    <Text style={styles.unloadButtonText}>
                      {activeRemoteTextModelId ? 'Disconnect remote model' : 'Unload current model'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Local Models */}
                {downloadedModels.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Local Models</Text>
                    {downloadedModels.map((model, idx) => {
                      const totalSize = model.fileSize + (model.mmProjFileSize || 0);
                      const estimatedMemoryGB = (totalSize * 1.5) / (1024 * 1024 * 1024);
                      const memoryFits = memoryInfo
                        ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                        : true;
                      const isHighlighted = idx === 0 && highlightFirst;
                      const modelItem = (
                        <TouchableOpacity
                          testID="model-item"
                          style={[
                            styles.pickerItem,
                            activeModelId === model.id && styles.pickerItemActive,
                            !memoryFits && styles.pickerItemWarning,
                          ]}
                          onPress={() => onSelectTextModel(model)}
                          disabled={loadingState.isLoading}
                        >
                          <View style={styles.pickerItemInfo}>
                            <Text style={styles.pickerItemName}>
                              {model.name}{' '}
                              {model.isVisionModel && <Icon name="eye" size={14} color={colors.info} />}
                            </Text>
                            <Text style={styles.pickerItemMeta}>
                              {model.quantization} · {hardwareService.formatModelSize(model)}
                              {model.isVisionModel && ' (Vision)'}
                            </Text>
                            <Text style={[styles.pickerItemMemory, !memoryFits && styles.pickerItemMemoryWarning]}>
                              ~{estimatedMemoryGB.toFixed(1)} GB RAM {!memoryFits && '(may not fit)'}
                            </Text>
                          </View>
                          {activeModelId === model.id && (
                            <Icon name="check" size={18} color={colors.text} />
                          )}
                        </TouchableOpacity>
                      );
                      if (isHighlighted) {
                        return (
                          <Animated.View
                            key={model.id}
                            style={[localStyles.highlightBorder, { borderColor: highlightBorderColor }]}
                          >
                            {modelItem}
                            <Text style={[localStyles.highlightHint, { color: colors.textSecondary }]}>
                              Tap this model to load it for chatting
                            </Text>
                          </Animated.View>
                        );
                      }
                      return <View key={model.id}>{modelItem}</View>;
                    })}
                  </>
                )}

                {/* Remote Models */}
                {remoteTextModels.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Remote Models</Text>
                    {remoteTextModels.map((model) => (
                      <TouchableOpacity
                        key={`${model.serverId}-${model.id}`}
                        testID="remote-model-item"
                        style={[
                          styles.pickerItem,
                          activeRemoteTextModelId === model.id && styles.pickerItemActive,
                        ]}
                        onPress={() => onSelectRemoteTextModel(model)}
                        disabled={loadingState.isLoading}
                      >
                        <View style={styles.pickerItemInfo}>
                          <Text style={styles.pickerItemName}>
                            {model.name}{' '}
                            <Icon name="cloud" size={14} color={colors.primary} />
                          </Text>
                          <Text style={styles.pickerItemMeta}>
                            {getServerName(model.serverId)}
                            {model.capabilities.supportsVision && ' · Vision'}
                            {model.capabilities.supportsToolCalling && ' · Tools'}
                          </Text>
                        </View>
                        {activeRemoteTextModelId === model.id && activeServerId === model.serverId && (
                          <Icon name="check" size={18} color={colors.text} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {pickerType === 'image' && (
          <>
            {/* Local Image Models Section */}
            {downloadedImageModels.length === 0 && remoteImageModels.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.emptyPickerText}>No image models available</Text>
                <Button
                  title="Browse Models"
                  variant="outline"
                  size="small"
                  onPress={() => onBrowseModels('image')}
                />
              </View>
            ) : (
              <>
                {/* Active Model Unload Button */}
                {(activeImageModelId || activeRemoteImageModelId) && (
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={activeRemoteImageModelId ? onUnloadRemoteImageModel : onUnloadImageModel}
                    disabled={loadingState.isLoading}
                  >
                    <Icon name="power" size={16} color={colors.error} />
                    <Text style={styles.unloadButtonText}>
                      {activeRemoteImageModelId ? 'Disconnect remote model' : 'Unload current model'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Local Image Models */}
                {downloadedImageModels.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Local Models</Text>
                    {downloadedImageModels.map((model) => {
                      const estimatedMemoryGB = (model.size * 1.8) / (1024 * 1024 * 1024);
                      const memoryFits = memoryInfo
                        ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                        : true;
                      return (
                        <TouchableOpacity
                          key={model.id}
                          testID="model-item"
                          style={[
                            styles.pickerItem,
                            activeImageModelId === model.id && styles.pickerItemActive,
                            !memoryFits && styles.pickerItemWarning,
                          ]}
                          onPress={() => onSelectImageModel(model)}
                          disabled={loadingState.isLoading}
                        >
                          <View style={styles.pickerItemInfo}>
                            <Text style={styles.pickerItemName}>{model.name}</Text>
                            <Text style={styles.pickerItemMeta}>
                              {model.style || 'Image'} · {hardwareService.formatBytes(model.size)}
                            </Text>
                            <Text style={[styles.pickerItemMemory, !memoryFits && styles.pickerItemMemoryWarning]}>
                              ~{estimatedMemoryGB.toFixed(1)} GB RAM {!memoryFits && '(may not fit)'}
                            </Text>
                          </View>
                          {activeImageModelId === model.id && (
                            <Icon name="check" size={18} color={colors.text} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {/* Remote Image Models */}
                {remoteImageModels.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Remote Models</Text>
                    {remoteImageModels.map((model) => (
                      <TouchableOpacity
                        key={`${model.serverId}-${model.id}`}
                        testID="remote-model-item"
                        style={[
                          styles.pickerItem,
                          activeRemoteImageModelId === model.id && styles.pickerItemActive,
                        ]}
                        onPress={() => onSelectRemoteImageModel(model)}
                        disabled={loadingState.isLoading}
                      >
                        <View style={styles.pickerItemInfo}>
                          <Text style={styles.pickerItemName}>
                            {model.name}{' '}
                            <Icon name="cloud" size={14} color={colors.primary} />
                          </Text>
                          <Text style={styles.pickerItemMeta}>
                            {getServerName(model.serverId)}
                            {model.capabilities.supportsVision && ' · Vision'}
                          </Text>
                        </View>
                        {activeRemoteImageModelId === model.id && activeServerId === model.serverId && (
                          <Icon name="check" size={18} color={colors.text} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.browseMoreButton}
        onPress={() => onBrowseModels(pickerType ?? 'text')}
      >
        <Text style={styles.browseMoreText}>Browse more models</Text>
        <Icon name="arrow-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </AppSheet>
  );
};

const localStyles = StyleSheet.create({
  highlightBorder: {
    borderWidth: 2,
    borderRadius: 10,
  },
  highlightHint: {
    fontSize: 11,
    fontStyle: 'italic',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
});
