import { Message } from '../../types';

export type ChatMessageItem = {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: number;
  isThinking?: boolean;
  isStreaming?: boolean;
};

export type StreamingState = {
  isThinking: boolean;
  streamingMessage: string;
  isStreamingForThisConversation: boolean;
};

export function getDisplayMessages(
  allMessages: Message[],
  streaming: StreamingState,
): (Message | ChatMessageItem)[] {
  const { isThinking, streamingMessage, isStreamingForThisConversation } = streaming;
  if (isThinking && isStreamingForThisConversation) {
    return [
      ...allMessages,
      { id: 'thinking', role: 'assistant' as const, content: '', timestamp: Date.now(), isThinking: true },
    ];
  }
  if (streamingMessage && isStreamingForThisConversation) {
    return [
      ...allMessages,
      { id: 'streaming', role: 'assistant' as const, content: streamingMessage, timestamp: Date.now(), isStreaming: true },
    ];
  }
  return allMessages;
}

export function getPlaceholderText(isModelLoaded: boolean, supportsVision: boolean): string {
  if (!isModelLoaded) return 'Loading model...';
  return supportsVision ? 'Type a message or add an image...' : 'Type a message...';
}
