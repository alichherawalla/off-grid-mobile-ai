import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Text, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton } from '../VoiceRecordButton';
import { AttachStep } from 'react-native-spotlight-tour';
import { triggerHaptic } from '../../utils/haptics';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles, PILL_ICONS_WIDTH, ANIM_DURATION_IN, ANIM_DURATION_OUT } from './styles';
import { QueueRow } from './Toolbar';
import { AttachmentPreview, useAttachments } from './Attachments';
import { useVoiceInput } from './Voice';

interface ChatInputProps {
  onSend: (message: string, attachments?: MediaAttachment[], imageMode?: ImageModeState) => void;
  onStop?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  supportsVision?: boolean;
  conversationId?: string | null;
  imageModelLoaded?: boolean;
  onImageModeChange?: (mode: ImageModeState) => void;
  onOpenSettings?: () => void;
  queueCount?: number;
  queuedTexts?: string[];
  onClearQueue?: () => void;
  onToolsPress?: () => void;
  enabledToolCount?: number;
  supportsToolCalling?: boolean;
  /** When set, mounts a single AttachStep for that index. Only one at a time to avoid waypoint dots. */
  activeSpotlight?: number | null;
}

const IMAGE_MODE_CYCLE: ImageModeState[] = ['auto', 'force', 'disabled'];

