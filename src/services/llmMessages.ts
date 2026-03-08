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

/**
 * Format a tool call as plain text for the assistant message.
 * Avoids structured tool_calls which cause Jinja template errors
 * (C++ wants arguments as string, Jinja wants dict — can't satisfy both).
 */
function formatToolCallAsText(tc: { name: string; arguments: string }): string {
  const escapedName = JSON.stringify(tc.name);
  return `<tool_call>{"name":${escapedName},"arguments":${tc.arguments}}</tool_call>`;
}

export function buildOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] {
  const filtered = messages.filter(m => !m.isSystemInfo);
  return filtered.map((message) => {
    // Flatten tool result messages into user messages —
    // avoids role:"tool" which some Jinja templates don't handle
    if (message.role === 'tool') {
      const label = message.toolName || 'tool';
      return {
        role: 'user' as const,
        content: `[Tool Result: ${label}]\n${message.content}\n[End Tool Result]`,
      };
    }

    // Flatten assistant tool calls into plain text —
    // structured tool_calls in history cause Jinja/C++ conflicts
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCallText = message.toolCalls.map(formatToolCallAsText).join('\n');
      const content = message.content
        ? `${message.content}\n${toolCallText}`
        : toolCallText;
      return { role: 'assistant' as const, content };
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
