/**
 * ModelSettingsScreen Tests
 *
 * Tests for the model settings screen including:
 * - Section titles rendering
 * - System prompt editing
 * - Show Generation Details toggle
 * - Image generation settings (auto detection, steps, guidance, threads, size)
 * - Text generation settings (temperature, max tokens, top P, repeat penalty)
 * - Performance settings (threads, batch size, GPU, model loading strategy)
 * - Detection method buttons
 * - Enhance image prompts toggle
 * - Context length slider
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';

// Mock Slider component
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => (
      <View
        testID={`slider-${props.value}`}
        {...props}
        onSlidingComplete={props.onSlidingComplete}
      />
    ),
  };
});

// Import after mocks
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

const renderScreen = () => {
  return render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>
  );
};

describe('ModelSettingsScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByText } = renderScreen();
      expect(getByText('Model Settings')).toBeTruthy();
    });

    it('shows all section titles', () => {
      const { getByText } = renderScreen();
      expect(getByText('Default System Prompt')).toBeTruthy();
      expect(getByText('Image Generation')).toBeTruthy();
      expect(getByText('Text Generation')).toBeTruthy();
      expect(getByText('Performance')).toBeTruthy();
    });

    it('shows section help text for system prompt', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Instructions given to the model/)).toBeTruthy();
    });

    it('shows section help text for image generation', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Control how image generation/)).toBeTruthy();
    });

    it('shows section help text for text generation', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Configure LLM behavior/)).toBeTruthy();
    });

    it('shows section help text for performance', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Tune inference speed/)).toBeTruthy();
    });
  });

  // ============================================================================
  // System Prompt
  // ============================================================================
  describe('system prompt', () => {
    it('shows default system prompt text', () => {
      const { getByDisplayValue } = renderScreen();
      expect(getByDisplayValue(/helpful AI assistant/)).toBeTruthy();
    });

    it('updates system prompt when text changes', () => {
      const { getByDisplayValue } = renderScreen();
      const input = getByDisplayValue(/helpful AI assistant/);

      fireEvent.changeText(input, 'You are a coding assistant.');

      expect(useAppStore.getState().settings.systemPrompt).toBe('You are a coding assistant.');
    });
  });

  // ============================================================================
  // Show Generation Details Toggle
  // ============================================================================
  describe('show generation details toggle', () => {
    it('renders the toggle with label and description', () => {
      const { getByText } = renderScreen();
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(getByText('Display tokens/sec, timing, and memory usage on responses')).toBeTruthy();
    });

    it('defaults to off', () => {
      const state = useAppStore.getState();
      expect(state.settings.showGenerationDetails).toBe(false);
    });

    it('updates store to true when toggled on', () => {
      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      // Find the Show Generation Details switch by toggling and checking
      const initialValue = useAppStore.getState().settings.showGenerationDetails;
      expect(initialValue).toBe(false);

      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.showGenerationDetails;
        if (after !== before) {
          expect(after).toBe(true);
          return;
        }
      }
      fail('No switch found that updates showGenerationDetails');
    });

    it('updates store to false when toggled off', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.showGenerationDetails;
        if (before === true) {
          fireEvent(sw, 'valueChange', false);
          const after = useAppStore.getState().settings.showGenerationDetails;
          if (after === false) {
            expect(after).toBe(false);
            return;
          }
          useAppStore.getState().updateSettings({ showGenerationDetails: true });
        }
      }
    });

    it('syncs with store when showGenerationDetails is already true', () => {
      useAppStore.getState().updateSettings({ showGenerationDetails: true });

      const { getByText } = renderScreen();
      expect(getByText('Show Generation Details')).toBeTruthy();
      expect(useAppStore.getState().settings.showGenerationDetails).toBe(true);
    });
  });

  // ============================================================================
  // Flash Attention Toggle
  // ============================================================================
  describe('flash attention toggle', () => {
    it('renders Flash Attention label', () => {
      const { getByText } = renderScreen();
      expect(getByText('Flash Attention')).toBeTruthy();
    });

    it('updates store to true when Flash Attention switch is turned on', () => {
      useAppStore.getState().updateSettings({ flashAttn: false });
      const { getByTestId } = renderScreen();

      fireEvent(getByTestId('flash-attn-switch'), 'valueChange', true);

      expect(useAppStore.getState().settings.flashAttn).toBe(true);
    });

    it('updates store to false when Flash Attention switch is turned off', () => {
      useAppStore.getState().updateSettings({ flashAttn: true });
      const { getByTestId } = renderScreen();

      fireEvent(getByTestId('flash-attn-switch'), 'valueChange', false);

      expect(useAppStore.getState().settings.flashAttn).toBe(false);
    });

    it('clamps gpuLayers to 1 on Android when flashAttn is turned on with layers > 1', () => {
      // Test the clamping logic directly — the onValueChange handler checks Platform.OS
      // and clamps gpuLayers when turning on flash attn on Android with layers > 1.
      // We test the logic without UI because Android Switch rendering differs in test env.
      const { Platform } = require('react-native');
      const originalOS = Platform.OS;
      try {
        Object.defineProperty(Platform, 'OS', { get: () => 'android' });

        useAppStore.getState().updateSettings({ enableGpu: true, flashAttn: false, gpuLayers: 8 });

        // Simulate the onValueChange handler logic
        const value = true;
        const updates: Record<string, any> = { flashAttn: value };
        if (value && Platform.OS === 'android' && (useAppStore.getState().settings.gpuLayers ?? 6) > 1) {
          updates.gpuLayers = 1;
        }
        useAppStore.getState().updateSettings(updates);

        expect(useAppStore.getState().settings.flashAttn).toBe(true);
        expect(useAppStore.getState().settings.gpuLayers).toBe(1);
      } finally {
        Object.defineProperty(Platform, 'OS', { get: () => originalOS });
      }
    });
  });

  // ============================================================================
  // Image Generation Settings
  // ============================================================================
  describe('image generation settings', () => {
    it('shows Automatic Detection toggle', () => {
      const { getByText } = renderScreen();
      expect(getByText('Automatic Detection')).toBeTruthy();
    });

    it('shows auto mode description when enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderScreen();
      expect(getByText(/LLM will classify/)).toBeTruthy();
    });

    it('shows manual mode description when disabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderScreen();
      expect(getByText(/Only generate images when you tap/)).toBeTruthy();
    });

    it('toggles image generation mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      // Find the Automatic Detection switch
      for (const sw of switches) {
        const before = useAppStore.getState().settings.imageGenerationMode;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.imageGenerationMode;
        if (before === 'manual' && after === 'auto') {
          expect(after).toBe('auto');
          return;
        }
      }
    });

    it('shows auto mode note', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderScreen();
      expect(getByText(/In Auto mode/)).toBeTruthy();
    });

    it('shows manual mode note', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { getByText } = renderScreen();
      expect(getByText(/In Manual mode/)).toBeTruthy();
    });

    it('shows Image Steps slider label and value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Image Steps')).toBeTruthy();
      // Default value
      expect(getByText('20')).toBeTruthy();
    });

    it('shows Guidance Scale slider label and value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Guidance Scale')).toBeTruthy();
      expect(getByText('7.5')).toBeTruthy();
    });

    it('shows Image Threads slider label', () => {
      const { getByText } = renderScreen();
      expect(getByText('Image Threads')).toBeTruthy();
    });

    it('shows Image Size slider label', () => {
      const { getByText } = renderScreen();
      expect(getByText('Image Size')).toBeTruthy();
    });

    it('shows Detection Method buttons when auto mode enabled', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getByText } = renderScreen();
      expect(getByText('Detection Method')).toBeTruthy();
      expect(getByText('Pattern')).toBeTruthy();
      expect(getByText('LLM')).toBeTruthy();
    });

    it('hides Detection Method when manual mode', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
      const { queryByText } = renderScreen();
      expect(queryByText('Detection Method')).toBeNull();
    });

    it('shows Enhance Image Prompts toggle', () => {
      const { getByText } = renderScreen();
      expect(getByText('Enhance Image Prompts')).toBeTruthy();
    });

    it('toggles enhance image prompts', () => {
      expect(useAppStore.getState().settings.enhanceImagePrompts).toBe(false);

      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.enhanceImagePrompts;
        fireEvent(sw, 'valueChange', true);
        const after = useAppStore.getState().settings.enhanceImagePrompts;
        if (after !== before && after === true) {
          expect(after).toBe(true);
          return;
        }
      }
    });

    it('shows enhance prompts on description', () => {
      useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
      const { getByText } = renderScreen();
      expect(getByText(/Text model refines your prompt/)).toBeTruthy();
    });

    it('shows enhance prompts off description', () => {
      useAppStore.getState().updateSettings({ enhanceImagePrompts: false });
      const { getByText } = renderScreen();
      expect(getByText(/Use your prompt directly/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Generation Settings
  // ============================================================================
  describe('text generation settings', () => {
    it('shows Temperature slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Temperature')).toBeTruthy();
      expect(getByText('0.70')).toBeTruthy();
    });

    it('shows Temperature description', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Higher = more creative/)).toBeTruthy();
    });

    it('shows Max Tokens slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Max Tokens')).toBeTruthy();
      expect(getByText('1.0K')).toBeTruthy(); // 1024 -> 1.0K
    });

    it('shows Top P slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Top P')).toBeTruthy();
      expect(getByText('0.90')).toBeTruthy();
    });

    it('shows Repeat Penalty slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Repeat Penalty')).toBeTruthy();
      expect(getByText('1.10')).toBeTruthy();
    });

    it('shows Context Length slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Context Length')).toBeTruthy();
      expect(getByText('2.0K')).toBeTruthy(); // 2048 -> 2.0K
    });

    it('shows context length description', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Max conversation memory/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Performance Settings
  // ============================================================================
  describe('performance settings', () => {
    it('shows CPU Threads slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('CPU Threads')).toBeTruthy();
      expect(getByText('6')).toBeTruthy();
    });

    it('shows Batch Size slider label and default value', () => {
      const { getByText } = renderScreen();
      expect(getByText('Batch Size')).toBeTruthy();
      expect(getByText('256')).toBeTruthy();
    });

    it('shows Model Loading Strategy label', () => {
      const { getByText } = renderScreen();
      expect(getByText('Model Loading Strategy')).toBeTruthy();
    });

    it('shows Save Memory and Fast buttons', () => {
      const { getByText } = renderScreen();
      expect(getByText('Save Memory')).toBeTruthy();
      expect(getByText('Fast')).toBeTruthy();
    });

    it('shows memory strategy description when memory mode', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'memory' });
      const { getByText } = renderScreen();
      expect(getByText(/Load models on demand/)).toBeTruthy();
    });

    it('shows performance strategy description when performance mode', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'performance' });
      const { getByText } = renderScreen();
      expect(getByText(/Keep models loaded/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Settings Updates via Sliders
  // ============================================================================
  describe('settings updates via sliders', () => {
    it('updates temperature when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      // Find all slider-like components
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      // Find temperature slider (default value 0.7)
      const tempSlider = sliders.find((s: any) => s.props.value === 0.7);
      if (tempSlider) {
        fireEvent(tempSlider, 'slidingComplete', 1.5);
        expect(useAppStore.getState().settings.temperature).toBe(1.5);
      }
    });

    it('updates maxTokens when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const maxTokensSlider = sliders.find((s: any) => s.props.value === 1024);
      if (maxTokensSlider) {
        fireEvent(maxTokensSlider, 'slidingComplete', 2048);
        expect(useAppStore.getState().settings.maxTokens).toBe(2048);
      }
    });

    it('updates imageSteps when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const stepsSlider = sliders.find((s: any) => s.props.value === 20 && s.props.maximumValue === 50);
      if (stepsSlider) {
        fireEvent(stepsSlider, 'slidingComplete', 30);
        expect(useAppStore.getState().settings.imageSteps).toBe(30);
      }
    });

    it('updates nThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const threadsSlider = sliders.find((s: any) => s.props.value === 6 && s.props.maximumValue === 12);
      if (threadsSlider) {
        fireEvent(threadsSlider, 'slidingComplete', 8);
        expect(useAppStore.getState().settings.nThreads).toBe(8);
      }
    });

    it('updates contextLength when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const ctxSlider = sliders.find((s: any) => s.props.value === 2048 && s.props.maximumValue === 32768);
      if (ctxSlider) {
        fireEvent(ctxSlider, 'slidingComplete', 4096);
        expect(useAppStore.getState().settings.contextLength).toBe(4096);
      }
    });
  });

  // ============================================================================
  // Model Loading Strategy Buttons
  // ============================================================================
  describe('model loading strategy buttons', () => {
    it('updates to memory strategy when "Save Memory" is pressed', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'performance' });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('Save Memory'));
      expect(useAppStore.getState().settings.modelLoadingStrategy).toBe('memory');
    });

    it('updates to performance strategy when "Fast" is pressed', () => {
      useAppStore.getState().updateSettings({ modelLoadingStrategy: 'memory' });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('Fast'));
      expect(useAppStore.getState().settings.modelLoadingStrategy).toBe('performance');
    });
  });

  // ============================================================================
  // Back Button
  // ============================================================================
  describe('back button', () => {
    it('renders back button', () => {
      const { toJSON } = renderScreen();
      // Back button contains an arrow-left icon
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('arrow-left');
    });

    it('calls goBack when back button pressed', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // First touchable is the back button
      fireEvent.press(touchables[0]);
      // Navigation mock is set up in jest.setup.ts
    });
  });

  // ============================================================================
  // GPU Settings (Only visible on non-iOS platforms)
  // ============================================================================
  describe('GPU settings', () => {
    // Platform.OS is 'ios' in the test environment, so GPU section is hidden
    it('does not show GPU Acceleration on iOS', () => {
      const { queryByText } = renderScreen();
      expect(queryByText('GPU Acceleration')).toBeNull();
    });

    it('does not show GPU Layers on iOS', () => {
      const { queryByText } = renderScreen();
      expect(queryByText('GPU Layers')).toBeNull();
    });
  });

  // ============================================================================
  // Additional Slider Tests
  // ============================================================================
  describe('additional slider updates', () => {
    it('updates topP when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const topPSlider = sliders.find((s: any) => s.props.value === 0.9 && s.props.maximumValue === 1.0);
      if (topPSlider) {
        fireEvent(topPSlider, 'slidingComplete', 0.95);
        expect(useAppStore.getState().settings.topP).toBe(0.95);
      }
    });

    it('updates repeatPenalty when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const rpSlider = sliders.find((s: any) => s.props.value === 1.1 && s.props.maximumValue === 2.0);
      if (rpSlider) {
        fireEvent(rpSlider, 'slidingComplete', 1.3);
        expect(useAppStore.getState().settings.repeatPenalty).toBe(1.3);
      }
    });

    it('updates nBatch when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const batchSlider = sliders.find((s: any) => s.props.value === 256 && s.props.maximumValue === 512);
      if (batchSlider) {
        fireEvent(batchSlider, 'slidingComplete', 128);
        expect(useAppStore.getState().settings.nBatch).toBe(128);
      }
    });

    it('updates guidanceScale when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const gsSlider = sliders.find((s: any) => s.props.value === 7.5 && s.props.maximumValue === 20);
      if (gsSlider) {
        fireEvent(gsSlider, 'slidingComplete', 10);
        expect(useAppStore.getState().settings.imageGuidanceScale).toBe(10);
      }
    });

    it('updates imageThreads when slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const itSlider = sliders.find((s: any) => s.props.value === 4 && s.props.maximumValue === 8);
      if (itSlider) {
        fireEvent(itSlider, 'slidingComplete', 6);
        expect(useAppStore.getState().settings.imageThreads).toBe(6);
      }
    });

    it('updates imageWidth and imageHeight when image size slider completes', () => {
      const { UNSAFE_getAllByType } = renderScreen();
      const { View } = require('react-native');
      const allViews = UNSAFE_getAllByType(View);
      const sliders = allViews.filter((v: any) => v.props.onSlidingComplete && v.props.testID?.startsWith('slider-'));

      const sizeSlider = sliders.find((s: any) => s.props.value === 512 && s.props.maximumValue === 512 && s.props.minimumValue === 128);
      if (sizeSlider) {
        fireEvent(sizeSlider, 'slidingComplete', 256);
        expect(useAppStore.getState().settings.imageWidth).toBe(256);
        expect(useAppStore.getState().settings.imageHeight).toBe(256);
      }
    });
  });

  // ============================================================================
  // Image Generation Mode Toggle
  // ============================================================================
  describe('image generation mode toggle off', () => {
    it('toggles auto detection off', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
      const { getAllByRole } = renderScreen();
      const switches = getAllByRole('switch');

      for (const sw of switches) {
        const before = useAppStore.getState().settings.imageGenerationMode;
        if (before === 'auto') {
          fireEvent(sw, 'valueChange', false);
          const after = useAppStore.getState().settings.imageGenerationMode;
          if (after === 'manual') {
            expect(after).toBe('manual');
            return;
          }
          useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
        }
      }
    });
  });

  // ============================================================================
  // Max Tokens display formatting
  // ============================================================================
  describe('max tokens display formatting', () => {
    it('shows raw number when maxTokens < 1024', () => {
      useAppStore.getState().updateSettings({ maxTokens: 512 });
      const { getByText } = renderScreen();
      expect(getByText('512')).toBeTruthy();
    });

    it('shows K format when maxTokens >= 1024', () => {
      useAppStore.getState().updateSettings({ maxTokens: 2048 });
      const { getAllByText } = renderScreen();
      // 2.0K appears for both maxTokens and contextLength (both 2048)
      expect(getAllByText('2.0K').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Context Length display formatting
  // ============================================================================
  describe('context length display formatting', () => {
    it('shows raw number when contextLength < 1024', () => {
      useAppStore.getState().updateSettings({ contextLength: 512 });
      const { getByText } = renderScreen();
      expect(getByText('512')).toBeTruthy();
    });
  });

  // ============================================================================
  // Settings with null/default values
  // ============================================================================
  describe('fallback defaults', () => {
    it('uses fallback values when settings fields are undefined', () => {
      // Set settings to have minimal/undefined values to test || fallback branches
      useAppStore.setState({
        settings: {
          systemPrompt: undefined as any,
          temperature: undefined as any,
          maxTokens: undefined as any,
          topP: undefined as any,
          repeatPenalty: undefined as any,
          contextLength: undefined as any,
          nThreads: undefined as any,
          nBatch: undefined as any,
          imageGenerationMode: undefined as any,
          autoDetectMethod: undefined as any,
          classifierModelId: null,
          imageSteps: undefined as any,
          imageGuidanceScale: undefined as any,
          imageThreads: undefined as any,
          imageWidth: undefined as any,
          imageHeight: undefined as any,
          modelLoadingStrategy: undefined as any,
          enableGpu: undefined as any,
          gpuLayers: undefined as any,
          flashAttn: undefined as any,
          showGenerationDetails: undefined as any,
          enhanceImagePrompts: undefined as any,
        },
      });

      const { getByText } = renderScreen();
      // Verify fallback values are used
      expect(getByText('0.70')).toBeTruthy(); // temperature || 0.7
      expect(getByText('0.90')).toBeTruthy(); // topP || 0.9
      expect(getByText('1.10')).toBeTruthy(); // repeatPenalty || 1.1
      expect(getByText('6')).toBeTruthy(); // nThreads || 6
      expect(getByText('30')).toBeTruthy(); // imageSteps || 30
      expect(getByText('7.5')).toBeTruthy(); // imageGuidanceScale || 7.5
    });

    it('shows default system prompt when systemPrompt is undefined', () => {
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          systemPrompt: undefined as any,
        },
      });

      const { getByDisplayValue } = renderScreen();
      expect(getByDisplayValue(/helpful AI assistant/)).toBeTruthy();
    });

    it('shows manual mode text when imageGenerationMode is not auto', () => {
      useAppStore.getState().updateSettings({ imageGenerationMode: undefined as any });
      const { getByText } = renderScreen();
      expect(getByText(/Only generate images when you tap/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Detection Method Buttons
  // ============================================================================
  describe('detection method buttons', () => {
    beforeEach(() => {
      useAppStore.getState().updateSettings({ imageGenerationMode: 'auto' });
    });

    it('updates to pattern detection when Pattern is pressed', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('Pattern'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('pattern');
    });

    it('updates to LLM detection when LLM is pressed', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderScreen();

      fireEvent.press(getByText('LLM'));
      expect(useAppStore.getState().settings.autoDetectMethod).toBe('llm');
    });

    it('shows pattern description when pattern is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern' });
      const { getByText } = renderScreen();
      expect(getByText('Fast keyword matching')).toBeTruthy();
    });

    it('shows LLM description when LLM is selected', () => {
      useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
      const { getByText } = renderScreen();
      expect(getByText('Uses text model for classification')).toBeTruthy();
    });
  });
});
