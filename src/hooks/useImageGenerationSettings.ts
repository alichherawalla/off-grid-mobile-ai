import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useAppStore } from '../stores';
import { localDreamGeneratorService } from '../services/localDreamGenerator';

export function useClearGpuCache() {
  const { downloadedImageModels, activeImageModelId } = useAppStore();
  const [clearing, setClearing] = useState(false);

  const handleClearCache = useCallback(async () => {
    const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeModel?.modelPath) {
      Alert.alert('No Model', 'Load an image model first.');
      return;
    }
    setClearing(true);
    try {
      const cleared = await localDreamGeneratorService.clearOpenCLCache(activeModel.modelPath);
      Alert.alert('Cache Cleared', `Removed ${cleared} GPU cache file(s). Next generation will retune GPU kernels (first run may be slower).`);
    } catch (e: any) {
      Alert.alert('Error', `Failed to clear GPU cache: ${e?.message || 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  }, [downloadedImageModels, activeImageModelId]);

  return { clearing, handleClearCache };
}
