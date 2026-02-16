import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { DeviceInfo as DeviceInfoType, ModelRecommendation, SoCInfo, SoCVendor, ImageModelRecommendation } from '../types';
import { MODEL_RECOMMENDATIONS, RECOMMENDED_MODELS } from '../constants';

const { LocalDreamModule } = NativeModules;

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

  async getSoCInfo(): Promise<SoCInfo> {
    if (this.cachedSoCInfo) {
      return this.cachedSoCInfo;
    }

    if (Platform.OS === 'ios') {
      const deviceId = DeviceInfo.getDeviceId(); // e.g. "iPhone15,2"
      const ramGB = this.getTotalMemoryGB();
      let appleChip: SoCInfo['appleChip'];

      // Map device identifiers to chip families
      // iPhone 12 = iPhone13,x → A14, iPhone 13 = iPhone14,x → A15,
      // iPhone 14 = iPhone15,x → A16, iPhone 15 Pro = iPhone16,1/2 → A17Pro,
      // iPhone 16 = iPhone17,x → A18
      const majorMatch = deviceId.match(/iPhone(\d+)/);
      if (majorMatch) {
        const major = parseInt(majorMatch[1], 10);
        if (major >= 17) appleChip = 'A18';
        else if (major >= 16) appleChip = 'A17Pro';
        else if (major >= 15) appleChip = 'A16';
        else if (major >= 14) appleChip = 'A15';
        else if (major >= 13) appleChip = 'A14';
      }

      this.cachedSoCInfo = {
        vendor: 'apple',
        hasNPU: true,
        appleChip: appleChip || (ramGB >= 6 ? 'A15' : 'A14'),
      };
      return this.cachedSoCInfo;
    }

    // Android: detect SoC vendor from hardware string
    const hardware = await DeviceInfo.getHardware();
    const model = DeviceInfo.getModel();
    const hardwareLower = hardware.toLowerCase();
    const ramGB = this.getTotalMemoryGB();

    let vendor: SoCVendor = 'unknown';
    if (hardwareLower.includes('qcom')) {
      vendor = 'qualcomm';
    } else if (model.startsWith('Pixel')) {
      vendor = 'tensor';
    } else if (hardwareLower.includes('mt') || hardwareLower.includes('mediatek')) {
      vendor = 'mediatek';
    } else if (hardwareLower.includes('exynos') || hardwareLower.includes('samsungexynos')) {
      vendor = 'exynos';
    }

    let qnnVariant: SoCInfo['qnnVariant'];
    if (vendor === 'qualcomm') {
      qnnVariant = await this.getQnnVariantFromSoC();
    }

    this.cachedSoCInfo = {
      vendor,
      hasNPU: vendor === 'qualcomm',
      qnnVariant,
    };
    return this.cachedSoCInfo;
  }

  /**
   * Determine QNN variant from the actual SoC model number.
   * Flagship chips (8 Gen 2/3/4+) use '8gen2' models,
   * 8 Gen 1 uses '8gen1', and everything else uses 'min'.
   */
  private async getQnnVariantFromSoC(): Promise<'8gen2' | '8gen1' | 'min'> {
    let socModel = '';
    try {
      if (LocalDreamModule?.getSoCModel) {
        socModel = await LocalDreamModule.getSoCModel();
      }
    } catch {
      // Fall through to RAM-based fallback
    }

    if (socModel) {
      // Strip sub-variant suffixes (e.g. "SM8550-AB" → "SM8550")
      const baseModel = socModel.split('-')[0].toUpperCase();

      // Flagship chips: full 8 Gen 2, 8 Gen 3, 8 Elite
      // These have the most capable NPU and run '8gen2' QNN models
      const FLAGSHIP_SOCS = [
        'SM8550', // Snapdragon 8 Gen 2
        'SM8650', // Snapdragon 8 Gen 3
        'SM8750', // Snapdragon 8 Elite (Gen 4)
      ];

      // High-tier: 8 Gen 1 / 8+ Gen 1
      const GEN1_SOCS = [
        'SM8450', // Snapdragon 8 Gen 1
        'SM8475', // Snapdragon 8+ Gen 1
      ];

      if (FLAGSHIP_SOCS.includes(baseModel)) return '8gen2';
      if (GEN1_SOCS.includes(baseModel)) return '8gen1';

      // Everything else (SM8635 = 8s Gen 3, SM7xxx, SM6xxx, etc.) → non-flagship
      return 'min';
    }

    // Fallback: RAM-based heuristic (only if SoC model unavailable)
    // Conservative: never recommend flagship since we can't confirm the chip
    const ramGB = this.getTotalMemoryGB();
    if (ramGB >= 12) return '8gen1';
    return 'min';
  }

  async getImageModelRecommendation(): Promise<ImageModelRecommendation> {
    if (this.cachedImageRecommendation) {
      return this.cachedImageRecommendation;
    }

    const socInfo = await this.getSoCInfo();
    const ramGB = this.getTotalMemoryGB();
    let rec: ImageModelRecommendation;

    if (Platform.OS === 'ios') {
      const chip = socInfo.appleChip;
      const isHighEnd = (chip === 'A17Pro' || chip === 'A18') && ramGB >= 6;
      const isMidRange = (chip === 'A15' || chip === 'A16') && ramGB >= 6;

      if (isHighEnd) {
        rec = {
          recommendedBackend: 'coreml',
          recommendedModels: ['sdxl', 'xl-base'],
          bannerText: 'All models supported \u2014 SDXL for best quality',
          compatibleBackends: ['coreml'],
        };
      } else if (isMidRange) {
        rec = {
          recommendedBackend: 'coreml',
          recommendedModels: ['v1-5-palettized', '2-1-base-palettized'],
          bannerText: 'SD 1.5 or SD 2.1 Palettized recommended',
          compatibleBackends: ['coreml'],
        };
      } else {
        rec = {
          recommendedBackend: 'coreml',
          recommendedModels: ['v1-5-palettized'],
          bannerText: 'SD 1.5 Palettized recommended for your device',
          compatibleBackends: ['coreml'],
        };
      }
    } else if (socInfo.vendor === 'qualcomm') {
      let bannerText: string;
      if (socInfo.qnnVariant === '8gen2') {
        bannerText = 'Snapdragon flagship \u2014 NPU models for fastest generation (~15s)';
      } else if (socInfo.qnnVariant === '8gen1') {
        bannerText = 'Snapdragon NPU supported \u2014 use NPU models for fast generation';
      } else {
        bannerText = 'Snapdragon NPU supported \u2014 use non-flagship NPU models for fast generation';
      }

      rec = {
        recommendedBackend: 'qnn',
        qnnVariant: socInfo.qnnVariant,
        bannerText,
        compatibleBackends: ['qnn', 'mnn'],
      };
    } else {
      rec = {
        recommendedBackend: 'mnn',
        bannerText: 'CPU models available \u2014 generation takes ~2 min per image',
        compatibleBackends: ['mnn'],
      };
    }

    if (ramGB < 4) {
      rec.warning = 'Low RAM \u2014 expect slower performance';
    }

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
