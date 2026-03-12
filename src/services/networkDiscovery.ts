/**
 * LAN LLM Server Discovery
 *
 * Scans the device's local subnet for running LLM servers
 * (Ollama, LM Studio, LocalAI) using their default ports.
 */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import logger from '../utils/logger';

export interface DiscoveredServer {
  endpoint: string;
  type: 'ollama' | 'lmstudio' | 'localai';
  name: string;
}

const PROVIDERS = [
  { port: 11434, type: 'ollama' as const,   name: 'Ollama',    probePath: '/api/tags'     },
  { port: 1234,  type: 'lmstudio' as const, name: 'LM Studio', probePath: '/api/v1/models' },
  { port: 8080,  type: 'localai' as const,  name: 'LocalAI',   probePath: '/v1/models'    },
];

const TIMEOUT_MS = 500;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 50;

/** Probe a single host:port — resolves true if it responds with an HTTP status */
async function probe(ip: string, port: number, path: string): Promise<boolean> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(false); }, TIMEOUT_MS);

    fetch(`http://${ip}:${port}${path}`, { signal: controller.signal })
      .then(res => { clearTimeout(timer); resolve(res.status === 200); })
      .catch(() => { clearTimeout(timer); resolve(false); });
  });
}

/** Run up to BATCH_SIZE probes concurrently with a small delay between batches */
async function runBatch<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE).map(t => t());
    results.push(...await Promise.all(batch));
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

/** Parse subnet base from IPv4, e.g. "192.168.1.42" → "192.168.1". Returns null if not a private IPv4. */
function subnetBase(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);
  const isPrivate =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!isPrivate) return null;
  return parts.slice(0, 3).join('.');
}

/** Returns true if the string looks like an IPv6 address */
function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Common home/office subnets to try when IPv4 detection fails (e.g. device returns IPv6).
 * Intentionally limited to the 2 most common home subnets to avoid a flood of timeouts
 * on devices with no WiFi (e.g. cellular-only) where all probes would time out anyway.
 */
const FALLBACK_SUBNETS = ['192.168.1', '192.168.0'];

/**
 * Scan the local subnet for LLM servers.
 * Returns discovered servers sorted by IP.
 * Throws with a human-readable message if setup fails (no WiFi IP, non-private network).
 * Errors during probing are swallowed — only setup errors propagate.
 */
export async function discoverLANServers(): Promise<DiscoveredServer[]> {
  const runningOnEmulator = await isEmulator();
  if (runningOnEmulator) {
    logger.warn('[Discovery] Running on emulator — skipping LAN scan (emulator network stack cannot handle concurrent probes)');
    return [];
  }

  let ip: string | null;
  try {
    ip = await getIpAddress();
  } catch (err) {
    logger.warn('[Discovery] getIpAddress threw:', (err as Error).message, '— trying common subnets');
    ip = null;
  }

  let subnetsToScan: string[];

  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') {
    logger.warn('[Discovery] Could not get device WiFi IP (got:', ip || 'null', '), trying common subnets');
    subnetsToScan = FALLBACK_SUBNETS;
  } else if (isIPv6(ip)) {
    // iOS 26+ may return IPv6 as the primary address — fall back to common subnets
    logger.warn('[Discovery] Got IPv6 address:', ip, '— falling back to common subnets');
    subnetsToScan = FALLBACK_SUBNETS;
  } else {
    const base = subnetBase(ip);
    if (!base) {
      logger.warn('[Discovery] IP is not on a private network:', ip, '— trying common subnets');
      subnetsToScan = FALLBACK_SUBNETS;
    } else {
      subnetsToScan = [base];
    }
  }

  logger.log('[Discovery] Scanning subnets:', subnetsToScan.map(s => `${s}.0/24`).join(', '));

  try {
    const discovered: DiscoveredServer[] = [];
    const seenEndpoints = new Set<string>();

    const recordIfFound = (target: string, provider: typeof PROVIDERS[0]) => (found: boolean) => {
      if (!found) return;
      const endpoint = `http://${target}:${provider.port}`;
      if (!seenEndpoints.has(endpoint)) {
        seenEndpoints.add(endpoint);
        logger.log(`[Discovery] Found ${provider.name} at ${target}:${provider.port}`);
        discovered.push({ endpoint, type: provider.type, name: `${provider.name} (${target})` });
      }
    };

    // Scan all subnets in parallel — each subnet is independent
    await Promise.all(subnetsToScan.map(async (base) => {
      for (const provider of PROVIDERS) {
        const tasks = Array.from({ length: 254 }, (_, i) => {
          const target = `${base}.${i + 1}`;
          return () => probe(target, provider.port, provider.probePath).then(recordIfFound(target, provider));
        });
        await runBatch(tasks);
      }
    }));

    logger.log('[Discovery] Scan complete, found:', discovered.length, 'servers');
    return discovered;
  } catch (error) {
    logger.warn('[Discovery] Scan error during probing:', error);
    return [];
  }
}
