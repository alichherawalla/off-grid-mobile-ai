import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';

// Access NativeModules.LocalDreamModule dynamically (not destructured)
// so it can be mocked in tests after module import.
const getLocalDreamModule = () => NativeModules.LocalDreamModule;
import { DeviceInfo as DeviceInfoType, ModelRecommendation, SoCInfo, SoCVendor, ImageModelRecommendation } from '../types';
import { MODEL_RECOMMENDATIONS, RECOMMENDED_MODELS } from '../constants';

/**
 * Explicit mapping of SM model numbers to QNN variant tiers.
 * Flagship chips get their full tier; everything else with Hexagon V68+ gets 'min'.
 *
 * SM numbers are NOT linearly ordered for NPU capability — e.g. SM8250 (SD 870,
 * Hexagon V66) sits between SM7450 and SM8350 but has NO NPU support.
 * We therefore use two separate range checks:
 *   - 7-series: SM7450+ (SD 7 Gen 1, Hexagon V69+)
 *   - 8-series: SM8350+ (SD 888, Hexagon V69+)
 *
 * Source: https://github.com/xororz/local-dream (supported chips)
 * - 8gen2: SD 8 Gen 2 (SM8550), 8 Gen 3 (SM8650), 8 Elite (SM8750)
 * - 8gen1: SD 8 Gen 1 (SM8450), 8+ Gen 1 (SM8475)
 * - min:   SD 888 (SM8350), 8s Gen 3 (SM8635), 7 Gen 1 (SM7450), etc.
 */
const FLAGSHIP_8GEN2: number[] = [8550, 8650, 8750];
const FLAGSHIP_8GEN1: number[] = [8450, 8475];
/** Minimum SM number for QNN HTP in 7-series (Hexagon V69+) — SD 7 Gen 1 */
const MIN_QNN_7SERIES = 7450;
/** Minimum SM number for QNN HTP in 8-series (Hexagon V69+) — SD 888 */
const MIN_QNN_8SERIES = 8350;

class HardwareService {
  private cachedDeviceInfo: DeviceInfoType | null = null;
  private cachedSoCInfo: SoCInfo | null = null;
  private cachedImageRecommendation: ImageModelRecommendation | null = null;

  async getDeviceInfo(): Promise<DeviceInfoType> {
    if (this.cachedDeviceInfo) {
      return this.cachedDeviceInfo;
    }

    const [
      totalMemory,
      usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    ] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemName(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.isEmulator(),
    ]);

    this.cachedDeviceInfo = {
      totalMemory,
      usedMemory,
      availableMemory: totalMemory - usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    };

