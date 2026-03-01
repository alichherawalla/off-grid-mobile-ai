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
import { mockGoTo, clearSpotlightMocks } from '../../utils/spotlightMocks';
import {
  setPendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';

jest.mock('react-native-spotlight-tour', () =>
  require('../../utils/spotlightMocks').createSpotlightTourMock()
);

jest.mock('@react-navigation/native', () =>
  require('../../utils/spotlightMocks').createNavigationMock()
);

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
    clearSpotlightMocks();
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
