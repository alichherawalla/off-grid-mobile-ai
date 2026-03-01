/**
 * handleStepPress Unit Tests
 *
 * Tests the HomeScreen handleStepPress logic in isolation.
 * This function is the entry point for all 6 onboarding flows:
 *   1. Closes the onboarding sheet
 *   2. Queues a pending spotlight for multi-step flows
 *   3. Navigates to the correct tab
 *   4. Fires goTo(stepIndex) after a delay
 *
 * These tests verify the state mutations and function calls that
 * handleStepPress makes, without rendering the full HomeScreen.
 */

import {
  setPendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';
import {
  STEP_INDEX_MAP,
  STEP_TAB_MAP,
  CHAT_INPUT_STEP_INDEX,
  MODEL_SETTINGS_STEP_INDEX,
  PROJECT_EDIT_STEP_INDEX,
  DOWNLOAD_FILE_STEP_INDEX,
  MODEL_PICKER_STEP_INDEX,
} from '../../../src/components/onboarding/spotlightConfig';

/**
 * Reimplements handleStepPress logic from HomeScreen/index.tsx
 * so we can test it without rendering the component.
 */
function simulateHandleStepPress(
  stepId: string,
  callbacks: { closeSheet: jest.Mock; navigate: jest.Mock; goTo: jest.Mock }
) {
  const { closeSheet, navigate, goTo } = callbacks;
  closeSheet();

  const tab = STEP_TAB_MAP[stepId];
  const stepIndex = STEP_INDEX_MAP[stepId];

  // Queue continuation spotlight for multi-step flows
  if (stepId === 'downloadedModel') {
    setPendingSpotlight(DOWNLOAD_FILE_STEP_INDEX);
  }
  if (stepId === 'loadedModel') {
    setPendingSpotlight(MODEL_PICKER_STEP_INDEX);
  }
  if (stepId === 'sentMessage') {
    setPendingSpotlight(CHAT_INPUT_STEP_INDEX);
  }
  if (stepId === 'exploredSettings') {
    setPendingSpotlight(MODEL_SETTINGS_STEP_INDEX);
  }
  if (stepId === 'createdProject') {
    setPendingSpotlight(PROJECT_EDIT_STEP_INDEX);
  }

  // Navigate to the correct tab
  if (tab && tab !== 'HomeTab') {
    navigate(tab);
  }

  // Delay spotlight based on whether cross-tab navigation is needed
  if (stepIndex !== undefined) {
    const delay = tab && tab !== 'HomeTab' ? 800 : 600;
    setTimeout(() => goTo(stepIndex), delay);
  }
}

describe('handleStepPress', () => {
  let closeSheet: jest.Mock;
  let navigate: jest.Mock;
  let goTo: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    setPendingSpotlight(null);
    closeSheet = jest.fn();
    navigate = jest.fn();
    goTo = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const callbacks = () => ({ closeSheet, navigate, goTo });

  // ========================================================================
  // Common behavior
  // ========================================================================
  describe('common behavior', () => {
    it('always closes the onboarding sheet first', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      expect(closeSheet).toHaveBeenCalledTimes(1);
    });

    it('does not navigate if tab is HomeTab (loadedModel)', () => {
      simulateHandleStepPress('loadedModel', callbacks());
      expect(navigate).not.toHaveBeenCalled();
    });

    it('navigates for non-HomeTab flows', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      expect(navigate).toHaveBeenCalledWith('ModelsTab');
    });

    it('uses 800ms delay for cross-tab navigations', () => {
      simulateHandleStepPress('downloadedModel', callbacks());

      // Not called before 800ms
      jest.advanceTimersByTime(799);
      expect(goTo).not.toHaveBeenCalled();

      // Called at 800ms
      jest.advanceTimersByTime(1);
      expect(goTo).toHaveBeenCalledWith(0);
    });

    it('uses 600ms delay for same-tab flows (HomeTab)', () => {
      simulateHandleStepPress('loadedModel', callbacks());

      jest.advanceTimersByTime(599);
      expect(goTo).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(goTo).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Flow 1: Download a Model
  // ========================================================================
  describe('Flow 1: downloadedModel', () => {
    it('queues step 9 (DOWNLOAD_FILE_STEP_INDEX) as pending', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      expect(peekPendingSpotlight()).toBe(9);
    });

    it('navigates to ModelsTab', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      expect(navigate).toHaveBeenCalledWith('ModelsTab');
    });

    it('fires goTo(0) after delay', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      jest.advanceTimersByTime(800);
      expect(goTo).toHaveBeenCalledWith(0);
    });
  });

  // ========================================================================
  // Flow 2: Load a Model
  // ========================================================================
  describe('Flow 2: loadedModel', () => {
    it('queues step 11 (MODEL_PICKER_STEP_INDEX) as pending', () => {
      simulateHandleStepPress('loadedModel', callbacks());
      expect(peekPendingSpotlight()).toBe(11);
    });

    it('does not navigate (stays on HomeTab)', () => {
      simulateHandleStepPress('loadedModel', callbacks());
      expect(navigate).not.toHaveBeenCalled();
    });

    it('fires goTo(1) after delay', () => {
      simulateHandleStepPress('loadedModel', callbacks());
      jest.advanceTimersByTime(600);
      expect(goTo).toHaveBeenCalledWith(1);
    });
  });

  // ========================================================================
  // Flow 3: Send Message
  // ========================================================================
  describe('Flow 3: sentMessage', () => {
    it('queues step 3 (CHAT_INPUT_STEP_INDEX) as pending', () => {
      simulateHandleStepPress('sentMessage', callbacks());
      expect(peekPendingSpotlight()).toBe(3);
    });

    it('navigates to ChatsTab', () => {
      simulateHandleStepPress('sentMessage', callbacks());
      expect(navigate).toHaveBeenCalledWith('ChatsTab');
    });

    it('fires goTo(2) after delay', () => {
      simulateHandleStepPress('sentMessage', callbacks());
      jest.advanceTimersByTime(800);
      expect(goTo).toHaveBeenCalledWith(2);
    });
  });

  // ========================================================================
  // Flow 4: Try Image Generation
  // ========================================================================
  describe('Flow 4: triedImageGen', () => {
    it('does NOT queue any pending spotlight (only immediate step)', () => {
      simulateHandleStepPress('triedImageGen', callbacks());
      expect(peekPendingSpotlight()).toBeNull();
    });

    it('navigates to ModelsTab', () => {
      simulateHandleStepPress('triedImageGen', callbacks());
      expect(navigate).toHaveBeenCalledWith('ModelsTab');
    });

    it('fires goTo(4) after delay', () => {
      simulateHandleStepPress('triedImageGen', callbacks());
      jest.advanceTimersByTime(800);
      expect(goTo).toHaveBeenCalledWith(4);
    });
  });

  // ========================================================================
  // Flow 5: Explore Settings
  // ========================================================================
  describe('Flow 5: exploredSettings', () => {
    it('queues step 6 (MODEL_SETTINGS_STEP_INDEX) as pending', () => {
      simulateHandleStepPress('exploredSettings', callbacks());
      expect(peekPendingSpotlight()).toBe(6);
    });

    it('navigates to SettingsTab', () => {
      simulateHandleStepPress('exploredSettings', callbacks());
      expect(navigate).toHaveBeenCalledWith('SettingsTab');
    });

    it('fires goTo(5) after delay', () => {
      simulateHandleStepPress('exploredSettings', callbacks());
      jest.advanceTimersByTime(800);
      expect(goTo).toHaveBeenCalledWith(5);
    });
  });

  // ========================================================================
  // Flow 6: Create Project
  // ========================================================================
  describe('Flow 6: createdProject', () => {
    it('queues step 8 (PROJECT_EDIT_STEP_INDEX) as pending', () => {
      simulateHandleStepPress('createdProject', callbacks());
      expect(peekPendingSpotlight()).toBe(8);
    });

    it('navigates to ProjectsTab', () => {
      simulateHandleStepPress('createdProject', callbacks());
      expect(navigate).toHaveBeenCalledWith('ProjectsTab');
    });

    it('fires goTo(7) after delay', () => {
      simulateHandleStepPress('createdProject', callbacks());
      jest.advanceTimersByTime(800);
      expect(goTo).toHaveBeenCalledWith(7);
    });
  });

  // ========================================================================
  // Edge cases
  // ========================================================================
  describe('edge cases', () => {
    it('calling two flows in sequence overwrites the pending spotlight', () => {
      simulateHandleStepPress('downloadedModel', callbacks());
      expect(peekPendingSpotlight()).toBe(9);

      simulateHandleStepPress('sentMessage', callbacks());
      expect(peekPendingSpotlight()).toBe(3);
    });

    it('unknown stepId does not queue or navigate', () => {
      simulateHandleStepPress('unknownStep', callbacks());
      expect(peekPendingSpotlight()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(goTo).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(goTo).not.toHaveBeenCalled();
    });
  });
});
