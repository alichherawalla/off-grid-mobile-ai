import React, { useState } from 'react';
import { View, Text, Switch, Platform, TouchableOpacity, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { localDreamGeneratorService } from '../../services/localDreamGenerator';
import { createStyles } from './styles';

const ClearGPUCacheButton: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { downloadedImageModels, activeImageModelId } = useAppStore();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeModel?.modelPath) {
      Alert.alert('No Model', 'Load an image model first.');
      return;
    }
    setClearing(true);
    try {
      const cleared = await localDreamGeneratorService.clearOpenCLCache(activeModel.modelPath);
      Alert.alert('Cache Cleared', `Removed ${cleared} GPU cache file(s). Next generation will retune GPU kernels (first run may be slower).`);
    } catch (e: any) {
      Alert.alert('Error', `Failed to clear GPU cache: ${e?.message || 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.settingHeader, styles.clearCacheButton, { backgroundColor: colors.surfaceLight }]}
      onPress={handleClear}
      disabled={clearing}
    >
      <Text style={[styles.settingDescription, { color: colors.primary }]}>
        {clearing ? 'Clearing...' : 'Clear GPU Cache'}
      </Text>
    </TouchableOpacity>
  );
};

/** Basic sliders: Image Steps + Image Size */
export const ImageQualityBasicSliders: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.settingGroup}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingLabel}>Image Steps</Text>
          <Text style={styles.settingValue}>{settings.imageSteps || 8}</Text>
        </View>
        <Text style={styles.settingDescription}>
          4-8 steps for speed, 20-50 for quality
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={4}
          maximumValue={50}
          step={1}
          value={settings.imageSteps || 8}
          onSlidingComplete={(value) => updateSettings({ imageSteps: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surfaceLight}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderMinMax}>4</Text>
          <Text style={styles.sliderMinMax}>50</Text>
        </View>
      </View>

      <View style={styles.settingGroup}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingLabel}>Image Size</Text>
          <Text style={styles.settingValue}>
            {settings.imageWidth ?? 256}x{settings.imageHeight ?? 256}
          </Text>
        </View>
        <Text style={styles.settingDescription}>
          Output resolution (smaller = faster, larger = more detail)
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={128}
          maximumValue={512}
          step={64}
          value={settings.imageWidth ?? 256}
          onSlidingComplete={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surfaceLight}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderMinMax}>128</Text>
          <Text style={styles.sliderMinMax}>512</Text>
        </View>
      </View>
    </>
  );
};

/** Advanced sliders: Guidance Scale, Image Threads, GPU Acceleration */
export const ImageQualityAdvancedSliders: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.settingGroup}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingLabel}>Guidance Scale</Text>
          <Text style={styles.settingValue}>{(settings.imageGuidanceScale || 7.5).toFixed(1)}</Text>
        </View>
        <Text style={styles.settingDescription}>
          Higher = follows prompt more strictly (5-15 range)
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={20}
          step={0.5}
          value={settings.imageGuidanceScale || 7.5}
          onSlidingComplete={(value) => updateSettings({ imageGuidanceScale: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surfaceLight}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderMinMax}>1</Text>
          <Text style={styles.sliderMinMax}>20</Text>
        </View>
      </View>

      <View style={styles.settingGroup}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingLabel}>Image Threads</Text>
          <Text style={styles.settingValue}>{settings.imageThreads ?? 4}</Text>
        </View>
        <Text style={styles.settingDescription}>
          CPU threads used for image generation. Takes effect next time the image model loads.
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={8}
          step={1}
          value={settings.imageThreads ?? 4}
          onSlidingComplete={(value) => updateSettings({ imageThreads: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surfaceLight}
          thumbTintColor={colors.primary}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderMinMax}>1</Text>
          <Text style={styles.sliderMinMax}>8</Text>
        </View>
      </View>

      {Platform.OS === 'android' && (
        <View style={styles.settingGroup}>
          <View style={styles.settingHeader}>
            <Text style={styles.settingLabel}>GPU Acceleration</Text>
            <Switch
              value={settings.imageUseOpenCL ?? true}
              onValueChange={(value) => updateSettings({ imageUseOpenCL: value })}
              trackColor={{ false: colors.surfaceLight, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
          <Text style={styles.settingDescription}>
            Use GPU for faster image generation. First run may be slower while optimizing for your device. For best performance, use NPU models on supported Snapdragon devices.
          </Text>
          {(settings.imageUseOpenCL ?? true) && <ClearGPUCacheButton />}
        </View>
      )}
    </>
  );
};
