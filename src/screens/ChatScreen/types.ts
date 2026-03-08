import { Message } from '../../types';

export type ChatMessageItem = {
  id: string;
  role: 'assistant';
  content: string;
  reasoningContent?: string;
  timestamp: number;
  isThinking?: boolean;
  isStreaming?: boolean;
};

export type StreamingState = {
  isThinking: boolean;
  streamingMessage: string;
  streamingReasoningContent: string;
  isStreamingForThisConversation: boolean;
};

export function getDisplayMessages(
  allMessages: Message[],
  streaming: StreamingState,
): (Message | ChatMessageItem)[] {
  const { isThinking, streamingMessage, streamingReasoningContent, isStreamingForThisConversation } = streaming;
  if (isThinking && isStreamingForThisConversation) {
    return [
      ...allMessages,
      { id: 'thinking', role: 'assistant' as const, content: '', timestamp: Date.now(), isThinking: true },
    ];
  }
  if ((streamingMessage || streamingReasoningContent) && isStreamingForThisConversation) {
    return [
      ...allMessages,
      { id: 'streaming', role: 'assistant' as const, content: streamingMessage, reasoningContent: streamingReasoningContent || undefined, timestamp: Date.now(), isStreaming: true },
    ];
  }
  return allMessages;
}

export function getPlaceholderText(isAnyModelLoaded: boolean, supportsVision: boolean): string {
  if (!isAnyModelLoaded) return 'Loading model...';
  return supportsVision ? 'Type a message or add an image...' : 'Type a message...';
}
