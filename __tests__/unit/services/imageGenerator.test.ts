export {};

/**
 * ImageGeneratorService Unit Tests
 *
 * Tests for the Android-only image generation service that wraps ImageGeneratorModule.
 * Priority: P1 - Image generation support.
 */

const mockImageGeneratorModule = {
  isModelLoaded: jest.fn(),
  getLoadedModelPath: jest.fn(),
  loadModel: jest.fn(),
  unloadModel: jest.fn(),
  generateImage: jest.fn(),
  cancelGeneration: jest.fn(),
  isGenerating: jest.fn(),
  getGeneratedImages: jest.fn(),
  deleteGeneratedImage: jest.fn(),
  getConstants: jest.fn(),
};

const mockAddListener = jest.fn().mockReturnValue({ remove: jest.fn() });

jest.mock('react-native', () => {
  return {
    NativeModules: {
      ImageGeneratorModule: mockImageGeneratorModule,
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: mockAddListener,
    })),
    Platform: { OS: 'android' },
  };
});

describe('ImageGeneratorService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // isAvailable
  // ========================================================================
  describe('isAvailable', () => {
    it('returns true on Android when module exists', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');
        expect(imageGeneratorService.isAvailable()).toBe(true);
      });
    });

    it('returns false on iOS', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');
        expect(imageGeneratorService.isAvailable()).toBe(false);
      });
    });

    it('returns false when module is null', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        rn.NativeModules.ImageGeneratorModule = null;
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');
        expect(imageGeneratorService.isAvailable()).toBe(false);
      });
    });
  });

  // ========================================================================
  // isModelLoaded
  // ========================================================================
  describe('isModelLoaded', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.isModelLoaded.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.isModelLoaded();
        expect(result).toBe(true);
        expect(mockImageGeneratorModule.isModelLoaded).toHaveBeenCalled();
      });
    });

    it('returns false when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.isModelLoaded();
        expect(result).toBe(false);
      });
    });

    it('returns false on native error', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.isModelLoaded.mockRejectedValue(new Error('crash'));
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.isModelLoaded();
        expect(result).toBe(false);
      });
    });
  });

  // ========================================================================
  // getLoadedModelPath
  // ========================================================================
  describe('getLoadedModelPath', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.getLoadedModelPath.mockResolvedValue('/model/path');
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getLoadedModelPath();
        expect(result).toBe('/model/path');
      });
    });

    it('returns null when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getLoadedModelPath();
        expect(result).toBeNull();
      });
    });

    it('returns null on native error', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.getLoadedModelPath.mockRejectedValue(new Error('crash'));
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getLoadedModelPath();
        expect(result).toBeNull();
      });
    });
  });

  // ========================================================================
  // loadModel
  // ========================================================================
  describe('loadModel', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.loadModel.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.loadModel('/path/to/model');
        expect(mockImageGeneratorModule.loadModel).toHaveBeenCalledWith('/path/to/model');
        expect(result).toBe(true);
      });
    });

    it('throws when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        await expect(imageGeneratorService.loadModel('/path'))
          .rejects.toThrow('Image generation is not available on this platform');
      });
    });
  });

  // ========================================================================
  // unloadModel
  // ========================================================================
  describe('unloadModel', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.unloadModel.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.unloadModel();
        expect(mockImageGeneratorModule.unloadModel).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });

    it('returns true when not available (no-op)', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.unloadModel();
        expect(result).toBe(true);
      });
    });
  });

  // ========================================================================
  // generateImage
  // ========================================================================
  describe('generateImage', () => {
    it('calls native generateImage with correct params and defaults', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-1',
          prompt: 'A cat',
          negativePrompt: '',
          imagePath: '/gen/img.png',
          width: 512,
          height: 512,
          steps: 20,
          seed: 42,
          createdAt: '2026-01-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.generateImage({ prompt: 'A cat' });

        expect(mockImageGeneratorModule.generateImage).toHaveBeenCalledWith({
          prompt: 'A cat',
          negativePrompt: '',
          steps: 20,
          guidanceScale: 7.5,
          seed: undefined,
          width: 512,
          height: 512,
        });
        expect(result).toEqual({
          id: 'img-1',
          prompt: 'A cat',
          negativePrompt: '',
          imagePath: '/gen/img.png',
          width: 512,
          height: 512,
          steps: 20,
          seed: 42,
          modelId: '',
          createdAt: '2026-01-01',
        });
      });
    });

    it('passes custom params', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-2',
          prompt: 'sunset',
          negativePrompt: 'blurry',
          imagePath: '/gen/img2.png',
          width: 768,
          height: 768,
          steps: 30,
          seed: 99,
          createdAt: '2026-02-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        await imageGeneratorService.generateImage({
          prompt: 'sunset',
          negativePrompt: 'blurry',
          steps: 30,
          guidanceScale: 8.0,
          seed: 99,
          width: 768,
          height: 768,
        });

        expect(mockImageGeneratorModule.generateImage).toHaveBeenCalledWith({
          prompt: 'sunset',
          negativePrompt: 'blurry',
          steps: 30,
          guidanceScale: 8.0,
          seed: 99,
          width: 768,
          height: 768,
        });
      });
    });

    it('throws when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        await expect(imageGeneratorService.generateImage({ prompt: 'test' }))
          .rejects.toThrow('Image generation is not available on this platform');
      });
    });

    it('sets up progress listener when onProgress provided', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-1', prompt: 'test', negativePrompt: '', imagePath: '/p.png',
          width: 512, height: 512, steps: 20, seed: 1, createdAt: '2026-01-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const onProgress = jest.fn();
        await imageGeneratorService.generateImage({ prompt: 'test' }, onProgress);

        expect(mockAddListener).toHaveBeenCalledWith(
          'ImageGenerationProgress',
          expect.any(Function),
        );
      });
    });

    it('sets up complete listener when onComplete provided', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-1', prompt: 'test', negativePrompt: '', imagePath: '/p.png',
          width: 512, height: 512, steps: 20, seed: 1, createdAt: '2026-01-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const onComplete = jest.fn();
        await imageGeneratorService.generateImage({ prompt: 'test' }, undefined, onComplete);

        expect(mockAddListener).toHaveBeenCalledWith(
          'ImageGenerationComplete',
          expect.any(Function),
        );
      });
    });

    it('does not set up error listener (errors propagate via thrown exception)', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-1', prompt: 'test', negativePrompt: '', imagePath: '/p.png',
          width: 512, height: 512, steps: 20, seed: 1, createdAt: '2026-01-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        await imageGeneratorService.generateImage({ prompt: 'test' });

        expect(mockAddListener).not.toHaveBeenCalledWith(
          'ImageGenerationError',
          expect.any(Function),
        );
      });
    });

    it('removes listeners after generation completes', async () => {
      const mockRemove = jest.fn();
      mockAddListener.mockReturnValue({ remove: mockRemove });

      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockResolvedValue({
          id: 'img-1', prompt: 'test', negativePrompt: '', imagePath: '/p.png',
          width: 512, height: 512, steps: 20, seed: 1, createdAt: '2026-01-01',
        });
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const onProgress = jest.fn();
        await imageGeneratorService.generateImage({ prompt: 'test' }, onProgress);

        expect(mockRemove).toHaveBeenCalled();
      });
    });

    it('removes listeners after generation fails', async () => {
      const mockRemove = jest.fn();
      mockAddListener.mockReturnValue({ remove: mockRemove });

      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockRejectedValue(new Error('OOM'));
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const onProgress = jest.fn();
        await imageGeneratorService.generateImage({ prompt: 'test' }, onProgress).catch(() => {});

        expect(mockRemove).toHaveBeenCalled();
      });
    });

    it('propagates native rejection as a rejected promise', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.generateImage.mockRejectedValue(new Error('GPU memory exceeded'));
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        await expect(imageGeneratorService.generateImage({ prompt: 'test' }))
          .rejects.toThrow('GPU memory exceeded');
      });
    });
  });

  // ========================================================================
  // cancelGeneration
  // ========================================================================
  describe('cancelGeneration', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.cancelGeneration.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.cancelGeneration();
        expect(mockImageGeneratorModule.cancelGeneration).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });

    it('returns true when not available (no-op)', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.cancelGeneration();
        expect(result).toBe(true);
      });
    });
  });

  // ========================================================================
  // isGenerating
  // ========================================================================
  describe('isGenerating', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.isGenerating.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.isGenerating();
        expect(result).toBe(true);
      });
    });

    it('returns false when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.isGenerating();
        expect(result).toBe(false);
      });
    });
  });

  // ========================================================================
  // getGeneratedImages
  // ========================================================================
  describe('getGeneratedImages', () => {
    it('delegates to native module and maps results', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.getGeneratedImages.mockResolvedValue([
          { id: 'img-1', prompt: 'cat', imagePath: '/img1.png', width: 768, height: 768, steps: 25, seed: 42, modelId: 'm1', createdAt: '2026-01-01' },
          { id: 'img-2', imagePath: '/img2.png', createdAt: '2026-01-02' },
        ]);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getGeneratedImages();
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          id: 'img-1',
          prompt: 'cat',
          imagePath: '/img1.png',
          width: 768,
          height: 768,
          steps: 25,
          seed: 42,
          modelId: 'm1',
          createdAt: '2026-01-01',
        });
        // Second image should use defaults for missing fields
        expect(result[1]).toEqual({
          id: 'img-2',
          prompt: '',
          imagePath: '/img2.png',
          width: 512,
          height: 512,
          steps: 20,
          seed: 0,
          modelId: '',
          createdAt: '2026-01-02',
        });
      });
    });

    it('returns empty array when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getGeneratedImages();
        expect(result).toEqual([]);
      });
    });

    it('returns empty array on native error', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.getGeneratedImages.mockRejectedValue(new Error('crash'));
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.getGeneratedImages();
        expect(result).toEqual([]);
      });
    });
  });

  // ========================================================================
  // deleteGeneratedImage
  // ========================================================================
  describe('deleteGeneratedImage', () => {
    it('delegates to native module', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        mockImageGeneratorModule.deleteGeneratedImage.mockResolvedValue(true);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.deleteGeneratedImage('img-1');
        expect(mockImageGeneratorModule.deleteGeneratedImage).toHaveBeenCalledWith('img-1');
        expect(result).toBe(true);
      });
    });

    it('returns false when not available', async () => {
      jest.isolateModules(async () => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = await imageGeneratorService.deleteGeneratedImage('img-1');
        expect(result).toBe(false);
      });
    });
  });

  // ========================================================================
  // getConstants
  // ========================================================================
  describe('getConstants', () => {
    it('delegates to native module when available', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.Platform.OS = 'android';
        const mockConstants = {
          DEFAULT_STEPS: 30,
          DEFAULT_GUIDANCE_SCALE: 8.0,
        };
        mockImageGeneratorModule.getConstants.mockReturnValue(mockConstants);
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = imageGeneratorService.getConstants();
        expect(result).toEqual(mockConstants);
      });
    });

    it('returns defaults when not available', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.Platform.OS = 'ios';
        const { imageGeneratorService } = require('../../../src/services/imageGenerator');

        const result = imageGeneratorService.getConstants();
        expect(result).toEqual({
          DEFAULT_STEPS: 20,
          DEFAULT_GUIDANCE_SCALE: 7.5,
          DEFAULT_WIDTH: 512,
          DEFAULT_HEIGHT: 512,
          SUPPORTED_WIDTHS: [512, 768],
          SUPPORTED_HEIGHTS: [512, 768],
        });
      });
    });
  });
});
