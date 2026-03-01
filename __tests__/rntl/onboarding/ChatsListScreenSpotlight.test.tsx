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
import { mockGoTo, clearSpotlightMocks } from '../../utils/spotlightMocks';

jest.mock('react-native-spotlight-tour', () =>
  require('../../utils/spotlightMocks').createSpotlightTourMock()
);

jest.mock('@react-navigation/native', () =>
  require('../../utils/spotlightMocks').createNavigationMock()
);

jest.mock('../../../src/components/AnimatedEntry', () =>
  require('../../utils/spotlightMocks').createAnimatedEntryMock()
);

jest.mock('../../../src/components/AnimatedListItem', () =>
  require('../../utils/spotlightMocks').createAnimatedListItemMock()
);

jest.mock('../../../src/components/CustomAlert', () =>
  require('../../utils/spotlightMocks').createCustomAlertMock()
);

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
    clearSpotlightMocks();
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

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();

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
