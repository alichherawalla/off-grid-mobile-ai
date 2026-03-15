import RNFS from 'react-native-fs';
import logger from './logger';

/**
 * After extracting a Core ML zip, the contents may be nested inside a
 * subdirectory (e.g. `model_split_einsum_v2_compiled/`). The
 * StableDiffusionPipeline expects all resources (mlmodelc + tokenizer) in the
 * same flat directory. This helper finds the actual directory containing the
 * .mlmodelc bundles and returns it as the effective modelPath.
 */
export async function resolveCoreMLModelDir(modelDir: string): Promise<string> {
  const items = await RNFS.readDir(modelDir);
  // If there's already an .mlmodelc at this level, we're good
  if (items.some(i => i.name.endsWith('.mlmodelc'))) return modelDir;
  // Otherwise look for a single subdirectory that contains .mlmodelc bundles
  const subDirs = items.filter(i => i.isDirectory());
  for (const sub of subDirs) {
    const subItems = await RNFS.readDir(sub.path);
    if (subItems.some(i => i.name.endsWith('.mlmodelc'))) {
      logger.log(`[CoreML] Resolved nested model dir: ${sub.path}`);
      return sub.path;
    }
  }
  return modelDir;
}

/**
 * Download tokenizer files (merges.txt, vocab.json) from the HuggingFace repo
 * root. Needed for multi-file Core ML downloads where only the compiled
 * directory is fetched.
 */
export async function downloadCoreMLTokenizerFiles(modelDir: string, repo: string): Promise<void> {
  const files = ['merges.txt', 'vocab.json'];
  // Download in parallel — these are tiny files and independent of each other
  await Promise.all(files.map(async (file) => {
    const destPath = `${modelDir}/${file}`;
    if (await RNFS.exists(destPath)) return;
    const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
    logger.log(`[CoreML] Downloading tokenizer file: ${file}`);
    try {
      const result = await RNFS.downloadFile({ fromUrl: url, toFile: destPath }).promise;
      if (result.statusCode !== 200) {
        logger.warn(`[CoreML] Failed to download ${file}: HTTP ${result.statusCode}`);
      }
    } catch (e) {
      logger.warn(`[CoreML] Tokenizer download failed for ${file}:`, e);
    }
  }));
}
