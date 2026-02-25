import { renderHook, act } from '@testing-library/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import { useNotifRationale } from '../../../src/screens/ModelsScreen/useNotifRationale';

const mockRequestNotificationPermission = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/services', () => ({
  backgroundDownloadService: {
    get requestNotificationPermission() { return mockRequestNotificationPermission; },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

function setupAndroid33(permissionGranted: boolean) {
  Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  Object.defineProperty(Platform, 'Version', { get: () => 33 });
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(permissionGranted);
}

async function renderAndTrigger(isFirstDownload: boolean) {
  const proceed = jest.fn();
  const hook = renderHook(() => useNotifRationale(isFirstDownload));
  await act(async () => {
    await hook.result.current.maybeShowNotifRationale(proceed);
  });
  return { ...hook, proceed };
}

describe('useNotifRationale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('proceeds immediately when not first download', async () => {
    const { result, proceed } = await renderAndTrigger(false);

    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });

  it('proceeds immediately on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    const { result, proceed } = await renderAndTrigger(true);

    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });

  it('proceeds immediately on Android < 33', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    Object.defineProperty(Platform, 'Version', { get: () => 32 });
    const { result, proceed } = await renderAndTrigger(true);

    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });

  it('proceeds immediately when permission already granted', async () => {
    setupAndroid33(true);
    const { result, proceed } = await renderAndTrigger(true);

    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });

  it('shows rationale on Android 33+ first download without permission', async () => {
    setupAndroid33(false);
    const { result, proceed } = await renderAndTrigger(true);

    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(true);
  });

  it('handleNotifRationaleAllow requests permission then proceeds', async () => {
    setupAndroid33(false);
    const { result, proceed } = await renderAndTrigger(true);
    expect(result.current.showNotifRationale).toBe(true);

    await act(async () => { result.current.handleNotifRationaleAllow(); });
    await act(async () => { await Promise.resolve(); });

    expect(mockRequestNotificationPermission).toHaveBeenCalled();
    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });

  it('only shows rationale once per session', async () => {
    setupAndroid33(false);
    const { result, proceed } = await renderAndTrigger(true);
    expect(proceed).not.toHaveBeenCalled();

    await act(async () => { result.current.handleNotifRationaleDismiss(); });

    const proceed2 = jest.fn();
    await act(async () => {
      await result.current.maybeShowNotifRationale(proceed2);
    });
    expect(proceed2).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });

  it('handleNotifRationaleDismiss proceeds without requesting permission', async () => {
    setupAndroid33(false);
    const { result, proceed } = await renderAndTrigger(true);

    await act(async () => { result.current.handleNotifRationaleDismiss(); });

    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalled();
    expect(result.current.showNotifRationale).toBe(false);
  });
});
