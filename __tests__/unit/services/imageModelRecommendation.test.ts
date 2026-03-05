/**
 * Image Model Recommendation Filter Tests
 *
 * Tests the matching logic used to determine if an image model is "recommended"
 * for a given device. This logic lives in ModelsScreen but is tested here as
 * pure functions for reliability.
 */

import { ImageModelRecommendation } from '../../../src/types';

// Replicate the isRecommendedModel logic from ModelsScreen
interface TestImageModel {
  id: string;
  name: string;
  repo: string;
  backend: string;
  variant?: string;
}

function isRecommendedModel(model: TestImageModel, imageRec: ImageModelRecommendation | null): boolean {
  if (!imageRec) return false;
  if (model.backend !== imageRec.recommendedBackend && imageRec.recommendedBackend !== 'all') return false;
  if (imageRec.qnnVariant && model.variant) {
    return model.variant.includes(imageRec.qnnVariant);
  }
  if (imageRec.recommendedModels?.length) {
    const fields = [model.name, model.repo, model.id].map(s => s.toLowerCase());
    return imageRec.recommendedModels.some(p => fields.some(f => f.includes(p)));
  }
  return true;
}

// ============================================================================
// Core ML model fixtures (mirroring coreMLModelBrowser.ts)
// ============================================================================
const COREML_MODELS: TestImageModel[] = [
  {
    id: 'coreml_apple_coreml-stable-diffusion-v1-5-palettized',
    name: 'SD 1.5 Palettized',
    repo: 'apple/coreml-stable-diffusion-v1-5-palettized',
    backend: 'coreml',
  },
  {
    id: 'coreml_apple_coreml-stable-diffusion-2-1-base-palettized',
    name: 'SD 2.1 Palettized',
    repo: 'apple/coreml-stable-diffusion-2-1-base-palettized',
    backend: 'coreml',
  },
  {
    id: 'coreml_apple_coreml-stable-diffusion-xl-base-ios',
    name: 'SDXL (iOS)',
    repo: 'apple/coreml-stable-diffusion-xl-base-ios',
    backend: 'coreml',
  },
  {
    id: 'coreml_apple_coreml-stable-diffusion-v1-5',
    name: 'SD 1.5',
    repo: 'apple/coreml-stable-diffusion-v1-5',
    backend: 'coreml',
  },
  {
    id: 'coreml_apple_coreml-stable-diffusion-2-1-base',
    name: 'SD 2.1 Base',
    repo: 'apple/coreml-stable-diffusion-2-1-base',
    backend: 'coreml',
  },
];

// QNN model fixtures
const QNN_MODELS: TestImageModel[] = [
  { id: 'qnn-sd15-8gen2', name: 'SD 1.5 QNN', repo: 'xororz/sd-qnn', backend: 'qnn', variant: '8gen2' },
  { id: 'qnn-sd15-8gen1', name: 'SD 1.5 QNN', repo: 'xororz/sd-qnn', backend: 'qnn', variant: '8gen1' },
  { id: 'qnn-sd15-min', name: 'SD 1.5 QNN Min', repo: 'xororz/sd-qnn', backend: 'qnn', variant: 'min' },
];

// MNN model fixtures
const MNN_MODELS: TestImageModel[] = [
  { id: 'mnn-sd15', name: 'SD 1.5 MNN', repo: 'xororz/sd-mnn', backend: 'mnn' },
  { id: 'mnn-sd15-anime', name: 'SD 1.5 Anime MNN', repo: 'xororz/sd-mnn', backend: 'mnn' },
];

const findModel = (models: TestImageModel[], idSubstr: string) =>
  models.find(m => m.id.includes(idSubstr))!;

