/**
 * Remote Server Manager Unit Tests
 *
 * Tests for managing remote LLM server connections and provider selection.
 */

import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { providerRegistry } from '../../../src/services/providers/registry';

// Mock dependencies
jest.mock('../../../src/stores/remoteServerStore');
jest.mock('../../../src/services/providers/registry');
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(null),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

describe('remoteServerManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setActiveRemoteTextModel', () => {
    it('should set active server and model, and load model on provider', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('llama2'),
        isReady: jest.fn().mockResolvedValue(true),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      await remoteServerManager.setActiveRemoteTextModel('server-123', 'llama2');

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith('server-123');
      expect(useRemoteServerStore.getState().setActiveRemoteTextModelId).toHaveBeenCalledWith('llama2');
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('server-123');
      expect(mockLoadModel).toHaveBeenCalledWith('llama2');
    });

    it('should handle missing provider gracefully', async () => {
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(undefined);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      // Should not throw
      await expect(
        remoteServerManager.setActiveRemoteTextModel('server-123', 'llama2')
      ).resolves.not.toThrow();
    });
  });

  describe('setActiveRemoteImageModel', () => {
    it('should set active server and vision model', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('llava'),
        isReady: jest.fn().mockResolvedValue(true),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      await remoteServerManager.setActiveRemoteImageModel('server-123', 'llava');

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith('server-123');
      expect(useRemoteServerStore.getState().setActiveRemoteImageModelId).toHaveBeenCalledWith('llava');
      expect(mockLoadModel).toHaveBeenCalledWith('llava');
    });
  });

  describe('clearActiveRemoteModel', () => {
    it('should clear all remote selections and switch to local provider', () => {
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      remoteServerManager.clearActiveRemoteModel();

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith(null);
      expect(useRemoteServerStore.getState().setActiveRemoteTextModelId).toHaveBeenCalledWith(null);
      expect(useRemoteServerStore.getState().setActiveRemoteImageModelId).toHaveBeenCalledWith(null);
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('local');
    });
  });

  describe('detectVisionCapability', () => {
    it('should detect vision models from model name', () => {
      // Using the private method via reflection
      const manager = remoteServerManager as any;

      const visionModels = [
        'llava-v1.6-mistral-7b',
        'gpt-4-vision-preview',
        'claude-3-opus',
        'gemini-pro-vision',
        'qwen-vl-chat',
      ];

      const nonVisionModels = [
        'llama-2-7b',
        'mistral-7b-instruct',
        'codellama-34b',
        'phi-2',
      ];

      visionModels.forEach(modelId => {
        expect(manager.detectVisionCapability(modelId)).toBe(true);
      });

      nonVisionModels.forEach(modelId => {
        expect(manager.detectVisionCapability(modelId)).toBe(false);
      });
    });
  });

  describe('detectToolCallingCapability', () => {
    it('should detect tool-capable models from model name', () => {
      const manager = remoteServerManager as any;

      const toolCapableModels = [
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'claude-3-sonnet',
        'mistral-7b',
        'llama-3-70b',
        'qwen-72b',
      ];

      toolCapableModels.forEach(modelId => {
        expect(manager.detectToolCallingCapability(modelId)).toBe(true);
      });
    });

    it('should return false for non-tool-capable models', () => {
      const manager = remoteServerManager as any;

      // These should NOT match the tool capability patterns
      const nonToolModels = [
        'phi-2',
        'tinyllama',
      ];

      nonToolModels.forEach(modelId => {
        expect(manager.detectToolCallingCapability(modelId)).toBe(false);
      });
    });
  });
});