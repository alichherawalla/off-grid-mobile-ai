const CONTROL_TOKEN_PATTERNS: RegExp[] = [
  /<\|im_start\|>\s*(?:system|assistant|user|tool)?\s*\n?/gi,
  /<\|im_end\|>\s*\n?/gi,
  /<\|end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\/s>/gi,
  /<tool_call>[\s\S]*?<\/tool_call>\s*/g,
];

export function stripControlTokens(content: string): string {
  return CONTROL_TOKEN_PATTERNS.reduce((result, pattern) => result.replace(pattern, ''), content);
}
