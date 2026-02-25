import type { ParsedContent } from './types';

export function parseThinkingContent(content: string): ParsedContent {
  const thinkStartMatch = content.match(/<think>/i);
  const thinkEndMatch = content.match(/<\/think>/i);

  if (!thinkStartMatch) {
    return { thinking: null, response: content, isThinkingComplete: true };
  }

  const thinkStart = thinkStartMatch.index! + thinkStartMatch[0].length;

  if (!thinkEndMatch) {
    const thinkingContent = content.slice(thinkStart);
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  const thinkEnd = thinkEndMatch.index!;
  let thinkingContent = content.slice(thinkStart, thinkEnd).trim();
  const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();

  let thinkingLabel: string | undefined;
  const labelMatch = thinkingContent.match(/^__LABEL:(.+?)__\n*/);
  if (labelMatch) {
    thinkingLabel = labelMatch[1];
    thinkingContent = thinkingContent.slice(labelMatch[0].length).trim();
  }

  return {
    thinking: thinkingContent,
    response: responseContent,
    isThinkingComplete: true,
    thinkingLabel,
  };
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
