# Onboarding Checklist Flows

This document describes every onboarding checklist flow — the sequence of spotlights, navigations, and user actions that guide a new user through the app.

## Overview

The onboarding system has 6 checklist steps shown in a bottom sheet ("Get Started"). Each step maps to one or more spotlight tour steps that highlight specific UI elements. When a user taps an incomplete checklist item, the app navigates to the right screen and fires spotlights in sequence.

Some flows have **reactive continuation steps** — spotlights that fire later when conditions are met (e.g., after a model finishes downloading). These use store state checks rather than the immediate `setPendingSpotlight` mechanism.

### Checklist Steps at a Glance

| # | Step ID | Title | Completion Criteria | Spotlight Steps |
|---|---------|-------|---------------------|-----------------|
| 1 | `downloadedModel` | Download a model | `downloadedModels.length > 0` | 0 → 9 → 10 (3-part) |
| 2 | `loadedModel` | Load a model | `activeModelId !== null` | 1 → 11 (2-part) |
| 3 | `sentMessage` | Send your first message | Any conversation has messages | 2 → 3 → 12 (3-part) |
| 4 | `triedImageGen` | Try image generation | see below | 4 → 13 → 14 → 15 → 16 (5-part) |
| 5 | `exploredSettings` | Explore settings | `onboardingChecklist.exploredSettings` flag | 5 → 6 (2-part) |
| 6 | `createdProject` | Create a project | `projects.length > 4` | 7 → 8 (2-part) |

---

## Flow 1: Download a Model (3-part)

**Goal**: Guide the user to browse models, select one, and download a file.

### Sequence

1. User taps "Download a model" in the checklist sheet
2. Sheet closes
3. App queues spotlight step 9 (file card) as the pending next step
4. App navigates to **ModelsTab**
5. After 600ms, spotlight **step 0** fires — highlights the first recommended model card
   - Tooltip: "Download a model" / "Tap this recommended model to see downloadable files"
6. User taps "Got it" to dismiss the spotlight
7. User taps the recommended model card → model detail view opens
8. Model detail view mounts → consumes pending step 9, pre-queues step 10 (Download Manager icon)
9. After 600ms, spotlight **step 9** fires — highlights the first file card's download button
   - Tooltip: "Download this file" / "Tap the download icon to start downloading this model"
10. User taps "Got it" to dismiss
11. User taps download on a file → download starts, user presses back to model list
12. `onBack` in TextModelsTab consumes pending step 10
13. After 400ms, spotlight **step 10** fires — highlights the Download Manager icon in the header
    - Tooltip: "Download Manager" / "Track your download progress here"
14. User taps "Got it" to dismiss

### Completion

Step auto-completes when `downloadedModels.length > 0` (checked reactively via Zustand store).

### Key Files

- `spotlightConfig.tsx`: Steps 0, 9, 10
- `TextModelsTab.tsx`: Consumes pending step 9 on detail mount, step 10 on back
- `HomeScreen/index.tsx`: `handleStepPress` queues step 9, navigates to ModelsTab, fires step 0

---

## Flow 2: Load a Model (2-part)

**Goal**: Show the user how to activate a downloaded model.

### Sequence

1. User taps "Load a model" in the checklist sheet
2. Sheet closes
3. App queues spotlight step 11 (model picker item) as the pending next step
4. App stays on **HomeTab** (already there)
5. After 600ms, spotlight **step 1** fires — highlights the TextModelCard on HomeScreen
   - Tooltip: "Load a model" / "Tap here to select and load a text model for chatting."
