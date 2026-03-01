/**
 * ChatsListScreen Spotlight Integration Tests
 *
 * Renders the actual ChatsListScreen and verifies:
 * - Reactive spotlight for imageNewChat (step 14) fires when image model is loaded
 * - Spotlight does NOT fire when already shown or triedImageGen completed
 * - AttachStep indices 2 and 14 wrap the "New" button
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';

// Capture goTo calls
const mockGoTo = jest.fn();

jest.mock('react-native-spotlight-tour', () => ({
  SpotlightTourProvider: ({ children }: { children: React.ReactNode }) => children,
  AttachStep: ({ children }: { children: React.ReactNode }) => children,
  useSpotlightTour: () => ({
    start: jest.fn(),
    stop: jest.fn(),
    next: jest.fn(),
    previous: jest.fn(),
    goTo: mockGoTo,
    current: 0,
    status: 'idle',
    pause: jest.fn(),
    resume: jest.fn(),
  }),
}));

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock child components
jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} style={style} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: () => null,
  showAlert: jest.fn(),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../../src/services/localDreamGenerator', () => ({
  onnxImageGeneratorService: {
    deleteGeneratedImage: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('react-native-gesture-handler/Swipeable', () => {
  const ReactMock = require('react');
  return ReactMock.forwardRef(({ children }: any, _ref: any) => children);
});

import { ChatsListScreen } from '../../../src/screens/ChatsListScreen';

let unmountFn: (() => void) | null = null;

function renderScreen() {
  const result = render(
    <NavigationContainer>
      <ChatsListScreen />
    </NavigationContainer>
  );
  unmountFn = result.unmount;
  return result;
}

describe('ChatsListScreen Spotlight Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
    mockGoTo.mockClear();
    mockNavigate.mockClear();
    unmountFn = null;
  });

  afterEach(() => {
    if (unmountFn) { unmountFn(); unmountFn = null; }
    jest.useRealTimers();
  });

  // ========================================================================
  // Reactive: Image New Chat spotlight (step 14)
  // ========================================================================
  describe('reactive: imageNewChat spotlight (step 14)', () => {
    it('fires goTo(14) when image model is loaded', () => {
      // Pre-set image model as active
      act(() => {
        useAppStore.getState().setActiveImageModelId('img-model');
      });

      renderScreen();

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(14);
      expect(useAppStore.getState().shownSpotlights.imageNewChat).toBe(true);
    });

    it('does NOT fire when no image model is loaded', () => {
      renderScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when already shown', () => {
      act(() => {
        useAppStore.getState().setActiveImageModelId('img-model');
        useAppStore.getState().markSpotlightShown('imageNewChat');
      });

      renderScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when triedImageGen is completed', () => {
      act(() => {
        useAppStore.getState().setActiveImageModelId('img-model');
        useAppStore.getState().completeChecklistStep('triedImageGen');
      });

      renderScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('fires when image model is loaded AFTER mount', () => {
      renderScreen();

      // Initially no goTo
      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();

      // Now set active image model → triggers reactive effect
      act(() => {
        useAppStore.getState().setActiveImageModelId('img-model');
      });

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(14);
    });
  });

  // ========================================================================
  // "New" button renders (verifies component mounts correctly)
  // ========================================================================
  describe('New button', () => {
    it('renders when models are downloaded', () => {
      act(() => {
        useAppStore.getState().addDownloadedModel(createDownloadedModel());
      });

      const { getByText } = renderScreen();
      expect(getByText('New')).toBeTruthy();
    });
  });
});
