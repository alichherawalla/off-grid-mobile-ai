// Lightweight module-level state for coordinating multi-step spotlight flows.
// Not persisted — resets on app restart.

let pendingStep: number | null = null;

export function setPendingSpotlight(stepIndex: number | null) {
  pendingStep = stepIndex;
}

export function consumePendingSpotlight(): number | null {
  const step = pendingStep;
  pendingStep = null;
  return step;
}

export function peekPendingSpotlight(): number | null {
  return pendingStep;
}