6. User taps "Got it" to dismiss
7. User taps the TextModelCard → ModelPickerSheet opens (Modal)
8. ModelPickerSheet consumes pending step 11 → pulsating border animation highlights the first model (can't use spotlight-tour inside Modal — separate view hierarchy)
   - Hint text: "Tap this model to load it for chatting"
9. User taps the model → model starts loading

### Completion

Step auto-completes when `activeModelId !== null`.

### Key Files

- `spotlightConfig.tsx`: Steps 1, 11
- `ActiveModelsSection.tsx`: AttachStep index 1 wraps TextModelCard
- `ModelPickerSheet.tsx`: Pulsating border animation highlights first model item (can't use AttachStep inside Modal — separate view hierarchy)
- `HomeScreen/index.tsx`: `handleStepPress` queues step 11, fires step 1

---

## Flow 3: Send Your First Message (3-part)

**Goal**: Guide the user to create a new chat, send a message, and discover voice input.

### Sequence

1. User taps "Send your first message" in the checklist sheet
2. Sheet closes
3. App queues spotlight step 3 (ChatInput) as the pending next step
4. App navigates to **ChatsTab**
5. After 600ms, spotlight **step 2** fires — highlights the "New" button on ChatsListScreen
   - Tooltip: "Start a new chat" / "Tap the New button to create a conversation."
6. User taps "Got it" to dismiss
7. User taps the "New" button → navigates to Chat screen
8. ChatScreen mounts → consumes pending step 3, queues step 12 (voice hint)
9. After 600ms, spotlight **step 3** fires — highlights the ChatInput area
   - Tooltip: "Send a message" / "Type your message here and tap the send button."
10. User taps "Got it" to dismiss
11. After step 3 dismissed, spotlight **step 12** fires — highlights the VoiceRecordButton
    - Tooltip: "Try voice input" / "Download a speech model in Voice Settings to send voice messages"
12. User taps "Got it" to dismiss

### Completion

Step auto-completes when `conversations.some(c => c.messages.length > 0)`.

### Key Files

- `spotlightConfig.tsx`: Steps 2, 3, 12
- `ChatScreen/index.tsx`: Consumes pending step 3 on mount, queues step 12
- `ChatInput/index.tsx`: AttachStep index 12 wraps the action button area (send/stop/voice), spotlighting VoiceRecordButton when visible
- `HomeScreen/index.tsx`: `handleStepPress` queues step 3, navigates to ChatsTab, fires step 2

---

## Flow 4: Try Image Generation (5-part, reactive)

**Goal**: Guide the user through the full image generation experience — from downloading a model to generating their first image.

### Sequence

**Part 1 — Show Image Models tab (immediate, from checklist)**

1. User taps "Try image generation" in the checklist sheet
2. Sheet closes
3. App navigates to **ModelsTab**
4. After 600ms, spotlight **step 4** fires — highlights the "Image Models" tab button
   - Tooltip: "Try image generation" / "Switch to Image Models, download a model, then generate images from any chat"
5. User taps "Got it" to dismiss
6. User switches to Image Models tab and downloads a model

**Part 2 — Load the image model (reactive, on HomeScreen)**

7. When user returns to HomeScreen and an image model is downloaded but NOT loaded:
8. After 600ms, spotlight **step 13** fires — highlights the ImageModelCard on HomeScreen
   - Tooltip: "Load your image model" / "Tap here to load the image model you downloaded"
9. User taps "Got it" to dismiss
10. User taps ImageModelCard → picker opens → selects model → model loads

**Part 3 — Create a chat for image generation (reactive, on ChatsListScreen)**

11. When image model IS loaded and user is on ChatsListScreen:
12. After 800ms, spotlight **step 14** fires — highlights the "New Chat" button
    - Tooltip: "Generate an image" / "Start a new chat and try asking for an image"
13. User creates a new chat

**Part 4 — Type an image prompt (reactive, on ChatScreen)**

14. In ChatScreen with image model loaded and no images generated yet:
15. After 600ms, spotlight **step 15** fires — highlights the ChatInput
    - Tooltip: "Draw something" / "Try typing 'draw a dog' and send it"
16. User types and sends

**Part 5 — Discover image settings (reactive, after first image)**

17. After first image is generated:
18. Spotlight **step 16** fires — highlights the image mode toggle button in ChatInput
    - Tooltip: "Image generation settings" / "Control when images are generated: auto, always, or off. Configure more in Settings."

### Completion

Step auto-completes when the user has generated at least one image. Tracked via `onboardingChecklist.triedImageGen` flag, set by `imageGenerationService` after successful image generation.

### Reactive Trigger Logic

Parts 2–5 fire based on state conditions checked on relevant screens:
- **Part 2**: `downloadedImageModels.length > 0 && activeImageModelId === null && !onboardingChecklist.triedImageGen`
- **Part 3**: `activeImageModelId !== null && !onboardingChecklist.triedImageGen`
- **Part 4**: Same as Part 3, checked when ChatScreen mounts
- **Part 5**: Fires once after first image generation completes

Each reactive spotlight fires **once** — tracked via `shownSpotlights` store (a `Record<string, boolean>` separate from `onboardingChecklist`). Keys: `imageLoad`, `imageNewChat`, `imageDraw`, `imageSettings`. Cleared by `resetChecklist`.

### Key Files

- `spotlightConfig.tsx`: Steps 4, 13, 14, 15, 16
- `ModelsScreen/index.tsx`: AttachStep index 4 wraps Image Models tab button
- `ActiveModelsSection.tsx`: AttachStep index 13 wraps ImageModelCard
- `ChatInput/index.tsx`: AttachStep index 16 wraps entire ChatInput container
- `ChatScreen/index.tsx`: AttachStep index 15 wraps ChatInput; reactive logic for parts 4–5
- `HomeScreen/index.tsx`: Reactive logic for part 2
- `ChatsListScreen.tsx`: Reactive logic for part 3 (step 14)

---

## Flow 5: Explore Settings (2-part)

**Goal**: Guide the user to discover Model Settings.

### Sequence

1. User taps "Explore settings" in the checklist sheet
2. Sheet closes
3. App queues spotlight step 6 (Model Settings accordion) as the pending next step
4. App navigates to **SettingsTab**
5. After 600ms, spotlight **step 5** fires — highlights the navigation section (Model Settings row)
   - Tooltip: "Explore settings" / "Tap Model Settings to explore system prompts, generation parameters, and more"
6. User taps "Got it" to dismiss
7. User taps "Model Settings" → navigates to ModelSettingsScreen
8. ModelSettingsScreen mounts → consumes pending step 6
9. After 600ms, spotlight **step 6** fires — highlights the first accordion section
   - Tooltip: "Model settings" / "Explore model settings: system prompt, generation params, and performance tuning"
10. User taps "Got it" to dismiss

### Completion

Step auto-completes when `onboardingChecklist.exploredSettings` is `true`. This flag is set when the user opens ModelSettingsScreen.

### Key Files

- `spotlightConfig.tsx`: Steps 5, 6
- `ModelSettingsScreen/index.tsx`: Consumes pending step 6 on mount
- `HomeScreen/index.tsx`: `handleStepPress` queues step 6, navigates to SettingsTab, fires step 5

---

## Flow 6: Create a Project (2-part)

**Goal**: Guide the user to create their first project.

### Sequence

1. User taps "Create a project" in the checklist sheet
2. Sheet closes
3. App queues spotlight step 8 (name input) as the pending next step
4. App navigates to **ProjectsTab**
5. After 600ms, spotlight **step 7** fires — highlights the "New" button on ProjectsScreen
   - Tooltip: "Create a project" / "Tap New to create a project that groups related chats"
6. User taps "Got it" to dismiss
7. User taps the "New" button → navigates to ProjectEditScreen
8. ProjectEditScreen mounts → consumes pending step 8
9. After 600ms, spotlight **step 8** fires — highlights the project name input
   - Tooltip: "Name your project" / "Give your project a name to get started"
10. User taps "Got it" to dismiss

### Completion

Step auto-completes when `projects.length > 4`.

### Key Files

- `spotlightConfig.tsx`: Steps 7, 8
- `ProjectEditScreen.tsx`: Consumes pending step 8 on mount
- `HomeScreen/index.tsx`: `handleStepPress` queues step 8, navigates to ProjectsTab, fires step 7

---

## System Mechanics

### Onboarding Sheet

- Auto-opens 500ms after HomeScreen mounts (if not all steps complete)
- Only auto-opens once per app session (`hasAutoOpened` ref)
- A pulsating icon appears in the HomeScreen header when the sheet is closed and steps remain
- Sheet auto-dismisses 3 seconds after all steps complete

### Spotlight State Coordination

**Immediate flows** (same interaction) use module-level state (`spotlightState.ts`):
1. `handleStepPress` calls `setPendingSpotlight(nextStepIndex)` before navigating
2. The target screen calls `consumePendingSpotlight()` on mount
3. If a step is returned, it fires `goTo(stepIndex)` after 600ms delay
4. For 3-part flows, the intermediate screen pre-queues the next step before consuming its own

**Reactive flows** (state-dependent, across sessions) use `shownSpotlights` store:
1. Screen mounts or state changes → check conditions in `useEffect`
2. If conditions met and spotlight not yet shown → fire `goTo(stepIndex)`
3. Mark spotlight as shown via `markSpotlightShown(key)` to prevent repeats (keys: `imageLoad`, `imageNewChat`, `imageDraw`, `imageSettings`)

### Spotlight Step Index Map

| Index | Target Element | Screen | Flow |
|-------|---------------|--------|------|
| 0 | First recommended model card | ModelsScreen | downloadedModel (part 1) |
| 1 | Text model card | HomeScreen | loadedModel (part 1) |
| 2 | "New" chat button | ChatsListScreen | sentMessage (part 1) |
| 3 | Chat input area | ChatScreen | sentMessage (part 2) |
| 4 | "Image Models" tab | ModelsScreen | triedImageGen (part 1) |
| 5 | Settings nav section | SettingsScreen | exploredSettings (part 1) |
| 6 | Accordion section | ModelSettingsScreen | exploredSettings (part 2) |
| 7 | "New" project button | ProjectsScreen | createdProject (part 1) |
| 8 | Project name input | ProjectEditScreen | createdProject (part 2) |
| 9 | First file card download button | ModelsScreen (detail) | downloadedModel (part 2) |
| 10 | Download Manager icon | ModelsScreen (header) | downloadedModel (part 3) |
| 11 | First model in picker list | ModelPickerSheet | loadedModel (part 2) |
| 12 | Voice record button | ChatScreen | sentMessage (part 3) |
| 13 | Image model card | HomeScreen | triedImageGen (part 2, reactive) |
| 14 | New chat action | HomeScreen/ChatsTab | triedImageGen (part 3, reactive) |
| 15 | Chat input ("draw a dog") | ChatScreen | triedImageGen (part 4, reactive) |
| 16 | Image mode toggle | ChatScreen | triedImageGen (part 5, reactive) |

### Reset Onboarding

Settings screen has a "Reset Onboarding" button that:
1. Resets `onboardingChecklist` to all `false`
2. Sets `checklistDismissed` to `false`
3. Clears `shownSpotlights` (all reactive spotlight tracking)
4. Resets navigation to the Onboarding screen
