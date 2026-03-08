import { ToolDefinition } from './types';

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    id: 'web_search',
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the web for current information',
    icon: 'globe',
    requiresNetwork: true,
    parameters: {
      query: {
        type: 'string',
        description: 'The search query',
        required: true,
      },
    },
  },
  {
    id: 'calculator',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate mathematical expressions',
    icon: 'hash',
    parameters: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate',
        required: true,
      },
    },
  },
  {
    id: 'get_current_datetime',
    name: 'get_current_datetime',
    displayName: 'Date & Time',
    description: 'Get the current date and time',
    icon: 'clock',
    parameters: {
      timezone: {
        type: 'string',
        description: 'IANA timezone (e.g. America/New_York). Defaults to device timezone.',
      },
    },
  },
  {
    id: 'get_device_info',
    name: 'get_device_info',
    displayName: 'Device Info',
    description: 'Get device hardware information',
    icon: 'smartphone',
    parameters: {
      info_type: {
        type: 'string',
        description: 'Type of info to retrieve',
        enum: ['battery', 'storage', 'memory', 'all'],
      },
    },
  },
  {
    id: 'read_url',
    name: 'read_url',
    displayName: 'URL Reader',
    description: 'Fetch and read the content of a web page',
    icon: 'link',
    requiresNetwork: true,
    parameters: {
      url: {
        type: 'string',
        description: 'The URL to fetch and read',
        required: true,
      },
    },
  },
];

export function getToolsAsOpenAISchema(enabledToolIds: string[]) {
  return AVAILABLE_TOOLS
    .filter(tool => enabledToolIds.includes(tool.id))
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              {
                type: param.type,
                description: param.description,
                ...(param.enum ? { enum: param.enum } : {}),
              },
            ]),
          ),
          required: Object.entries(tool.parameters)
            .filter(([_, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));
}

export function buildToolSystemPromptHint(enabledToolIds: string[]): string {
  const enabledTools = AVAILABLE_TOOLS.filter(t => enabledToolIds.includes(t.id));
  if (enabledTools.length === 0) return '';

  const toolList = enabledTools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  const enabledNames = new Set(enabledTools.map(t => t.name));

  const hints: string[] = [];
  if (enabledNames.has('web_search')) {
    hints.push('- The user asks about recent events, real-time data, or current news — use web_search');
    hints.push('- The user asks for specific facts you cannot reliably answer from training data — use web_search');
    hints.push('- The user asks you to look up or research a specific entity (company, person, product) — use web_search');
  }
  if (enabledNames.has('read_url')) {
    hints.push('- The user provides a URL — use read_url');
  }
  if (enabledNames.has('calculator')) {
    hints.push('- The user asks for calculations — use calculator');
  }
  if (enabledNames.has('get_current_datetime')) {
    hints.push('- The user asks about the current time or date — use get_current_datetime');
  }

  const hintsBlock = hints.length > 0 ? `\n\nIMPORTANT: You MUST use the appropriate tool when:\n${hints.join('\n')}\nDo NOT say you cannot help or lack internet access. USE your tools instead.` : '';

  return `\n\nYou have access to the following tools and MUST use them proactively:\n${toolList}${hintsBlock}`;
}
