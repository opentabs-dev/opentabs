import {
  buildQueryString,
  getLocalStorage,
  removeLocalStorage,
  setLocalStorage,
  ToolError,
} from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { parseDiagnostics } from './diagnostics.js';
import { getProject, getResponse, pageOrigin, post, readBoundedText, requestError } from './overleaf-api.js';
import type { Diagnostic, LogResult, PdfResult } from './tools/schemas.js';
import { objectId } from './tools/schemas.js';

const BUILD_ID = /^[a-f0-9]+-[a-f0-9]+$/i;
const outputFileSchema = z.object({
  path: z.string().max(512),
  url: z.string().max(2_048),
  build: z.string().max(128).optional(),
  type: z.string().optional(),
});
const compileResponseSchema = z.object({
  status: z.string().min(1),
  outputFiles: z.array(outputFileSchema).max(500).default([]),
  compileGroup: z.string().max(128).optional(),
  clsiServerId: z.string().max(256).optional(),
  fromCache: z.boolean().optional(),
  validationProblems: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.array(z.object({ path: z.string() })),
        z.object({
          resources: z.array(z.object({ path: z.string(), size: z.number(), kbSize: z.number().optional() })),
          totalSize: z.number(),
        }),
      ]),
    )
    .nullish(),
});
type CompileResponse = z.infer<typeof compileResponseSchema>;
type OutputFile = z.infer<typeof outputFileSchema>;

const FRESHNESS =
  'The compile endpoint snapshots server-saved source using the existing project settings. ' +
  'Unsynced editor text is excluded. Source/settings can change during compilation or after that snapshot; ' +
  'this is not an atomic snapshot at return time. Cached PDF existence alone is never freshness evidence.';

const emptyResult = (projectId: string): PdfResult => ({
  project_id: projectId,
  success: false,
  status: 'not-started',
  failure_reason: null,
  compilation_requested: false,
  compilation_ran: false,
  build_id: null,
  pdf_url: null,
  freshness: FRESHNESS,
  diagnostics: [],
  diagnostics_truncated: false,
  logs: [],
  logs_omitted: 0,
});