const ToolsButton: React.FC<{
  supportsToolCalling: boolean; enabledToolCount: number; disabled?: boolean;
  onToolsPress?: () => void; styles: any; colors: any; onUnsupported: () => void;
}> = ({ supportsToolCalling, enabledToolCount, disabled, onToolsPress, styles, colors, onUnsupported }) => (
  <TouchableOpacity
    testID="tools-button"
    style={[styles.pillIconButton, supportsToolCalling && enabledToolCount > 0 && styles.pillIconButtonActive]}
    onPress={supportsToolCalling ? onToolsPress : onUnsupported}
    disabled={disabled}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
  >
    <Icon name="tool" size={18} color={supportsToolCalling ? (enabledToolCount > 0 ? colors.primary : colors.textSecondary) : colors.textMuted} />
    {supportsToolCalling && enabledToolCount > 0 && (
      <View style={[styles.iconBadge, styles.iconBadgeOn]}><Text style={styles.iconBadgeText}>{enabledToolCount}</Text></View>
    )}
  </TouchableOpacity>
);

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled,
  isGenerating,
  placeholder = 'Message',
  supportsVision = false,
  conversationId,
  imageModelLoaded = false,
  onImageModeChange,
  onOpenSettings: _onOpenSettings,
  queueCount = 0,
  queuedTexts = [],
  onClearQueue,
  onToolsPress,
  enabledToolCount = 0,
  supportsToolCalling = false,
  activeSpotlight = null,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const inputRef = useRef<TextInput>(null);
  const hasText = message.length > 0;
  const iconsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(iconsAnim, {
      toValue: hasText ? 1 : 0,
      duration: hasText ? ANIM_DURATION_IN : ANIM_DURATION_OUT,
      useNativeDriver: false,
    }).start();
  }, [hasText, iconsAnim]);

  const { attachments, removeAttachment, clearAttachments, handlePickImage, handlePickDocument } = useAttachments(setAlertState);

  const { isRecording, isModelLoading, isTranscribing, partialResult, error, voiceAvailable, startRecording, stopRecording, clearResult } = useVoiceInput({
    conversationId,
    onTranscript: (text) => {
      setMessage(prev => {
        const prefix = prev.trim() ? `${prev.trim()} ` : '';
        return prefix + text;
      });
    },
  });

  const canSend = (message.trim().length > 0 || attachments.length > 0) && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    triggerHaptic('impactMedium');
    onSend(message.trim(), attachments.length > 0 ? attachments : undefined, imageMode);
    setMessage('');
    clearAttachments();
    inputRef.current?.focus();
    if (imageMode === 'force') {
      setImageMode('auto');
      onImageModeChange?.('auto');
    }
  };

  const handleImageModeToggle = () => {
    if (!imageModelLoaded) { setAlertState(showAlert('No Image Model', 'Download an image generation model from the Models screen to enable this feature.', [{ text: 'OK' }])); return; }
    const newMode = IMAGE_MODE_CYCLE[(IMAGE_MODE_CYCLE.indexOf(imageMode) + 1) % IMAGE_MODE_CYCLE.length];
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleToolsUnsupported = () => setAlertState(showAlert('Tools Not Supported', 'This model does not support tool calling. Load a model with tool calling support to enable tools.', [{ text: 'OK' }]));

  const handleVisionPress = () => {
    if (!supportsVision) { setAlertState(showAlert('Vision Not Supported', 'Load a vision-capable model (with mmproj) to enable image input.', [{ text: 'OK' }])); return; }
    handlePickImage();
  };

  const handleStop = () => {
    if (onStop && isGenerating) {
      triggerHaptic('impactLight');
      onStop();
    }
  };

  const imageModeIcon = (): { color: string; badge: string; badgeStyle: 'on' | 'off' | 'auto' } => {
    switch (imageMode) {
      case 'force':
        return { color: imageModelLoaded ? colors.primary : colors.textMuted, badge: 'ON', badgeStyle: 'on' };
      case 'disabled':
        return { color: colors.textMuted, badge: 'OFF', badgeStyle: 'off' };
      default:
        return { color: imageModelLoaded ? colors.textSecondary : colors.textMuted, badge: 'A', badgeStyle: 'auto' };
    }
  };

  const imgState = imageModeIcon();

  const actionButton = canSend ? (
    <TouchableOpacity
      testID="send-button"
      style={styles.circleButton}
      onPress={handleSend}
    >
      <Icon name="send" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : isGenerating && onStop ? (
    <TouchableOpacity
      testID="stop-button"
      style={[styles.circleButton, styles.circleButtonStop]}
      onPress={handleStop}
    >
      <Icon name="square" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : (
    <VoiceRecordButton
      isRecording={isRecording}
      isAvailable={voiceAvailable}
      isModelLoading={isModelLoading}
      isTranscribing={isTranscribing}
      partialResult={partialResult}
      error={error}
      disabled={disabled}
      onStartRecording={startRecording}
      onStopRecording={stopRecording}
      onCancelRecording={() => { stopRecording(); clearResult(); }}
      asSendButton
    />
  );

  const content = (
    <View style={styles.container}>
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      <QueueRow
        queueCount={queueCount}
        queuedTexts={queuedTexts}
        onClearQueue={onClearQueue}
      />
      <View style={styles.mainRow}>
        {/* Pill: text input + right icons */}
        <View style={styles.pill}>
          <TextInput
            ref={inputRef}
            testID="chat-input"
            style={styles.pillInput}
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            scrollEnabled
            editable={!disabled}
            blurOnSubmit={false}
            returnKeyType="default"
          />
          {/* Icons collapse when user starts typing, reappear when input is empty */}
          <Animated.View
            pointerEvents={hasText ? 'none' : 'auto'}
            style={[styles.pillIcons, {
              width: iconsAnim.interpolate({ inputRange: [0, 1], outputRange: [PILL_ICONS_WIDTH, 0] }),
              opacity: iconsAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
              overflow: 'hidden' as const,
            }]}
          >
            {/* Attachment button */}
            <TouchableOpacity
              testID="document-picker-button"
              style={styles.pillIconButton}
              onPress={handlePickDocument}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon
                name="paperclip"
                size={18}
                color={disabled ? colors.textMuted : colors.textSecondary}
              />
            </TouchableOpacity>

            <ToolsButton
              supportsToolCalling={supportsToolCalling}
              enabledToolCount={enabledToolCount}
              disabled={disabled}
              onToolsPress={onToolsPress}
              styles={styles}
              colors={colors}
              onUnsupported={handleToolsUnsupported}
            />

            {/* Vision button — always shown */}
            <TouchableOpacity
              testID="camera-button"
              style={[styles.pillIconButton, supportsVision && styles.pillIconButtonActive]}
              onPress={handleVisionPress}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon
                name="eye"
                size={18}
                color={supportsVision ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>

            {/* Image gen toggle — always shown, cycles auto → force → disabled */}
            <TouchableOpacity
              testID="image-mode-toggle"
              style={[
                styles.pillIconButton,
                imageMode === 'force' && styles.pillIconButtonActive,
              ]}
              onPress={handleImageModeToggle}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon name="image" size={18} color={imgState.color} />
              <View
                testID={`image-mode-${imageMode}-badge`}
                style={[
                  styles.iconBadge,
                  imgState.badgeStyle === 'on' ? styles.iconBadgeOn
                    : imgState.badgeStyle === 'off' ? styles.iconBadgeOff
                    : styles.iconBadgeAuto,
                ]}
              >
                <Text style={styles.iconBadgeText}>{imgState.badge}</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Circular action button — conditionally wrapped with AttachStep */}
        {activeSpotlight === 12 ? (
          <AttachStep index={12} style={spotlightStyles.centered}>{actionButton}</AttachStep>
        ) : actionButton}
      </View>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </View>
  );

  return content;
};

const spotlightStyles = StyleSheet.create({
  centered: { alignSelf: 'center' },
});
