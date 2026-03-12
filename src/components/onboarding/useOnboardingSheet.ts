import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useOnboardingSteps } from '../checklist';

export function useOnboardingSheet() {
  const { steps, completedCount, totalCount } = useOnboardingSteps();
  const allComplete = completedCount === totalCount && totalCount > 0;
  const checklistDismissed = useAppStore(s => s.checklistDismissed);
  const [sheetVisible, setSheetVisible] = useState(false);
  const hasAutoOpened = useRef(false);

  // Auto-open only on the very first app launch (never again once dismissed or all complete)
  useEffect(() => {
    if (!allComplete && !checklistDismissed && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      const timer = setTimeout(() => setSheetVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, [allComplete, checklistDismissed]);

  const dismissChecklist = useAppStore(s => s.dismissChecklist);

  const openSheet = () => setSheetVisible(true);
  const closeSheet = () => { setSheetVisible(false); dismissChecklist(); };
  const showIcon = !allComplete && !checklistDismissed && !sheetVisible;

  return { sheetVisible, openSheet, closeSheet, showIcon, allComplete, steps, completedCount, totalCount };
}
