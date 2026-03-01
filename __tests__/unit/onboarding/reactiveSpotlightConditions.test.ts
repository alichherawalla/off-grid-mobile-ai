/**
 * Reactive Spotlight Condition Tests
 *
 * Tests the exact boolean conditions that each screen's useEffect checks
 * before firing a reactive spotlight. These conditions are the "guards"
 * that prevent spotlights from firing at the wrong time.
 *
 * Each reactive spotlight has a specific condition pattern:
 *   condition && !shownSpotlights[key] && !onboardingChecklist.triedImageGen
 *
 * This file exhaustively tests every combination of inputs for each condition.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, getAppState } from '../../utils/testHelpers';
import { createONNXImageModel, createGeneratedImage } from '../../utils/factories';

describe('Reactive Spotlight Conditions', () => {
  beforeEach(() => {
    resetStores();
  });

  // ========================================================================
  // HomeScreen: Image Load spotlight (step 13)
  //
  // Condition from HomeScreen/index.tsx:
  //   downloadedImageModels.length > 0
  //   && !activeImageModelId
  //   && !shownSpotlights.imageLoad
  //   && !onboardingChecklist.triedImageGen
  // ========================================================================
  describe('HomeScreen: imageLoad spotlight (step 13)', () => {
    function shouldShowImageLoad(): boolean {
      const s = getAppState();
      return (
        s.downloadedImageModels.length > 0 &&
        !s.activeImageModelId &&
        !s.shownSpotlights.imageLoad &&
        !s.onboardingChecklist.triedImageGen
      );
    }

    it('shows when image model downloaded, not loaded, not shown, not completed', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      expect(shouldShowImageLoad()).toBe(true);
    });

    it('does NOT show when no image models downloaded', () => {
      expect(shouldShowImageLoad()).toBe(false);
    });

    it('does NOT show when image model is already loaded', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().setActiveImageModelId('some-model');
      expect(shouldShowImageLoad()).toBe(false);
    });

    it('does NOT show when already shown', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().markSpotlightShown('imageLoad');
      expect(shouldShowImageLoad()).toBe(false);
    });

    it('does NOT show when triedImageGen is completed', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(shouldShowImageLoad()).toBe(false);
    });
  });

  // ========================================================================
  // ChatsListScreen: Image New Chat spotlight (step 14)
  //
  // Condition from ChatsListScreen.tsx:
  //   activeImageModelId
  //   && !shownSpotlights.imageNewChat
  //   && !onboardingChecklist.triedImageGen
  // ========================================================================
  describe('ChatsListScreen: imageNewChat spotlight (step 14)', () => {
    function shouldShowImageNewChat(): boolean {
      const s = getAppState();
      return (
        !!s.activeImageModelId &&
        !s.shownSpotlights.imageNewChat &&
        !s.onboardingChecklist.triedImageGen
      );
    }

    it('shows when image model is loaded, not shown, not completed', () => {
      useAppStore.getState().setActiveImageModelId('img-model');
      expect(shouldShowImageNewChat()).toBe(true);
    });

    it('does NOT show when no image model loaded', () => {
      expect(shouldShowImageNewChat()).toBe(false);
    });

    it('does NOT show when already shown', () => {
      useAppStore.getState().setActiveImageModelId('img-model');
      useAppStore.getState().markSpotlightShown('imageNewChat');
      expect(shouldShowImageNewChat()).toBe(false);
    });

    it('does NOT show when triedImageGen is completed', () => {
      useAppStore.getState().setActiveImageModelId('img-model');
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(shouldShowImageNewChat()).toBe(false);
    });
  });

  // ========================================================================
  // ChatScreen: Image Draw spotlight (step 15)
  //
  // Condition from ChatScreen/index.tsx:
  //   chat.imageModelLoaded (derived from activeImageModelId !== null)
  //   && !shownSpotlights.imageDraw
  //   && !onboardingChecklist.triedImageGen
  // ========================================================================
  describe('ChatScreen: imageDraw spotlight (step 15)', () => {
    function shouldShowImageDraw(imageModelLoaded: boolean): boolean {
      const s = getAppState();
      return (
        imageModelLoaded &&
        !s.shownSpotlights.imageDraw &&
        !s.onboardingChecklist.triedImageGen
      );
    }

    it('shows when image model loaded, not shown, not completed', () => {
      expect(shouldShowImageDraw(true)).toBe(true);
    });

    it('does NOT show when image model not loaded', () => {
      expect(shouldShowImageDraw(false)).toBe(false);
    });

    it('does NOT show when already shown', () => {
      useAppStore.getState().markSpotlightShown('imageDraw');
      expect(shouldShowImageDraw(true)).toBe(false);
    });

    it('does NOT show when triedImageGen is completed', () => {
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(shouldShowImageDraw(true)).toBe(false);
    });
  });

  // ========================================================================
  // ChatScreen: Image Settings spotlight (step 16)
  //
  // Condition from ChatScreen/index.tsx:
  //   generatedImages.length > 0
  //   && !shownSpotlights.imageSettings
  //   && onboardingChecklist.triedImageGen  (note: POSITIVE check, not negated)
  // ========================================================================
  describe('ChatScreen: imageSettings spotlight (step 16)', () => {
    function shouldShowImageSettings(): boolean {
      const s = getAppState();
      return (
        s.generatedImages.length > 0 &&
        !s.shownSpotlights.imageSettings &&
        s.onboardingChecklist.triedImageGen
      );
    }

    it('shows when images exist, triedImageGen completed, not shown', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(shouldShowImageSettings()).toBe(true);
    });

    it('does NOT show when no images generated', () => {
      useAppStore.getState().completeChecklistStep('triedImageGen');
      expect(shouldShowImageSettings()).toBe(false);
    });

    it('does NOT show when triedImageGen NOT completed (images exist but flag not set)', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      // Note: triedImageGen is false — Part 5 requires it to be true
      expect(shouldShowImageSettings()).toBe(false);
    });

    it('does NOT show when already shown', () => {
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      useAppStore.getState().completeChecklistStep('triedImageGen');
      useAppStore.getState().markSpotlightShown('imageSettings');
      expect(shouldShowImageSettings()).toBe(false);
    });
  });

  // ========================================================================
  // Cross-condition: multiple reactive spotlights with shared state
  //
  // Verifies that marking one spotlight as shown doesn't affect others.
  // ========================================================================
  describe('cross-condition independence', () => {
    it('marking imageLoad as shown does not affect imageNewChat', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().markSpotlightShown('imageLoad');

      const s = getAppState();
      expect(s.shownSpotlights.imageLoad).toBe(true);
      expect(s.shownSpotlights.imageNewChat).toBeUndefined();
    });

    it('each shownSpotlight key is independent', () => {
      const keys = ['imageLoad', 'imageNewChat', 'imageDraw', 'imageSettings'];
      const store = useAppStore.getState();

      // Mark first two
      store.markSpotlightShown(keys[0]);
      store.markSpotlightShown(keys[1]);

      const s = getAppState();
      expect(s.shownSpotlights[keys[0]]).toBe(true);
      expect(s.shownSpotlights[keys[1]]).toBe(true);
      expect(s.shownSpotlights[keys[2]]).toBeUndefined();
      expect(s.shownSpotlights[keys[3]]).toBeUndefined();
    });

    it('resetChecklist clears all shownSpotlights at once', () => {
      const store = useAppStore.getState();
      store.markSpotlightShown('imageLoad');
      store.markSpotlightShown('imageNewChat');
      store.markSpotlightShown('imageDraw');
      store.markSpotlightShown('imageSettings');

      useAppStore.getState().resetChecklist();

      const s = getAppState();
      expect(s.shownSpotlights).toEqual({});
    });
  });

  // ========================================================================
  // Temporal ordering: spotlights fire in correct progression
  //
  // Tests that the state progression through all 4 reactive spotlights
  // follows the correct order as the user advances through the flow.
  // ========================================================================
  describe('temporal ordering of reactive spotlights', () => {
    it('only Part 2 can trigger before image model is loaded', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());

      const s = getAppState();
      // Part 2: YES (downloaded, not loaded)
      expect(s.downloadedImageModels.length > 0 && !s.activeImageModelId).toBe(true);
      // Part 3: NO (not loaded yet)
      expect(!!s.activeImageModelId).toBe(false);
      // Part 4: NO (same check)
      // Part 5: NO (no images)
      expect(s.generatedImages.length > 0).toBe(false);
    });

    it('Parts 3 and 4 can trigger after model is loaded', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().setActiveImageModelId('model');
      useAppStore.getState().markSpotlightShown('imageLoad');

      const s = getAppState();
      // Part 2: NO (model is loaded)
      expect(!s.activeImageModelId).toBe(false);
      // Part 3: YES
      expect(!!s.activeImageModelId && !s.shownSpotlights.imageNewChat).toBe(true);
      // Part 4: YES (same base condition, different shown key)
      expect(!!s.activeImageModelId && !s.shownSpotlights.imageDraw).toBe(true);
      // Part 5: NO (no images)
      expect(s.generatedImages.length > 0).toBe(false);
    });

    it('only Part 5 can trigger after image generation', () => {
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().setActiveImageModelId('model');
      useAppStore.getState().markSpotlightShown('imageLoad');
      useAppStore.getState().markSpotlightShown('imageNewChat');
      useAppStore.getState().markSpotlightShown('imageDraw');
      useAppStore.getState().addGeneratedImage(createGeneratedImage());
      useAppStore.getState().completeChecklistStep('triedImageGen');

      const s = getAppState();
      // Parts 2-4: NO (triedImageGen is true)
      expect(!s.onboardingChecklist.triedImageGen).toBe(false);
      // Part 5: YES
      expect(
        s.generatedImages.length > 0 &&
        !s.shownSpotlights.imageSettings &&
        s.onboardingChecklist.triedImageGen
      ).toBe(true);
    });
  });
});