export const outputUrl = (file: OutputFile, projectId: string, data: CompileResponse): string | null => {
  if (
    !file.build ||
    !BUILD_ID.test(file.build) ||
    !file.path ||
    file.path.split('/').some(part => !part || part === '..' || part === '.')
  ) {
    return null;
  }
  const origin = pageOrigin();
  let url: URL;
  try {
    url = new URL(file.url, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.username || url.password || url.hash) return null;
  const prefix = `/project/${projectId}`;
  const suffix = `/build/${file.build}/output/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  const middle = url.pathname.slice(prefix.length, url.pathname.length - suffix.length);
  if (
    !url.pathname.startsWith(prefix) ||
    !url.pathname.endsWith(suffix) ||
    (middle !== '' && !/^\/user\/[a-f0-9]{24}$/i.test(middle))
  ) {
    return null;
  }
  const query = buildQueryString({
    compileGroup: data.compileGroup,
    clsiserverid: data.clsiServerId,
  });
  return `${origin}${url.pathname}${query ? `?${query}` : ''}`;
};

const readLogs = async (data: CompileResponse, projectId: string, buildId: string | null, signal: AbortSignal) => {
  const diagnostics: Diagnostic[] = [];
  const logs: LogResult[] = [];
  const outputs = data.outputFiles.filter(file => file.path === 'output.log' || file.path.endsWith('.blg'));
  let diagnosticsTruncated = false;
  for (const file of outputs.slice(0, 8)) {
    const url = file.build === buildId ? outputUrl(file, projectId, data) : null;
    if (!url) {
      logs.push({
        path: file.path,
        status: 'unavailable',
        reason: 'Missing, unsafe, or mismatched build identity; this log was not fetched.',
        truncated: false,
        unparsed_excerpt: null,
      });
      continue;
    }
    try {
      const path = url.slice(pageOrigin().length);
      const response = await getResponse(path, { signal, timeout: 8_000 });
      const result = await readBoundedText(response, 262_144);
      const parsed = parseDiagnostics(result.text, file.path);
      const remaining = 100 - diagnostics.length;
      diagnosticsTruncated ||= parsed.length > remaining;
      diagnostics.push(...parsed.slice(0, remaining));
      logs.push({
        path: file.path,
        status: parsed.length ? 'partial' : 'unparsed',
        reason: 'Bounded pattern-based extraction, not a complete LaTeX/BibTeX/Biber parser.',
        truncated: result.truncated,
        unparsed_excerpt: parsed.length ? null : result.text.slice(0, 2_000),
      });
    } catch (error) {
      const classified = requestError(error, 'Overleaf build log read');
      logs.push({
        path: file.path,
        status: 'unavailable',
        reason: `Log read failed (${classified.category ?? classified.code}).`,
        truncated: false,
        unparsed_excerpt: null,
      });
      if (signal.aborted) break;
    }
  }
  const logsOmitted = outputs.length - logs.length;
  if (!outputs.some(file => file.path === 'output.log')) {
    logs.unshift({
      path: 'output.log',
      status: 'unavailable',
      reason: 'This compile response did not include a LaTeX log.',
      truncated: false,
      unparsed_excerpt: null,
    });
  }
  return {
    diagnostics,
    diagnostics_truncated: diagnosticsTruncated,
    logs,
    logs_omitted: logsOmitted,
  };
};

const runCompile = async (projectId: string, signal: AbortSignal): Promise<PdfResult> => {
  const result = emptyResult(projectId);
  const project = await getProject(projectId);
  const main = project.entities.find(entity => entity.id === project.main_document_id && entity.type === 'doc');
  if (!main) {
    return {
      ...result,
      status: 'validation-problems',
      failure_reason: 'The existing main document is unset or unavailable; no settings were changed.',
      diagnostics: [
        {
          severity: 'error',
          source: 'validation',
          log_file: null,
          file: null,
          line: null,
          message: 'Configure a valid main document in Overleaf before requesting a PDF.',
        },
      ],
    };
  }
  const key = `opentabs.overleaf.compile.${projectId}`;
  const pending = getLocalStorage(key);
  if (pending !== null && (!Number.isFinite(Number(pending)) || Number(pending) > Date.now())) {
    throw new ToolError(
      'An earlier compile may still be running. Do not retry blindly; its outcome is unknown. ' +
        'Wait for the existing Overleaf compile to finish and for the 13-minute safety window to expire.',
      'COMPILE_OUTCOME_UNKNOWN',
      { category: 'timeout', retryable: false },
    );
  }
  const guard = String(Date.now() + 13 * 60_000);
  setLocalStorage(key, guard);
  if (getLocalStorage(key) !== guard) {
    throw ToolError.internal('Browser storage is unavailable; cannot safely guard against duplicate compiles.');
  }
  let data: CompileResponse;
  try {
    // Supplying the existing path avoids Overleaf's automatic main-document repair.
    data = await post(
      `/project/${projectId}/compile?file_line_errors=true`,
      {
        rootResourcePath: main.path,
        ...(project.compiler ? { compiler: project.compiler } : {}),
        ...(project.png_to_pdf !== null ? { png2pdf: project.png_to_pdf } : {}),
      },
      compileResponseSchema,
      { signal, timeout: 240_000 },
    );
  } catch (error) {
    const classified = requestError(error, 'Overleaf compile');
    if (['auth', 'rate_limit'].includes(classified.category ?? '')) {
      removeLocalStorage(key);
      throw classified;
    }
    throw new ToolError(
      'The compile response could not be confirmed. The server may still be compiling; no retry or cached PDF was used.',
      'COMPILE_OUTCOME_UNKNOWN',
      { category: classified.category ?? 'internal', retryable: false, retryAfterMs: classified.retryAfterMs },
    );
  }
  removeLocalStorage(key);
  if (getLocalStorage(key) !== null) {
    throw ToolError.internal('Compilation returned, but the duplicate-compile guard could not be cleared.');
  }
  result.compilation_requested = true;
  result.status = data.status;
  const notRun = ['compile-in-progress', 'too-recently-compiled', 'autocompile-backoff', 'validation-problems'];
  const ran = ['success', 'failure', 'error', 'timedout', 'stopped-on-first-error', 'terminated', 'killed'];
  result.compilation_ran = notRun.includes(data.status) ? false : ran.includes(data.status) ? true : null;
  const pdf = data.outputFiles.find(file => file.path === 'output.pdf');
  const buildIds = data.outputFiles.map(file => file.build).filter((id): id is string => !!id && BUILD_ID.test(id));
  result.build_id = pdf?.build && BUILD_ID.test(pdf.build) ? pdf.build : (buildIds[0] ?? null);
  const logs = await readLogs(data, projectId, result.build_id, signal);
  Object.assign(result, logs);
  for (const [field, message] of Object.entries(data.validationProblems ?? {})) {
    if (result.diagnostics.length >= 100) {
      result.diagnostics_truncated = true;
      break;
    }
    result.diagnostics.push({
      severity: 'error',
      source: 'validation',
      log_file: null,
      file: null,
      line: null,
      message: `${field}: ${typeof message === 'string' ? message : JSON.stringify(message)}`.slice(0, 1_000),
    });
  }
  const pdfUrl = pdf ? outputUrl(pdf, projectId, data) : null;
  if (data.status === 'success' && !data.fromCache && pdfUrl) {
    result.success = true;
    result.pdf_url = pdfUrl;
  } else {
    result.failure_reason =
      data.status !== 'success'
        ? `Overleaf returned ${data.status}; no previous PDF is returned as current.`
        : data.fromCache
          ? 'The response was cache-only and did not establish source freshness.'
          : 'A safe build-specific PDF URL was not present in the successful compile response.';
  }
  return result;
};

export const compilePdf = async (projectId: string): Promise<PdfResult> => {
  if (!objectId.safeParse(projectId).success) throw ToolError.validation('Invalid Overleaf project ID.');
  pageOrigin();
  if (!navigator.locks)
    throw ToolError.internal('Browser Web Locks are required to prevent concurrent plugin compiles.');
  return navigator.locks.request(`opentabs.overleaf.compile.${projectId}`, { ifAvailable: true }, lock => {
    if (!lock) {
      return Promise.resolve({
        ...emptyResult(projectId),
        status: 'compile-in-progress',
        failure_reason: 'Another plugin request is compiling this project. It was not interrupted or duplicated.',
      });
    }
    return runCompile(projectId, AbortSignal.timeout(270_000));
  });
};
