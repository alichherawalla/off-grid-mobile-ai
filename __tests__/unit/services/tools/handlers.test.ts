/**
 * Tool Handlers Unit Tests
 *
 * Tests for executeToolCall dispatcher, calculator, datetime, device info,
 * and web search handlers.
 * Priority: P0 (Critical) - Tool execution drives assistant capabilities.
 */

import DeviceInfo from 'react-native-device-info';
import { executeToolCall } from '../../../../src/services/tools/handlers';
import { ToolCall } from '../../../../src/services/tools/types';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return { id: 'test-call-1', name, arguments: args };
}

/** Shorthand: create a tool call and execute it in one step. */
async function runTool(name: string, args: Record<string, any> = {}) {
  return executeToolCall(makeToolCall(name, args));
}

/**
 * Builds a minimal Brave Search-style HTML string containing result blocks.
 * Each entry produces one block with class="result-wrapper" containing
 * a title link, URL, and snippet paragraph.
 */
function buildBraveSearchHTML(
  results: Array<{ title: string; url: string; snippet: string }>,
): string {
  const blocks = results
    .map(
      (r) =>
        `<div class="result-wrapper">
          <a class="result-header" href="${r.url}">
            <span class="snippet-title">${r.title}</span>
          </a>
          <p class="snippet-description">${r.snippet}</p>
        </div>`,
    )
    .join('\n');
  return `<html><body>${blocks}</body></html>`;
}

// ============================================================================
// executeToolCall dispatcher
// ============================================================================
describe('Tool Handlers', () => {
  describe('executeToolCall dispatcher', () => {
    it('routes to calculator handler', async () => {
      const result = await runTool('calculator', { expression: '1+1' });
      expect(result.name).toBe('calculator');
      expect(result.content).toContain('1+1');
      expect(result.content).toContain('2');
      expect(result.error).toBeUndefined();
    });

    it('routes to datetime handler', async () => {
      const result = await runTool('get_current_datetime');
      expect(result.name).toBe('get_current_datetime');
      expect(result.content).toContain('Current date and time');
      expect(result.error).toBeUndefined();
    });

    it('routes to device info handler', async () => {
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.name).toBe('get_device_info');
      expect(result.content).toContain('Memory');
      expect(result.error).toBeUndefined();
    });

    it('returns error for unknown tool name', async () => {
      const result = await runTool('nonexistent_tool');
      expect(result.error).toBe('Unknown tool: nonexistent_tool');
      expect(result.content).toBe('');
    });

    it('each result includes durationMs', async () => {
      const result = await runTool('calculator', { expression: '5+5' });
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Calculator
  // ==========================================================================
  describe('Calculator', () => {
    it.each([
      ['2+2', '2+2 = 4'],
      ['3*4', '3*4 = 12'],
      ['(2+3)*4', '(2+3)*4 = 20'],
      ['2^3', '2^3 = 8'],
      ['10/2', '10/2 = 5'],
    ])('evaluates %s correctly', async (expr, expected) => {
      const result = await runTool('calculator', { expression: expr });
      expect(result.content).toBe(expected);
    });

    it('rejects invalid characters (letters)', async () => {
      const result = await runTool('calculator', { expression: '2+abc' });
      expect(result.error).toContain('Invalid expression');
    });

    it('rejects invalid characters (semicolons)', async () => {
      const result = await runTool('calculator', { expression: '2+2; process.exit()' });
      expect(result.error).toContain('Invalid expression');
    });
  });

  // ==========================================================================
  // Date/Time
  // ==========================================================================
  describe('Date/Time', () => {
    it('returns formatted date/time string with ISO and Unix timestamp', async () => {
      const result = await runTool('get_current_datetime');
      expect(result.content).toContain('Current date and time:');
      expect(result.content).toMatch(/ISO 8601: \d{4}-\d{2}-\d{2}T/);
      expect(result.content).toMatch(/Unix timestamp: \d+/);
    });

    it('handles invalid timezone gracefully (returns fallback)', async () => {
      const result = await runTool('get_current_datetime', { timezone: 'Invalid/Fake_Zone' });
      expect(result.content).toContain('invalid');
      expect(result.content).toContain('Invalid/Fake_Zone');
      expect(result.error).toBeUndefined();
    });
  });

  // ==========================================================================
  // Device Info
  // ==========================================================================
  describe('Device Info', () => {
    beforeEach(() => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getFreeDiskStorage.mockResolvedValue(50 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getTotalDiskCapacity = jest.fn().mockResolvedValue(128 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getBatteryLevel = jest.fn().mockResolvedValue(0.75);
      (mockedDeviceInfo as any).isBatteryCharging = jest.fn().mockResolvedValue(false);
      (mockedDeviceInfo as any).getBrand = jest.fn().mockReturnValue('Google');
      mockedDeviceInfo.getModel.mockReturnValue('Pixel 7');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
    });

    it('returns memory info when type is "memory"', async () => {
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('Memory');
      expect(result.content).toContain('Total');
      expect(result.content).toContain('Used');
      expect(result.content).toContain('Available');
    });

    it('returns battery info when type is "battery"', async () => {
      const result = await runTool('get_device_info', { info_type: 'battery' });
      expect(result.content).toContain('Battery');
      expect(result.content).toContain('75%');
    });

    it('returns all info when type is "all"', async () => {
      const result = await runTool('get_device_info', { info_type: 'all' });
      for (const section of ['Memory', 'Battery', 'Device', 'OS']) {
        expect(result.content).toContain(section);
      }
    });
  });

  // ==========================================================================
  // Web Search (mock fetch)
  // ==========================================================================
  describe('Web Search', () => {
    const originalFetch = (globalThis as any).fetch;

    afterEach(() => {
      (globalThis as any).fetch = originalFetch;
    });

    it('returns formatted results when fetch succeeds', async () => {
      const html = buildBraveSearchHTML([
        {
          title: 'React Native Docs',
          url: 'https://reactnative.dev',
          snippet: 'Learn once, write anywhere.',
        },
        {
          title: 'React Native GitHub',
          url: 'https://github.com/facebook/react-native',
          snippet: 'A framework for building native apps.',
        },
      ]);

      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'react native' });

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('React Native Docs');
      expect(result.content).toContain('reactnative.dev');
      expect(result.content).toContain('Learn once, write anywhere.');
      expect(result.content).toContain('React Native GitHub');
    });

    it('returns "No results" when HTML has no results', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue('<html><body>No matching documents</body></html>'),
      });

      const result = await runTool('web_search', { query: 'xyznonexistent12345' });

      expect(result.content).toContain('No results found');
      expect(result.error).toBeUndefined();
    });

    it('handles fetch timeout/error gracefully', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      const result = await runTool('web_search', { query: 'test query' });
      expect(result.error).toContain('Network request failed');
      expect(result.content).toBe('');
    });

    it.each([
      ['empty string', { query: '' }],
      ['undefined', {}],
      ['whitespace only', { query: '   ' }],
    ])('returns error when query is %s', async (_label, args) => {
      const result = await runTool('web_search', args);
      expect(result.error).toContain('Missing required parameter: query');
    });

  });
});
