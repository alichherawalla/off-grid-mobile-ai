/**
 * useModelsScreen — notification permission rationale tests
 *
 * Covers the maybeShowNotifRationale gate and the allow/dismiss handlers.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Platform, PermissionsAndroid } from 'react-native';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({ navigate: jest.fn() })),
}));

jest.mock('react-native-fs', () => ({
  exists: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/mock/extracted')),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
  isErrorWithCode: jest.fn(() => false),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

jest.mock('../../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: jest.fn(() => 0),
}));

const mockStoreState = {
  addDownloadedModel: jest.fn(),
  activeImageModelId: null,
  setActiveImageModelId: jest.fn(),
  addDownloadedImageModel: jest.fn(),
};

jest.mock('../../../../src/stores', () => ({
  useAppStore: jest.fn(() => mockStoreState),
}));

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: jest.fn(() => '/mock/image-models'),
    importLocalModel: jest.fn(),
    addDownloadedImageModel: jest.fn(() => Promise.resolve()),
  },
  backgroundDownloadService: {
    requestNotificationPermission: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  warn: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn((p: string) => Promise.resolve(p)),
}));

jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn(() => ({ visible: true })),
  initialAlertState: { visible: false },
}));

const mockTextHandleDownload = jest.fn();
const mockImageHandleDownloadImageModel = jest.fn();

const makeDefaultTextModels = () => ({
  searchQuery: '', setSearchQuery: jest.fn(),
  isLoading: false, isRefreshing: false, setIsRefreshing: jest.fn(),
  hasSearched: false,
  selectedModel: null, setSelectedModel: jest.fn(),
  modelFiles: [], setModelFiles: jest.fn(),
  isLoadingFiles: false,
  filterState: {}, setFilterState: jest.fn(),
  textFiltersVisible: false, setTextFiltersVisible: jest.fn(),
  downloadedModels: [],
  downloadProgress: {},
  hasActiveFilters: false, ramGB: 8,
  deviceRecommendation: { maxParameters: 7 },
  filteredResults: [], recommendedAsModelInfo: [],
  handleSearch: jest.fn(),
  handleSelectModel: jest.fn(),
  handleDownload: mockTextHandleDownload,
  handleRepairMmProj: jest.fn(),
  handleCancelDownload: jest.fn(),
  loadDownloadedModels: jest.fn(() => Promise.resolve()),
  clearFilters: jest.fn(), toggleFilterDimension: jest.fn(),
  toggleOrg: jest.fn(), setTypeFilter: jest.fn(),
  setSourceFilter: jest.fn(), setSizeFilter: jest.fn(), setQuantFilter: jest.fn(),
  isModelDownloaded: jest.fn(() => false),
  getDownloadedModel: jest.fn(() => undefined),
  downloadIds: {},
});

jest.mock('../../../../src/screens/ModelsScreen/useTextModels', () => ({
  useTextModels: jest.fn(() => makeDefaultTextModels()),
}));

jest.mock('../../../../src/screens/ModelsScreen/useImageModels', () => ({
  useImageModels: jest.fn(() => ({
    availableHFModels: [], hfModelsLoading: false, hfModelsError: null,
    backendFilter: 'all', setBackendFilter: jest.fn(),
    styleFilter: 'all', setStyleFilter: jest.fn(),
    sdVersionFilter: 'all', setSdVersionFilter: jest.fn(),
    imageFilterExpanded: null, setImageFilterExpanded: jest.fn(),
    imageSearchQuery: '', setImageSearchQuery: jest.fn(),
    imageFiltersVisible: false, setImageFiltersVisible: jest.fn(),
    imageRec: null,
    showRecommendedOnly: false, setShowRecommendedOnly: jest.fn(),
    showRecHint: false, setShowRecHint: jest.fn(),
    imageModelProgress: {}, downloadedImageModels: [],
    imageModelDownloading: {},
    hasActiveImageFilters: false, filteredHFModels: [],
    imageRecommendation: null,
    loadHFModels: jest.fn(() => Promise.resolve()),
    clearImageFilters: jest.fn(),
    isRecommendedModel: jest.fn(() => false),
    handleDownloadImageModel: mockImageHandleDownloadImageModel,
    setUserChangedBackendFilter: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helper: set Platform values
// ---------------------------------------------------------------------------

function setPlatform(os: string, version: number) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

// ---------------------------------------------------------------------------
// Import under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { useModelsScreen } from '../../../../src/screens/ModelsScreen/useModelsScreen';
import { useTextModels } from '../../../../src/screens/ModelsScreen/useTextModels';

const mockPermissionsCheck = jest.spyOn(PermissionsAndroid, 'check');
const { backgroundDownloadService: mockBDS } = require('../../../../src/services');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useModelsScreen — notification permission rationale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: permission not yet granted
    mockPermissionsCheck.mockResolvedValue(false);
    mockBDS.requestNotificationPermission.mockResolvedValue(undefined);
    // Reset useTextModels to default (no downloaded models)
    (useTextModels as jest.Mock).mockImplementation(() => makeDefaultTextModels());
  });

  // -------------------------------------------------------------------------
  // Platform / version gates
  // -------------------------------------------------------------------------

  it('calls through immediately on iOS without showing modal', async () => {
    setPlatform('ios', 17);
    const { result } = renderHook(() => useModelsScreen());

    await act(async () => {
      result.current.handleDownload({} as any, {} as any);
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  it('calls through immediately on Android < 33 without showing modal', async () => {
    setPlatform('android', 32);
    const { result } = renderHook(() => useModelsScreen());

    await act(async () => {
      result.current.handleDownload({} as any, {} as any);
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Android 13+ first-download gate
  // -------------------------------------------------------------------------

  it('shows rationale modal on Android 13+ first download when permission not granted', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);

    const { result } = renderHook(() => useModelsScreen());

    act(() => { result.current.handleDownload({} as any, {} as any); });
    await waitFor(() => expect(result.current.showNotifRationale).toBe(true));
    expect(mockTextHandleDownload).not.toHaveBeenCalled();
  });

  it('calls through without modal if permission already granted', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(true);

    const { result } = renderHook(() => useModelsScreen());

    await act(async () => {
      result.current.handleDownload({} as any, {} as any);
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  it('calls through without modal if models already downloaded (not first download)', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);

    (useTextModels as jest.Mock).mockImplementation(() => ({
      ...makeDefaultTextModels(),
      downloadedModels: [{ id: 'some/model.gguf' }],
    }));

    const { result } = renderHook(() => useModelsScreen());

    await act(async () => {
      result.current.handleDownload({} as any, {} as any);
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // handleNotifRationaleAllow
  // -------------------------------------------------------------------------

  it('allow: hides modal, requests permission, then starts pending download', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);

    const { result } = renderHook(() => useModelsScreen());

    act(() => { result.current.handleDownload({} as any, {} as any); });
    await waitFor(() => expect(result.current.showNotifRationale).toBe(true));

    await act(async () => {
      result.current.handleNotifRationaleAllow();
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockBDS.requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  it('allow: proceeds with download even if permission request rejects', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);
    mockBDS.requestNotificationPermission.mockRejectedValue(new Error('denied'));

    const { result } = renderHook(() => useModelsScreen());

    act(() => { result.current.handleDownload({} as any, {} as any); });
    await waitFor(() => expect(result.current.showNotifRationale).toBe(true));

    await act(async () => {
      result.current.handleNotifRationaleAllow();
    });

    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // handleNotifRationaleDismiss
  // -------------------------------------------------------------------------

  it('dismiss: hides modal and starts pending download without requesting permission', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);

    const { result } = renderHook(() => useModelsScreen());

    act(() => { result.current.handleDownload({} as any, {} as any); });
    await waitFor(() => expect(result.current.showNotifRationale).toBe(true));

    act(() => {
      result.current.handleNotifRationaleDismiss();
    });

    expect(result.current.showNotifRationale).toBe(false);
    expect(mockBDS.requestNotificationPermission).not.toHaveBeenCalled();
    expect(mockTextHandleDownload).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Image model download
  // -------------------------------------------------------------------------

  it('gates image model download through the same rationale on Android 13+', async () => {
    setPlatform('android', 33);
    mockPermissionsCheck.mockResolvedValue(false);

    const { result } = renderHook(() => useModelsScreen());

    act(() => { result.current.handleDownloadImageModel({} as any); });
    await waitFor(() => expect(result.current.showNotifRationale).toBe(true));
    expect(mockImageHandleDownloadImageModel).not.toHaveBeenCalled();

    await act(async () => {
      result.current.handleNotifRationaleAllow();
    });

    expect(mockImageHandleDownloadImageModel).toHaveBeenCalledTimes(1);
  });
});
