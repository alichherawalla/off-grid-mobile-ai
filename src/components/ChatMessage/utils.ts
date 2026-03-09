import type { ParsedContent } from './types';

/**
 * Parse content that may contain thinking/reasoning sections.
 * Handles two formats:
 * 1. HLSL.. HLSL tags (used by llama models with thinking enabled)
 * 2. <|channel|>analysis<|message|>...<|channel|>final<|message|> (used by Qwen and similar models)
 */
export function parseThinkingContent(content: string): ParsedContent {
  // First, check for channel-based thinking format
  // Format: <|channel|>analysis<|message|>[thinking content]<|channel|>final<|message|>[response]
  const channelAnalysisMatch = content.match(/<\|channel\|>analysis<\|message\|>/i);
  const channelFinalMatch = content.match(/<\|channel\|>final<\|message\|>/i);

  if (channelAnalysisMatch) {
    const analysisStart = channelAnalysisMatch.index! + channelAnalysisMatch[0].length;

    if (channelFinalMatch) {
      // We have both analysis and final markers
      const finalStart = channelFinalMatch.index!;
      const thinkingContent = content.slice(analysisStart, finalStart).trim();
      const responseContent = content.slice(finalStart + channelFinalMatch[0].length).trim();

      return {
        thinking: thinkingContent,
        response: responseContent,
        isThinkingComplete: true,
      };
    }

    // Only analysis marker - thinking is still in progress
    const thinkingContent = content.slice(analysisStart).trim();
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  // Fall back to HLSL HLSL format
  const thinkStartMatch = content.match(/ HLSL/i);
  const thinkEndMatch = content.match(/<\/think>/i);

  if (!thinkStartMatch) {
    // Handle  HLSL without HLSL — llama.rn Jinja template may consume
    // the opening HLSL tag while leaving thinking text + HLSL as tokens
    if (thinkEndMatch) {
      const thinkEnd = thinkEndMatch.index!;
      const thinkingContent = content.slice(0, thinkEnd).trim();
      const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();
      if (thinkingContent) {
        return {
          thinking: thinkingContent,
          response: responseContent,
          isThinkingComplete: true,
        };
      }
    }
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