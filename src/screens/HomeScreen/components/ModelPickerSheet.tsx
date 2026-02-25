import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../../components/AppSheet';
import { Button } from '../../../components';
import { useTheme, useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { hardwareService } from '../../../services';
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { ModelPickerType, LoadingState } from '../hooks/useHomeScreen';
import { ResourceUsage } from '../../../services';

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
                {downloadedModels.map((model) => {
                  const totalSize = model.fileSize + (model.mmProjFileSize || 0);
                  const estimatedMemoryGB = (totalSize * 1.5) / (1024 * 1024 * 1024);
                  const memoryFits = memoryInfo
                    ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                    : true;
                  return (
                    <TouchableOpacity
                      key={model.id}
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
