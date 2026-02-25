import React from 'react';
import { View, Text, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

// ─── Loading state ────────────────────────────────────────────────────────────

interface LoadingStateProps {
  asSendButton: boolean;
  loadingAnim: Animated.Value;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ asSendButton, loadingAnim }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const spin = loadingAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={asSendButton ? undefined : styles.loadingContainer}>
      <Animated.View style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonLoading, { transform: [{ rotate: spin }] }]}>
        {asSendButton ? <Icon name="mic" size={18} color={colors.primary} /> : <View style={styles.loadingIndicator} />}
      </Animated.View>
      {!asSendButton && <Text style={styles.loadingText}>Loading...</Text>}
    </View>
  );
};

// ─── Transcribing state ───────────────────────────────────────────────────────

interface TranscribingStateProps {
  asSendButton: boolean;
  loadingAnim: Animated.Value;
}

export const TranscribingState: React.FC<TranscribingStateProps> = ({ asSendButton, loadingAnim }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const spin = loadingAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={asSendButton ? undefined : styles.loadingContainer}>
      <Animated.View style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonTranscribing, { transform: [{ rotate: spin }] }]}>
        {asSendButton ? <Icon name="mic" size={18} color={colors.info} /> : <View style={styles.loadingIndicator} />}
      </Animated.View>
      {!asSendButton && <Text style={styles.transcribingText}>Transcribing...</Text>}
    </View>
  );
};

// ─── Unavailable state ────────────────────────────────────────────────────────

interface UnavailableButtonProps {
  asSendButton: boolean;
}

export const UnavailableButton: React.FC<UnavailableButtonProps> = ({ asSendButton }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={[styles.button, asSendButton ? styles.buttonAsSendUnavailable : styles.buttonUnavailable]}>
      {asSendButton ? (
        <Icon name="mic-off" size={18} color={colors.textMuted} />
      ) : (
        <>
          <View style={styles.micIcon}>
            <View style={[styles.micBody, styles.micBodyUnavailable]} />
            <View style={[styles.micBase, styles.micBodyUnavailable]} />
          </View>
          <View style={styles.unavailableSlash} />
        </>
      )}
    </View>
  );
};

// ─── Button icon ──────────────────────────────────────────────────────────────

interface ButtonIconProps {
  asSendButton: boolean;
  isRecording: boolean;
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({ asSendButton, isRecording }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (asSendButton) {
    return <Icon name={isRecording ? 'mic' : 'send'} size={18} color={colors.primary} />;
  }

  return (
    <View style={styles.micIcon}>
      <View style={[styles.micBody, isRecording && styles.micBodyRecording]} />
      <View style={[styles.micBase, isRecording && styles.micBodyRecording]} />
    </View>
  );
};
