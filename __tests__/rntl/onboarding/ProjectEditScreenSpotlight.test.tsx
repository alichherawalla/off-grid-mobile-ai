/**
 * ProjectEditScreen Spotlight Integration Tests
 *
 * Renders the actual ProjectEditScreen and verifies:
 * - Pending spotlight consumption on mount (step 8)
 * - goTo fires with correct step index after 600ms delay
 * - No goTo when no pending spotlight
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
const mockRoute = { params: {} as any };
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
    useRoute: () => mockRoute,
  };
});

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: () => null,
  showAlert: jest.fn(),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

import { ProjectEditScreen } from '../../../src/screens/ProjectEditScreen';

let unmountFn: (() => void) | null = null;

function renderScreen() {
  const result = render(
    <NavigationContainer>
      <ProjectEditScreen />
    </NavigationContainer>
  );
  unmountFn = result.unmount;
  return result;
}

describe('ProjectEditScreen Spotlight Integration', () => {
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

  describe('pending spotlight consumption (Flow 6)', () => {
    it('consumes pending step 8 and fires goTo(8) after 600ms', () => {
      setPendingSpotlight(8);

      renderScreen();

      // Pending consumed
      expect(peekPendingSpotlight()).toBeNull();

      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(8);
    });

    it('does not fire goTo when no pending spotlight', () => {
      renderScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('clears pending after consumption', () => {
      setPendingSpotlight(8);

      renderScreen();

      // Immediately after mount, pending is consumed
      expect(peekPendingSpotlight()).toBeNull();
    });
  });

  describe('screen renders correctly', () => {
    it('renders project name input', () => {
      const { getByText } = renderScreen();
      expect(getByText('Name *')).toBeTruthy();
    });
  });
});
