import { describe, expect, test } from 'vitest';
import { screenshotTab } from './screenshot-tab.js';

describe('screenshotTab.formatResult', () => {
  test('emits a single MCP image content part with mimeType image/png', () => {
    expect(screenshotTab.formatResult).toBeDefined();
    const formatted = screenshotTab.formatResult?.({ image: 'iVBORw0KGgoAAAANSUhEUg==' });
    expect(formatted).toEqual([{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }]);
  });

  test('throws a metadata-only error when the payload is not {image: string}', () => {
    // Contract: the error describes the malformed payload by type and keys,
    // never by serialising the payload itself — screenshots can carry PII
    // (tokens, DOM content) if something has gone very wrong upstream.
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).toThrow(
      /browser_screenshot_tab: extension returned unexpected payload/,
    );
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).toThrow(
      /type=object.*keys=\[image,secret\]/,
    );
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).not.toThrow(/leakme/);
  });
});
