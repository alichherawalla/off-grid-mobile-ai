import React from 'react';
import { View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';

interface SettingConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  description?: string;
}

const DEFAULT_SETTINGS: Record<string, number> = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 2048,
};

const SETTINGS_CONFIG: SettingConfig[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Higher = more creative, Lower = more focused',
  },
  {
    key: 'maxTokens',
    label: 'Max Tokens',
    min: 64,
    max: 8192,
    step: 64,
    format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
    description: 'Maximum length of generated response',
  },
  {
    key: 'topP',
    label: 'Top P',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Nucleus sampling threshold',
  },
  {
    key: 'repeatPenalty',
    label: 'Repeat Penalty',
    min: 1.0,
    max: 2.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Penalize repeated tokens',
  },
  {
    key: 'contextLength',
    label: 'Context Length',
    min: 512,
    max: 32768,
    step: 512,
    format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
    description: 'Max conversation memory (requires model reload)',
  },
];

interface SettingSliderProps {
  config: SettingConfig;
}

const SettingSlider: React.FC<SettingSliderProps> = ({ config }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const rawValue = (settings as Record<string, unknown>)[config.key];
  const value = (rawValue ?? DEFAULT_SETTINGS[config.key]) as number;

  return (
    <View style={styles.settingGroup}>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>{config.label}</Text>
        <Text style={styles.settingValue}>{config.format(value)}</Text>
      </View>
      {config.description && (
        <Text style={styles.settingDescription}>{config.description}</Text>
      )}
      <Slider
        style={styles.slider}
        minimumValue={config.min}
        maximumValue={config.max}
        step={config.step}
        value={value}
        onValueChange={(v) => updateSettings({ [config.key]: v })}
        onSlidingComplete={() => {}}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.surfaceLight}
        thumbTintColor={colors.primary}
      />
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderMinMax}>{config.format(config.min)}</Text>
        <Text style={styles.sliderMinMax}>{config.format(config.max)}</Text>
      </View>
    </View>
  );
};

export const TextGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.sectionCard}>
      {SETTINGS_CONFIG.map((config) => (
        <SettingSlider key={config.key} config={config} />
      ))}
    </View>
  );
};
