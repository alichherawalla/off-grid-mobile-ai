/**
 * ModelDownloadScreen Tests
 *
 * Tests for the model download screen including:
 * - Screen rendering (loading state)
 * - Loaded state with recommended models
 * - Skip button
 * - Model selection and file fetching
 * - Download flow (foreground and background)
 * - Error handling
 * - Warning card for limited compatibility
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      replace: mockReplace,
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

const mockAppState = {
  downloadedModels: [],
  settings: {},
  deviceInfo: { deviceModel: 'Test Device', availableMemory: 8000000000 },
  setDeviceInfo: jest.fn(),
  setModelRecommendation: jest.fn(),
  downloadProgress: {} as Record<string, any>,
  setDownloadProgress: jest.fn(),
  addDownloadedModel: jest.fn(),
  setActiveModelId: jest.fn(),
  themeMode: 'system',
};

jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    return selector ? selector(mockAppState) : mockAppState;
  }),
}));

const mockGetModelFiles = jest.fn<Promise<any[]>, any[]>(() => Promise.resolve([]));
const mockDownloadModel = jest.fn();
const mockDownloadModelBackground = jest.fn();

jest.mock('../../../src/services', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({ deviceModel: 'Test Device', availableMemory: 8000000000 })),
    getModelRecommendation: jest.fn(() => ({ tier: 'medium' })),
    getTotalMemoryGB: jest.fn(() => 8),
    formatBytes: jest.fn((bytes: number) => `${(bytes / 1e9).toFixed(1)}GB`),
  },
  huggingFaceService: {
    getModelFiles: jest.fn((...args: any[]) => (mockGetModelFiles as any)(...args)),
  },
  modelManager: {
    isBackgroundDownloadSupported: jest.fn(() => false),
    downloadModel: jest.fn((...args: any[]) => mockDownloadModel(...args)),
    downloadModelBackground: jest.fn((...args: any[]) => mockDownloadModelBackground(...args)),
    watchDownload: jest.fn(),
  },
}));

const { hardwareService: mockHardwareService, modelManager: mockModelManager, huggingFaceService: mockHuggingFaceService } = jest.requireMock('../../../src/services');

const mockShowAlert = jest.fn((_t: string, _m: string, _b?: any) => ({
  visible: true,
  title: _t,
  message: _m,
  buttons: _b || [],
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
  ModelCard: ({ model, onPress, onDownload, testID, _file, isDownloading }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID={testID}>
        <Text>{model?.name || 'ModelCard'}</Text>
        {onPress && (
          <TouchableOpacity testID={`${testID}-press`} onPress={onPress}>
            <Text>Select</Text>
          </TouchableOpacity>
        )}
        {onDownload && (
          <TouchableOpacity testID={`${testID}-download`} onPress={onDownload}>
            <Text>Download</Text>
          </TouchableOpacity>
        )}
        {isDownloading && <Text testID={`${testID}-downloading`}>Downloading...</Text>}
      </View>
    );
  },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message, buttons, onClose }: any) => {
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
        <TO testID="alert-close" onPress={onClose}>
          <Text>CloseAlert</Text>
        </TO>
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const { View } = require('react-native');
    return <View {...props}>{children}</View>;
  },
}));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { ModelDownloadScreen } from '../../../src/screens/ModelDownloadScreen';

const MOCK_FILE = {
  name: 'model-Q4_K_M.gguf',
  size: 4000000000,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://example.com/model.gguf',
};

const mockNavigation: any = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  replace: mockReplace,
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};

describe('ModelDownloadScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.downloadProgress = {};
    mockGetModelFiles.mockResolvedValue([]);
    mockDownloadModel.mockResolvedValue(undefined);
    mockDownloadModelBackground.mockResolvedValue(undefined);
    mockHardwareService.getDeviceInfo.mockResolvedValue({ deviceModel: 'Test Device', availableMemory: 8000000000 });
    mockHardwareService.getModelRecommendation.mockReturnValue({ tier: 'medium' });
    mockHardwareService.getTotalMemoryGB.mockReturnValue(8);
    mockHardwareService.formatBytes.mockImplementation((bytes: number) => `${(bytes / 1e9).toFixed(1)}GB`);
    mockModelManager.isBackgroundDownloadSupported.mockReturnValue(true);
    mockModelManager.downloadModel.mockImplementation((...args: any[]) => (mockDownloadModel as any)(...args));
    mockModelManager.downloadModelBackground.mockImplementation((...args: any[]) => (mockDownloadModelBackground as any)(...args));
    mockHuggingFaceService.getModelFiles.mockImplementation((...args: any[]) => (mockGetModelFiles as any)(...args));
  });

  it('renders the loading state initially', () => {
    const { getByText } = render(
      <ModelDownloadScreen navigation={mockNavigation} />,
    );
    expect(getByText('Analyzing your device...')).toBeTruthy();
  });

  it('renders with testID for loading state', () => {
    const { getByTestId } = render(
      <ModelDownloadScreen navigation={mockNavigation} />,
    );
    expect(getByTestId('model-download-loading')).toBeTruthy();
  });

  it('renders the loaded state with recommended models', async () => {
    mockGetModelFiles.mockResolvedValue([
      {
        name: 'model-Q4_K_M.gguf',
        size: 4000000000,
        quantization: 'Q4_K_M',
        downloadUrl: 'https://example.com/model.gguf',
      },
    ]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    expect(result.getByTestId('model-download-screen')).toBeTruthy();
    expect(result.getByText('Download Your First Model')).toBeTruthy();
    expect(result.getByText(/Based on your device/)).toBeTruthy();
    expect(result.getByText('Recommended Models')).toBeTruthy();
  });

  it('renders device info card after loading', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    expect(result.getByText('Your Device')).toBeTruthy();
    expect(result.getByText('Test Device')).toBeTruthy();
    expect(result.getByText('Available Memory')).toBeTruthy();
  });

  it('skip button navigates to Main', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const skipButton = result.getByTestId('model-download-skip');
    fireEvent.press(skipButton);
    expect(mockReplace).toHaveBeenCalledWith('Main');
  });

  it('renders recommended models based on device RAM', async () => {
    mockGetModelFiles.mockResolvedValue([
      {
        name: 'model-Q4_K_M.gguf',
        size: 4000000000,
        quantization: 'Q4_K_M',
        downloadUrl: 'https://example.com/model.gguf',
      },
    ]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    expect(result.getByTestId('recommended-model-0')).toBeTruthy();
  });

  it('shows warning card when no compatible models', async () => {
    mockHardwareService.getTotalMemoryGB.mockReturnValue(1);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    expect(result.getByText('Limited Compatibility')).toBeTruthy();
  });

  it('pressing model card calls handleSelectModel which fetches files', async () => {
    mockGetModelFiles.mockResolvedValue([
      {
        name: 'model-Q4_K_M.gguf',
        size: 4000000000,
        quantization: 'Q4_K_M',
        downloadUrl: 'https://example.com/model.gguf',
      },
    ]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const modelPress = result.getByTestId('recommended-model-0-press');
    await act(async () => {
      fireEvent.press(modelPress);
    });

    expect(mockGetModelFiles).toHaveBeenCalled();
  });

  it('handleSelectModel fetches files for unloaded model', async () => {
    mockGetModelFiles.mockResolvedValue([]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const modelPress = result.getByTestId('recommended-model-0-press');
    await act(async () => {
      fireEvent.press(modelPress);
    });

    expect(mockGetModelFiles).toHaveBeenCalled();
  });

  it('handleSelectModel shows error alert on failure', async () => {
    // During init, the 4th model's fetch fails (silently caught).
    // After init, handleSelectModel retries and also fails → shows alert.
    mockGetModelFiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Network error'));

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    // Model index 3 failed during init, so it has no files.
    // Queue another rejection for the handleSelectModel retry.
    mockGetModelFiles.mockRejectedValueOnce(new Error('Network error'));

    const modelPress = result.getByTestId('recommended-model-3-press');
    await act(async () => {
      fireEvent.press(modelPress);
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Failed to fetch model files.');
  });

  it('download button triggers handleDownload via background download', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 1 });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    const downloadBtn = await result.findByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockDownloadModelBackground).toHaveBeenCalled();
  });

  it('download button triggers background download when supported', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    mockModelManager.isBackgroundDownloadSupported.mockReturnValue(true);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockDownloadModelBackground).toHaveBeenCalled();
  });

  it('download calls onProgress callback', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    mockDownloadModel.mockImplementation((_modelId: string, _file: any, onProgress: any) => {
      onProgress({ progress: 0.5, bytesDownloaded: 2000000000, totalBytes: 4000000000 });
      return Promise.resolve();
    });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    // Flush all promises (getDeviceInfo + Promise.all of getModelFiles + state updates)
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockAppState.setDownloadProgress).toHaveBeenCalled();
  });

  async function setupDownloadCompletion() {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    const completedModel = {
      id: 'test-model', name: 'Test Model', author: 'test',
      fileName: 'model-Q4_K_M.gguf', filePath: '/path',
      fileSize: 4000000000, quantization: 'Q4_K_M',
      downloadedAt: new Date().toISOString(),
    };
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 42 });
    let capturedOnComplete: ((model: any) => void) | undefined;
    mockModelManager.watchDownload.mockImplementation((_id: number, onComplete: any) => {
      capturedOnComplete = onComplete;
    });
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }
    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => { fireEvent.press(downloadBtn); });
    await act(async () => { capturedOnComplete?.(completedModel); });
    return { result, completedModel };
  }

  it('download calls onComplete callback and shows alert', async () => {
    const { completedModel } = await setupDownloadCompletion();

    expect(mockAppState.addDownloadedModel).toHaveBeenCalledWith(completedModel);
    expect(mockAppState.setActiveModelId).toHaveBeenCalledWith('test-model');
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Download Complete!',
      expect.stringContaining('Test Model'),
      expect.any(Array),
    );
  });

  it('download complete alert Start Chatting navigates to Main', async () => {
    const { result } = await setupDownloadCompletion();

    const startChatBtn = result.getByTestId('alert-button-Start Chatting');
    fireEvent.press(startChatBtn);

    expect(mockReplace).toHaveBeenCalledWith('Main');
  });

  it('download calls onError callback and shows error alert', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    mockDownloadModelBackground.mockResolvedValue({ downloadId: 42 });
    let capturedOnError: ((err: Error) => void) | undefined;
    mockModelManager.watchDownload.mockImplementation((_id: number, _onComplete: any, onError: any) => {
      capturedOnError = onError;
    });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    await act(async () => {
      capturedOnError?.(new Error('Download failed'));
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Download Failed', 'Download failed');
  });

  it('download catch block shows error on exception', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    mockDownloadModelBackground.mockRejectedValue(new Error('Unexpected error'));

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    for (let i = 0; i < 10; i++) {
      await act(async () => { await Promise.resolve(); });
    }

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Download Failed', 'Unexpected error');
  });

  it('init error shows error alert', async () => {
    mockHardwareService.getDeviceInfo.mockRejectedValueOnce(new Error('Hardware error'));

    render(<ModelDownloadScreen navigation={mockNavigation} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Failed to initialize. Please try again.');
  });
});
