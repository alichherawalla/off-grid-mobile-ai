import React, { useState, useRef } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton } from '../VoiceRecordButton';
import { triggerHaptic } from '../../utils/haptics';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles } from './styles';
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
}

const IMAGE_MODE_CYCLE: ImageModeState[] = ['auto', 'force', 'disabled'];

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
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const inputRef = useRef<TextInput>(null);

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
    if (!imageModelLoaded) {
      setAlertState(showAlert(
        'No Image Model',
        'Download an image generation model from the Models screen to enable this feature.',
        [{ text: 'OK' }],
      ));
      return;
    }
    const currentIndex = IMAGE_MODE_CYCLE.indexOf(imageMode);
    const newMode = IMAGE_MODE_CYCLE[(currentIndex + 1) % IMAGE_MODE_CYCLE.length];
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleVisionPress = () => {
    if (!supportsVision) {
      setAlertState(showAlert(
        'Vision Not Supported',
        'This model does not support image input. Load a vision-capable model (with an mmproj file) to enable this feature.',
        [{ text: 'OK' }],
      ));
      return;
    }
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

  return (
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
          <View style={styles.pillIcons}>
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
                size={20}
                color={disabled ? colors.textMuted : colors.textSecondary}
              />
            </TouchableOpacity>

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
                size={20}
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
              <Icon name="image" size={20} color={imgState.color} />
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
          </View>
        </View>

        {/* Circular action button */}
        {canSend ? (
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
        )}
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
};
