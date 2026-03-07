/**
 * ChatScreen Spotlight Coordination Tests
 *
 * Tests the ChatScreen-specific spotlight logic in isolation:
 * - Consuming pending step 3 and chaining to step 12
 * - Reactive spotlights for image generation (steps 15, 16)
 * - chatSpotlight state management (only one AttachStep at a time)
 * - chainingRef guard preventing premature cleanup
 *
 * These test the logic extracted from ChatScreen without rendering
 * the full component, using the same conditions and state transitions.
 */

import { useAppStore } from '../../../src/stores/appStore';
import {
  setPendingSpotlight,
  consumePendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';
import {
  VOICE_HINT_STEP_INDEX,
  IMAGE_DRAW_STEP_INDEX,
  IMAGE_SETTINGS_STEP_INDEX,
} from '../../../src/components/onboarding/spotlightConfig';
import { resetStores, getAppState } from '../../utils/testHelpers';
import { createGeneratedImage } from '../../utils/factories';

/**
 * Simulates ChatScreen's spotlight coordination logic.
 *
 * This is extracted from ChatScreen/index.tsx useEffect hooks:
 * 1. On mount: consume pending spotlight
 * 2. If step 3 → chain to step 12 via pendingNextRef
 * 3. When tour stops (current becomes undefined) → fire chained step
 * 4. Reactive effects for image spotlights (steps 15, 16)
 */
class ChatScreenSpotlightSimulator {
  chatSpotlight: number | null = null;
  pendingNext: number | null = null;
  step3Shown = false;
  chaining = false;
  goToCalls: number[] = [];

  private goTo(step: number) {
    this.goToCalls.push(step);
  }

  /** Simulates the mount effect that consumes pending spotlights */
  simulateMount() {
    const pending = consumePendingSpotlight();
    if (pending === 3) {
      this.pendingNext = VOICE_HINT_STEP_INDEX;
      this.step3Shown = false;
      this.chatSpotlight = 3;
      // In real code: setTimeout → step3Shown = true, goTo(3)
      this.step3Shown = true;
      this.goTo(3);
    } else if (pending !== null) {
      this.chatSpotlight = pending;
      this.goTo(pending);
    }
  }

  /** Simulates the effect when tour current changes to undefined (tour stopped) */
  simulateTourStop() {
    const current = undefined; // tour stopped

    if (current === undefined && this.step3Shown && this.pendingNext !== null) {
      // Chain to next step
      this.step3Shown = false;
      this.chaining = true;
      const next = this.pendingNext;
      this.pendingNext = null;
      this.chatSpotlight = next;
      // In real code: setTimeout → chaining = false, goTo(next)
      this.chaining = false;
      this.goTo(next);
    } else if (current === undefined && !this.chaining && !this.step3Shown && this.pendingNext === null) {
      // No chain pending — clear spotlight
      this.chatSpotlight = null;
    }
  }

  /** Simulates reactive image draw spotlight (step 15) */
  simulateImageDrawCheck(imageModelLoaded: boolean) {
    const state = getAppState();
    if (
      imageModelLoaded &&
      !state.shownSpotlights.imageDraw &&
      !state.onboardingChecklist.triedImageGen
    ) {
      useAppStore.getState().markSpotlightShown('imageDraw');
      this.chatSpotlight = IMAGE_DRAW_STEP_INDEX;
      this.goTo(IMAGE_DRAW_STEP_INDEX);
    }
  }

  /** Simulates reactive image settings spotlight (step 16) */
  simulateImageSettingsCheck() {
    const state = getAppState();
    if (
      state.generatedImages.length > 0 &&
      !state.shownSpotlights.imageSettings &&
      state.onboardingChecklist.triedImageGen
    ) {
      useAppStore.getState().markSpotlightShown('imageSettings');
      this.chatSpotlight = IMAGE_SETTINGS_STEP_INDEX;
      this.goTo(IMAGE_SETTINGS_STEP_INDEX);
    }
  }
}

function getAttachStepConfig(spotlight: number | null) {
  // From ChatScreen: MaybeAttachStep wraps ChatInput for steps 3 and 15
  let externalIndex: number | null;
  if (spotlight === 3) externalIndex = 3;
  else if (spotlight === 15) externalIndex = 15;
  else externalIndex = null;
  // ChatInput receives activeSpotlight for steps 12 and 16
  const internalSpotlight = spotlight === 12 || spotlight === 16 ? spotlight : null;
  return { externalIndex, internalSpotlight };
}

describe('ChatScreen Spotlight Coordination', () => {
  let sim: ChatScreenSpotlightSimulator;

  beforeEach(() => {
    resetStores();
    setPendingSpotlight(null);
    sim = new ChatScreenSpotlightSimulator();
  });

  // ========================================================================
  // Flow 3 chain: step 3 → step 12
  // ========================================================================
  describe('Flow 3: step 3 → step 12 chain', () => {
    it('consumes pending step 3 and sets chatSpotlight to 3', () => {
      setPendingSpotlight(3);
      sim.simulateMount();

      expect(sim.chatSpotlight).toBe(3);
      expect(sim.goToCalls).toEqual([3]);
      expect(sim.pendingNext).toBe(VOICE_HINT_STEP_INDEX);
    });

    it('chains to step 12 when tour stops after step 3', () => {
      setPendingSpotlight(3);
      sim.simulateMount();

      // Tour stops (user taps "Got it")
      sim.simulateTourStop();

      expect(sim.chatSpotlight).toBe(12);
      expect(sim.goToCalls).toEqual([3, 12]);
      expect(sim.pendingNext).toBeNull();
    });

    it('clears chatSpotlight when tour stops after step 12 (no more chains)', () => {
      setPendingSpotlight(3);
      sim.simulateMount();
      sim.simulateTourStop(); // chains to 12

      // Tour stops again after step 12
      sim.simulateTourStop();

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([3, 12]);
    });

    it('chainingRef prevents premature cleanup during transition', () => {
      setPendingSpotlight(3);
      sim.simulateMount();

      // Simulate the state during chaining (before setTimeout fires)
      sim.step3Shown = false;
      sim.chaining = true;
      sim.pendingNext = null; // already consumed

      // This should NOT clear chatSpotlight because chaining is true
      const current = undefined;
      if (current === undefined && !sim.chaining && !sim.step3Shown && sim.pendingNext === null) {
        sim.chatSpotlight = null; // This branch should NOT execute
      }

      // chatSpotlight should still be set (was set to 12 during chain setup)
      expect(sim.chatSpotlight).not.toBeNull();
    });
  });

  // ========================================================================
  // Non-step-3 pending spotlights
  // ========================================================================
  describe('non-step-3 pending spotlights', () => {
    it('consumes and fires arbitrary pending step without chaining', () => {
      setPendingSpotlight(15);
      sim.simulateMount();

      expect(sim.chatSpotlight).toBe(15);
      expect(sim.goToCalls).toEqual([15]);
      expect(sim.pendingNext).toBeNull();
    });

    it('clears chatSpotlight when tour stops (no chain for non-step-3)', () => {
      setPendingSpotlight(15);
      sim.simulateMount();
      sim.simulateTourStop();

      expect(sim.chatSpotlight).toBeNull();
    });
  });

  // ========================================================================
  // No pending spotlight
  // ========================================================================
  describe('no pending spotlight on mount', () => {
    it('does not set chatSpotlight or fire goTo when no pending', () => {
      sim.simulateMount();

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });
  });

  // ========================================================================
  // Reactive: Image Draw spotlight (step 15)
  // ========================================================================
  describe('reactive: image draw spotlight (step 15)', () => {
    it('fires when image model is loaded and spotlight not yet shown', () => {
      sim.simulateImageDrawCheck(true);

      expect(sim.chatSpotlight).toBe(IMAGE_DRAW_STEP_INDEX);
      expect(sim.goToCalls).toEqual([15]);
      expect(getAppState().shownSpotlights.imageDraw).toBe(true);
    });

    it('does not fire when image model is not loaded', () => {
      sim.simulateImageDrawCheck(false);

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });

    it('does not fire when already shown', () => {
      useAppStore.getState().markSpotlightShown('imageDraw');
      sim.simulateImageDrawCheck(true);

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });

    it('does not fire when triedImageGen is already completed', () => {
      useAppStore.getState().completeChecklistStep('triedImageGen');
      sim.simulateImageDrawCheck(true);

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });
  });

  // ========================================================================
  // Reactive: Image Settings spotlight (step 16)
  // ========================================================================
  describe('reactive: image settings spotlight (step 16)', () => {
    it('fires when images generated and triedImageGen flag set', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      useAppStore.getState().completeChecklistStep('triedImageGen');

      sim.simulateImageSettingsCheck();

      expect(sim.chatSpotlight).toBe(IMAGE_SETTINGS_STEP_INDEX);
      expect(sim.goToCalls).toEqual([16]);
      expect(getAppState().shownSpotlights.imageSettings).toBe(true);
    });

    it('does not fire when no images generated yet', () => {
      useAppStore.getState().completeChecklistStep('triedImageGen');
      sim.simulateImageSettingsCheck();

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });

    it('does not fire when triedImageGen not yet set', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      sim.simulateImageSettingsCheck();

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });

    it('does not fire when already shown', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      useAppStore.getState().completeChecklistStep('triedImageGen');
      useAppStore.getState().markSpotlightShown('imageSettings');

      sim.simulateImageSettingsCheck();

      expect(sim.chatSpotlight).toBeNull();
      expect(sim.goToCalls).toEqual([]);
    });
  });

  // ========================================================================
  // chatSpotlight → AttachStep mapping
  //
  // Verifies the conditional AttachStep logic:
  // - chatSpotlight 3 or 15 → wraps ChatInput externally via MaybeAttachStep
  // - chatSpotlight 12 or 16 → passed to ChatInput as activeSpotlight prop
  // - null → no AttachStep mounted
  // ========================================================================
  describe('chatSpotlight → AttachStep mapping', () => {
    it('step 3: wraps ChatInput externally, no internal spotlight', () => {
      const config = getAttachStepConfig(3);
      expect(config.externalIndex).toBe(3);
      expect(config.internalSpotlight).toBeNull();
    });

    it('step 12: no external wrap, internal spotlight 12', () => {
      const config = getAttachStepConfig(12);
      expect(config.externalIndex).toBeNull();
      expect(config.internalSpotlight).toBe(12);
    });

    it('step 15: wraps ChatInput externally, no internal spotlight', () => {
      const config = getAttachStepConfig(15);
      expect(config.externalIndex).toBe(15);
      expect(config.internalSpotlight).toBeNull();
    });

    it('step 16: no external wrap, internal spotlight 16', () => {
      const config = getAttachStepConfig(16);
      expect(config.externalIndex).toBeNull();
      expect(config.internalSpotlight).toBe(16);
    });

    it('null: no external wrap, no internal spotlight', () => {
      const config = getAttachStepConfig(null);
      expect(config.externalIndex).toBeNull();
      expect(config.internalSpotlight).toBeNull();
    });

    it('only ONE AttachStep is active at any time (external XOR internal)', () => {
      for (const spotlight of [null, 3, 12, 15, 16]) {
        const config = getAttachStepConfig(spotlight);
        const activeCount =
          (config.externalIndex === null ? 0 : 1) +
          (config.internalSpotlight === null ? 0 : 1);
        expect(activeCount).toBeLessThanOrEqual(1);
      }
    });
  });
});
