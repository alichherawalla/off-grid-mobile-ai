/**
 * Provider Registry Unit Tests
 *
 * Tests for the provider registry that manages LLM providers.
 */

// Mock logger BEFORE importing anything else
jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the localProvider import to avoid dependency issues
jest.mock('../../../../src/services/providers/localProvider', () => ({
  localProvider: {
    id: 'local',
    type: 'local',
    capabilities: { supportsVision: false, supportsToolCalling: true },
    loadModel: jest.fn(),
    unloadModel: jest.fn(),
    isModelLoaded: jest.fn(),
    getLoadedModelId: jest.fn(),
    generate: jest.fn(),
    stopGeneration: jest.fn(),
    getTokenCount: jest.fn(),
    isReady: jest.fn(),
    dispose: jest.fn(),
  },
}));

import { providerRegistry, getProviderForServer } from '../../../../src/services/providers/registry';
import { localProvider } from '../../../../src/services/providers/localProvider';

// We need to test a singleton, so we need to clear the registry state between tests
describe('ProviderRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any extra providers from previous tests
    const ids = providerRegistry.getProviderIds().filter(id => id !== 'local');
    for (const id of ids) {
      providerRegistry.unregisterProvider(id);
    }
    // Reset active provider to local
    providerRegistry.setActiveProvider('local');
  });

  describe('registerProvider and getProvider', () => {
    it('should register and retrieve a provider', () => {
      const mockProvider = {
        id: 'test-provider',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test-provider', mockProvider as any);
      expect(providerRegistry.getProvider('test-provider')).toBe(mockProvider);
    });

    it('should return undefined for non-existent provider', () => {
      expect(providerRegistry.getProvider('non-existent')).toBeUndefined();
    });
  });

  describe('unregisterProvider', () => {
    it('should not allow unregistering local provider', () => {
      // Local provider should still exist
      providerRegistry.unregisterProvider('local');
      expect(providerRegistry.getProvider('local')).toBeDefined();
    });

    it('should unregister a provider', () => {
      const mockProvider = {
        id: 'test',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test', mockProvider as any);
      expect(providerRegistry.getProvider('test')).toBe(mockProvider);

      providerRegistry.unregisterProvider('test');
      expect(providerRegistry.getProvider('test')).toBeUndefined();
    });

    it('should switch to local when unregistering active provider', () => {
      const mockProvider = {
        id: 'test-active',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test-active', mockProvider as any);
      providerRegistry.setActiveProvider('test-active');
      expect(providerRegistry.getActiveProviderId()).toBe('test-active');

      providerRegistry.unregisterProvider('test-active');
      expect(providerRegistry.getActiveProviderId()).toBe('local');
    });
  });

  describe('setActiveProvider', () => {
    it('should set active provider if it exists', () => {
      const mockProvider = {
        id: 'test-provider',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test-provider', mockProvider as any);
      const result = providerRegistry.setActiveProvider('test-provider');

      expect(result).toBe(true);
      expect(providerRegistry.getActiveProviderId()).toBe('test-provider');
    });

    it('should return false if provider does not exist', () => {
      const result = providerRegistry.setActiveProvider('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getActiveProvider', () => {
    it('should return local provider as default', () => {
      const provider = providerRegistry.getActiveProvider();
      expect(provider.id).toBe('local');
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      expect(providerRegistry.hasProvider('local')).toBe(true);
    });

    it('should return false for non-existent provider', () => {
      expect(providerRegistry.hasProvider('non-existent')).toBe(false);
    });
  });

  describe('getProviderIds', () => {
    it('should return array of provider IDs', () => {
      const mockProvider = {
        id: 'test',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test', mockProvider as any);
      const ids = providerRegistry.getProviderIds();

      expect(ids).toContain('local');
      expect(ids).toContain('test');
    });
  });

  describe('subscribe', () => {
    it('should notify listeners when active provider changes', () => {
      const mockProvider = {
        id: 'test-subscribe',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };
      const listener = jest.fn();

      providerRegistry.registerProvider('test-subscribe', mockProvider as any);
      const unsubscribe = providerRegistry.subscribe(listener);

      providerRegistry.setActiveProvider('test-subscribe');

      expect(listener).toHaveBeenCalledWith('test-subscribe');

      unsubscribe();
    });

    it('should pass null when switching to local provider', () => {
      const listener = jest.fn();
      providerRegistry.subscribe(listener);

      // Local is already active, but let's verify the behavior
      providerRegistry.setActiveProvider('local');

      expect(listener).toHaveBeenCalledWith(null);
    });

    it('should unsubscribe correctly', () => {
      const mockProvider = {
        id: 'test-unsub',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };
      const listener = jest.fn();

      providerRegistry.registerProvider('test-unsub', mockProvider as any);
      const unsubscribe = providerRegistry.subscribe(listener);
      unsubscribe();

      providerRegistry.setActiveProvider('test-unsub');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear all providers except local', () => {
      const mockProvider1 = {
        id: 'test-clear1',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };
      const mockProvider2 = {
        id: 'test-clear2',
        type: 'openai-compatible' as const,
        capabilities: { supportsVision: true },
      };

      providerRegistry.registerProvider('test-clear1', mockProvider1 as any);
      providerRegistry.registerProvider('test-clear2', mockProvider2 as any);
      providerRegistry.setActiveProvider('test-clear1');

      providerRegistry.clear();

      expect(providerRegistry.hasProvider('test-clear1')).toBe(false);
      expect(providerRegistry.hasProvider('test-clear2')).toBe(false);
      expect(providerRegistry.hasProvider('local')).toBe(true);
      expect(providerRegistry.getActiveProviderId()).toBe('local');
    });
  });
});

describe('getProviderForServer', () => {
  it('should return local provider for null serverId', () => {
    const provider = getProviderForServer(null);
    expect(provider.id).toBe('local');
  });

  it('should return local provider for undefined serverId', () => {
    const provider = getProviderForServer(undefined as any);
    expect(provider.id).toBe('local');
  });

  it('should return registered provider for valid serverId', () => {
    const mockProvider = {
      id: 'my-server',
      type: 'openai-compatible' as const,
      capabilities: { supportsVision: true },
    };

    providerRegistry.registerProvider('my-server', mockProvider as any);
    const provider = getProviderForServer('my-server');
    expect(provider.id).toBe('my-server');
  });

  it('should return local provider for non-existent serverId', () => {
    const provider = getProviderForServer('non-existent-server');
    expect(provider.id).toBe('local');
  });
});