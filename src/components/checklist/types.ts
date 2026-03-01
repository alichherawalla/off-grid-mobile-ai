export interface OnboardingStep {
  id: string;
  title: string;
  subtitle?: string;
  completed: boolean;
  /** When true, step cannot be tapped (prerequisite not met). */
  disabled?: boolean;
}

export interface ChecklistTheme {
  // Progress bar
  progressTrackColor: string;
  progressFillColor: string;
  progressHeight: number;
  progressBorderRadius: number;
  progressTextColor: string;
  progressTextFontSize: number;

  // Checklist items
  itemSpacing: number;
  itemTitleColor: string;
  itemTitleCompletedColor: string;
  itemTitleFontSize: number;
  itemSubtitleColor: string;
  itemSubtitleFontSize: number;
  itemPressedOpacity: number;

  // Checkbox
  checkboxSize: number;
  checkboxBorderColor: string;
  checkboxBorderWidth: number;
  checkboxBorderRadius: number;
  checkboxCompletedBackground: string;
  checkboxCompletedBorderColor: string;
  checkmarkColor: string;

  // Strikethrough
  strikethroughColor: string;
  strikethroughHeight: number;

  // Animation
  springDamping: number;
  springStiffness: number;
}
