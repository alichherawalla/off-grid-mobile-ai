/**
 * Remote Server Store Unit Tests
 *
 * Tests for Zustand store managing remote LLM server configurations.
 */

import { act } from '@testing-library/react-native';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import * as httpClient from '../../../src/services/httpClient';

// Mock httpClient
jest.mock('../../../src/services/httpClient', () => ({
  testEndpoint: jest.fn(),
  detectServerType: jest.fn(),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

function addTestServer(name = 'Test Server', endpoint = 'http://test:11434'): string { // NOSONAR
  let serverId = '';
  act(() => {
    serverId = useRemoteServerStore.getState().addServer({
      name,
      endpoint,
      providerType: 'openai-compatible',
    });
  });
  return serverId;
}

function addServerWithModel(modelId = 'model1', modelName = 'Model 1'): string {
  const serverId = addTestServer();
  act(() => {
    useRemoteServerStore.getState().setDiscoveredModels(serverId, [
      { id: modelId, name: modelName, serverId, capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false }, lastUpdated: new Date().toISOString() },
    ]);
  });
  return serverId;
}

describe('remoteServerStore', () => {
  beforeEach(() => {
    // Reset store before each test
    act(() => {
      useRemoteServerStore.getState().clearAllServers();
    });
    jest.clearAllMocks();
  });

  describe('addServer', () => {
    it('should add a new server with generated ID', () => {
      const serverData = {
        name: 'Test Server',
        endpoint: 'http://192.168.1.50:11434',
        providerType: 'openai-compatible' as const,
      };

      let serverId: string = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer(serverData);
      });

      const servers = useRemoteServerStore.getState().servers;

      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe(serverId);
      expect(servers[0].name).toBe('Test Server');
      expect(servers[0].endpoint).toBe('http://192.168.1.50:11434');
      expect(servers[0].createdAt).toBeDefined();
    });

    it('should store notes if provided', () => {
      const serverData = {
        name: 'Ollama Server',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible' as const,
        notes: 'Local development server',
      };

      act(() => {
        useRemoteServerStore.getState().addServer(serverData);
      });

      const servers = useRemoteServerStore.getState().servers;

      expect(servers[0].notes).toBe('Local development server');
    });
  });

  describe('updateServer', () => {
    it('should update existing server', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Original Name',
          endpoint: 'http://original:11434',
          providerType: 'openai-compatible',
        });
      });

      act(() => {
        useRemoteServerStore.getState().updateServer(serverId, {
          name: 'Updated Name',
          endpoint: 'http://updated:11434',
        });
      });

      const server = useRemoteServerStore.getState().getServerById(serverId);

      expect(server?.name).toBe('Updated Name');
      expect(server?.endpoint).toBe('http://updated:11434');
    });

    it('should not modify other servers', () => {
      let server1Id = '';
      let _server2Id = '';
      act(() => {
        server1Id = useRemoteServerStore.getState().addServer({
          name: 'Server 1',
          endpoint: 'http://server1:11434',
          providerType: 'openai-compatible',
        });
        _server2Id = useRemoteServerStore.getState().addServer({
          name: 'Server 2',
          endpoint: 'http://server2:11434',
          providerType: 'openai-compatible',
        });
      });

      act(() => {
        useRemoteServerStore.getState().updateServer(server1Id, { name: 'Updated Server 1' });
      });

      const servers = useRemoteServerStore.getState().servers;

      expect(servers[0].name).toBe('Updated Server 1');
      expect(servers[1].name).toBe('Server 2');
    });
  });

  describe('removeServer', () => {
    it('should remove server from list', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      act(() => {
        useRemoteServerStore.getState().removeServer(serverId);
      });

      const servers = useRemoteServerStore.getState().servers;

      expect(servers).toHaveLength(0);
    });

    it('should clear activeServerId if removed server was active', () => {
      const serverId = addTestServer('Active Server', 'http://active:11434'); // NOSONAR

      act(() => {
        useRemoteServerStore.getState().setActiveServerId(serverId);
      });

      expect(useRemoteServerStore.getState().activeServerId).toBe(serverId);

      act(() => {
        useRemoteServerStore.getState().removeServer(serverId);
      });

      expect(useRemoteServerStore.getState().activeServerId).toBeNull();
    });
  });

  describe('setActiveServerId', () => {
    it('should set active server', () => {
      const serverId = addTestServer();

      act(() => {
        useRemoteServerStore.getState().setActiveServerId(serverId);
      });

      expect(useRemoteServerStore.getState().activeServerId).toBe(serverId);
    });

    it('should allow clearing active server', () => {
      act(() => {
        useRemoteServerStore.getState().setActiveServerId(null);
      });

      expect(useRemoteServerStore.getState().activeServerId).toBeNull();
    });
  });

  describe('getActiveServer', () => {
    it('should return active server', () => {
      const serverId = addTestServer('Active Server', 'http://active:11434'); // NOSONAR

      act(() => {
        useRemoteServerStore.getState().setActiveServerId(serverId);
      });

      const activeServer = useRemoteServerStore.getState().getActiveServer();

      expect(activeServer?.name).toBe('Active Server');
    });

    it('should return null when no server is active', () => {
      const activeServer = useRemoteServerStore.getState().getActiveServer();

      expect(activeServer).toBeNull();
    });
  });

  describe('setDiscoveredModels', () => {
    it('should store discovered models for a server', () => {
      const serverId = addTestServer();

      act(() => {
        useRemoteServerStore.getState().setDiscoveredModels(serverId, [
          { id: 'llama2', name: 'Llama 2', serverId, capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false }, lastUpdated: new Date().toISOString() },
          { id: 'mistral', name: 'Mistral', serverId, capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false }, lastUpdated: new Date().toISOString() },
        ]);
      });

      const models = useRemoteServerStore.getState().discoveredModels[serverId];

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('llama2');
    });
  });

  describe('clearDiscoveredModels', () => {
    it('should clear models for a server', () => {
      const serverId = addServerWithModel();

      act(() => {
        useRemoteServerStore.getState().clearDiscoveredModels(serverId);
      });

      expect(useRemoteServerStore.getState().discoveredModels[serverId]).toBeUndefined();
    });
  });

  describe('testConnection', () => {
    it('should test connection and return success', async () => {
      (httpClient.testEndpoint as jest.Mock).mockResolvedValue({
        success: true,
        latency: 50,
      });
      (httpClient.detectServerType as jest.Mock).mockResolvedValue({ type: 'ollama' });

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      let result;
      await act(async () => {
        result = await useRemoteServerStore.getState().testConnection(serverId);
      });

      expect(result!.success).toBe(true);
      expect(result!.latency).toBe(50);
    });

    it('should return error on connection failure', async () => {
      (httpClient.testEndpoint as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Connection refused',
      });

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Bad Server',
          endpoint: 'http://bad:11434',
          providerType: 'openai-compatible',
        });
      });

      let result;
      await act(async () => {
        result = await useRemoteServerStore.getState().testConnection(serverId);
      });

      expect(result!.success).toBe(false);
      expect(result!.error).toContain('Connection refused');
    });
  });

  describe('testConnectionByEndpoint', () => {
    it('should test connection without adding server', async () => {
      (httpClient.testEndpoint as jest.Mock).mockResolvedValue({
        success: true,
        latency: 25,
      });

      let result;
      await act(async () => {
        result = await useRemoteServerStore.getState().testConnectionByEndpoint('http://test:11434');
      });

      expect(result!.success).toBe(true);
      expect(useRemoteServerStore.getState().servers).toHaveLength(0);
    });
  });

  describe('getServerById', () => {
    it('should return server by ID', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      const server = useRemoteServerStore.getState().getServerById(serverId);

      expect(server?.name).toBe('Test Server');
    });

    it('should return null for non-existent ID', () => {
      const server = useRemoteServerStore.getState().getServerById('non-existent');

      expect(server).toBeNull();
    });
  });

  describe('getModelById', () => {
    it('should return model by ID', () => {
      const serverId = addServerWithModel();

      const model = useRemoteServerStore.getState().getModelById(serverId, 'model1');

      expect(model?.name).toBe('Model 1');
    });

    it('should return null for non-existent model', () => {
      const model = useRemoteServerStore.getState().getModelById('non-existent', 'non-existent');

      expect(model).toBeNull();
    });
  });

  describe('clearAllServers', () => {
    it('should remove all servers', () => {
      act(() => {
        useRemoteServerStore.getState().addServer({
          name: 'Server 1',
          endpoint: 'http://s1:11434',
          providerType: 'openai-compatible',
        });
        useRemoteServerStore.getState().addServer({
          name: 'Server 2',
          endpoint: 'http://s2:11434',
          providerType: 'openai-compatible',
        });
      });

      act(() => {
        useRemoteServerStore.getState().clearAllServers();
      });

      expect(useRemoteServerStore.getState().servers).toHaveLength(0);
      expect(useRemoteServerStore.getState().activeServerId).toBeNull();
    });
  });

  describe('activeRemoteTextModelId', () => {
    it('should set active remote text model ID', () => {
      act(() => {
        useRemoteServerStore.getState().setActiveRemoteTextModelId('model-123');
      });

      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('model-123');
    });

    it('should clear active remote text model ID', () => {
      act(() => {
        useRemoteServerStore.getState().setActiveRemoteTextModelId('model-123');
      });

      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('model-123');

      act(() => {
        useRemoteServerStore.getState().setActiveRemoteTextModelId(null);
      });

      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBeNull();
    });
  });

  describe('activeRemoteImageModelId', () => {
    it('should set active remote image model ID', () => {
      act(() => {
        useRemoteServerStore.getState().setActiveRemoteImageModelId('vision-model-456');
      });

      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBe('vision-model-456');
    });

    it('should clear active remote image model ID', () => {
      act(() => {
        useRemoteServerStore.getState().setActiveRemoteImageModelId('vision-model-456');
      });

      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBe('vision-model-456');

      act(() => {
        useRemoteServerStore.getState().setActiveRemoteImageModelId(null);
      });

      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBeNull();
    });
  });

  describe('getActiveRemoteTextModel', () => {
    it('should return active remote text model when set', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
        useRemoteServerStore.getState().setDiscoveredModels(serverId, [
          { id: 'llama2', name: 'Llama 2', serverId, capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false }, lastUpdated: new Date().toISOString() },
          { id: 'mistral', name: 'Mistral', serverId, capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false }, lastUpdated: new Date().toISOString() },
        ]);
        useRemoteServerStore.getState().setActiveServerId(serverId);
        useRemoteServerStore.getState().setActiveRemoteTextModelId('llama2');
      });

      const model = useRemoteServerStore.getState().getActiveRemoteTextModel();

      expect(model).not.toBeNull();
      expect(model?.id).toBe('llama2');
      expect(model?.name).toBe('Llama 2');
    });

    it('should return null when no remote text model is set', () => {
      const model = useRemoteServerStore.getState().getActiveRemoteTextModel();

      expect(model).toBeNull();
    });

    it('should return null when activeRemoteTextModelId is set but activeServerId is not', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
        useRemoteServerStore.getState().setDiscoveredModels(serverId, [
          { id: 'llama2', name: 'Llama 2', serverId, capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false }, lastUpdated: new Date().toISOString() },
        ]);
        // Set model ID but not server ID
        useRemoteServerStore.getState().setActiveRemoteTextModelId('llama2');
      });

      const model = useRemoteServerStore.getState().getActiveRemoteTextModel();

      // Should return null because activeServerId is not set
      expect(model).toBeNull();
    });
  });

  describe('getActiveRemoteImageModel', () => {
    it('should return active remote image model when set', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
        useRemoteServerStore.getState().setDiscoveredModels(serverId, [
          { id: 'llava', name: 'LLaVA', serverId, capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false }, lastUpdated: new Date().toISOString() },
        ]);
        useRemoteServerStore.getState().setActiveServerId(serverId);
        useRemoteServerStore.getState().setActiveRemoteImageModelId('llava');
      });

      const model = useRemoteServerStore.getState().getActiveRemoteImageModel();

      expect(model).not.toBeNull();
      expect(model?.id).toBe('llava');
      expect(model?.capabilities.supportsVision).toBe(true);
    });

    it('should return null when no remote image model is set', () => {
      const model = useRemoteServerStore.getState().getActiveRemoteImageModel();

      expect(model).toBeNull();
    });
  });

  describe('clearAllServers clears remote model IDs', () => {
    it('should clear activeRemoteTextModelId and activeRemoteImageModelId', () => {
      act(() => {
        useRemoteServerStore.getState().addServer({
          name: 'Server 1',
          endpoint: 'http://s1:11434',
          providerType: 'openai-compatible',
        });
        useRemoteServerStore.getState().setActiveRemoteTextModelId('model-1');
        useRemoteServerStore.getState().setActiveRemoteImageModelId('vision-1');
      });

      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('model-1');
      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBe('vision-1');

      act(() => {
        useRemoteServerStore.getState().clearAllServers();
      });

      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBeNull();
      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBeNull();
    });
  });

  describe('removeServer clears related data', () => {
    it('should clear discoveredModels and serverHealth when server is removed', () => {
      const serverId = addServerWithModel();

      // Set up health status
      act(() => {
        useRemoteServerStore.getState().updateServerHealth(serverId, true);
      });

      expect(useRemoteServerStore.getState().discoveredModels[serverId]).toBeDefined();
      expect(useRemoteServerStore.getState().serverHealth[serverId]).toBeDefined();

      act(() => {
        useRemoteServerStore.getState().removeServer(serverId);
      });

      expect(useRemoteServerStore.getState().discoveredModels[serverId]).toBeUndefined();
      expect(useRemoteServerStore.getState().serverHealth[serverId]).toBeUndefined();
    });
  });

  describe('discoverModels', () => {
    it('should throw error when server not found', async () => {
      await expect(
        useRemoteServerStore.getState().discoverModels('non-existent-id')
      ).rejects.toThrow('Server not found');
    });

    it('should discover models and store them', async () => {
      // Mock global fetch for model discovery
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'gpt-4', owned_by: 'openai' },
          ],
        }),
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      let models: any;
      await act(async () => {
        models = await useRemoteServerStore.getState().discoverModels(serverId);
      });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('gpt-4');
      expect(useRemoteServerStore.getState().discoveredModels[serverId]).toHaveLength(1);
    });

    it('should handle fetch failure and return empty array', async () => {
      // Mock fetch to fail
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      // discoverModels returns empty array on fetch failure
      const models = await useRemoteServerStore.getState().discoverModels(serverId);

      expect(models).toHaveLength(0);
      expect(useRemoteServerStore.getState().isLoading).toBe(false);
      expect(useRemoteServerStore.getState().discoveringServerId).toBeNull();
    });
  });

  describe('testConnection error cases', () => {
    it('should return error when server not found', async () => {
      const result = await useRemoteServerStore.getState().testConnection('non-existent-id');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Server not found');
    });

    it('should catch errors and return error result', async () => {
      (httpClient.testEndpoint as jest.Mock).mockRejectedValue(new Error('Network failure'));

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      const result = await useRemoteServerStore.getState().testConnection(serverId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });
  });

  describe('testConnectionByEndpoint error cases', () => {
    it('should handle network errors', async () => {
      (httpClient.testEndpoint as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

      const result = await useRemoteServerStore.getState().testConnectionByEndpoint('http://test:11434');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });

    it('should handle non-Error exceptions', async () => {
      (httpClient.testEndpoint as jest.Mock).mockRejectedValue('Unknown failure');

      const result = await useRemoteServerStore.getState().testConnectionByEndpoint('http://test:11434');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('updateServerHealth', () => {
    it('should update server health status', () => {
      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Test Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      act(() => {
        useRemoteServerStore.getState().updateServerHealth(serverId, true);
      });

      const health = useRemoteServerStore.getState().serverHealth[serverId];
      expect(health.isHealthy).toBe(true);
      expect(health.lastCheck).toBeDefined();
    });
  });

  describe('fetchModelsFromServer with apiKey', () => {
    it('should use Authorization header when apiKey is provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [{ id: 'model-with-key' }],
        }),
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'API Key Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
          apiKey: 'secret-key',
        });
      });

      await useRemoteServerStore.getState().discoverModels(serverId);

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe('Bearer secret-key');
    });
  });

  describe('Ollama model format', () => {
    it('should parse Ollama /v1/models response with models array', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama2:latest', details: { size: '4GB' } },
            { name: 'mistral:latest' },
          ],
        }),
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Ollama Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      const models = await useRemoteServerStore.getState().discoverModels(serverId);

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('llama2:latest');
      expect(models[0].details).toEqual({ size: '4GB' });
    });
  });

  describe('Ollama /api/tags endpoint fallback', () => {
    it('should try /api/tags when /v1/models fails', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('/v1/models')) {
          return Promise.resolve({
            ok: false,
            json: async () => ({}),
          });
        }
        // /api/tags succeeds
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ name: 'ollama-model' }],
          }),
        });
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Ollama Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      const models = await useRemoteServerStore.getState().discoverModels(serverId);

      expect(callCount).toBe(2); // Both endpoints called
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('ollama-model');
    });

    it('should return empty array when both endpoints fail', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Failing Server',
          endpoint: 'http://test:11434',
          providerType: 'openai-compatible',
        });
      });

      const models = await useRemoteServerStore.getState().discoverModels(serverId);

      expect(models).toHaveLength(0);
    });
  });

  async function discoverWithModels(modelIds: string[]) {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: 'list',
        data: modelIds.map(id => ({ id })),
      }),
    });
    (global as any).fetch = mockFetch;

    let serverId = '';
    act(() => {
      serverId = useRemoteServerStore.getState().addServer({
        name: 'Test Server',
        endpoint: 'http://test:11434', // NOSONAR
        providerType: 'openai-compatible',
      });
    });

    return useRemoteServerStore.getState().discoverModels(serverId);
  }

  describe('isGenerativeModel filter', () => {
    it('filters out embedding models by "embed" pattern', async () => {
      const models = await discoverWithModels(['llama3', 'nomic-embed-text', 'text-embedding-ada-002']);
      const ids = models.map(m => m.id);
      expect(ids).toContain('llama3');
      expect(ids).not.toContain('nomic-embed-text');
      expect(ids).not.toContain('text-embedding-ada-002');
    });

    it('filters out reranker models', async () => {
      const models = await discoverWithModels(['llama3', 'bge-reranker-v2', 'cross-encoder-rerank']);
      const ids = models.map(m => m.id);
      expect(ids).toContain('llama3');
      expect(ids).not.toContain('bge-reranker-v2');
      expect(ids).not.toContain('cross-encoder-rerank');
    });

    it('filters out known embedding model prefixes (bge-, e5-, gte-, minilm)', async () => {
      const models = await discoverWithModels([
        'mistral', 'bge-small-en', 'e5-large-v2', 'gte-base', 'all-minilm-l6', 'arctic-embed-m',
      ]);
      const ids = models.map(m => m.id);
      expect(ids).toContain('mistral');
      expect(ids).not.toContain('bge-small-en');
      expect(ids).not.toContain('e5-large-v2');
      expect(ids).not.toContain('gte-base');
      expect(ids).not.toContain('all-minilm-l6');
      expect(ids).not.toContain('arctic-embed-m');
    });

    it('keeps text generation models like llama, mistral, qwen', async () => {
      const models = await discoverWithModels(['llama3:8b', 'mistral:7b', 'qwen2:1.5b', 'phi-3:mini']);
      expect(models).toHaveLength(4);
    });

    it('filters classifier models', async () => {
      const models = await discoverWithModels(['llama3', 'zero-shot-classifier']);
      const ids = models.map(m => m.id);
      expect(ids).toContain('llama3');
      expect(ids).not.toContain('zero-shot-classifier');
    });

    it('applies filter to Ollama /api/tags format', async () => {
      let _callCount = 0;
      const mockFetch = jest.fn().mockImplementation((url: string) => {
        _callCount++;
        if (url.includes('/v1/models')) {
          return Promise.resolve({ ok: false, json: async () => ({}) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3' },
              { name: 'nomic-embed-text' },
            ],
          }),
        });
      });
      (global as any).fetch = mockFetch;

      let serverId = '';
      act(() => {
        serverId = useRemoteServerStore.getState().addServer({
          name: 'Ollama',
          endpoint: 'http://test:11434', // NOSONAR
          providerType: 'openai-compatible',
        });
      });

      const models = await useRemoteServerStore.getState().discoverModels(serverId);
      const ids = models.map(m => m.id);
      expect(ids).toContain('llama3');
      expect(ids).not.toContain('nomic-embed-text');
    });
  });
});