import { useState, useRef, useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { backgroundDownloadService } from '../../services';
import logger from '../../utils/logger';

export function useNotifRationale(isFirstDownload: boolean) {
  const [showNotifRationale, setShowNotifRationale] = useState(false);
  const pendingDownload = useRef<(() => void) | null>(null);
  const hasShownRationale = useRef(false);

  const maybeShowNotifRationale = useCallback(async (proceed: () => void) => {
    if (Platform.OS !== 'android' || Platform.Version < 33 || !isFirstDownload || hasShownRationale.current) {
      proceed();
      return;
    }
    const alreadyGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (alreadyGranted) {
      proceed();
      return;
    }
    hasShownRationale.current = true;
    pendingDownload.current = proceed;
    setShowNotifRationale(true);
  }, [isFirstDownload]);

  const handleNotifRationaleAllow = useCallback(() => {
    setShowNotifRationale(false);
    backgroundDownloadService
      .requestNotificationPermission()
      .catch((err) => logger.warn('Failed to request notification permission', err))
      .finally(() => {
        pendingDownload.current?.();
        pendingDownload.current = null;
      });
  }, []);

  const handleNotifRationaleDismiss = useCallback(() => {
    setShowNotifRationale(false);
    pendingDownload.current?.();
    pendingDownload.current = null;
  }, []);

  return {
    showNotifRationale,
    maybeShowNotifRationale,
    handleNotifRationaleAllow,
    handleNotifRationaleDismiss,
  };
}
