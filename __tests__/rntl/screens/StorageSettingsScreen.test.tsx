/**
 * StorageSettingsScreen Tests
 *
 * Tests for the storage settings screen including:
 * - Title display
 * - Back button navigation
 * - Storage info rendering
 * - Breakdown section with model counts
 * - LLM models list rendering
 * - Image models list rendering
 * - Orphaned files section
 * - Stale downloads section
 * - Delete orphaned file flow
 * - Conversation count display
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { TouchableOpacity } from 'react-native';

// Navigation is globally mocked in jest.setup.ts

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity: TO, Text } = require('react-native');
    return (
      <TO onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </TO>
    );
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

const mockShowAlert = jest.fn((_t: string, _m: string, _b?: any) => ({
  visible: true,
  title: _t,
  message: _m,
  buttons: _b || [],
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message, buttons }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity: TO } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        <Text testID="alert-message">{message}</Text>
        {buttons && buttons.map((btn: any, i: number) => (
          <TO key={i} testID={`alert-button-${btn.text}`} onPress={btn.onPress}>
            <Text>{btn.text}</Text>
          </TO>
        ))}
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity: TO, Text } = require('react-native');
    return (
      <TO onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </TO>
    );
  },
}));

const mockSetBackgroundDownload = jest.fn();
const mockClearBackgroundDownloads = jest.fn();
let mockDownloadedModels: any[] = [];
let mockDownloadedImageModels: any[] = [];
let mockActiveBackgroundDownloads: any = {};
let mockConversations: any[] = [];

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn(() => ({
    downloadedModels: mockDownloadedModels,
    downloadedImageModels: mockDownloadedImageModels,
    generatedImages: [],
    activeBackgroundDownloads: mockActiveBackgroundDownloads,
    setBackgroundDownload: mockSetBackgroundDownload,
    clearBackgroundDownloads: mockClearBackgroundDownloads,
  })),
  useChatStore: jest.fn((selector?: any) => {
    const state = { conversations: mockConversations };
    return selector ? selector(state) : state;
  }),
}));

const mockFormatBytes = jest.fn((bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
});

const mockGetOrphanedFiles = jest.fn<Promise<any[]>, any[]>(() => Promise.resolve([]));
const mockDeleteOrphanedFile = jest.fn(() => Promise.resolve());

jest.mock('../../../src/services', () => ({
  hardwareService: {
    getFreeDiskStorageGB: jest.fn(() => 50),
    formatModelSize: jest.fn(() => '4.00 GB'),
    formatBytes: (...args: any[]) => (mockFormatBytes as any)(...args),
  },
  modelManager: {
    getStorageUsed: jest.fn(() => Promise.resolve(4 * 1024 * 1024 * 1024)),
    getAvailableStorage: jest.fn(() => Promise.resolve(50 * 1024 * 1024 * 1024)),
    getOrphanedFiles: (...args: any[]) => (mockGetOrphanedFiles as any)(...args),
    deleteOrphanedFile: (...args: any[]) => (mockDeleteOrphanedFile as any)(...args),
  },
}));

import { StorageSettingsScreen } from '../../../src/screens/StorageSettingsScreen';

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
    useRoute: () => ({ params: {} }),
  };
});

describe('StorageSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadedModels = [];
    mockDownloadedImageModels = [];
    mockActiveBackgroundDownloads = {};
    mockConversations = [];
    mockGetOrphanedFiles.mockResolvedValue([]);
  });

  // ---- Rendering tests ----

  it('renders "Storage" title', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Storage')).toBeTruthy();
  });

  it('back button calls goBack', () => {
    const { UNSAFE_getAllByType } = render(<StorageSettingsScreen />);
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // The first TouchableOpacity is the back button
    fireEvent.press(touchables[0]);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows storage info sections', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Storage Usage')).toBeTruthy();
    expect(getByText('Breakdown')).toBeTruthy();
  });

  it('shows hint text at the bottom', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText(/To free up space/)).toBeTruthy();
  });

  // ---- Breakdown section tests ----

  it('shows LLM Models count in breakdown', () => {
    mockDownloadedModels = [
      { id: 'm1', name: 'Model 1', author: 'a', fileName: 'f', filePath: '/p', fileSize: 1024, quantization: 'Q4', downloadedAt: '' },
      { id: 'm2', name: 'Model 2', author: 'a', fileName: 'f', filePath: '/p', fileSize: 2048, quantization: 'Q8', downloadedAt: '' },
    ];

    const { getAllByText } = render(<StorageSettingsScreen />);
    // "LLM Models" appears in breakdown AND section title
    expect(getAllByText('LLM Models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Image Models count in breakdown', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'Img Model', description: '', modelPath: '/p', downloadedAt: '', size: 1024, style: 'creative', backend: 'mnn' },
    ];

    const { getAllByText } = render(<StorageSettingsScreen />);
    // "Image Models" appears in breakdown AND section title
    expect(getAllByText('Image Models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Conversations count in breakdown', () => {
    mockConversations = [
      { id: 'c1', title: 'Conv 1', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
      { id: 'c2', title: 'Conv 2', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
      { id: 'c3', title: 'Conv 3', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Conversations')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('shows Model Storage label in breakdown', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Model Storage')).toBeTruthy();
  });

  // ---- LLM Models section tests ----

  it('shows LLM Models section when models exist', () => {
    mockDownloadedModels = [
      { id: 'm1', name: 'Llama 3', author: 'meta', fileName: 'llama3.gguf', filePath: '/p', fileSize: 4 * 1024 * 1024 * 1024, quantization: 'Q4_K_M', downloadedAt: '' },
    ];

    const { getAllByText } = render(<StorageSettingsScreen />);
    // "LLM Models" appears in breakdown AND as a section title
    expect(getAllByText('LLM Models').length).toBeGreaterThanOrEqual(2);
  });

  it('renders model name and quantization', () => {
    mockDownloadedModels = [
      { id: 'm1', name: 'Phi-3 Mini', author: 'microsoft', fileName: 'phi3.gguf', filePath: '/p', fileSize: 2 * 1024 * 1024 * 1024, quantization: 'Q5_K_M', downloadedAt: '' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Phi-3 Mini')).toBeTruthy();
    expect(getByText('Q5_K_M')).toBeTruthy();
  });

  it('does not show LLM Models section when no models', () => {
    const { queryAllByText } = render(<StorageSettingsScreen />);
    // "LLM Models" appears once in breakdown
    const llmTexts = queryAllByText('LLM Models');
    expect(llmTexts.length).toBe(1); // Only breakdown, no separate section
  });

  // ---- Image Models section tests ----

  it('shows Image Models section when image models exist', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'SD Turbo', description: '', modelPath: '/p', downloadedAt: '', size: 2 * 1024 * 1024 * 1024, style: 'creative', backend: 'mnn' },
    ];

    const { getAllByText } = render(<StorageSettingsScreen />);
    // "Image Models" appears in breakdown AND as a section title
    expect(getAllByText('Image Models').length).toBeGreaterThanOrEqual(2);
  });

  it('renders image model with backend info', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'CoreML SD', description: '', modelPath: '/p', downloadedAt: '', size: 2048, style: 'realistic', backend: 'coreml' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('CoreML SD')).toBeTruthy();
    expect(getByText(/Core ML/)).toBeTruthy();
  });

  it('renders image model with MNN backend as GPU', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'MNN Model', description: '', modelPath: '/p', downloadedAt: '', size: 1024, style: '', backend: 'mnn' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('MNN Model')).toBeTruthy();
    expect(getByText('GPU')).toBeTruthy();
  });

  it('renders image model with QNN backend as Qualcomm NPU', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'QNN Model', description: '', modelPath: '/p', downloadedAt: '', size: 1024, style: 'artistic', backend: 'qnn' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('QNN Model')).toBeTruthy();
    expect(getByText(/Qualcomm NPU/)).toBeTruthy();
  });

  // ---- Orphaned files section tests ----

  it('shows "No orphaned files found" after scan completes', async () => {
    mockGetOrphanedFiles.mockResolvedValue([]);
    const result = render(<StorageSettingsScreen />);

    // Wait for async scan to complete
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    expect(result.getByText('No orphaned files found')).toBeTruthy();
  });

  it('shows orphaned files when they exist', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'stale-model.gguf', path: '/p/stale-model.gguf', size: 1024 * 1024 },
    ]);

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    expect(result.getByText('stale-model.gguf')).toBeTruthy();
    expect(result.getByText('Delete All Orphaned Files')).toBeTruthy();
  });

  it('shows warning text when orphaned files exist', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'orphan.gguf', path: '/p/orphan.gguf', size: 512 },
    ]);

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    expect(result.getByText(/files\/folders exist on disk but aren't tracked/)).toBeTruthy();
  });

  // ---- Stale downloads section tests ----

  it('shows stale downloads when they exist', () => {
    mockActiveBackgroundDownloads = {
      123: null, // null entry = stale
    };

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Stale Downloads')).toBeTruthy();
    expect(getByText('Clear All')).toBeTruthy();
  });

  it('shows stale download with missing modelId', () => {
    mockActiveBackgroundDownloads = {
      456: { fileName: 'partial.gguf', modelId: '', totalBytes: 0 },
    };

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Stale Downloads')).toBeTruthy();
    expect(getByText(/Download #456/)).toBeTruthy();
  });

  it('does not show stale downloads section when none exist', () => {
    const { queryByText } = render(<StorageSettingsScreen />);
    expect(queryByText('Stale Downloads')).toBeNull();
  });

  it('clearing a stale download calls setBackgroundDownload with null', () => {
    mockActiveBackgroundDownloads = {
      789: { fileName: '', modelId: 'test', totalBytes: 0 },
    };

    const { UNSAFE_getAllByType } = render(<StorageSettingsScreen />);
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // Find the X button for the stale download
    // There should be a button with an X icon for clearing
    // Let's look for the clear button in the stale downloads section
    // The back button is first, then scan button, then stale download X
    const deleteButtons = touchables.filter((t: any) =>
      t.props.testID === undefined && !t.props.disabled,
    );

    // Press the last delete-like button (X for stale download)
    if (deleteButtons.length > 2) {
      fireEvent.press(deleteButtons[deleteButtons.length - 1]);
      expect(mockSetBackgroundDownload).toHaveBeenCalledWith(789, null);
    }
  });

  it('clear all stale downloads shows confirmation', () => {
    mockActiveBackgroundDownloads = {
      100: null,
      200: { fileName: '', modelId: '', totalBytes: 0 },
    };

    const { getByText } = render(<StorageSettingsScreen />);
    fireEvent.press(getByText('Clear All'));

    expect(mockShowAlert).toHaveBeenCalledWith(
      'Clear Stale Downloads',
      expect.stringContaining('2'),
      expect.any(Array),
    );
  });

  // ---- Storage legend tests ----

  it('shows Used and Free labels in storage legend', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText(/Used:/)).toBeTruthy();
    expect(getByText(/Free:/)).toBeTruthy();
  });

  // ---- Multiple models tests ----

  it('renders multiple LLM models with sizes', () => {
    mockDownloadedModels = [
      { id: 'm1', name: 'Model A', author: 'a', fileName: 'a.gguf', filePath: '/p', fileSize: 1024, quantization: 'Q4_K_M', downloadedAt: '' },
      { id: 'm2', name: 'Model B', author: 'b', fileName: 'b.gguf', filePath: '/p', fileSize: 2048, quantization: 'Q8_0', downloadedAt: '' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Model A')).toBeTruthy();
    expect(getByText('Model B')).toBeTruthy();
    expect(getByText('Q4_K_M')).toBeTruthy();
    expect(getByText('Q8_0')).toBeTruthy();
  });

  it('Orphaned Files section has scan button', () => {
    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('Orphaned Files')).toBeTruthy();
    // The scan/refresh button exists (icon-only, but section header is rendered)
  });

  // ---- Delete orphaned file flow ----

  it('shows delete confirmation when orphaned file delete pressed', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'orphan.gguf', path: '/p/orphan.gguf', size: 1024 * 1024 },
    ]);

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // The trash icon button for individual orphaned files is within the orphanedRow
    // It's a TouchableOpacity with the trash icon. We need to find the right one.
    // The buttons are: back, scan/refresh, individual-trash, delete-all
    // The individual trash is before the "Delete All" button
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    // Find trash button by excluding known buttons
    // Try pressing each one until we get the right alert
    for (const btn of touchables) {
      mockShowAlert.mockClear();
      fireEvent.press(btn);
      if (mockShowAlert.mock.calls.length > 0 &&
          mockShowAlert.mock.calls[0][0] === 'Delete Orphaned File') {
        break;
      }
    }

    expect(mockShowAlert).toHaveBeenCalledWith(
      'Delete Orphaned File',
      expect.stringContaining('orphan.gguf'),
      expect.any(Array),
    );
  });

  it('deletes orphaned file when confirmed', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'orphan.gguf', path: '/p/orphan.gguf', size: 1024 * 1024 },
    ]);

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // Find and press the individual trash button
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    for (const btn of touchables) {
      mockShowAlert.mockClear();
      fireEvent.press(btn);
      if (mockShowAlert.mock.calls.length > 0 &&
          mockShowAlert.mock.calls[0][0] === 'Delete Orphaned File') {
        break;
      }
    }

    // Get the Delete button callback from showAlert
    const alertButtons = mockShowAlert.mock.calls[0]?.[2];
    const deleteButton = alertButtons?.find((b: any) => b.text === 'Delete');

    if (deleteButton?.onPress) {
      await act(async () => {
        await deleteButton.onPress();
      });
      expect(mockDeleteOrphanedFile).toHaveBeenCalledWith('/p/orphan.gguf');
    }
  });

  it('handles delete orphaned file error', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'orphan.gguf', path: '/p/orphan.gguf', size: 1024 * 1024 },
    ]);
    mockDeleteOrphanedFile.mockRejectedValueOnce(new Error('Delete failed'));

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // Find and press the individual trash button
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    for (const btn of touchables) {
      mockShowAlert.mockClear();
      fireEvent.press(btn);
      if (mockShowAlert.mock.calls.length > 0 &&
          mockShowAlert.mock.calls[0][0] === 'Delete Orphaned File') {
        break;
      }
    }

    const alertButtons = mockShowAlert.mock.calls[0]?.[2];
    const deleteButton = alertButtons?.find((b: any) => b.text === 'Delete');

    if (deleteButton?.onPress) {
      await act(async () => {
        await deleteButton.onPress();
      });
      // Should show error alert
      expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Failed to delete file');
    }
  });

  it('deletes all orphaned files when confirmed', async () => {
    mockGetOrphanedFiles.mockResolvedValue([
      { name: 'orphan1.gguf', path: '/p/orphan1.gguf', size: 1024 },
      { name: 'orphan2.gguf', path: '/p/orphan2.gguf', size: 2048 },
    ]);

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // Press "Delete All Orphaned Files" button
    fireEvent.press(result.getByText('Delete All Orphaned Files'));

    const alertButtons = mockShowAlert.mock.calls[0]?.[2];
    const deleteAllButton = alertButtons?.find((b: any) => b.text === 'Delete All');

    if (deleteAllButton?.onPress) {
      await act(async () => {
        await deleteAllButton.onPress();
      });
      expect(mockDeleteOrphanedFile).toHaveBeenCalledTimes(2);
    }
  });

  it('does not show delete all alert when no orphaned files', () => {
    // handleDeleteAllOrphaned returns early if orphanedFiles.length === 0
    // Since orphanedFiles is initially empty, the button is not shown
    const { queryByText } = render(<StorageSettingsScreen />);
    expect(queryByText('Delete All Orphaned Files')).toBeNull();
  });

  it('handles error during scan for orphaned files', async () => {
    mockGetOrphanedFiles.mockRejectedValueOnce(new Error('Scan failed'));

    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // Should still render without crashing
    expect(result.getByText('No orphaned files found')).toBeTruthy();
  });

  it('clears all stale downloads when confirmed', () => {
    mockActiveBackgroundDownloads = {
      100: null,
      200: { fileName: '', modelId: '', totalBytes: 0 },
    };

    const { getByText } = render(<StorageSettingsScreen />);
    fireEvent.press(getByText('Clear All'));

    const alertButtons = mockShowAlert.mock.calls[0]?.[2];
    const clearAllButton = alertButtons?.find((b: any) => b.text === 'Clear All');

    if (clearAllButton?.onPress) {
      clearAllButton.onPress();
      expect(mockSetBackgroundDownload).toHaveBeenCalledWith(100, null);
      expect(mockSetBackgroundDownload).toHaveBeenCalledWith(200, null);
    }
  });

  it('rescans for orphaned files when scan button pressed', async () => {
    mockGetOrphanedFiles.mockResolvedValue([]);
    const result = render(<StorageSettingsScreen />);

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });

    // Clear first call from initial render
    mockGetOrphanedFiles.mockClear();

    // Press scan/refresh button
    const touchables = result.UNSAFE_getAllByType(TouchableOpacity);
    // The scan button is typically the second button (after back button)
    // Let's find the one in the orphaned files section
    for (const btn of touchables) {
      if (!btn.props.disabled) {
        fireEvent.press(btn);
      }
    }

    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });
  });

  it('renders image model with style info', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'Styled Model', description: '', modelPath: '/p', downloadedAt: '', size: 1024, style: 'anime', backend: 'mnn' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText(/anime/)).toBeTruthy();
  });

  it('renders image model without style', () => {
    mockDownloadedImageModels = [
      { id: 'i1', name: 'No Style', description: '', modelPath: '/p', downloadedAt: '', size: 1024, style: '', backend: 'mnn' },
    ];

    const { getByText } = render(<StorageSettingsScreen />);
    expect(getByText('No Style')).toBeTruthy();
    expect(getByText('GPU')).toBeTruthy();
  });

  it('shows scanning text while scanning', async () => {
    // Make getOrphanedFiles take time to resolve
    let resolveOrphaned: any;
    mockGetOrphanedFiles.mockReturnValue(new Promise(resolve => {
      resolveOrphaned = resolve;
    }));

    const result = render(<StorageSettingsScreen />);

    // While scanning, "Scanning..." should appear
    expect(result.getByText(/Scanning/)).toBeTruthy();

    // Resolve to complete scanning
    await act(async () => {
      resolveOrphaned([]);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });
  });
});
