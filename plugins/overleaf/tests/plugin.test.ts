import { getCurrentUrl, getMetaContent, getPageGlobal } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { outputUrl } from '../src/compile.js';
import { parseDiagnostics } from '../src/diagnostics.js';
import plugin from '../src/index.js';
import { getProject, isAuthenticated, mapProject, readBoundedText } from '../src/overleaf-api.js';
import { getPdf } from '../src/tools/get-pdf.js';
import { getProjectTool } from '../src/tools/get-project.js';
import { listProjects } from '../src/tools/list-projects.js';
import { readFile } from '../src/tools/read-file.js';
import { searchProject } from '../src/tools/search-project.js';

vi.mock('@opentabs-dev/plugin-sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@opentabs-dev/plugin-sdk')>();
  return {
    ...actual,
    getCurrentUrl: vi.fn(),
    getMetaContent: vi.fn(),
    getPageGlobal: vi.fn(),
  };
});

const PROJECT = '100000000000000000000001';
const OTHER_PROJECT = '100000000000000000000002';
const ROOT = '200000000000000000000001';
const DOC = '300000000000000000000001';
const BIB = '300000000000000000000002';
const BINARY = '300000000000000000000003';
const MISSING = '300000000000000000000004';
const BUILD = 'abcd-1234';
const ORIGIN = 'https://www.overleaf.com';

const projectPayload = () => ({
  permissionsLevel: 'readOnly',
  project: {
    _id: PROJECT,
    name: 'Example paper',
    rootDoc_id: DOC,
    compiler: 'pdflatex',
    imageName: 'texlive-2025.1',
    png2pdf: true,
    owner: { _id: OTHER_PROJECT },
    rootFolder: [
      {
        _id: ROOT,
        name: 'rootFolder',
        docs: [{ _id: DOC, name: 'main.tex' }],
        fileRefs: [{ _id: BINARY, name: 'figure.pdf' }],
        folders: [
          {
            _id: '200000000000000000000002',
            name: 'references',
            docs: [],
            fileRefs: [{ _id: BIB, name: 'sources.bib' }],
            folders: [],
          },
        ],
      },
    ],
  },
});
let payload = projectPayload();
let activeLocks: Set<string>;
let storage: Map<string, string>;
let requests: { path: string; init?: RequestInit }[];
let socketOptions: Record<string, unknown>[];
let socketDisconnections: number;
let route: (path: string, init?: RequestInit) => Response | Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const text = (value: string, status = 200) =>
  new Response(value, { status, headers: { 'content-type': 'text/plain' } });

const file = (path: string, build = BUILD, projectId = PROJECT) => ({
  path,
  build,
  url: `/project/${projectId}/user/${OTHER_PROJECT}/build/${build}/output/${path}`,
  type: path.split('.').at(-1),
});
const compileResponse = (status = 'success') => ({
  status,
  outputFiles: [file('output.pdf'), file('output.log'), file('output.blg')],
  compileGroup: 'standard',
  clsiServerId: 'compile-server',
});

const invoke = async <I extends z.ZodObject<z.ZodRawShape>, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
  input: unknown,
): Promise<z.infer<O>> => {
  const result = await tool.handle(tool.input.parse(input));
  return tool.output.parse(result);
};

