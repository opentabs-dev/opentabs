import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { readParamsSource, renderToolCallContent } from './tool.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opentabs-tool-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readParamsSource', () => {
  test('returns undefined when no source is provided', async () => {
    const result = await readParamsSource(undefined, undefined, undefined);
    expect(result).toBeUndefined();
  });

  test('returns { json, origin } for --params flag', async () => {
    const result = await readParamsSource(undefined, '{"hello":"world"}', undefined);
    expect(result).toEqual({ json: '{"hello":"world"}', origin: '--params' });
  });

  test('returns { json, origin } for positional jsonArg', async () => {
    const result = await readParamsSource('{"a":1}', undefined, undefined);
    expect(result).toEqual({ json: '{"a":1}', origin: '[json]' });
  });

  test('reads JSON from --params-file path', async () => {
    const path = join(dir, 'payload.json');
    await writeFile(path, '{"hello":"world"}', 'utf8');
    const result = await readParamsSource(undefined, undefined, path);
    expect(result).toEqual({ json: '{"hello":"world"}', origin: path });
  });

  test('reads JSON from stdin when --params-file is -', async () => {
    const stdin = Readable.from([Buffer.from('{"x":1}')]);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    try {
      const result = await readParamsSource(undefined, undefined, '-');
      expect(result).toEqual({ json: '{"x":1}', origin: 'stdin' });
    } finally {
      if (descriptor) {
        Object.defineProperty(process, 'stdin', descriptor);
      }
    }
  });

  test('exits code 2 when jsonArg and --params are both given', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(readParamsSource('{"a":1}', '{"b":2}', undefined)).rejects.toThrow('exit');
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/Specify only one of:.*\[json\].*--params/));
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  test('exits code 2 when jsonArg and --params-file are both given', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(readParamsSource('{"a":1}', undefined, '/some/file.json')).rejects.toThrow('exit');
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/Specify only one of:.*\[json\].*--params-file/));
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  test('exits code 2 when --params-file points to a missing file', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(readParamsSource(undefined, undefined, '/nonexistent/path.json')).rejects.toThrow('exit');
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/Failed to read params file \/nonexistent\/path\.json/));
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  test('round-trips a 2 MB JSON payload without truncation', async () => {
    const bigString = 'x'.repeat(2 * 1024 * 1024);
    const path = join(dir, 'big.json');
    await writeFile(path, JSON.stringify({ data: bigString }), 'utf8');
    const result = await readParamsSource(undefined, undefined, path);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result?.json ?? '') as { data: string };
    expect(parsed.data.length).toBe(2 * 1024 * 1024);
    expect(parsed.data).toBe(bigString);
  });
});

describe('renderToolCallContent', () => {
  test('image part calls saveImage and renders a human summary with the saved path', () => {
    const saveImage = vi.fn().mockReturnValue('/tmp/opentabs-shot.png');
    const out = renderToolCallContent([{ type: 'image', data: 'AAAABBBB', mimeType: 'image/png' }], saveImage);
    expect(saveImage).toHaveBeenCalledWith('AAAABBBB', 'image/png', 0);
    expect(out).toContain('image/png');
    expect(out).toContain('/tmp/opentabs-shot.png');
  });

  test('single text part renders as text verbatim without touching saveImage', () => {
    const saveImage = vi.fn();
    expect(renderToolCallContent([{ type: 'text', text: 'hello' }], saveImage)).toBe('hello');
    expect(saveImage).not.toHaveBeenCalled();
  });

  test('combined text + image: text line first, image summary second', () => {
    const saveImage = vi.fn().mockReturnValue('/tmp/shot.png');
    const out = renderToolCallContent(
      [
        { type: 'text', text: 'preamble' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      saveImage,
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('preamble');
    expect(lines[1]).toContain('/tmp/shot.png');
  });

  test('unsupported content part type is reported, not silently dropped', () => {
    const saveImage = vi.fn();
    const out = renderToolCallContent([{ type: 'audio' }], saveImage);
    expect(out).toContain('unsupported');
    expect(out).toContain('audio');
  });

  test('malformed image part (missing mimeType) is reported; saveImage not called', () => {
    const saveImage = vi.fn();
    const out = renderToolCallContent([{ type: 'image', data: 'AAAA' }], saveImage);
    expect(saveImage).not.toHaveBeenCalled();
    expect(out).toContain('malformed');
  });

  test('malformed text part (missing text) is reported, not silently emitted as empty line', () => {
    const saveImage = vi.fn();
    // type=text but no text field — flag it the same way image malformations are flagged,
    // so a server-side bug producing this shape doesn't disappear into a blank line.
    const out = renderToolCallContent([{ type: 'text' }], saveImage);
    expect(out).toContain('malformed');
    expect(out).toContain('text');
    expect(saveImage).not.toHaveBeenCalled();
  });
});
