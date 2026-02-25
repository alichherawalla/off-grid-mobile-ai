import React from 'react';
import { View, Text, Modal, ActivityIndicator } from 'react-native';
import { useTheme, useThemedStyles } from '../../../theme';
import type { ThemeColors, ThemeShadows } from '../../../theme';
import { TYPOGRAPHY, SPACING } from '../../../constants';
import { LoadingState } from '../hooks/useHomeScreen';

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.xxl,
    alignItems: 'center' as const,
    marginHorizontal: 40,
    maxWidth: 300,
    ...shadows.large,
  },
  loadingTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginTop: SPACING.xl,
  },
  loadingModelName: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    marginTop: SPACING.sm,
    textAlign: 'center' as const,
  },
  loadingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
});

type Props = {
  loadingState: LoadingState;
};

export const LoadingOverlay: React.FC<Props> = ({ loadingState }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Modal
      visible={loadingState.isLoading}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTitle}>
            {loadingState.type === 'text' ? 'Loading Text Model' : 'Loading Image Model'}
          </Text>
          <Text style={styles.loadingModelName} numberOfLines={2}>
            {loadingState.modelName || 'Please wait...'}
          </Text>
          <Text style={styles.loadingHint}>
            This may take a moment for larger models.{'\n'}
            The app will be unresponsive during loading.
          </Text>
        </View>
      </View>
    </Modal>
  );
};
