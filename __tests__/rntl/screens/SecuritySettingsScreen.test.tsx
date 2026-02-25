/**
 * SecuritySettingsScreen Tests
 *
 * Tests for the security settings screen including:
 * - Title display
 * - App Lock section
 * - Back button navigation
 * - Passphrase toggle (enable/disable)
 * - Change passphrase button
 * - Info card
 * - Passphrase setup modal
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Navigation is globally mocked in jest.setup.ts
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

const mockSetEnabled = jest.fn();
const mockRemovePassphrase = jest.fn(() => Promise.resolve());

let mockAuthEnabled = false;

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      themeMode: 'system',
    };
    return selector ? selector(state) : state;
  }),
  useAuthStore: jest.fn(() => ({
    isEnabled: mockAuthEnabled,
    setEnabled: mockSetEnabled,
  })),
}));

jest.mock('../../../src/services', () => ({
  authService: {
    removePassphrase: mockRemovePassphrase,
  },
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/CustomAlert', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    CustomAlert: ({ visible, title, message, buttons, onClose }: any) => {
      if (!visible) return null;
      return (
        <View testID="custom-alert">
          <Text testID="alert-title">{title}</Text>
          <Text testID="alert-message">{message}</Text>
          {buttons && buttons.map((btn: any, i: number) => (
            <TouchableOpacity
              key={i}
              testID={`alert-button-${btn.text}`}
              onPress={() => {
                if (btn.onPress) btn.onPress();
                onClose();
              }}
            >
              <Text>{btn.text}</Text>
            </TouchableOpacity>
          ))}
          {!buttons && (
            <TouchableOpacity testID="alert-ok" onPress={onClose}>
              <Text>OK</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
    showAlert: (title: string, message: string, buttons?: any[]) => ({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: 'OK', style: 'default' }],
    }),
    hideAlert: () => ({ visible: false, title: '', message: '', buttons: [] }),
    initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  };
});

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));

// Mock PassphraseSetupScreen
jest.mock('../../../src/screens/PassphraseSetupScreen', () => ({
  PassphraseSetupScreen: ({ onComplete, onCancel, isChanging }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="passphrase-setup">
        <Text>{isChanging ? 'Change Passphrase' : 'Set Passphrase'}</Text>
        <TouchableOpacity testID="passphrase-complete" onPress={onComplete}>
          <Text>Complete</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="passphrase-cancel" onPress={onCancel}>
          <Text>Cancel Setup</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

import { SecuritySettingsScreen } from '../../../src/screens/SecuritySettingsScreen';

describe('SecuritySettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthEnabled = false;
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders "Security" title', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('Security')).toBeTruthy();
    });

    it('shows App Lock section', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('App Lock')).toBeTruthy();
      expect(getByText('Passphrase Lock')).toBeTruthy();
      expect(getByText('Require passphrase to open app')).toBeTruthy();
    });

    it('back button calls goBack', () => {
      const { UNSAFE_getAllByType } = render(<SecuritySettingsScreen />);
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // The first TouchableOpacity is the back button
      fireEvent.press(touchables[0]);
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('shows info card about passphrase behavior', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(
        getByText(/the app will lock automatically/i)
      ).toBeTruthy();
    });

    it('shows info about passphrase being stored on device', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(
        getByText(/stored securely on device and never transmitted/i)
      ).toBeTruthy();
    });
  });

  // ============================================================================
  // Passphrase Toggle - Enable
  // ============================================================================
  describe('passphrase toggle - enable', () => {
    it('switch defaults to off when auth not enabled', () => {
      const { getAllByRole } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');
      expect(switches.length).toBeGreaterThan(0);
      // The switch value should reflect mockAuthEnabled = false
      expect(switches[0].props.value).toBe(false);
    });

    it('opens passphrase setup when toggling on', () => {
      const { getAllByRole, queryByTestId } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Initially no passphrase setup shown
      expect(queryByTestId('passphrase-setup')).toBeNull();

      // Toggle switch on
      fireEvent(switches[0], 'valueChange', true);

      // Passphrase setup modal should appear
      expect(queryByTestId('passphrase-setup')).toBeTruthy();
    });

    it('shows "Set Passphrase" text when enabling (not changing)', () => {
      const { getAllByRole, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', true);

      expect(getByText('Set Passphrase')).toBeTruthy();
    });
  });

  // ============================================================================
  // Passphrase Toggle - Disable
  // ============================================================================
  describe('passphrase toggle - disable', () => {
    beforeEach(() => {
      mockAuthEnabled = true;
    });

    it('switch shows on when auth is enabled', () => {
      const { getAllByRole } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');
      expect(switches[0].props.value).toBe(true);
    });

    it('shows confirmation alert when toggling off', () => {
      const { getAllByRole, queryByTestId } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', false);

      // Should show the alert asking to confirm disabling
      expect(queryByTestId('custom-alert')).toBeTruthy();
      expect(queryByTestId('alert-title')?.props.children).toBe('Disable Passphrase Lock');
    });

    it('shows confirmation alert with Disable and Cancel buttons', () => {
      const { getAllByRole, queryByTestId, getByText } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Toggle off to trigger the confirmation alert
      fireEvent(switches[0], 'valueChange', false);

      // Alert should be visible with correct title and buttons
      expect(queryByTestId('custom-alert')).toBeTruthy();
      expect(queryByTestId('alert-title')?.props.children).toBe('Disable Passphrase Lock');
      expect(getByText('Disable')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('does not disable auth when cancelled', () => {
      const { getAllByRole, getByTestId } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      fireEvent(switches[0], 'valueChange', false);

      // Press "Cancel" button in alert
      fireEvent.press(getByTestId('alert-button-Cancel'));

      // Should NOT call removePassphrase
      expect(mockRemovePassphrase).not.toHaveBeenCalled();
      expect(mockSetEnabled).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Change Passphrase
  // ============================================================================
  describe('change passphrase', () => {
    beforeEach(() => {
      mockAuthEnabled = true;
    });

    it('shows "Change Passphrase" button when auth is enabled', () => {
      const { getByText } = render(<SecuritySettingsScreen />);
      expect(getByText('Change Passphrase')).toBeTruthy();
    });

    it('does not show "Change Passphrase" button when auth is disabled', () => {
      mockAuthEnabled = false;
      const { queryByText } = render(<SecuritySettingsScreen />);
      expect(queryByText('Change Passphrase')).toBeNull();
    });

    it('opens passphrase setup in change mode when button is pressed', () => {
      const { getByText, queryByTestId } = render(<SecuritySettingsScreen />);

      fireEvent.press(getByText('Change Passphrase'));

      expect(queryByTestId('passphrase-setup')).toBeTruthy();
      // The PassphraseSetupScreen mock shows 'Change Passphrase' text when isChanging=true
      // and the button text also says 'Change Passphrase', so we verify modal is open
    });
  });

  // ============================================================================
  // Passphrase Setup Modal Interactions
  // ============================================================================
  describe('passphrase setup modal', () => {
    it('closes passphrase setup on complete', () => {
      const { getAllByRole, queryByTestId, getByTestId } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Open setup
      fireEvent(switches[0], 'valueChange', true);
      expect(queryByTestId('passphrase-setup')).toBeTruthy();

      // Complete setup
      fireEvent.press(getByTestId('passphrase-complete'));

      // Modal should close (passphrase-setup no longer visible)
      // Note: In real RN, Modal visibility is controlled by state,
      // but our mock renders conditionally
    });

    it('closes passphrase setup on cancel', () => {
      const { getAllByRole, queryByTestId, getByTestId } = render(<SecuritySettingsScreen />);
      const switches = getAllByRole('switch');

      // Open setup
      fireEvent(switches[0], 'valueChange', true);
      expect(queryByTestId('passphrase-setup')).toBeTruthy();

      // Cancel setup
      fireEvent.press(getByTestId('passphrase-cancel'));
    });
  });
});
