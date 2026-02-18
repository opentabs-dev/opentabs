import { mock, describe, expect, test, beforeEach } from 'bun:test';

const mockWriteExecFile = mock<(execId: string, code: string) => Promise<string>>();
const mockDispatchToExtension =
  mock<(state: unknown, method: string, params: Record<string, unknown>) => Promise<unknown>>();
const mockDeleteExecFile = mock<(filename: string) => Promise<void>>();

await mock.module('../extension-protocol.js', () => ({
  writeExecFile: mockWriteExecFile,
  dispatchToExtension: mockDispatchToExtension,
  deleteExecFile: mockDeleteExecFile,
}));

// Import after mocking so the module picks up the mocked dependencies
const { executeScript } = await import('./execute-script.js');
const { createState } = await import('../state.js');

describe('executeScript handler', () => {
  beforeEach(() => {
    mockWriteExecFile.mockReset();
    mockDispatchToExtension.mockReset();
    mockDeleteExecFile.mockReset();
  });

  test('on successful dispatch, deleteExecFile is called with the filename from writeExecFile', async () => {
    const state = createState();
    mockWriteExecFile.mockResolvedValue('__exec-abc123.js');
    mockDispatchToExtension.mockResolvedValue({ result: 'ok' });
    mockDeleteExecFile.mockResolvedValue(undefined);

    await executeScript.handler({ tabId: 1, code: 'return 42' }, state);

    expect(mockDeleteExecFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteExecFile).toHaveBeenCalledWith('__exec-abc123.js');
  });

  test('when dispatchToExtension throws, deleteExecFile is still called (finally contract)', async () => {
    const state = createState();
    mockWriteExecFile.mockResolvedValue('__exec-def456.js');
    mockDispatchToExtension.mockRejectedValue(new Error('dispatch failed'));
    mockDeleteExecFile.mockResolvedValue(undefined);

    let caught: Error | undefined;
    try {
      await executeScript.handler({ tabId: 2, code: 'throw new Error()' }, state);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    expect(caught?.message).toBe('dispatch failed');
    expect(mockDeleteExecFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteExecFile).toHaveBeenCalledWith('__exec-def456.js');
  });

  test('the filename from writeExecFile is passed as execFile param to dispatchToExtension', async () => {
    const state = createState();
    mockWriteExecFile.mockResolvedValue('__exec-ghi789.js');
    mockDispatchToExtension.mockResolvedValue({ success: true });
    mockDeleteExecFile.mockResolvedValue(undefined);

    await executeScript.handler({ tabId: 5, code: 'return document.title' }, state);

    expect(mockDispatchToExtension).toHaveBeenCalledTimes(1);
    expect(mockDispatchToExtension).toHaveBeenCalledWith(state, 'browser.executeScript', {
      tabId: 5,
      execFile: '__exec-ghi789.js',
    });
  });

  test('when writeExecFile rejects, the handler rejects with the same error and deleteExecFile is not called', () => {
    const state = createState();
    mockWriteExecFile.mockRejectedValue(new Error('disk full'));

    const fn = async () => await executeScript.handler({ tabId: 3, code: 'return 1' }, state);
    expect(fn).toThrow(/disk full/);

    expect(mockDispatchToExtension).not.toHaveBeenCalled();
    expect(mockDeleteExecFile).not.toHaveBeenCalled();
  });

  test('returns the result from dispatchToExtension on success', async () => {
    const state = createState();
    const dispatchResult = { value: 42, type: 'number' };
    mockWriteExecFile.mockResolvedValue('__exec-ret001.js');
    mockDispatchToExtension.mockResolvedValue(dispatchResult);
    mockDeleteExecFile.mockResolvedValue(undefined);

    const result = await executeScript.handler({ tabId: 7, code: 'return 42' }, state);

    expect(result).toEqual(dispatchResult);
  });
});
