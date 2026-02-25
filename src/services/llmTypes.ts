export interface MultimodalSupport {
  vision: boolean;
  audio: boolean;
}

export interface LLMPerformanceSettings {
  nThreads: number;
  nBatch: number;
  contextLength: number;
}

export interface LLMPerformanceStats {
  lastTokensPerSecond: number;
  lastDecodeTokensPerSecond: number;
  lastTimeToFirstToken: number;
  lastGenerationTime: number;
  lastTokenCount: number;
}
