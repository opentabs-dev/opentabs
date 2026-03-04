import { defineTool, waitForSelector } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkWaitForSelector = defineTool({
  name: 'sdk_wait_for_selector',
  displayName: 'SDK Wait For Selector',
  description: 'Tests sdk.waitForSelector — waits for a DOM element matching the given selector',
  summary: 'Test SDK waitForSelector',
  icon: 'wrench',
  input: z.object({
    selector: z.string().describe('CSS selector to wait for'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the element was found'),
    tagName: z.string().describe('Tag name of the found element'),
    textContent: z.string().describe('Text content of the found element'),
  }),
  handle: async params => {
    const el = await waitForSelector<HTMLElement>(params.selector, { timeout: 5_000 });
    return {
      ok: true,
      tagName: el.tagName.toLowerCase(),
      textContent: el.textContent?.trim() ?? '',
    };
  },
});
