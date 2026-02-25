import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { ToolCall, ToolResult } from './types';
import logger from '../../utils/logger';

export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const start = Date.now();
  try {
    let content: string;
    switch (call.name) {
      case 'web_search': {
        const query = call.arguments.query;
        if (!query || typeof query !== 'string' || !query.trim()) {
          return { toolCallId: call.id, name: call.name, content: '', error: 'Missing required parameter: query', durationMs: Date.now() - start };
        }
        content = await handleWebSearch(query.trim());
        break;
      }
      case 'calculator':
        content = handleCalculator(call.arguments.expression);
        break;
      case 'get_current_datetime':
        content = handleGetDatetime(call.arguments.timezone);
        break;
      case 'get_device_info':
        content = await handleGetDeviceInfo(call.arguments.info_type);
        break;
      default:
        return {
          toolCallId: call.id,
          name: call.name,
          content: '',
          error: `Unknown tool: ${call.name}`,
          durationMs: Date.now() - start,
        };
    }
    return {
      toolCallId: call.id,
      name: call.name,
      content,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    logger.error(`[Tools] Error executing ${call.name}:`, error);
    return {
      toolCallId: call.id,
      name: call.name,
      content: '',
      error: error.message || 'Tool execution failed',
      durationMs: Date.now() - start,
    };
  }
}

async function handleWebSearch(query: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
    const html = await response.text();
    const results = parseBraveResults(html);

    if (results.length === 0) {
      return `No results found for "${query}".`;
    }

    return results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.url ? `[${r.title}](${r.url})` : r.title}\n   ${r.snippet}`)
      .join('\n\n');
  } finally {
    clearTimeout(timeout);
  }
}

type SearchResult = { title: string; snippet: string; url?: string };

function stripHtmlTags(html: string): string {
  let result = '';
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    if (html[i] === '<') { inTag = true; continue; }
    if (html[i] === '>') { inTag = false; continue; }
    if (!inTag) result += html[i];
  }
  return result;
}

function parseResultBlock(block: string): SearchResult | null {
  const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
  const url = urlMatch ? decodeHTMLEntities(urlMatch[1]) : '';

  const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ||
                     block.match(/<a[^>]*href="https?:\/\/[^"]*"[^>]*>\s*<span[^>]*>([^<]+)/);
  const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : '';

  const snippetMatch = block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
                       block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const snippet = snippetMatch
    ? decodeHTMLEntities(stripHtmlTags(snippetMatch[1]).trim())
    : '';

  if (!title && !snippet) return null;
  return { title: title || '(no title)', snippet: snippet || '(no snippet)', url };
}

function parseBraveResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result-wrapper/).slice(1);

  for (const block of blocks) {
    if (results.length >= 5) break;
    const parsed = parseResultBlock(block);
    if (parsed) results.push(parsed);
  }

  if (results.length === 0) {
    const linkPattern = /<a[^>]*href="(https?:\/\/(?!search\.brave)[^"]*)"[^>]*>([^<]{10,})<\/a>/g;
    let match;
    while ((match = linkPattern.exec(html)) !== null && results.length < 5) {
      const title = decodeHTMLEntities(match[2].trim());
      if (!title.includes('Brave')) {
        results.push({ title, snippet: '', url: match[1] });
      }
    }
  }

  return results;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Safe math expression evaluator using recursive descent parsing.
 * Supports: +, -, *, /, %, ^ (exponentiation), parentheses, decimals.
 * No dynamic code execution (no eval/new Function).
 */
function evaluateExpression(expr: string): number {
  let pos = 0;
  const str = expr.replace(/\s/g, '');

  function parseExpr(): number {
    let left = parseTerm();
    while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
      const op = str[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (pos < str.length && (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')) {
      const op = str[pos++];
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    if (pos < str.length && str[pos] === '^') {
      pos++;
      const exp = parsePower(); // right-associative
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (str[pos] === '-') { pos++; return -parseAtom(); }
    if (str[pos] === '+') { pos++; return parseAtom(); }
    return parseAtom();
  }

  function parseAtom(): number {
    if (str[pos] === '(') {
      pos++; // skip '('
      const val = parseExpr();
      if (str[pos] !== ')') throw new Error('Mismatched parentheses');
      pos++; // skip ')'
      return val;
    }
    const start = pos;
    while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) pos++;
    if (pos === start) throw new Error('Unexpected character');
    return Number(str.substring(start, pos));
  }

  const result = parseExpr();
  if (pos < str.length) throw new Error('Unexpected character');
  return result;
}

function handleCalculator(expression: string): string {
  const sanitized = expression.replace(/\s/g, '');
  if (!/^[0-9+\-*/().,%^]+$/.test(sanitized)) {
    throw new Error('Invalid expression: only numbers and basic operators (+, -, *, /, ^, %, parentheses) are allowed');
  }

  const result = evaluateExpression(sanitized);

  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not evaluate to a finite number');
  }

  return `${expression} = ${result}`;
}

function handleGetDatetime(timezone?: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
  };

  if (timezone) {
    options.timeZone = timezone;
  }

  try {
    const formatted = new Intl.DateTimeFormat('en-US', options).format(now);
    const isoString = now.toISOString();
    return `Current date and time: ${formatted}\nISO 8601: ${isoString}\nUnix timestamp: ${Math.floor(now.getTime() / 1000)}`;
  } catch {
    // Invalid timezone fallback
    const formatted = now.toString();
    return `Current date and time: ${formatted}\nNote: requested timezone "${timezone}" was invalid, showing device local time.`;
  }
}

async function collectDeviceSection(
  label: string, fetcher: () => Promise<string>,
): Promise<string> {
  try { return await fetcher(); } catch { return `${label}: unavailable`; }
}

async function handleGetDeviceInfo(infoType?: string): Promise<string> {
  const type = infoType ?? 'all';
  const parts: string[] = [];

  if (type === 'all' || type === 'memory') {
    parts.push(await collectDeviceSection('Memory', async () => {
      const total = await DeviceInfo.getTotalMemory();
      const used = await DeviceInfo.getUsedMemory();
      return `Memory:\n  Total: ${formatBytes(total)}\n  Used: ${formatBytes(used)}\n  Available: ${formatBytes(total - used)}`;
    }));
  }

  if (type === 'all' || type === 'storage') {
    parts.push(await collectDeviceSection('Storage', async () => {
      const free = await DeviceInfo.getFreeDiskStorage();
      const total = await DeviceInfo.getTotalDiskCapacity();
      return `Storage:\n  Total: ${formatBytes(total)}\n  Free: ${formatBytes(free)}`;
    }));
  }

  if (type === 'all' || type === 'battery') {
    parts.push(await collectDeviceSection('Battery', async () => {
      const level = await DeviceInfo.getBatteryLevel();
      const charging = await DeviceInfo.isBatteryCharging();
      return `Battery: ${Math.round(level * 100)}%${charging ? ' (charging)' : ''}`;
    }));
  }

  if (type === 'all') {
    parts.push(
      `Device: ${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,
      `OS: ${Platform.OS} ${DeviceInfo.getSystemVersion()}`,
    );
  }

  return parts.join('\n\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
