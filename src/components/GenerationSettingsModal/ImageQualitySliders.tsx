import React from 'react';
import { View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';

export const ImageQualitySliders: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.settingGroup}>
        <View style={styles.settingHeader}>
          <Text style={styles.settingLabel}>Image Steps</Text>
          <Text style={styles.settingValue}>{settings.imageSteps || 20}</Text>
        </View>
        <Text style={styles.settingDescription}>
          LCM models: 4-8 steps, Standard SD: 20-50 steps
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={4}
          maximumValue={50}
          step={1}
          value={settings.imageSteps || 20}
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
