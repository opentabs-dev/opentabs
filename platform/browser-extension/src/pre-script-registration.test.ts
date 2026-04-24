import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PluginMeta } from './extension-messages.js';

// ---------------------------------------------------------------------------
// Chrome API stubs — must be set up before importing pre-script-registration.ts
// so the module binds to the mocked scripting methods.
// ---------------------------------------------------------------------------

const mockUnregisterContentScripts = vi.fn<(filter: { ids: string[] }) => Promise<void>>();
const mockRegisterContentScripts = vi.fn<(scripts: unknown[]) => Promise<void>>();

(globalThis as Record<string, unknown>).chrome = {
  scripting: {
    unregisterContentScripts: mockUnregisterContentScripts,
    registerContentScripts: mockRegisterContentScripts,
  },
};

// Import after mocking so upsertPreScript binds to the mocked chrome.scripting
const { upsertPreScript } = await import('./pre-script-registration.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseMeta = (): PluginMeta => ({
  name: 'prescript-test',
  version: '1.0.0',
  displayName: 'Prescript Test',
  urlPatterns: ['http://127.0.0.1/*'],
  permission: 'auto',
  tools: [],
});

// ---------------------------------------------------------------------------
// upsertPreScript tests
// ---------------------------------------------------------------------------

describe('upsertPreScript', () => {
  beforeEach(() => {
    // Unregister throws to simulate no existing registration — upsertPreScript catches this.
    mockUnregisterContentScripts.mockRejectedValue(new Error('not registered'));
    mockRegisterContentScripts.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('valid preScriptFile', () => {
    test('registers the content script for a well-formed content-hashed filename', async () => {
      const meta = { ...baseMeta(), preScriptFile: 'adapters/prescript-test-prescript-a1b2c3d4.js' };
      await upsertPreScript(meta);
      expect(mockRegisterContentScripts).toHaveBeenCalledOnce();
      expect(mockRegisterContentScripts).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ js: ['adapters/prescript-test-prescript-a1b2c3d4.js'] })]),
      );
    });
  });

  describe('absent preScriptFile', () => {
    test('returns early without registering when preScriptFile is undefined', async () => {
      await upsertPreScript(baseMeta());
      expect(mockRegisterContentScripts).not.toHaveBeenCalled();
      expect(mockUnregisterContentScripts).not.toHaveBeenCalled();
    });
  });

  describe('malformed preScriptFile — filename validation guard', () => {
    const BAD_PATHS = [
      '../../../etc/passwd',
      'adapters/plugin-abcdef12.js', // missing -prescript- segment
      'evil/prescript-test-prescript-a1b2c3d4.js', // wrong subdirectory
    ];

    for (const badPath of BAD_PATHS) {
      test(`rejects preScriptFile='${badPath}'`, async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const meta = { ...baseMeta(), preScriptFile: badPath };
          await upsertPreScript(meta);
          expect(mockRegisterContentScripts).not.toHaveBeenCalled();
          expect(mockUnregisterContentScripts).not.toHaveBeenCalled();
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('refusing to register pre-script with unexpected filename'),
          );
        } finally {
          warnSpy.mockRestore();
        }
      });
    }
  });
});