beforeEach(() => {
  payload = projectPayload();
  storage = new Map();
  activeLocks = new Set();
  requests = [];
  socketOptions = [];
  socketDisconnections = 0;
  vi.mocked(getCurrentUrl).mockReturnValue(`${ORIGIN}/project/${PROJECT}`);
  vi.mocked(getMetaContent).mockImplementation(name => {
    if (name === 'ol-csrfToken') return 'example-csrf-value';
    if (name === 'ol-user') return JSON.stringify({ id: OTHER_PROJECT });
    return null;
  });
  vi.mocked(getPageGlobal).mockImplementation(name => {
    if (name !== 'io') return undefined;
    return {
      connect: (_origin: string, options: Record<string, unknown>) => {
        socketOptions.push(options);
        const listeners = new Map<string, (value?: unknown) => void>();
        return {
          on: (event: string, listener: (value?: unknown) => void) => listeners.set(event, listener),
          removeAllListeners: () => listeners.clear(),
          disconnect: () => socketDisconnections++,
          connect: () => queueMicrotask(() => listeners.get('joinProjectResponse')?.(payload)),
        };
      },
    };
  });
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: object | null) => Promise<unknown>,
      ) => {
        if (activeLocks.has(name)) return callback(null);
        activeLocks.add(name);
        try {
          return await callback({});
        } finally {
          activeLocks.delete(name);
        }
      },
    },
  });
  route = (path, init) => {
    if (path === `/Project/${PROJECT}/doc/${DOC}/download`) return text('First line\nliteral.* text\nLast line');
    if (path === `/Project/${PROJECT}/file/${BIB}`) return text('@article{example,\n title = {Literal.* title}\n}');
    if (path === `/project/${PROJECT}/compile?file_line_errors=true` && init?.method === 'POST') {
      return json(compileResponse());
    }
    if (path.includes('/build/') && path.includes('output.log')) {
      return text('./main.tex:2: Undefined control sequence.\nLaTeX Warning: Citation undefined on input line 3.');
    }
    if (path.includes('/build/') && path.includes('output.blg')) return text('Warning--missing journal in example');
    return text('not found', 404);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      requests.push({ path, init });
      return route(path, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registration and schemas', () => {
  it('exposes exactly the approved tools and serializable schemas', () => {
    expect(plugin.name).toBe('overleaf');
    expect(plugin.tools.map(tool => tool.name)).toEqual([
      'list_projects',
      'get_project',
      'read_file',
      'search_project',
      'get_pdf',
    ]);
    for (const tool of plugin.tools) {
      expect(() => z.toJSONSchema(tool.input)).not.toThrow();
      expect(() => z.toJSONSchema(tool.output)).not.toThrow();
    }
  });

  it('recognizes dashboard and editor user metadata without accepting anonymous CSRF alone', () => {
    expect(isAuthenticated()).toBe(true);
    vi.mocked(getMetaContent).mockReturnValue(JSON.stringify({ _id: OTHER_PROJECT }));
    expect(isAuthenticated()).toBe(true);
    vi.mocked(getMetaContent).mockReturnValue('{}');
    expect(isAuthenticated()).toBe(false);
  });

  it('rejects invalid IDs, multiline queries, and unbounded limits', () => {
    expect(getProjectTool.input.safeParse({ project_id: '../other' }).success).toBe(false);
    expect(searchProject.input.safeParse({ project_id: PROJECT, query: 'a\nb' }).success).toBe(false);
    expect(listProjects.input.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('project listing', () => {
  const dashboardProjects = Array.from({ length: 3 }, (_, index) => ({
    id: `10000000000000000000000${index}`,
    name: `Example ${index}`,
    accessLevel: 'readOnly',
    source: 'invite',
    archived: false,
    trashed: false,
    lastUpdated: '2025-01-01T00:00:00.000Z',
  }));

  it('uses honest client-side pagination and the backend name filter', async () => {
    route = () => json({ totalSize: 3, projects: dashboardProjects });
    const result = await invoke(listProjects, { limit: 1, offset: 1, name_filter: 'Example' });
    expect(result.projects.map(project => project.name)).toEqual(['Example 1']);
    expect(result.next_offset).toBe(2);
    expect(result.pagination).toBe('client_side');
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      filters: { search: 'Example' },
      sort: { by: 'lastUpdated', order: 'desc' },
    });
    expect(new Headers(requests[0]?.init?.headers).get('X-CSRF-Token')).toBe('example-csrf-value');
  });

  it('handles final/empty pages without inventing a cursor', async () => {
    route = () => json({ totalSize: 3, projects: dashboardProjects });
    expect((await invoke(listProjects, { offset: 3 })).next_offset).toBeNull();
    route = () => json({ totalSize: 0, projects: [] });
    expect((await invoke(listProjects, {})).projects).toEqual([]);
  });

  it('rejects partial backend lists and malformed project metadata', async () => {
    route = () => json({ totalSize: 20, projects: dashboardProjects });
    await expect(invoke(listProjects, {})).rejects.toMatchObject({ category: 'internal' });
    route = () => json({ totalSize: 1, projects: [{ id: PROJECT }] });
    await expect(invoke(listProjects, {})).rejects.toMatchObject({ category: 'validation' });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [404, 'not_found'],
  ] as const)('classifies HTTP %s without exposing response bodies', async (status, category) => {
    route = () => text('sensitive response content', status);
    await expect(invoke(listProjects, {})).rejects.toMatchObject({ category });
    await expect(invoke(listProjects, {})).rejects.not.toThrow('sensitive response content');
  });
});

describe('ID-bearing project initialization', () => {
  it('gets settings and a nested file tree through a fresh project-specific connection', async () => {
    const result = await invoke(getProjectTool, { project_id: PROJECT });
    expect(result.main_document_id).toBe(DOC);
    expect(result.compiler).toBe('pdflatex');
    expect(result.permission_level).toBe('readOnly');
    expect(result.entities.find(entity => entity.id === BIB)?.path).toBe('references/sources.bib');
    expect(socketOptions[0]).toMatchObject({ query: `projectId=${PROJECT}`, autoConnect: false, reconnection: false });
    expect(socketDisconnections).toBe(1);
    expect(requests).toEqual([]);
  });

  it('does not silently use state from another project', () => {
    expect(() => mapProject(payload, OTHER_PROJECT)).toThrow('different project');
  });

  it('rejects unsafe paths, duplicate IDs, and oversized trees', () => {
    const root = payload.project.rootFolder[0];
    if (!root) throw new Error('Missing test fixture root');
    root.docs.push({ _id: MISSING, name: '../secret.tex' });
    expect(() => mapProject(payload, PROJECT)).toThrow('invalid entity path');
    root.docs = [
      { _id: DOC, name: 'main.tex' },
      { _id: DOC, name: 'duplicate.tex' },
    ];
    expect(() => mapProject(payload, PROJECT)).toThrow('duplicate');
    root.docs = Array.from({ length: 2_000 }, (_, index) => ({
      _id: index.toString(16).padStart(24, '0'),
      name: `file-${index}.tex`,
    }));
    expect(() => mapProject(payload, PROJECT)).toThrow('2,000');
  });

  it('requires an editor client and rejects a non-Overleaf socket origin before connecting', async () => {
    vi.mocked(getPageGlobal).mockReturnValue(undefined);
    expect(() => getProject(PROJECT)).toThrow('editor tab');
    vi.mocked(getPageGlobal).mockReturnValue({ connect: vi.fn() });
    vi.mocked(getMetaContent).mockReturnValue('https://overleaf.com.example.org/socket.io');
    expect(() => getProject(PROJECT)).toThrow('unsupported realtime endpoint');
    vi.mocked(getMetaContent).mockReturnValue('https://[');
    expect(() => getProject(PROJECT)).toThrow('invalid realtime endpoint');
  });

  it('supports the site v0 socket client without joining documents', async () => {
    const listeners = new Map<string, (value?: unknown) => void>();
    const connect = vi.fn(() => queueMicrotask(() => listeners.get('joinProjectResponse')?.(payload)));
    vi.mocked(getPageGlobal).mockReturnValue({
      version: '0.9.19',
      connect: () => ({
        on: (event: string, listener: (value?: unknown) => void) => listeners.set(event, listener),
        removeAllListeners: () => listeners.clear(),
        disconnect: () => socketDisconnections++,
        socket: { connect },
      }),
    });
    expect((await getProject(PROJECT)).id).toBe(PROJECT);
    expect(connect).toHaveBeenCalledOnce();
    expect(socketDisconnections).toBe(1);
    expect(requests).toEqual([]);
  });

  it.each(['removeAllListeners', 'disconnect'])('settles with a structured error if socket %s fails', async method => {
    const listeners = new Map<string, (value?: unknown) => void>();
    const socket = {
      on: (event: string, listener: (value?: unknown) => void) => listeners.set(event, listener),
      connect: () => queueMicrotask(() => listeners.get('joinProjectResponse')?.(payload)),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
    };
    const cleanup = method === 'disconnect' ? socket.disconnect : socket.removeAllListeners;
    cleanup.mockImplementation(() => {
      throw new Error('sensitive client details');
    });
    vi.mocked(getPageGlobal).mockReturnValue({ connect: () => socket });
    await expect(getProject(PROJECT)).rejects.toMatchObject({ category: 'internal' });
    expect(socket.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ['not authorized', 'auth'],
    ['invalid session', 'auth'],
    ['project not found', 'not_found'],
    ['rate-limit', 'rate_limit'],
  ] as const)('classifies project connection rejection: %s', async (message, category) => {
    const listeners = new Map<string, (value?: unknown) => void>();
    vi.mocked(getPageGlobal).mockReturnValue({
      connect: () => ({
        on: (event: string, listener: (value?: unknown) => void) => listeners.set(event, listener),
        connect: () => queueMicrotask(() => listeners.get('connectionRejected')?.({ message })),
        removeAllListeners: () => listeners.clear(),
        disconnect: () => socketDisconnections++,
      }),
    });
    await expect(getProject(PROJECT)).rejects.toMatchObject({ category });
    expect(socketDisconnections).toBe(1);
  });

  it('rejects a silent project connection after exactly 12 seconds with a structured tool timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getPageGlobal).mockReturnValue({
        connect: () => ({
          on: vi.fn(),
          connect: vi.fn(),
          removeAllListeners: vi.fn(),
          disconnect: () => socketDisconnections++,
        }),
      });
      const result = getProject(PROJECT);
      const rejected = expect(result).rejects.toMatchObject({
        code: 'TIMEOUT',
        category: 'timeout',
        message: 'Overleaf project initialization timed out.',
      });
      await vi.advanceTimersByTimeAsync(11_999);
      expect(socketDisconnections).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(socketDisconnections).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('saved file reads', () => {
  it('returns an inclusive range from the correctly cased saved-text endpoint', async () => {
    const result = await invoke(readFile, { project_id: PROJECT, file_id: DOC, start_line: 2, end_line: 2 });
    expect(result).toMatchObject({
      content: 'literal.* text',
      start_line: 2,
      end_line: 2,
      total_lines: 3,
      source: 'server_saved',
      truncated: true,
    });
    expect(requests.map(request => request.path)).toEqual([`/Project/${PROJECT}/doc/${DOC}/download`]);
    expect(requests.every(request => request.init?.method !== 'POST')).toBe(true);
  });

  it('reads stored bibliography text, preserving file identity', async () => {
    const result = await invoke(readFile, { project_id: PROJECT, file_id: BIB });
    expect(result.path).toBe('references/sources.bib');
    expect(result.type).toBe('file');
    expect(result.truncated).toBe(false);
  });

  it('rejects folders, absent IDs, reversed ranges, and binary files without fetching them', async () => {
    await expect(invoke(readFile, { project_id: PROJECT, file_id: ROOT })).rejects.toMatchObject({
      category: 'validation',
    });
    await expect(invoke(readFile, { project_id: PROJECT, file_id: MISSING })).rejects.toMatchObject({
      category: 'not_found',
    });
    await expect(
      invoke(readFile, { project_id: PROJECT, file_id: DOC, start_line: 3, end_line: 1 }),
    ).rejects.toMatchObject({ category: 'validation' });
    await expect(invoke(readFile, { project_id: PROJECT, file_id: BINARY })).rejects.toMatchObject({
      category: 'validation',
    });
    expect(requests).toHaveLength(0);
  });

  it('rejects unexpected binary bytes and MIME types', async () => {
    route = () => text('text\u0000binary');
    await expect(invoke(readFile, { project_id: PROJECT, file_id: DOC })).rejects.toMatchObject({
      category: 'validation',
    });
    route = () => new Response('PDF bytes', { headers: { 'content-type': 'application/pdf' } });
    await expect(invoke(readFile, { project_id: PROJECT, file_id: DOC })).rejects.toMatchObject({
      category: 'validation',
    });
    await expect(readBoundedText(new Response(new Uint8Array([0xff, 0xfe])), 100)).rejects.toMatchObject({
      category: 'validation',
    });
  });

  it('reports byte truncation and unknown total lines without returning a partial final line', async () => {
    route = () => text('line\n'.repeat(220_000));
    const result = await invoke(readFile, { project_id: PROJECT, file_id: DOC });
    expect(result.total_lines).toBeNull();
    expect(result.truncation_reasons).toContain('file_byte_limit');
    expect(result.end_line).toBe(2_000);
    expect(result.content.length).toBeLessThanOrEqual(100_000);
  });

  it('bounds characters and refuses a single oversized line', async () => {
    route = () => text('a'.repeat(100_001));
    await expect(invoke(readFile, { project_id: PROJECT, file_id: DOC })).rejects.toMatchObject({
      category: 'validation',
    });
  });
});

describe('literal source search and coverage', () => {
  it('searches source and bibliography without interpreting regex characters or compiling', async () => {
    const result = await invoke(searchProject, { project_id: PROJECT, query: 'literal.*' });
    expect(result.matches.map(match => [match.file_id, match.line])).toEqual([
      [DOC, 2],
      [BIB, 2],
    ]);
    expect(result.complete).toBe(true);
    expect(result.skipped_files).toBe(1);
    expect(result.issues).toContainEqual({ file_id: BINARY, path: 'figure.pdf', reason: 'non_source_or_binary' });
    expect(requests.every(request => request.init?.method !== 'POST')).toBe(true);
  });

  it('applies path filters and case sensitivity with complete scoped coverage', async () => {
    const result = await invoke(searchProject, {
      project_id: PROJECT,
      query: 'literal.*',
      path_filter: 'references/',
      case_sensitive: true,
    });
    expect(result.matches).toEqual([]);
    expect(result.scanned_files).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('reports unscanned files at the match limit', async () => {
    const result = await invoke(searchProject, { project_id: PROJECT, query: 'literal.*', max_matches: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.issues.some(issue => issue.file_id === BIB && issue.reason === 'match_limit')).toBe(true);
  });

  it('reports file failures and file-count limits instead of empty success', async () => {
    route = () => text('missing', 404);
    const result = await invoke(searchProject, { project_id: PROJECT, query: 'missing', max_files: 1 });
    expect(result.failed_files).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.issues.some(issue => issue.reason === 'not_found')).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('enforces the exact aggregate byte boundary after uneven file sizes', async () => {
    const root = payload.project.rootFolder[0];
    if (!root) throw new Error('Missing test fixture root');
    root.docs = Array.from({ length: 12 }, (_, index) => ({
      _id: (index + 100).toString(16).padStart(24, '0'),
      name: `source-${index}.tex`,
    }));
    root.fileRefs = [];
    root.folders = [];
    const halfMiB = 524_288;
    route = path => {
      const index = root.docs.findIndex(doc => path.includes(doc._id));
      if (index === 9) return text('x\n'.repeat(halfMiB / 2));
      if (index === 10) {
        return text(`${'x\n'.repeat((halfMiB - 14) / 2)}target-before\ntarget-after\n${'x\n'.repeat(halfMiB / 2)}`);
      }
      return text('x\n'.repeat(halfMiB));
    };
    const result = await invoke(searchProject, { project_id: PROJECT, query: 'target' });
    expect(result.matches.map(match => match.excerpt)).toEqual(['target-before']);
    expect(result.scanned_files).toBe(11);
    expect(result.skipped_files).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({
      file_id: root.docs[10]?._id,
      path: 'source-10.tex',
      reason: 'project_byte_limit',
    });
    expect(result.issues).toContainEqual({
      file_id: root.docs[11]?._id,
      path: 'source-11.tex',
      reason: 'scan_limit',
    });
    expect(requests).toHaveLength(11);
  });

  it('surfaces auth/rate limits rather than hiding them as skipped files', async () => {
    route = () => text('expired', 401);
    await expect(invoke(searchProject, { project_id: PROJECT, query: 'text' })).rejects.toMatchObject({
      category: 'auth',
    });
  });
});

describe('fresh PDF and same-build diagnostics', () => {
  it('waits for one actual compile, preserves settings, and returns a same-build authenticated URL', async () => {
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.success).toBe(true);
    expect(result.compilation_ran).toBe(true);
    expect(result.build_id).toBe(BUILD);
    expect(result.pdf_url).toBe(`${ORIGIN}${file('output.pdf').url}?compileGroup=standard&clsiserverid=compile-server`);
    expect(result.diagnostics.map(diagnostic => diagnostic.source)).toEqual(['latex', 'latex', 'bibtex']);
    expect(result.logs.every(log => log.status === 'partial')).toBe(true);
    const compiles = requests.filter(request => request.init?.method === 'POST');
    expect(compiles).toHaveLength(1);
    expect(JSON.parse(String(compiles[0]?.init?.body))).toEqual({
      rootResourcePath: 'main.tex',
      compiler: 'pdflatex',
      png2pdf: true,
    });
    expect(requests.some(request => /cached|\/stop|settings|\/flush/.test(request.path))).toBe(false);
    expect(storage.size).toBe(0);
  });

  it('does not reuse a PDF across calls without freshness evidence', async () => {
    await invoke(getPdf, { project_id: PROJECT });
    await invoke(getPdf, { project_id: PROJECT });
    expect(requests.filter(request => request.init?.method === 'POST')).toHaveLength(2);
  });

  it('returns an explicit failed build with diagnostics, never its leftover PDF', async () => {
    const previous = route;
    route = (path, init) => (init?.method === 'POST' ? json(compileResponse('failure')) : previous(path, init));
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.success).toBe(false);
    expect(result.pdf_url).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('does not trust cache-only success', async () => {
    const previous = route;
    route = (path, init) =>
      init?.method === 'POST' ? json({ ...compileResponse(), fromCache: true }) : previous(path, init);
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.success).toBe(false);
    expect(result.pdf_url).toBeNull();
  });

  it('refuses to repair an unset main document or submit a compile', async () => {
    payload.project.rootDoc_id = MISSING;
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.status).toBe('validation-problems');
    expect(result.compilation_requested).toBe(false);
    expect(requests).toEqual([]);
  });

  it('reports server contention without stopping, retrying, or returning an old PDF', async () => {
    route = () => json({ status: 'compile-in-progress', outputFiles: [] });
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result).toMatchObject({ success: false, pdf_url: null, compilation_ran: false });
    expect(requests).toHaveLength(1);
  });

  it('prevents cross-tab duplicate plugin compiles using a shared lock', async () => {
    activeLocks.add(`opentabs.overleaf.compile.${PROJECT}`);
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.status).toBe('compile-in-progress');
    expect(result.compilation_requested).toBe(false);
    expect(requests).toEqual([]);
  });

  it('guards an ambiguous timeout without a blind retry, even after reinjection', async () => {
    route = () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    await expect(invoke(getPdf, { project_id: PROJECT })).rejects.toMatchObject({
      code: 'COMPILE_OUTCOME_UNKNOWN',
      category: 'timeout',
      retryable: false,
    });
    await expect(invoke(getPdf, { project_id: PROJECT })).rejects.toMatchObject({
      code: 'COMPILE_OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(requests).toHaveLength(1);
    expect(storage.size).toBe(1);
  });

  it('preserves auth and rate-limit errors and clears the ambiguous guard', async () => {
    route = () => text('expired', 429);
    await expect(invoke(getPdf, { project_id: PROJECT })).rejects.toMatchObject({ category: 'rate_limit' });
    expect(storage.size).toBe(0);
  });

  it('rejects unsafe, cross-project and non-build-specific output URLs', () => {
    const data = compileResponse();
    expect(outputUrl({ ...file('output.pdf'), url: 'https://example.org/output.pdf' }, PROJECT, data)).toBeNull();
    expect(outputUrl(file('output.pdf', BUILD, OTHER_PROJECT), PROJECT, data)).toBeNull();
    expect(outputUrl({ ...file('output.pdf'), build: undefined }, PROJECT, data)).toBeNull();
    expect(
      outputUrl({ ...file('output.pdf'), url: `/project/${PROJECT}/output/output.pdf` }, PROJECT, data),
    ).toBeNull();
  });

  it('does not fetch mismatched-build logs and reports missing logs', async () => {
    const previous = route;
    route = (path, init) =>
      init?.method === 'POST'
        ? json({ status: 'success', outputFiles: [file('output.pdf'), file('output.blg', 'abcd-9999')] })
        : previous(path, init);
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.success).toBe(true);
    expect(result.logs.every(log => log.status === 'unavailable')).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('reports unavailable logs and unparsed log excerpts honestly', async () => {
    const previous = route;
    route = (path, init) =>
      path.includes('output.log')
        ? text('unrecognized format')
        : path.includes('output.blg')
          ? text('gone', 404)
          : previous(path, init);
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.logs.map(log => log.status)).toEqual(['unparsed', 'unavailable']);
    expect(result.logs[0]?.unparsed_excerpt).toBe('unrecognized format');
  });

  it.each([
    { category: 'auth', response: () => text('expired', 401) },
    { category: 'rate_limit', response: () => text('limited', 429) },
    {
      category: 'timeout',
      response: () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    },
  ])('preserves the confirmed PDF and reads remaining logs after a $category log failure', async ({
    category,
    response,
  }) => {
    const previous = route;
    route = (path, init) => (path.includes('output.log') ? response() : previous(path, init));
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result).toMatchObject({
      success: true,
      status: 'success',
      compilation_ran: true,
      build_id: BUILD,
      pdf_url: `${ORIGIN}${file('output.pdf').url}?compileGroup=standard&clsiserverid=compile-server`,
      logs_omitted: 0,
    });
    expect(result.logs).toMatchObject([
      { path: 'output.log', status: 'unavailable', reason: `Log read failed (${category}).` },
      { path: 'output.blg', status: 'partial' },
    ]);
    expect(result.diagnostics.map(diagnostic => diagnostic.source)).toEqual(['bibtex']);
    expect(requests.filter(request => request.init?.method === 'POST')).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(storage.size).toBe(0);
  });

  it('preserves the confirmed PDF and reports omitted logs when the operation signal aborts', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const previous = route;
    route = (path, init) => {
      if (path.includes('output.log')) {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      }
      return previous(path, init);
    };
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result).toMatchObject({
      success: true,
      status: 'success',
      compilation_ran: true,
      build_id: BUILD,
      pdf_url: `${ORIGIN}${file('output.pdf').url}?compileGroup=standard&clsiserverid=compile-server`,
      logs_omitted: 1,
    });
    expect(result.logs).toMatchObject([{ path: 'output.log', status: 'unavailable' }]);
    expect(result.logs).toHaveLength(1);
    expect(requests.some(request => request.path.includes('output.blg'))).toBe(false);
    expect(requests).toHaveLength(2);
    expect(storage.size).toBe(0);
  });

  it('caps diagnostics and raw log reads', async () => {
    const previous = route;
    route = (path, init) =>
      path.includes('output.log')
        ? text('LaTeX Warning: warning on input line 1.\n'.repeat(10_000))
        : previous(path, init);
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.diagnostics).toHaveLength(100);
    expect(result.diagnostics_truncated).toBe(true);
    expect(result.logs[0]?.truncated).toBe(true);
  });

  it('formats structured source-size validation failures without compiling again', async () => {
    route = () =>
      json({
        status: 'validation-problems',
        outputFiles: [],
        validationProblems: { sizeCheck: { resources: [{ path: 'main.tex', size: 2_000 }], totalSize: 2_000 } },
      });
    const result = await invoke(getPdf, { project_id: PROJECT });
    expect(result.compilation_ran).toBe(false);
    expect(result.diagnostics[0]?.source).toBe('validation');
    expect(requests).toHaveLength(1);
  });
});

describe('diagnostic patterns', () => {
  it('extracts LaTeX error lines and BibTeX/Biber errors without inventing filenames', () => {
    expect(parseDiagnostics('! Undefined control sequence.\nl.42 \\bad', 'output.log')[0]).toMatchObject({
      source: 'latex',
      severity: 'error',
      line: 42,
      file: null,
    });
    expect(parseDiagnostics('Repeated entry---line 12 of file sources.bib', 'output.blg')[0]).toMatchObject({
      source: 'bibtex',
      severity: 'error',
      line: 12,
      file: 'sources.bib',
    });
    expect(parseDiagnostics('[1] Biber.pm:100> ERROR - Cannot find bibliography', 'output.blg')[0]).toMatchObject({
      source: 'biber',
      severity: 'error',
    });
  });

  it('keeps diagnostic messages bounded and leaves unsupported text unparsed', () => {
    expect(parseDiagnostics(`! ${'x'.repeat(2_000)}`, 'output.log')[0]?.message).toHaveLength(1_000);
    expect(parseDiagnostics('unsupported diagnostic format', 'output.log')).toEqual([]);
  });
});
