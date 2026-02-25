import { RNLlamaOAICompatibleMessage, RNLlamaMessagePart } from 'llama.rn';
import { Message } from '../types';

export function formatLlamaMessages(messages: Message[], supportsVision: boolean): string {
  let prompt = '';
  for (const message of messages.filter(m => !m.isSystemInfo)) {
    if (message.role === 'system') {
      prompt += `<|im_start|>system\n${message.content}<|im_end|>\n`;
    } else if (message.role === 'user') {
      let content = message.content;
      if (message.attachments && message.attachments.length > 0 && supportsVision) {
        const imageMarkers = message.attachments
          .filter(a => a.type === 'image')
          .map(() => '<__media__>')
          .join('');
        content = imageMarkers + content;
      }
      prompt += `<|im_start|>user\n${content}<|im_end|>\n`;
    } else if (message.role === 'assistant') {
      prompt += `<|im_start|>assistant\n${message.content}<|im_end|>\n`;
    }
  }
  prompt += '<|im_start|>assistant\n';
  return prompt;
}

export function extractImageUris(messages: Message[]): string[] {
  const uris: string[] = [];
  for (const message of messages) {
    if (message.attachments) {
      for (const attachment of message.attachments) {
        if (attachment.type === 'image') {
          uris.push(attachment.uri);
        }
      }
    }
  }
  return uris;
}

export function buildOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] {
  return messages.filter(m => !m.isSystemInfo).map(message => {
    // Handle tool result messages
    if (message.role === 'tool') {
      return {
        role: 'tool' as any,
        content: message.content,
        tool_call_id: message.toolCallId || '',
      } as any;
    }

    // Handle assistant messages with tool calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map(tc => ({
          id: tc.id || '',
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      } as any;
    }

    const imageAttachments = message.attachments?.filter(a => a.type === 'image') || [];
    if (imageAttachments.length === 0 || message.role !== 'user') {
      return { role: message.role, content: message.content };
    }

    const contentParts: RNLlamaMessagePart[] = [];
    for (const attachment of imageAttachments) {
      let imagePath = attachment.uri;
      if (!imagePath.startsWith('file://') && !imagePath.startsWith('http')) {
        imagePath = `file://${imagePath}`;
      }
      contentParts.push({ type: 'image_url', image_url: { url: imagePath } });
    }
    if (message.content) {
      contentParts.push({ type: 'text', text: message.content });
    }
    return { role: message.role, content: contentParts };
  });
}
