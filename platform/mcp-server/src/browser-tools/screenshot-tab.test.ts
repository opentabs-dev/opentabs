import { describe, expect, test } from 'vitest';
import { screenshotTab } from './screenshot-tab.js';

describe('screenshotTab.formatResult', () => {
  test('emits a single MCP image content part with mimeType image/png', () => {
    expect(screenshotTab.formatResult).toBeDefined();
    const formatted = screenshotTab.formatResult?.({ image: 'iVBORw0KGgoAAAANSUhEUg==' });
    expect(formatted).toEqual([{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }]);
  });
});
