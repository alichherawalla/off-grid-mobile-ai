import React from 'react';
import { ChatMessage } from '../../components';
import { Message } from '../../types';
import { ChatMessageItem } from './useChatScreen';

type MessageRendererProps = {
  item: Message | ChatMessageItem;
  index: number;
  displayMessagesLength: number;
  animateLastN: number;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  showGenerationDetails: boolean;
  onCopy: (content: string) => void;
  onRetry: (message: Message) => void;
  onEdit: (message: Message, newContent: string) => void;
  onGenerateImage: (prompt: string) => void;
  onImagePress: (uri: string) => void;
};

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  item,
  index,
  displayMessagesLength,
  animateLastN,
  imageModelLoaded,
  isStreaming,
  isGeneratingImage,
  showGenerationDetails,
  onCopy,
  onRetry,
  onEdit,
  onGenerateImage,
  onImagePress,
}) => (
  <ChatMessage
    message={item as Message}
    isStreaming={item.id === 'streaming'}
    onCopy={onCopy}
    onRetry={onRetry}
    onEdit={onEdit}
    onGenerateImage={onGenerateImage}
    onImagePress={onImagePress}
    canGenerateImage={imageModelLoaded && !isStreaming && !isGeneratingImage}
    showGenerationDetails={showGenerationDetails}
    animateEntry={animateLastN > 0 && index >= displayMessagesLength - animateLastN}
  />
);
