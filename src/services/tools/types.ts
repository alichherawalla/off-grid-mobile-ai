export interface ToolDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  parameters: Record<string, ToolParameter>;
  requiresNetwork?: boolean;
}

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId?: string;
  name: string;
  content: string;
  error?: string;
  durationMs: number;
}
