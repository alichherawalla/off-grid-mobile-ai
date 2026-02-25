import React from 'react';
import { View, Text, Switch } from 'react-native';
import Slider from '@react-native-community/slider';
import { Card } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';

export const TextGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  const maxTokens = settings?.maxTokens || 512;
  const maxTokensLabel = maxTokens >= 1024
    ? `${(maxTokens / 1024).toFixed(1)}K`
    : String(maxTokens);
  const contextLength = settings?.contextLength || 2048;
  const contextLengthLabel = contextLength >= 1024
    ? `${(contextLength / 1024).toFixed(1)}K`
    : String(contextLength);

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>Configure LLM behavior for text responses.</Text>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Temperature</Text>
          <Text style={styles.sliderValue}>{(settings?.temperature || 0.7).toFixed(2)}</Text>
        </View>
        <Text style={styles.sliderDesc}>Higher = more creative, Lower = more focused</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={2}
          step={0.05}
          value={settings?.temperature || 0.7}
          onSlidingComplete={(value) => updateSettings({ temperature: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Max Tokens</Text>
          <Text style={styles.sliderValue}>{maxTokensLabel}</Text>
        </View>
        <Text style={styles.sliderDesc}>Maximum response length</Text>
        <Slider
          style={styles.slider}
          minimumValue={64}
          maximumValue={8192}
          step={64}
          value={maxTokens}
          onSlidingComplete={(value) => updateSettings({ maxTokens: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Top P</Text>
          <Text style={styles.sliderValue}>{(settings?.topP || 0.9).toFixed(2)}</Text>
        </View>
        <Text style={styles.sliderDesc}>Nucleus sampling threshold</Text>
        <Slider
          style={styles.slider}
          minimumValue={0.1}
          maximumValue={1.0}
          step={0.05}
          value={settings?.topP || 0.9}
          onSlidingComplete={(value) => updateSettings({ topP: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Repeat Penalty</Text>
          <Text style={styles.sliderValue}>{(settings?.repeatPenalty || 1.1).toFixed(2)}</Text>
        </View>
        <Text style={styles.sliderDesc}>Penalize repeated tokens</Text>
        <Slider
          style={styles.slider}
          minimumValue={1.0}
          maximumValue={2.0}
          step={0.05}
          value={settings?.repeatPenalty || 1.1}
          onSlidingComplete={(value) => updateSettings({ repeatPenalty: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Show Generation Details</Text>
          <Text style={styles.toggleDesc}>
            Display tokens/sec, timing, and memory usage on responses
          </Text>
        </View>
        <Switch
          value={settings?.showGenerationDetails ?? false}
          onValueChange={(value) => updateSettings({ showGenerationDetails: value })}
          trackColor={trackColor}
          thumbColor={settings?.showGenerationDetails ? colors.primary : colors.textMuted}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Context Length</Text>
          <Text style={styles.sliderValue}>{contextLengthLabel}</Text>
        </View>
        <Text style={styles.sliderDesc}>Max conversation memory (requires reload)</Text>
        <Slider
          style={styles.slider}
          minimumValue={512}
          maximumValue={32768}
          step={512}
          value={contextLength}
          onSlidingComplete={(value) => updateSettings({ contextLength: value })}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.surface}
          thumbTintColor={colors.primary}
        />
      </View>
    </Card>
  );
};