    return this.cachedDeviceInfo;
  }

  async refreshMemoryInfo(): Promise<DeviceInfoType> {
    // Force fresh fetch of all memory info
    const [totalMemory, usedMemory] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
    ]);

    if (!this.cachedDeviceInfo) {
      await this.getDeviceInfo();
    }

    if (this.cachedDeviceInfo) {
      this.cachedDeviceInfo.totalMemory = totalMemory;
      this.cachedDeviceInfo.usedMemory = usedMemory;
      this.cachedDeviceInfo.availableMemory = totalMemory - usedMemory;
    }

    return this.cachedDeviceInfo!;
  }

  /**
   * Get app-specific memory usage (more accurate for tracking model memory)
   * Note: This is system memory, native allocations may not be fully reflected
   */
  async getAppMemoryUsage(): Promise<{ used: number; available: number; total: number }> {
    const total = await DeviceInfo.getTotalMemory();
    const used = await DeviceInfo.getUsedMemory();
    return {
      used,
      available: total - used,
      total,
    };
  }

  getTotalMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 4; // Default assumption
    }
    return this.cachedDeviceInfo.totalMemory / (1024 * 1024 * 1024);
  }

  getAvailableMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 2; // Default assumption
    }
    return this.cachedDeviceInfo.availableMemory / (1024 * 1024 * 1024);
  }

  getModelRecommendation(): ModelRecommendation {
    const totalRamGB = this.getTotalMemoryGB();

    // Find the appropriate recommendation tier
    const tier = MODEL_RECOMMENDATIONS.memoryToParams.find(
      t => totalRamGB >= t.minRam && totalRamGB < t.maxRam
    ) || MODEL_RECOMMENDATIONS.memoryToParams[0];

    // Filter recommended models based on device capability
    const compatibleModels = RECOMMENDED_MODELS
      .filter(m => m.minRam <= totalRamGB)
      .map(m => m.id);

    let warning: string | undefined;
    if (totalRamGB < 4) {
      warning = 'Your device has limited memory. Only the smallest models will work well.';
    } else if (this.cachedDeviceInfo?.isEmulator) {
      warning = 'Running in emulator. Performance may be significantly slower.';
    }

    return {
      maxParameters: tier.maxParams,
      recommendedQuantization: tier.quantization,
      recommendedModels: compatibleModels,
      warning,
    };
  }

  canRunModel(parametersBillions: number, quantization: string = 'Q4_K_M'): boolean {
    const availableMemoryGB = this.getAvailableMemoryGB();

    // Estimate model memory requirement
    // Q4_K_M uses ~0.5 bytes per parameter + overhead
    const bitsPerWeight = this.getQuantizationBits(quantization);
    const modelSizeGB = (parametersBillions * bitsPerWeight) / 8;

    // Need at least 1.5x the model size for safe operation
    const requiredMemory = modelSizeGB * 1.5;

    return availableMemoryGB >= requiredMemory;
  }

  estimateModelMemoryGB(parametersBillions: number, quantization: string = 'Q4_K_M'): number {
    const bitsPerWeight = this.getQuantizationBits(quantization);
    return (parametersBillions * bitsPerWeight) / 8;
  }

  private getQuantizationBits(quantization: string): number {
    const bits: Record<string, number> = {
      'Q2_K': 2.625,
      'Q3_K_S': 3.4375,
      'Q3_K_M': 3.4375,
      'Q4_0': 4,
      'Q4_K_S': 4.5,
      'Q4_K_M': 4.5,
      'Q5_K_S': 5.5,
      'Q5_K_M': 5.5,
      'Q6_K': 6.5,
      'Q8_0': 8,
      'F16': 16,
    };

    // Try to match quantization string
    for (const [key, value] of Object.entries(bits)) {
      if (quantization.toUpperCase().includes(key)) {
        return value;
      }
    }

    return 4.5; // Default to Q4_K_M
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  /**
   * Get combined model size including mmproj for vision models.
   * Use this everywhere model size is displayed for consistency.
   */
  getModelTotalSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): number {
    const mainSize = model.fileSize || model.size || 0;
    const mmProjSize = model.mmProjFileSize || 0;
    return mainSize + mmProjSize;
  }

  /**
   * Format combined model size including mmproj.
   * Use this everywhere model size is displayed for consistency.
   */
  formatModelSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): string {
    return this.formatBytes(this.getModelTotalSize(model));
  }

  /**
   * Get estimated RAM usage for a model (combined size * overhead multiplier).
   */
  estimateModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier: number = 1.5): number {
    return this.getModelTotalSize(model) * multiplier;
  }

  /**
   * Format estimated RAM usage for a model.
   */
  formatModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier: number = 1.5): string {
    const ramBytes = this.estimateModelRam(model, multiplier);
    const ramGB = ramBytes / (1024 * 1024 * 1024);
    return `~${ramGB.toFixed(1)} GB`;
  }

  private detectAppleChip(deviceId: string): SoCInfo['appleChip'] {
    const match = deviceId.match(/iPhone(\d+)/);
    if (!match) return undefined;
    const major = parseInt(match[1], 10);
    if (major >= 17) return 'A18';
    if (major >= 16) return 'A17Pro';
    if (major >= 15) return 'A16';
    if (major >= 14) return 'A15';
    if (major >= 13) return 'A14';
    return undefined;
  }

  async getSoCInfo(): Promise<SoCInfo> {
    if (this.cachedSoCInfo) return this.cachedSoCInfo;
    if (Platform.OS === 'ios') {
      const ramGB = this.getTotalMemoryGB();
      const appleChip = this.detectAppleChip(DeviceInfo.getDeviceId()) ?? (ramGB >= 6 ? 'A15' : 'A14');
      this.cachedSoCInfo = { vendor: 'apple', hasNPU: true, appleChip };
      return this.cachedSoCInfo;
    }
    const hardware = await DeviceInfo.getHardware();
    const model = DeviceInfo.getModel();
    const hw = hardware.toLowerCase();
    let vendor: SoCVendor = 'unknown';
    if (hw.includes('qcom')) vendor = 'qualcomm';
    else if (model.startsWith('Pixel')) vendor = 'tensor';
    else if (hw.includes('mt') || hw.includes('mediatek')) vendor = 'mediatek';
    else if (hw.includes('exynos') || hw.includes('samsungexynos')) vendor = 'exynos';
    const qnnVariant = vendor === 'qualcomm' ? await this.getQnnVariantFromSoC() : undefined;
    this.cachedSoCInfo = { vendor, hasNPU: vendor === 'qualcomm' && !!qnnVariant, qnnVariant };
    return this.cachedSoCInfo;
  }

  private async getQnnVariantFromSoC(): Promise<'8gen2' | '8gen1' | 'min' | undefined> {
    let socModel = '';
    try {
      const localDream = getLocalDreamModule();
      if (localDream?.getSoCModel) socModel = await localDream.getSoCModel();
    } catch { /* fall through to RAM heuristic */ }
    if (socModel) {
      const base = socModel.split('-')[0].toUpperCase();
      const smMatch = base.match(/^SM(\d+)/);
      if (smMatch) {
        const num = parseInt(smMatch[1], 10);
        // 8-series: SM8350+ (SD 888, Hexagon V69+)
        if (num >= MIN_QNN_8SERIES) {
          if (FLAGSHIP_8GEN2.includes(num)) return '8gen2';
          if (FLAGSHIP_8GEN1.includes(num)) return '8gen1';
          return 'min';
        }
        // 7-series: SM7450–SM7999 (SD 7 Gen 1+, Hexagon V69+)
        if (num >= MIN_QNN_7SERIES && num < 8000) return 'min';
        return undefined;
      }
      return undefined; // Non-SM Qualcomm SoC — not supported
    }
    // Native module unavailable — can't determine SoC, assume no NPU
    return undefined;
  }

  private getIosImageRec(chip: SoCInfo['appleChip'], ramGB: number): ImageModelRecommendation {
    if ((chip === 'A17Pro' || chip === 'A18') && ramGB >= 6) {
      return { recommendedBackend: 'coreml', recommendedModels: ['sdxl', 'xl-base'], bannerText: 'All models supported \u2014 SDXL for best quality', compatibleBackends: ['coreml'] };
    }
    if ((chip === 'A15' || chip === 'A16') && ramGB >= 6) {
      return { recommendedBackend: 'coreml', recommendedModels: ['v1-5-palettized', '2-1-base-palettized'], bannerText: 'SD 1.5 or SD 2.1 Palettized recommended', compatibleBackends: ['coreml'] };
    }
    return { recommendedBackend: 'coreml', recommendedModels: ['v1-5-palettized'], bannerText: 'SD 1.5 Palettized recommended for your device', compatibleBackends: ['coreml'] };
  }

  private getQualcommImageRec(socInfo: SoCInfo): ImageModelRecommendation {
    const label = socInfo.qnnVariant === '8gen2' ? 'flagship' : socInfo.qnnVariant === '8gen1' ? '' : 'lightweight ';
    const suffix = socInfo.qnnVariant === '8gen2' ? 'NPU models for fastest inference' : socInfo.qnnVariant === '8gen1' ? 'NPU models supported' : 'lightweight NPU models recommended';
    return { recommendedBackend: 'qnn', qnnVariant: socInfo.qnnVariant, bannerText: `Snapdragon ${label}\u2014 ${suffix}`, compatibleBackends: ['qnn', 'mnn'] };
  }

  async getImageModelRecommendation(): Promise<ImageModelRecommendation> {
    if (this.cachedImageRecommendation) return this.cachedImageRecommendation;
    const socInfo = await this.getSoCInfo();
    const ramGB = this.getTotalMemoryGB();
    let rec: ImageModelRecommendation;
    if (Platform.OS === 'ios') {
      rec = this.getIosImageRec(socInfo.appleChip, ramGB);
    } else if (socInfo.vendor === 'qualcomm' && socInfo.hasNPU) {
      rec = this.getQualcommImageRec(socInfo);
    } else if (socInfo.vendor === 'qualcomm') {
      rec = { recommendedBackend: 'mnn', bannerText: 'CPU models recommended \u2014 your Snapdragon doesn\u2019t support NPU acceleration', compatibleBackends: ['mnn'] };
    } else {
      rec = { recommendedBackend: 'mnn', bannerText: 'CPU models recommended \u2014 NPU requires Snapdragon 888+', compatibleBackends: ['mnn'] };
    }
    if (ramGB < 4) { rec.warning = 'Low RAM \u2014 expect slower performance'; }
    this.cachedImageRecommendation = rec;
    return rec;
  }

  getDeviceTier(): 'low' | 'medium' | 'high' | 'flagship' {
    const ramGB = this.getTotalMemoryGB();

    if (ramGB < 4) return 'low';
    if (ramGB < 6) return 'medium';
    if (ramGB < 8) return 'high';
    return 'flagship';
  }
}

export const hardwareService = new HardwareService();
