export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export interface SimilarityResult {
  index: number;
  score: number;
}

export function topKSimilar(queryVec: number[], candidates: number[][], k: number): SimilarityResult[] {
  const scored = candidates.map((vec, index) => ({
    index,
    score: cosineSimilarity(queryVec, vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
