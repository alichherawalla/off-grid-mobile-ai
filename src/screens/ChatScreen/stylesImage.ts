import { Dimensions } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

export const createImageStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  imageViewerBackdrop: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  imageViewerContent: {
    width: '100%' as const,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.7,
  },
  imageViewerActions: {
    flexDirection: 'row' as const,
    position: 'absolute' as const,
    bottom: 60,
    gap: 40,
  },
  imageViewerButton: {
    alignItems: 'center' as const,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    minWidth: 80,
  },
  imageViewerButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginTop: SPACING.xs,
    fontWeight: '500' as const,
  },
});
