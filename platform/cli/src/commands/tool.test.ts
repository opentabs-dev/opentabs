import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { decodeBase64Field, parseFileMapping, readParamsSource, setField } from './tool.js';

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

describe('parseFileMapping', () => {
  test('splits on the first = into field segments and path', () => {
    expect(parseFileMapping('attachments.0.content=./a=b.pdf', '--attach')).toEqual({
      field: 'attachments.0.content',
      segments: ['attachments', '0', 'content'],
      path: resolve('./a=b.pdf'),
    });
  });

  test.each([
    'content',
    '=a.pdf',
    'content=',
    'a..b=x',
    '__proto__.x=f',
    'a.constructor=f',
    'a.00.b=f',
  ])('rejects %s', spec => {
    expect(() => parseFileMapping(spec, '--save')).toThrow('--save expects <field>=<file>');
  });
});

describe('setField', () => {
  test('creates arrays for numeric segments and objects otherwise', () => {
    const args: Record<string, unknown> = { to: 'x' };
    setField(args, ['attachments', '0', 'content'], 'QQ==');
    expect(args).toEqual({ to: 'x', attachments: [{ content: 'QQ==' }] });
  });

  test('throws when an index would leave a hole in an array', () => {
    expect(() => setField({}, ['attachments', '1', 'content'], 'QQ==')).toThrow('index 1 skips past the end');
    expect(() => setField({ list: ['a'] }, ['list', '2'], 'b')).toThrow('index 2 skips past the end');
  });

  test('merges into existing containers', () => {
    const args: Record<string, unknown> = { attachments: [{ filename: 'a.pdf' }] };
    setField(args, ['attachments', '0', 'content'], 'QQ==');
    expect(args).toEqual({ attachments: [{ filename: 'a.pdf', content: 'QQ==' }] });
  });

  test('throws on a named key into an existing array', () => {
    expect(() => setField({ attachments: [] }, ['attachments', 'content'], 'QQ==')).toThrow('must be an index');
  });

  test('throws when an intermediate value is a primitive', () => {
    expect(() => setField({ a: 'text' }, ['a', 'b'], 1)).toThrow('"a" is not an object');
  });
});

describe('decodeBase64Field', () => {
  const mapping = (field: string) => parseFileMapping(`${field}=out.bin`, '--save');

  test('decodes a nested base64 field', () => {
    const result = { files: [{ content: Buffer.from('hello').toString('base64'), encoding: 'base64' }] };
    expect(decodeBase64Field(result, mapping('files.0.content')).toString()).toBe('hello');
  });

  test('refuses a field whose sibling encoding is not base64', () => {
    expect(() => decodeBase64Field({ content: 'abcd', encoding: 'text' }, mapping('content'))).toThrow(
      'has a non-base64 encoding',
    );
  });

  test('rejects missing, non-string and non-base64 fields', () => {
    expect(() => decodeBase64Field({}, mapping('image'))).toThrow('not found');
    expect(() => decodeBase64Field({ image: 1 }, mapping('image'))).toThrow('not a string');
    expect(() => decodeBase64Field({ image: 'not base64!' }, mapping('image'))).toThrow('not valid base64');
    expect(() => decodeBase64Field({ image: 'AAAAY' }, mapping('image'))).toThrow('not valid base64');
  });

  test.each(['A=', 'AA=', 'AB', 'QR==', 'QUJ='])('rejects non-canonical %s', image => {
    expect(() => decodeBase64Field({ image }, mapping('image'))).toThrow('not valid base64');
  });

  test('accepts line-wrapped and base64url content', () => {
    expect(decodeBase64Field({ image: 'aGVs\nbG8=\n' }, mapping('image')).toString()).toBe('hello');
    expect([...decodeBase64Field({ image: '-_8' }, mapping('image'))]).toEqual([0xfb, 0xff]);
  });
});
