import { Platform } from 'react-native';
import { DownloadedModel, ONNXImageModel } from '../../types';

export type ModelType = 'text' | 'image';

export type MemoryCheckSeverity = 'safe' | 'warning' | 'critical' | 'blocked';

export interface MemoryCheckResult {
  canLoad: boolean;
  severity: MemoryCheckSeverity;
  availableMemoryGB: number;
  requiredMemoryGB: number;
  currentlyLoadedMemoryGB: number;
  totalRequiredMemoryGB: number;
  remainingAfterLoadGB: number;
  message: string;
}

export interface ActiveModelInfo {
  text: {
    model: DownloadedModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
  image: {
    model: ONNXImageModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
}

export interface ResourceUsage {
  memoryUsed: number;
  memoryTotal: number;
  memoryAvailable: number;
  memoryUsagePercent: number;
  /** Estimated memory used by loaded models (from file sizes) */
  estimatedModelMemory: number;
}

export type ModelChangeListener = (info: ActiveModelInfo) => void;

// Memory safety thresholds — dynamic budget based on device total RAM
export const MEMORY_BUDGET_PERCENT = 0.6; // Use up to 60% of device RAM for models
export const MEMORY_WARNING_PERCENT = 0.5; // Warn when exceeding 50% of device RAM
export const TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5; // KV cache, activations, etc.
// Core ML is more efficient than ONNX runtime
export const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8;
