/**
 * ToolPickerSheet Tests
 *
 * Tests for the tool picker bottom sheet including:
 * - Visibility (renders nothing when not visible)
 * - Renders all tool names and descriptions via testIDs
 * - Switch on/off state for enabled/disabled tools
 * - onToggleTool callback with correct tool ID
 * - onClose callback
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ToolPickerSheet } from '../../../src/components/ToolPickerSheet';
import { AVAILABLE_TOOLS } from '../../../src/services/tools/registry';

// Mock react-native-vector-icons/Feather as a simple Text showing icon name
jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

// Mock theme
jest.mock('../../../src/theme', () => {
  const mockColors = {
    text: '#000', textMuted: '#999', textSecondary: '#666',
    primary: '#007AFF', background: '#FFF', surface: '#F5F5F5', border: '#E0E0E0',
  };
  return {
    useTheme: () => ({ colors: mockColors }),
    useThemedStyles: (createStyles: Function) => createStyles(mockColors, {}),
  };
});

// Mock AppSheet to render children when visible, with a close button
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, onClose, title }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text>{title}</Text>
        <TouchableOpacity testID="sheet-close" onPress={onClose}>
          <Text>Close</Text>
        </TouchableOpacity>
        {children}
      </View>
    );
  },
}));

describe('ToolPickerSheet', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    enabledTools: ['web_search', 'calculator'],
    onToggleTool: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    const { queryByTestId } = render(
      <ToolPickerSheet {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  it('renders all tool rows with testIDs when visible', () => {
    const { getByTestId } = render(<ToolPickerSheet {...defaultProps} />);

    for (const tool of AVAILABLE_TOOLS) {
      expect(getByTestId(`tool-picker-row-${tool.id}`)).toBeTruthy();
      expect(getByTestId(`tool-picker-name-${tool.id}`)).toBeTruthy();
    }
  });

  it('renders tool descriptions', () => {
    const { getByText } = render(<ToolPickerSheet {...defaultProps} />);

    for (const tool of AVAILABLE_TOOLS) {
      expect(getByText(tool.description)).toBeTruthy();
    }
  });

  it('shows switches on for enabled tools and off for disabled', () => {
    const { getAllByRole } = render(
      <ToolPickerSheet {...defaultProps} enabledTools={['web_search', 'calculator']} />,
    );

    const switches = getAllByRole('switch');
    // AVAILABLE_TOOLS order: web_search, calculator, get_current_datetime, get_device_info
    expect(switches[0].props.value).toBe(true);  // web_search - enabled
    expect(switches[1].props.value).toBe(true);  // calculator - enabled
    expect(switches[2].props.value).toBe(false); // get_current_datetime - disabled
    expect(switches[3].props.value).toBe(false); // get_device_info - disabled
  });

  it('calls onToggleTool with correct tool ID when switch is toggled', () => {
    const onToggleTool = jest.fn();
    const { getAllByRole } = render(
      <ToolPickerSheet {...defaultProps} onToggleTool={onToggleTool} />,
    );

    const switches = getAllByRole('switch');
    fireEvent(switches[2], 'valueChange', true);

    expect(onToggleTool).toHaveBeenCalledTimes(1);
    expect(onToggleTool).toHaveBeenCalledWith('get_current_datetime');
  });

  it('calls onClose when close is triggered', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <ToolPickerSheet {...defaultProps} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
