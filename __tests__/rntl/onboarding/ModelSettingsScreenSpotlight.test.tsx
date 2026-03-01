/**
 * ModelSettingsScreen Spotlight Integration Tests
 *
 * Renders the actual ModelSettingsScreen and verifies:
 * - Pending spotlight consumption on mount (step 6)
 * - goTo fires with correct step index after 600ms delay
 * - No goTo when no pending spotlight
 * - Pending spotlight is cleared after consumption
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { resetStores } from '../../utils/testHelpers';
import {
  setPendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';

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
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock Slider used in TextGenerationSection
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return (props: any) => <View testID={props.testID} />;
});

import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

let unmountFn: (() => void) | null = null;

function renderScreen() {
  const result = render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>
  );
  unmountFn = result.unmount;
  return result;
}

describe('ModelSettingsScreen Spotlight Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
    setPendingSpotlight(null);
    mockGoTo.mockClear();
    unmountFn = null;
  });

  afterEach(() => {
    if (unmountFn) { unmountFn(); unmountFn = null; }
    jest.useRealTimers();
  });

  describe('pending spotlight consumption (Flow 5)', () => {
    it('consumes pending step 6 and fires goTo(6) after 600ms', () => {
      setPendingSpotlight(6);

      renderScreen();

      // Pending should be consumed
      expect(peekPendingSpotlight()).toBeNull();

      // Not fired yet
      expect(mockGoTo).not.toHaveBeenCalled();

      // After 600ms delay
      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(6);
    });

    it('does not fire goTo when no pending spotlight', () => {
      renderScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('consumes any pending step index', () => {
      setPendingSpotlight(42);

      renderScreen();

      expect(peekPendingSpotlight()).toBeNull();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(42);
    });
  });

  describe('screen renders correctly', () => {
    it('renders system prompt accordion', () => {
      const { getByTestId } = renderScreen();
      expect(getByTestId('system-prompt-accordion')).toBeTruthy();
    });
  });
});
