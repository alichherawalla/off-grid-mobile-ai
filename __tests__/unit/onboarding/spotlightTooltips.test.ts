/**
 * Spotlight Tooltip Content Tests
 *
 * Verifies that every spotlight step renders a tooltip with the correct
 * title and description text, matching the spec in ONBOARDING_FLOWS.md.
 */

import { createSpotlightSteps } from '../../../src/components/onboarding/spotlightConfig';

describe('Spotlight Tooltip Content', () => {
  const expectedTooltips: Array<{ index: number; title: string; description: string }> = [
    { index: 0, title: 'Download a model', description: 'Tap this recommended model to see downloadable files' },
    { index: 1, title: 'Load a model', description: 'Tap here to select and load a text model for chatting.' },
    { index: 2, title: 'Start a new chat', description: 'Tap the New button to create a conversation.' },
    { index: 3, title: 'Send a message', description: 'Type your message here and tap the send button.' },
    { index: 4, title: 'Try image generation', description: 'Switch to Image Models, download a model, then generate images from any chat' },
    { index: 5, title: 'Explore settings', description: 'Tap Model Settings to explore system prompts, generation parameters, and more' },
    { index: 6, title: 'Model settings', description: 'Explore model settings: system prompt, generation params, and performance tuning' },
    { index: 7, title: 'Create a project', description: 'Tap New to create a project that groups related chats' },
    { index: 8, title: 'Name your project', description: 'Give your project a name to get started' },
    { index: 9, title: 'Download this file', description: 'Tap the download icon to start downloading this model' },
    { index: 10, title: 'Download Manager', description: 'Track your download progress here' },
    { index: 11, title: 'Select a model', description: 'Tap this model to load it for chatting' },
    { index: 12, title: 'Try voice input', description: 'Download a speech model in Voice Settings to send voice messages' },
    { index: 13, title: 'Load your image model', description: 'Tap here to load the image model you downloaded' },
    { index: 14, title: 'Generate an image', description: 'Start a new chat and try asking for an image' },
    { index: 15, title: 'Draw something', description: "Try typing 'draw a dog' and send it" },
    { index: 16, title: 'Image generation settings', description: 'Control when images are generated: auto, always, or off. Configure more in Settings.' },
    { index: 17, title: 'Download an image model', description: 'Tap this recommended model to start downloading it' },
  ];

  it.each(expectedTooltips)(
    'step $index ("$title") renders correct tooltip content',
    ({ index, title, description }) => {
      const steps = createSpotlightSteps();
      const step = steps[index];
      const stopFn = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = step.render({ stop: stopFn } as any);

      // The Tooltip component receives title and description as props
      expect((element as any).props.title).toBe(title);
      expect((element as any).props.description).toBe(description);
    }
  );

  it('every tooltip "Got it" button calls stop()', () => {
    const steps = createSpotlightSteps();
    steps.forEach((step) => {
      const stopFn = jest.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const element = step.render({ stop: stopFn } as any);
      expect((element as any).props.stop).toBe(stopFn);
    });
  });
});
