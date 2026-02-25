import { Dispatch, SetStateAction } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { AlertState, showAlert } from '../../components';
import logger from '../../utils/logger';

export async function saveImageToGallery(
  viewerImageUri: string | null,
  setAlertState: Dispatch<SetStateAction<AlertState>>,
): Promise<void> {
  if (!viewerImageUri) return;
  try {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission',
          message: 'App needs access to save images',
          buttonNeutral: 'Ask Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
    }
    const sourcePath = viewerImageUri.replace('file://', '');
    const picturesDir = Platform.OS === 'android'
      ? `${RNFS.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`
      : `${RNFS.DocumentDirectoryPath}/OffgridMobile_Images`;
    if (!(await RNFS.exists(picturesDir))) {
      await RNFS.mkdir(picturesDir);
    }
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const fileName = `generated_${timestamp}.png`;
    await RNFS.copyFile(sourcePath, `${picturesDir}/${fileName}`);
    setAlertState(showAlert(
      'Image Saved',
      Platform.OS === 'android'
        ? `Saved to Pictures/OffgridMobile/${fileName}`
        : `Saved to ${fileName}`,
    ));
  } catch (error: any) {
    logger.error('[ChatScreen] Failed to save image:', error);
    setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
  }
}