describe('isRecommendedModel', () => {
  it('returns false when imageRec is null', () => {
    expect(isRecommendedModel(COREML_MODELS[0], null)).toBe(false);
  });

  // ========================================================================
  // iOS Core ML recommendations
  // ========================================================================
  describe('iOS Core ML — high-end (SDXL)', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'coreml',
      recommendedModels: ['sdxl', 'xl-base'],
      bannerText: 'All models supported — SDXL for best quality',
      compatibleBackends: ['coreml'],
    };

    it('matches SDXL model via repo (xl-base)', () => {
      const sdxl = findModel(COREML_MODELS, 'xl-base');
      expect(isRecommendedModel(sdxl, rec)).toBe(true);
    });

    it('does not match SD 1.5 Palettized', () => {
      const sd15p = findModel(COREML_MODELS, 'v1-5-palettized');
      expect(isRecommendedModel(sd15p, rec)).toBe(false);
    });

    it('does not match SD 2.1 Palettized', () => {
      const sd21p = findModel(COREML_MODELS, '2-1-base-palettized');
      expect(isRecommendedModel(sd21p, rec)).toBe(false);
    });

    it('does not match full-precision SD 1.5', () => {
      const sd15 = COREML_MODELS.find(m => m.id === 'coreml_apple_coreml-stable-diffusion-v1-5')!;
      expect(isRecommendedModel(sd15, rec)).toBe(false);
    });
  });

  describe('iOS Core ML — mid-range (SD 1.5/2.1 Palettized)', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'coreml',
      recommendedModels: ['v1-5-palettized', '2-1-base-palettized'],
      bannerText: 'SD 1.5 or SD 2.1 Palettized recommended',
      compatibleBackends: ['coreml'],
    };

    it('matches SD 1.5 Palettized', () => {
      const sd15p = findModel(COREML_MODELS, 'v1-5-palettized');
      expect(isRecommendedModel(sd15p, rec)).toBe(true);
    });

    it('matches SD 2.1 Palettized', () => {
      const sd21p = findModel(COREML_MODELS, '2-1-base-palettized');
      expect(isRecommendedModel(sd21p, rec)).toBe(true);
    });

    it('does not match SDXL', () => {
      const sdxl = findModel(COREML_MODELS, 'xl-base');
      expect(isRecommendedModel(sdxl, rec)).toBe(false);
    });

    it('does not match full-precision SD 1.5 (no "palettized" in repo)', () => {
      const sd15 = COREML_MODELS.find(m => m.id === 'coreml_apple_coreml-stable-diffusion-v1-5')!;
      expect(isRecommendedModel(sd15, rec)).toBe(false);
    });
  });

  describe('iOS Core ML — low-end (SD 1.5 Palettized only)', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'coreml',
      recommendedModels: ['v1-5-palettized'],
      bannerText: 'SD 1.5 Palettized recommended for your device',
      compatibleBackends: ['coreml'],
    };

    it('matches SD 1.5 Palettized', () => {
      const sd15p = findModel(COREML_MODELS, 'v1-5-palettized');
      expect(isRecommendedModel(sd15p, rec)).toBe(true);
    });

    it('does not match SD 2.1 Palettized', () => {
      const sd21p = findModel(COREML_MODELS, '2-1-base-palettized');
      expect(isRecommendedModel(sd21p, rec)).toBe(false);
    });

    it('does not match SDXL', () => {
      const sdxl = findModel(COREML_MODELS, 'xl-base');
      expect(isRecommendedModel(sdxl, rec)).toBe(false);
    });
  });

  // ========================================================================
  // Android QNN recommendations
  // ========================================================================
  describe('Android QNN — variant matching', () => {
    const rec8gen2: ImageModelRecommendation = {
      recommendedBackend: 'qnn',
      qnnVariant: '8gen2',
      bannerText: 'Snapdragon flagship — NPU models',
      compatibleBackends: ['qnn', 'mnn'],
    };

    const recMin: ImageModelRecommendation = {
      recommendedBackend: 'qnn',
      qnnVariant: 'min',
      bannerText: 'Snapdragon lightweight models',
      compatibleBackends: ['qnn', 'mnn'],
    };

    it('matches 8gen2 variant when rec is 8gen2', () => {
      expect(isRecommendedModel(QNN_MODELS[0], rec8gen2)).toBe(true);
    });

    it('does not match 8gen1 variant when rec is 8gen2', () => {
      expect(isRecommendedModel(QNN_MODELS[1], rec8gen2)).toBe(false);
    });

    it('does not match min variant when rec is 8gen2', () => {
      expect(isRecommendedModel(QNN_MODELS[2], rec8gen2)).toBe(false);
    });

    it('matches min variant when rec is min', () => {
      expect(isRecommendedModel(QNN_MODELS[2], recMin)).toBe(true);
    });

    it('rejects MNN models when rec is QNN', () => {
      expect(isRecommendedModel(MNN_MODELS[0], rec8gen2)).toBe(false);
    });

    it('rejects Core ML models when rec is QNN', () => {
      expect(isRecommendedModel(COREML_MODELS[0], rec8gen2)).toBe(false);
    });
  });

  // ========================================================================
  // Android MNN (non-Qualcomm) recommendations
  // ========================================================================
  describe('Android MNN — non-Qualcomm', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'mnn',
      bannerText: 'GPU models recommended',
      compatibleBackends: ['mnn'],
    };

    it('matches MNN models (no recommendedModels patterns = all pass)', () => {
      expect(isRecommendedModel(MNN_MODELS[0], rec)).toBe(true);
      expect(isRecommendedModel(MNN_MODELS[1], rec)).toBe(true);
    });

    it('rejects QNN models', () => {
      expect(isRecommendedModel(QNN_MODELS[0], rec)).toBe(false);
    });

    it('rejects Core ML models', () => {
      expect(isRecommendedModel(COREML_MODELS[0], rec)).toBe(false);
    });
  });

  // ========================================================================
  // Backend = 'all'
  // ========================================================================
  describe('recommendedBackend = all', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'all',
      bannerText: 'All backends',
      compatibleBackends: ['mnn', 'qnn', 'coreml'],
    };

    it('matches any backend when recommendedBackend is all', () => {
      expect(isRecommendedModel(MNN_MODELS[0], rec)).toBe(true);
      expect(isRecommendedModel(QNN_MODELS[0], rec)).toBe(true);
      expect(isRecommendedModel(COREML_MODELS[0], rec)).toBe(true);
    });
  });

  // ========================================================================
  // Edge case: backend mismatch from mapping bug
  // ========================================================================
  describe('backend mapping regression', () => {
    const rec: ImageModelRecommendation = {
      recommendedBackend: 'coreml',
      recommendedModels: ['v1-5-palettized'],
      bannerText: 'test',
      compatibleBackends: ['coreml'],
    };

    it('rejects Core ML model mapped with wrong backend (mnn placeholder)', () => {
      const misMapped: TestImageModel = {
        ...COREML_MODELS[0],
        backend: 'mnn', // the bug we fixed — was 'mnn' as placeholder
      };
      expect(isRecommendedModel(misMapped, rec)).toBe(false);
    });

    it('accepts Core ML model with correct backend', () => {
      expect(isRecommendedModel(COREML_MODELS[0], rec)).toBe(true);
    });
  });
});
