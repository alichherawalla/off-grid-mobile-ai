import type { ThemeColors, ThemeShadows } from '../../theme';
import { FONTS } from '../../constants';
import { Platform } from 'react-native';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Attachment previews row
  attachmentsContainer: {
    marginBottom: 6,
  },
  attachmentsContent: {
    gap: 8,
  },
  attachmentPreview: {
    position: 'relative' as const,
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  attachmentImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  documentPreview: {
    width: '100%' as const,
    height: '100%' as const,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 4,
  },
  documentName: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: 4,
  },
  removeAttachment: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  removeAttachmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold' as const,
    marginTop: -2,
  },
  // Queue badge row (above input)
  queueRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 4,
    gap: 4,
  },
  queueBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
    flex: 1,
  },
  queueBadgeText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
  queuePreview: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    color: colors.textMuted,
    flex: 1,
  },
  queueClearButton: {
    padding: 4,
  },
  // Main input row (pill + circular button)
  mainRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
  },
  // Pill container
  pill: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 48,
    overflow: 'hidden' as const,
  },
  pillInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: FONTS.mono,
    minHeight: 36,
    maxHeight: 150,
    textAlignVertical: 'top' as const,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    paddingRight: 4,
  },
  // Icons row inside pill (right side)
  pillIcons: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    paddingBottom: 4,
    gap: 0,
  },
  pillIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 18,
    position: 'relative' as const,
  },
  pillIconButtonActive: {
    backgroundColor: `${colors.primary}18`,
  },
  pillIconButtonDisabled: {
    opacity: 0.4,
  },
  // Small badge on image gen icon
  iconBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    minWidth: 16,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconBadgeOn: {
    backgroundColor: colors.primary,
  },
  iconBadgeOff: {
    backgroundColor: colors.textMuted,
  },
  iconBadgeAuto: {
    backgroundColor: colors.textMuted,
  },
  iconBadgeText: {
    fontSize: 7,
    fontFamily: FONTS.mono,
    fontWeight: '700' as const,
    color: colors.background,
    lineHeight: 10,
  },
  // Circular action button (send/stop/mic)
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    marginBottom: 2,
  },
  circleButtonStop: {
    backgroundColor: colors.error,
  },
  circleButtonIdle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visionBadge: {
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  visionBadgeText: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
});
