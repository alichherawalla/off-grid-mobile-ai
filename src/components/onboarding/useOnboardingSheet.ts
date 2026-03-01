import { useState, useEffect, useRef } from 'react';
import { useOnboardingSteps } from '../checklist';

export function useOnboardingSheet() {
  const { steps, completedCount, totalCount } = useOnboardingSteps();
  const allComplete = completedCount === totalCount && totalCount > 0;
  const [sheetVisible, setSheetVisible] = useState(false);
  const hasAutoOpened = useRef(false);

  // Auto-open on first render if not all complete
  useEffect(() => {
    if (!allComplete && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      const timer = setTimeout(() => setSheetVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, [allComplete]);

  const openSheet = () => setSheetVisible(true);
  const closeSheet = () => setSheetVisible(false);
  const showIcon = !allComplete && !sheetVisible;

  return { sheetVisible, openSheet, closeSheet, showIcon, allComplete, steps, completedCount, totalCount };
}
