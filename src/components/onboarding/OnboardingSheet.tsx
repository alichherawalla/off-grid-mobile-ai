import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import {
  ProgressBar,
  useOnboardingSteps,
  useChecklistTheme,
} from '../checklist';
import type { OnboardingStep, ChecklistTheme } from '../checklist/types';
import {
  useCheckmark,
  useStaggeredEntrance,
} from '../checklist/animations';
import { useTheme } from '../../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../../constants';

interface OnboardingSheetProps {
  visible: boolean;
  onClose: () => void;
  onStepPress: (stepId: string) => void;
}

interface ChecklistRowProps {
  step: OnboardingStep;
  theme: ChecklistTheme;
  entranceAnim: Animated.Value;
  onPress: () => void;
}

const ChecklistRow: React.FC<ChecklistRowProps> = ({
  step,
  theme,
  entranceAnim,
  onPress,
}) => {
  const { colors } = useTheme();
  const spring = useMemo(
    () => ({ damping: theme.springDamping, stiffness: theme.springStiffness }),
    [theme.springDamping, theme.springStiffness],
  );
  const { fillProgress, checkScale } = useCheckmark(step.completed, spring);

  const rowAnimStyle = {
    opacity: entranceAnim,
    transform: [
      {
        translateY: entranceAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  const checkboxBg = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', theme.checkboxCompletedBackground],
  });

  const checkboxBorder = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.checkboxBorderColor, theme.checkboxCompletedBorderColor],
  });

  const isDisabled = step.completed || step.disabled;

  return (
    <Animated.View style={rowAnimStyle}>
      <TouchableOpacity
        style={[styles.row, step.disabled && styles.disabled]}
        activeOpacity={isDisabled ? 1 : theme.itemPressedOpacity}
        onPress={isDisabled ? undefined : onPress}
        disabled={isDisabled}
      >
        {/* Checkbox */}
        <Animated.View
          style={[
            styles.checkbox,
            {
              width: theme.checkboxSize,
              height: theme.checkboxSize,
              borderRadius: theme.checkboxBorderRadius,
              borderWidth: theme.checkboxBorderWidth,
              borderColor: checkboxBorder,
              backgroundColor: checkboxBg,
            },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: checkScale }] }}>
            {step.completed && (
              <Icon name="check" size={10} color={theme.checkmarkColor} />
            )}
          </Animated.View>
        </Animated.View>

        {/* Text */}
        <View style={styles.textContainer}>
          <Text
            style={[
              styles.title,
              {
                color: step.completed
                  ? theme.itemTitleCompletedColor
                  : theme.itemTitleColor,
              },
            ]}
          >
            {step.title}
          </Text>
          {step.subtitle && (
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {step.subtitle}
            </Text>
          )}
        </View>

        {/* Arrow for incomplete steps */}
        {!step.completed && (
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

export const OnboardingSheet: React.FC<OnboardingSheetProps> = ({
  visible,
  onClose,
  onStepPress,
}) => {
  const { steps, completedCount, totalCount } = useOnboardingSteps();
  const checklistTheme = useChecklistTheme();
  const spring = useMemo(
    () => ({
      damping: checklistTheme.springDamping,
      stiffness: checklistTheme.springStiffness,
    }),
    [checklistTheme.springDamping, checklistTheme.springStiffness],
  );
  const entranceAnims = useStaggeredEntrance(steps.length, visible, spring);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      enableDynamicSizing
      title="Get Started"
    >
      <View style={styles.content}>
        <ProgressBar
          completed={completedCount}
          total={totalCount}
          theme={checklistTheme}
        />
        {steps.map((step, i) => (
          <ChecklistRow
            key={step.id}
            step={step}
            theme={checklistTheme}
            entranceAnim={entranceAnims[i]}
            onPress={() => onStepPress(step.id)}
          />
        ))}
      </View>
    </AppSheet>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
    gap: SPACING.md,
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...TYPOGRAPHY.bodySmall,
    fontFamily: FONTS.mono,
  },
  subtitle: {
    ...TYPOGRAPHY.meta,
    fontFamily: FONTS.mono,
    marginTop: 1,
  },
  disabled: {
    opacity: 0.4,
  },
});
