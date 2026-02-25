import React from 'react';
import { View, Text, Switch } from 'react-native';
import Slider from '@react-native-community/slider';
import { Card } from '../../components';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';

export const ImageGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  const isAutoMode = settings?.imageGenerationMode === 'auto';
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>
        Control how image generation requests are handled in chat.
      </Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Automatic Detection</Text>
          <Text style={styles.toggleDesc}>
            {isAutoMode
              ? 'LLM will classify if your message is asking for an image'
              : 'Only generate images when you tap the image button'}
          </Text>
        </View>
        <Switch
          value={isAutoMode}
          onValueChange={(value) =>
            updateSettings({ imageGenerationMode: value ? 'auto' : 'manual' })
          }
          trackColor={trackColor}
          thumbColor={isAutoMode ? colors.primary : colors.textMuted}
        />
      </View>
      <Text style={styles.toggleNote}>
        {isAutoMode
          ? 'In Auto mode, messages like "Draw me a sunset" will automatically generate an image when an image model is loaded.'
          : 'In Manual mode, you must tap the IMG button in chat to generate images.'}
      </Text>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Image Steps</Text>
          <Text style={styles.sliderValue}>{settings?.imageSteps || 30}</Text>
        </View>
        <Text style={styles.sliderDesc}>More steps = better quality but slower (LCM: 4-8, Standard: 20-50)</Text>
        <Slider
          style={styles.slider}
          minimumValue={4}
          maximumValue={50}
          step={1}
          value={settings?.imageSteps || 30}
          onSlidingComplete={(value) => updateSettings({ imageSteps: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Guidance Scale</Text>
          <Text style={styles.sliderValue}>{(settings?.imageGuidanceScale || 7.5).toFixed(1)}</Text>
        </View>
        <Text style={styles.sliderDesc}>Higher = follows prompt more strictly</Text>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={20}
          step={0.5}
          value={settings?.imageGuidanceScale || 7.5}
          onSlidingComplete={(value) => updateSettings({ imageGuidanceScale: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Image Threads</Text>
          <Text style={styles.sliderValue}>{settings?.imageThreads ?? 4}</Text>
        </View>
        <Text style={styles.sliderDesc}>
          CPU threads used for image generation (applies on next image model load)
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={8}
          step={1}
          value={settings?.imageThreads ?? 4}
          onSlidingComplete={(value) => updateSettings({ imageThreads: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Image Size</Text>
          <Text style={styles.sliderValue}>{settings?.imageWidth ?? 256}x{settings?.imageHeight ?? 256}</Text>
        </View>
        <Text style={styles.sliderDesc}>Output resolution (smaller = faster, larger = more detail)</Text>
        <Slider
          style={styles.slider}
          minimumValue={128}
          maximumValue={512}
          step={64}
          value={settings?.imageWidth ?? 256}
          onSlidingComplete={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <DetectionMethodRow />
      <EnhanceImageToggle />
    </Card>
  );
};

const EnhanceImageToggle: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>Enhance Image Prompts</Text>
        <Text style={styles.toggleDesc}>
          {settings?.enhanceImagePrompts
            ? 'Text model refines your prompt before image generation (slower but better results)'
            : 'Use your prompt directly for image generation (faster)'}
        </Text>
      </View>
      <Switch
        value={settings?.enhanceImagePrompts ?? false}
        onValueChange={(value) => updateSettings({ enhanceImagePrompts: value })}
        trackColor={trackColor}
        thumbColor={settings?.enhanceImagePrompts ? colors.primary : colors.textMuted}
      />
    </View>
  );
};

const DetectionMethodRow: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  if (settings?.imageGenerationMode !== 'auto') return null;

  return (
    <View style={styles.settingSection}>
      <Text style={styles.settingLabel}>Detection Method</Text>
      <Text style={styles.settingDesc}>
        {settings?.autoDetectMethod === 'pattern'
          ? 'Fast keyword matching'
          : 'Uses text model for classification'}
      </Text>
      <View style={styles.buttonRow}>
        <Button
          title="Pattern"
          variant="secondary"
          size="medium"
          active={settings?.autoDetectMethod === 'pattern'}
          onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
          style={styles.flex1}
        />
        <Button
          title="LLM"
          variant="secondary"
          size="medium"
          active={settings?.autoDetectMethod === 'llm'}
          onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
          style={styles.flex1}
        />
      </View>
    </View>
  );
};
