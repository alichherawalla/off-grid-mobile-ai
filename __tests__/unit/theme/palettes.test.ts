/**
 * palettes.ts Unit Tests
 *
 * Tests for createElevation factory function:
 * - Returns correct structure for all elevation levels
 * - blurType ternary: 'dark' when background === '#0A0A0A', 'light' otherwise
 */

import { createElevation, COLORS_DARK, COLORS_LIGHT } from '../../../src/theme/palettes';

describe('createElevation', () => {
  describe('with dark colors (background === "#0A0A0A")', () => {
    const elevation = createElevation(COLORS_DARK);

    it('level3 blur blurType is "dark"', () => {
      expect(elevation.level3.blur.ios.blurType).toBe('dark');
    });

    it('level4 blur blurType is "dark"', () => {
      expect(elevation.level4.blur.ios.blurType).toBe('dark');
    });

    it('level3 blurAmount is 10', () => {
      expect(elevation.level3.blur.ios.blurAmount).toBe(10);
    });

    it('level4 blurAmount is 15', () => {
      expect(elevation.level4.blur.ios.blurAmount).toBe(15);
    });
  });

  describe('with light colors (background !== "#0A0A0A")', () => {
    const elevation = createElevation(COLORS_LIGHT);

    it('level3 blur blurType is "light"', () => {
      expect(elevation.level3.blur.ios.blurType).toBe('light');
    });

    it('level4 blur blurType is "light"', () => {
      expect(elevation.level4.blur.ios.blurType).toBe('light');
    });
  });

  describe('with custom dark background', () => {
    it('returns "dark" blurType for any color with background === "#0A0A0A"', () => {
      const customDarkColors = { ...COLORS_LIGHT, background: '#0A0A0A' };
      const elevation = createElevation(customDarkColors as any);
      expect(elevation.level3.blur.ios.blurType).toBe('dark');
      expect(elevation.level4.blur.ios.blurType).toBe('dark');
    });

    it('returns "light" blurType for any other background color', () => {
      const customLightColors = { ...COLORS_DARK, background: '#FFFFFF' };
      const elevation = createElevation(customLightColors as any);
      expect(elevation.level3.blur.ios.blurType).toBe('light');
      expect(elevation.level4.blur.ios.blurType).toBe('light');
    });
  });

  describe('structure', () => {
    const elevation = createElevation(COLORS_LIGHT);

    it('returns all elevation levels', () => {
      expect(elevation.level0).toBeDefined();
      expect(elevation.level1).toBeDefined();
      expect(elevation.level2).toBeDefined();
      expect(elevation.level3).toBeDefined();
      expect(elevation.level4).toBeDefined();
      expect(elevation.handle).toBeDefined();
    });

    it('level0 has no border', () => {
      expect(elevation.level0.borderWidth).toBe(0);
      expect(elevation.level0.borderColor).toBe('transparent');
    });

    it('level3 and level4 have android overlay color', () => {
      expect(elevation.level3.blur.android.overlayColor).toBeDefined();
      expect(elevation.level4.blur.android.overlayColor).toBeDefined();
    });
  });
});
