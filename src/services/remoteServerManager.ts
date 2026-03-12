/* eslint-disable max-lines */
/**
 * Remote Server Manager
 *
 * Manages remote LLM server connections, including:
 * - CRUD operations for server configurations
 * - Secure API key storage using React Native Keychain
 * - Provider creation and management
 */

import * as Keychain from 'react-native-keychain';
import { RemoteServer, RemoteModel, ServerTestResult } from '../types';
import { useRemoteServerStore } from '../stores';
import { createOpenAIProvider, OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import logger from '../utils/logger';

const KEYCHAIN_SERVICE = 'ai.offgridmobile.servers';

class RemoteServerManager {
  /**
   * Add a new remote server
   */
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string }
  ): Promise<RemoteServer> {
    const store = useRemoteServerStore.getState();

    // Deduplicate: if a server with the same endpoint already exists, return it
    const trimSlashes = (url: string) => { let s = url.toLowerCase(); while (s.endsWith('/')) s = s.slice(0, -1); return s; };
    const normalizedEndpoint = trimSlashes(config.endpoint);
    const existing = store.servers.find(
      (s) => trimSlashes(s.endpoint) === normalizedEndpoint
    );
    if (existing) {
      logger.log('[RemoteServerManager] Server already exists:', existing.name);
      return existing;
    }

    // Add server to store
    const id = store.addServer(config);

    // Store API key securely if provided
    if (config.apiKey) {
      await this.storeApiKey(id, config.apiKey);
    }

    // Get the created server
    const server = store.getServerById(id);
    if (!server) {
      throw new Error('Failed to create server');
    }

    // Create and register provider
    await this.createProviderForServer(server);

    logger.log('[RemoteServerManager] Added server:', server.name);
    return server;
  }

  /**
   * Update a server configuration
   */
  async updateServer(
    id: string,
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>
  ): Promise<void> {
    const store = useRemoteServerStore.getState();
    const existingServer = store.getServerById(id);

    if (!existingServer) {
      throw new Error(`Server not found: ${id}`);
    }

    // Update API key if changed
    if (updates.apiKey !== undefined) {
      if (updates.apiKey) {
        await this.storeApiKey(id, updates.apiKey);
      } else {
        await this.removeApiKey(id);
      }
    }

    // Update store (apiKey is not stored in the store)
    const { apiKey: _, ...storeUpdates } = updates;
    store.updateServer(id, storeUpdates);

    // Update provider if endpoint or model changed
    const provider = providerRegistry.getProvider(id);
    if (provider && 'updateConfig' in provider) {
      const apiKey = await this.getApiKey(id);
      (provider as OpenAICompatibleProvider).updateConfig({
        endpoint: updates.endpoint || existingServer.endpoint,
        apiKey: apiKey || undefined,
      });
    }

    logger.log('[RemoteServerManager] Updated server:', id);
  }

  /**
   * Remove a server
   */
  async removeServer(id: string): Promise<void> {
    const store = useRemoteServerStore.getState();

    // Unregister provider
    providerRegistry.unregisterProvider(id);

    // Remove API key from secure storage
    await this.removeApiKey(id);

    // Remove from store
    store.removeServer(id);

    logger.log('[RemoteServerManager] Removed server:', id);
  }

  /**
   * Get all servers (without API keys)
   */
  getServers(): RemoteServer[] {
    return useRemoteServerStore.getState().servers;
  }

  /**
   * Get a server by ID
   */
  getServer(id: string): RemoteServer | null {
    return useRemoteServerStore.getState().getServerById(id);
  }

  /**
   * Get server with API key (for provider)
   */
  async getServerWithApiKey(id: string): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;

    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey || undefined };
  }

  /**
   * Test server connection
   */
  async testConnection(
    id: string
  ): Promise<{ success: boolean; error?: string; models?: RemoteModel[] }> {
    const store = useRemoteServerStore.getState();
    const result = await store.testConnection(id);

    if (result.success && result.models) {
      // Update capabilities for discovered models
      result.models = result.models.map(model => ({
        ...model,
        capabilities: {
          ...model.capabilities,
          // Try to detect capabilities from model name
          supportsVision: this.detectVisionCapability(model.id),
          supportsToolCalling: this.detectToolCallingCapability(model.id),
        },
      }));
    }

    return result;
  }

  /**
   * Test connection to a server by endpoint (before adding)
   */
  async testConnectionByEndpoint(
    endpoint: string,
    apiKey?: string
  ): Promise<ServerTestResult> {
    const store = useRemoteServerStore.getState();
    return store.testConnectionByEndpoint(endpoint, apiKey);
  }

  /**
   * Discover models from a server
   */
  async discoverModels(id: string): Promise<RemoteModel[]> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(id);

    if (!server) {
      throw new Error(`Server not found: ${id}`);
    }

    // Get API key
    const apiKey = await this.getApiKey(id);

    // Create temporary provider to discover models
    const tempProvider = createOpenAIProvider(
      'temp',
      server.endpoint,
      apiKey || undefined,
      'temp'
    );

    try {
      // Use store's discoverModels
      const models = await store.discoverModels(id);
      return models;
    } finally {
      await tempProvider.dispose();
    }
  }

  /**
   * Set the active server (null for local)
   */
  setActiveServer(id: string | null): void {
    const store = useRemoteServerStore.getState();
    store.setActiveServerId(id);

    if (id) {
      providerRegistry.setActiveProvider(id);
    } else {
      providerRegistry.setActiveProvider('local');
    }

    logger.log('[RemoteServerManager] Active server set to:', id || 'local');
  }

  /**
   * Set the active remote text model
   * This updates both the active server and the model ID on the provider
   */
  async setActiveRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    const store = useRemoteServerStore.getState();
    logger.log('[RemoteServerManager] setActiveRemoteTextModel called:', { serverId, modelId });

    // Set the active server
    store.setActiveServerId(serverId);
    store.setActiveRemoteTextModelId(modelId);

    // Ensure provider exists - create if needed
    let provider = providerRegistry.getProvider(serverId);
    if (!provider) {
      const server = store.getServerById(serverId);
      if (server) {
        logger.log('[RemoteServerManager] Creating provider for server:', serverId, server.endpoint);
        await this.createProviderForServer(server);
        provider = providerRegistry.getProvider(serverId);
      }
    }

    // Update the provider to use this model
    if (provider) {
      logger.log('[RemoteServerManager] Loading model on provider:', modelId);
      await provider.loadModel(modelId);
      providerRegistry.setActiveProvider(serverId);
      logger.log('[RemoteServerManager] Provider ready:', await provider.isReady());
    } else {
      logger.warn('[RemoteServerManager] Could not create provider for server:', serverId);
    }

    logger.log('[RemoteServerManager] Active remote text model set:', serverId, modelId);
  }

  /**
   * Set the active remote vision/image model
   */
  async setActiveRemoteImageModel(serverId: string, modelId: string): Promise<void> {
    const store = useRemoteServerStore.getState();

    // Set the active server
    store.setActiveServerId(serverId);
    store.setActiveRemoteImageModelId(modelId);

    // Ensure provider exists - create if needed
    let provider = providerRegistry.getProvider(serverId);
    if (!provider) {
      const server = store.getServerById(serverId);
      if (server) {
        logger.log('[RemoteServerManager] Creating provider for server:', serverId);
        await this.createProviderForServer(server);
        provider = providerRegistry.getProvider(serverId);
      }
    }

    // Update the provider to use this model
    if (provider) {
      await provider.loadModel(modelId);
    } else {
      logger.warn('[RemoteServerManager] Could not create provider for server:', serverId);
    }

    logger.log('[RemoteServerManager] Active remote image model set:', serverId, modelId);
  }

  /**
   * Clear active remote model (switch back to local)
   */
  clearActiveRemoteModel(): void {
    const store = useRemoteServerStore.getState();
    store.setActiveServerId(null);
    store.setActiveRemoteTextModelId(null);
    store.setActiveRemoteImageModelId(null);
    providerRegistry.setActiveProvider('local');
    logger.log('[RemoteServerManager] Cleared active remote model');
  }

  /**
   * Get the active server
   */
  getActiveServer(): RemoteServer | null {
    return useRemoteServerStore.getState().getActiveServer();
  }

  /**
   * Create and register provider for a server
   */
  private async createProviderForServer(server: RemoteServer): Promise<void> {
    const apiKey = await this.getApiKey(server.id);

    const provider = createOpenAIProvider(
      server.id,
      server.endpoint,
      apiKey || undefined,
      undefined
    );

    providerRegistry.registerProvider(server.id, provider);
  }

  /**
   * Store API key in secure storage
   */
  private async storeApiKey(serverId: string, apiKey: string): Promise<void> {
    try {
      await Keychain.setGenericPassword(
        `server_${serverId}`,
        apiKey,
        {
          service: `${KEYCHAIN_SERVICE}.${serverId}`,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
        }
      );
      logger.log('[RemoteServerManager] API key stored for server:', serverId);
    } catch (error) {
      logger.error('[RemoteServerManager] Failed to store API key:', error);
      throw error;
    }
  }

  /**
   * Get API key from secure storage
   */
  async getApiKey(serverId: string): Promise<string | null> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: `${KEYCHAIN_SERVICE}.${serverId}`,
      });
      return credentials ? credentials.password : null;
    } catch (error) {
      logger.error('[RemoteServerManager] Failed to get API key:', error);
      return null;
    }
  }

  /**
   * Remove API key from secure storage
   */
  private async removeApiKey(serverId: string): Promise<void> {
    try {
      await Keychain.resetGenericPassword({
        service: `${KEYCHAIN_SERVICE}.${serverId}`,
      });
      logger.log('[RemoteServerManager] API key removed for server:', serverId);
    } catch (error) {
      logger.error('[RemoteServerManager] Failed to remove API key:', error);
    }
  }

  /**
   * Detect vision capability from model name
   */
  private detectVisionCapability(modelId: string): boolean {
    const patterns = [
      'vision', 'llava', 'bakllava', 'moondream', 'cogvlm',
      'cogagent', 'fuyu', 'idefics', 'qwen-vl', 'gpt-4-vision',
      'gpt-4o', 'claude-3', 'gemini', 'pixtral', 'phi-3.5-vision',
      'minicpm-v', 'internvl', 'yi-vl',
    ];
    const lowerModelId = modelId.toLowerCase();
    return patterns.some(p => lowerModelId.includes(p));
  }

  /**
   * Detect tool calling capability from model name
   */
  private detectToolCallingCapability(modelId: string): boolean {
    const patterns = [
      'gpt-4', 'gpt-3.5-turbo', 'claude', 'gemini', 'mistral',
      'qwen', 'llama-3', 'command-r', 'dbrx', 'firefunction',
    ];
    const lowerModelId = modelId.toLowerCase();

    // Check for models known to support tools
    if (patterns.some(p => lowerModelId.includes(p))) {
      return true;
    }

    // Check for specific fine-tuned variants
    if (lowerModelId.includes('tool') || lowerModelId.includes('function')) {
      return true;
    }

    return false;
  }

  /**
   * Initialize providers for all stored servers
   * Also re-discovers models for each server to repopulate discoveredModels
   * Restores active remote model selection if persisted
   */
  async initializeProviders(): Promise<void> {
    const servers = this.getServers();
    const store = useRemoteServerStore.getState();
    logger.log('[RemoteServerManager] Initializing providers for', servers.length, 'servers');

    for (const server of servers) {
      try {
        await this.createProviderForServer(server);

        // Re-discover models to populate discoveredModels in the store
        // This is needed because discoveredModels is not persisted
        try {
          const models = await store.discoverModels(server.id);
          logger.log('[RemoteServerManager] Discovered', models.length, 'models for', server.name);
        } catch (discoverError) {
          logger.warn('[RemoteServerManager] Failed to discover models for', server.name, discoverError);
        }
      } catch (error) {
        logger.error('[RemoteServerManager] Failed to initialize provider for', server.name, error);
      }
    }

    // Restore active remote model selection if persisted
    const activeServerId = store.activeServerId;
    const activeRemoteTextModelId = store.activeRemoteTextModelId;

    if (activeServerId && activeRemoteTextModelId) {
      logger.log('[RemoteServerManager] Restoring active remote model:', activeRemoteTextModelId, 'on server:', activeServerId);
      try {
        await this.setActiveRemoteTextModel(activeServerId, activeRemoteTextModelId);
        logger.log('[RemoteServerManager] Successfully restored remote model selection');
      } catch (error) {
        logger.error('[RemoteServerManager] Failed to restore remote model selection:', error);
      }
    }
  }

  /**
   * Clear all servers
   */
  async clearAllServers(): Promise<void> {
    const servers = this.getServers();

    for (const server of servers) {
      await this.removeApiKey(server.id);
    }

    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  }
}

/** Singleton instance */
export const remoteServerManager = new RemoteServerManager();