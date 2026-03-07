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
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { ModelPickerType, LoadingState } from '../hooks/useHomeScreen';

type Props = {
  pickerType: ModelPickerType;
  loadingState: LoadingState;
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
  activeModelId: string | null;
  activeImageModelId: string | null;
  memoryInfo: ResourceUsage | null;
  onClose: () => void;
  onSelectTextModel: (model: DownloadedModel) => void;
  onUnloadTextModel: () => void;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onUnloadImageModel: () => void;
  onBrowseModels: () => void;
};

export const ModelPickerSheet: React.FC<Props> = ({
  pickerType,
  loadingState,
  downloadedModels,
  downloadedImageModels,
  activeModelId,
  activeImageModelId,
  memoryInfo,
  onClose,
  onSelectTextModel,
  onUnloadTextModel,
  onSelectImageModel,
  onUnloadImageModel,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [highlightFirst, setHighlightFirst] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

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
            {downloadedModels.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.emptyPickerText}>No text models downloaded</Text>
                <Button
                  title="Browse Models"
                  variant="outline"
                  size="small"
                  onPress={onBrowseModels}
                />
              </View>
            ) : (
              <>
                {activeModelId && (
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={onUnloadTextModel}
                    disabled={loadingState.isLoading}
                  >
                    <Icon name="power" size={16} color={colors.error} />
                    <Text style={styles.unloadButtonText}>Unload current model</Text>
                  </TouchableOpacity>
                )}
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
          </>
        )}

        {pickerType === 'image' && (
          <>
            {downloadedImageModels.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.emptyPickerText}>No image models downloaded</Text>
                <Button
                  title="Browse Models"
                  variant="outline"
                  size="small"
                  onPress={onBrowseModels}
                />
              </View>
            ) : (
              <>
                {activeImageModelId && (
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={onUnloadImageModel}
                    disabled={loadingState.isLoading}
                  >
                    <Icon name="power" size={16} color={colors.error} />
                    <Text style={styles.unloadButtonText}>Unload current model</Text>
                  </TouchableOpacity>
                )}
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
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.browseMoreButton}
        onPress={onBrowseModels}
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
