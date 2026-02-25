import React from 'react';
import { View, Text } from 'react-native';
import { ThinkingIndicator } from '../../ThinkingIndicator';
import { MarkdownText } from '../../MarkdownText';
import { BlinkingCursor } from './BlinkingCursor';
import { ThinkingBlock } from './ThinkingBlock';
import type { ParsedContent } from '../types';

interface MessageContentProps {
  isUser: boolean;
  isThinking?: boolean;
  content: string;
  isStreaming?: boolean;
  parsedContent: ParsedContent;
  showThinking: boolean;
  onToggleThinking: () => void;
  styles: any;
}

export function MessageContent({
  isUser,
  isThinking,
  content,
  isStreaming,
  parsedContent,
  showThinking,
  onToggleThinking,
  styles,
}: MessageContentProps) {
  if (isThinking) {
    return (
      <View testID="thinking-indicator">
        <ThinkingIndicator text={content} />
      </View>
    );
  }

  if (!content) {
    if (isStreaming) {
      return (
        <Text testID="message-text" style={[styles.text, styles.assistantText]}>
          <BlinkingCursor />
        </Text>
      );
    }
    return null;
  }

  return (
    <View>
      {!!parsedContent.thinking && (
        <ThinkingBlock
          parsedContent={parsedContent}
          showThinking={showThinking}
          onToggle={onToggleThinking}
          styles={styles}
        />
      )}

      {parsedContent.response ? (
        !isUser ? (
          <View testID="message-text">
            <MarkdownText>{parsedContent.response}</MarkdownText>
            {isStreaming && <BlinkingCursor />}
          </View>
        ) : (
          <Text
            testID="message-text"
            style={[styles.text, styles.userText]}
            selectable
          >
            {parsedContent.response}
          </Text>
        )
      ) : isStreaming && !parsedContent.isThinkingComplete ? (
        <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
          <ThinkingIndicator />
        </View>
      ) : isStreaming ? (
        <Text testID="message-text" style={[styles.text, styles.assistantText]}>
          <BlinkingCursor />
        </Text>
      ) : null}
    </View>
  );
}
