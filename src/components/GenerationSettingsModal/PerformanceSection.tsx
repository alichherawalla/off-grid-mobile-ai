import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { CacheType } from '../../types';
import { createStyles } from './styles';

// ─── GPU Acceleration ─────────────────────────────────────────────────────────

const GpuAccelerationToggle: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const gpuLayersMax = 99;
  const gpuLayersEffective = Math.min(settings.gpuLayers ?? 1, gpuLayersMax);
  const isQuantizedCache = (settings.cacheType ?? 'q8_0') !== 'f16';

  const handleGpuOn = () => {
    if (Platform.OS === 'android' && isQuantizedCache) {
      updateSettings({ enableGpu: true, cacheType: 'f16' });
    } else {
      updateSettings({ enableGpu: true });
    }
  };

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>GPU Acceleration</Text>
        <Text style={styles.modeToggleDesc}>
          Offload inference to GPU when available. Faster for large models, may add overhead for small ones. Requires model reload.
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          testID="gpu-off-button"
          style={[styles.modeButton, !settings.enableGpu && styles.modeButtonActive]}
          onPress={() => updateSettings({ enableGpu: false })}
        >
          <Text style={[styles.modeButtonText, !settings.enableGpu && styles.modeButtonTextActive]}>
            Off
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="gpu-on-button"
          style={[styles.modeButton, settings.enableGpu && styles.modeButtonActive]}
          onPress={handleGpuOn}
        >
          <Text style={[styles.modeButtonText, settings.enableGpu && styles.modeButtonTextActive]}>
            On
          </Text>
        </TouchableOpacity>
      </View>

      {settings.enableGpu && (
        <View style={styles.gpuLayersInline}>
          <View style={styles.settingHeader}>
            <Text style={styles.settingLabel}>GPU Layers</Text>
            <Text style={styles.settingValue}>{gpuLayersEffective}</Text>
          </View>
          <Text style={styles.settingDescription}>
            Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices. Requires model reload.
          </Text>
          <Slider
            testID="gpu-layers-slider"
            style={styles.slider}
            minimumValue={1}
            maximumValue={gpuLayersMax}
            step={1}
            value={gpuLayersEffective}
            onSlidingComplete={(value: number) => updateSettings({ gpuLayers: value })}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.surfaceLight}
            thumbTintColor={colors.primary}
          />
        </View>
      )}
    </View>
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

const FlashAttentionToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const isFlashAttnOn = settings.flashAttn ?? true;
  const isQuantizedCache = (settings.cacheType ?? 'q8_0') !== 'f16';

  const handleFlashAttnOff = () => {
    if (isQuantizedCache) {
      // Turning flash attention off with quantized cache → auto-switch to f16
      updateSettings({ flashAttn: false, cacheType: 'f16' });
    } else {
      updateSettings({ flashAttn: false });
    }
  };

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Flash Attention</Text>
        <Text style={styles.modeToggleDesc}>
          Faster inference and lower memory. Required for quantized KV cache (q8_0/q4_0). Requires model reload.
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          testID="flash-attn-off-button"
          style={[styles.modeButton, !isFlashAttnOn && styles.modeButtonActive]}
          onPress={handleFlashAttnOff}
        >
          <Text style={[styles.modeButtonText, !isFlashAttnOn && styles.modeButtonTextActive]}>
            Off
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="flash-attn-on-button"
          style={[styles.modeButton, isFlashAttnOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ flashAttn: true })}
        >
          <Text style={[styles.modeButtonText, isFlashAttnOn && styles.modeButtonTextActive]}>
            On
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── KV Cache Type ───────────────────────────────────────────────────────────

const CACHE_TYPE_DESC: Record<CacheType, string> = {
  f16: 'Full precision — best quality, highest memory usage',
  q8_0: '8-bit quantized — good balance of quality and memory',
  q4_0: '4-bit quantized — lowest memory, may reduce quality',
};

const KvCacheTypeToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const current: CacheType = settings.cacheType ?? 'q8_0';
  const isFlashAttnOn = settings.flashAttn ?? true;
  const gpuForcesF16 = Platform.OS === 'android' && settings.enableGpu;
  const cacheDisabled = gpuForcesF16;

  const handleCacheTypeChange = (ct: CacheType) => {
    if (cacheDisabled) return;
    const updates: Partial<typeof settings> = { cacheType: ct };
    if (ct !== 'f16' && !isFlashAttnOn) {
      updates.flashAttn = true;
    }
    updateSettings(updates);
  };

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>KV Cache Type</Text>
        <Text style={styles.modeToggleDesc}>{CACHE_TYPE_DESC[cacheDisabled ? 'f16' : current]}</Text>
      </View>
      <View style={styles.modeToggleButtons}>
        {(['f16', 'q8_0', 'q4_0'] as CacheType[]).map((ct) => (
          <TouchableOpacity
            key={ct}
            testID={`cache-type-${ct}-button`}
            style={[styles.modeButton, (cacheDisabled ? 'f16' : current) === ct && styles.modeButtonActive]}
            onPress={() => handleCacheTypeChange(ct)}
            disabled={cacheDisabled && ct !== 'f16'}
          >
            <Text style={[styles.modeButtonText, (cacheDisabled ? 'f16' : current) === ct && styles.modeButtonTextActive]}>
              {ct}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {cacheDisabled && (
        <Text style={styles.settingWarning}>
          GPU acceleration on Android requires f16 KV cache.
        </Text>
      )}
      {!cacheDisabled && !isFlashAttnOn && (
        <Text style={styles.settingWarning}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </View>
  );
};

// ─── Model Loading Strategy ───────────────────────────────────────────────────

const ModelLoadingStrategyToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const isPerformance = settings.modelLoadingStrategy === 'performance';
  const isMemory = settings.modelLoadingStrategy === 'memory';

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Model Loading Strategy</Text>
        <Text style={styles.modeToggleDesc}>
          {isPerformance
            ? 'Keep models loaded for faster responses (uses more memory)'
            : 'Load models on demand to save memory (slower switching)'}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[styles.modeButton, isMemory && styles.modeButtonActive]}
          onPress={() => updateSettings({ modelLoadingStrategy: 'memory' })}
        >
          <Text style={[styles.modeButtonText, isMemory && styles.modeButtonTextActive]}>
            Save Memory
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, isPerformance && styles.modeButtonActive]}
          onPress={() => updateSettings({ modelLoadingStrategy: 'performance' })}
        >
          <Text style={[styles.modeButtonText, isPerformance && styles.modeButtonTextActive]}>
            Fast
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Show Generation Details ──────────────────────────────────────────────────

const ShowGenerationDetailsToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const isOn = settings.showGenerationDetails;

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Show Generation Details</Text>
        <Text style={styles.modeToggleDesc}>
          Display GPU, model, tok/s, and image settings below each message
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[styles.modeButton, !isOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ showGenerationDetails: false })}
        >
          <Text style={[styles.modeButtonText, !isOn && styles.modeButtonTextActive]}>Off</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, isOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ showGenerationDetails: true })}
        >
          <Text style={[styles.modeButtonText, isOn && styles.modeButtonTextActive]}>On</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── CPU Threads & Batch Size ────────────────────────────────────────────────

const CpuThreadsSlider: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const value = settings.nThreads ?? 6;

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>CPU Threads</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      <Text style={styles.settingDescription}>Parallel threads for inference</Text>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={12}
        step={1}
        value={value}
        onSlidingComplete={(v: number) => updateSettings({ nThreads: v })}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.surfaceLight}
        thumbTintColor={colors.primary}
      />
    </View>
  );
};

const BatchSizeSlider: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const value = settings.nBatch ?? 256;

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>Batch Size</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      <Text style={styles.settingDescription}>Tokens processed per batch</Text>
      <Slider
        style={styles.slider}
        minimumValue={32}
        maximumValue={512}
        step={32}
        value={value}
        onSlidingComplete={(v: number) => updateSettings({ nBatch: v })}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.surfaceLight}
        thumbTintColor={colors.primary}
      />
    </View>
  );
};

// ─── Main Section ─────────────────────────────────────────────────────────────

export const PerformanceSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.sectionCard}>
      <CpuThreadsSlider />
      <BatchSizeSlider />
      {Platform.OS !== 'ios' && <GpuAccelerationToggle />}
      <FlashAttentionToggle />
      <KvCacheTypeToggle />
      <ModelLoadingStrategyToggle />
      <ShowGenerationDetailsToggle />
    </View>
  );
};
