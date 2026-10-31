import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';
import {
  buildQueryString,
  fetchFromPage,
  getCurrentUrl,
  getMetaContent,
  getPageGlobal,
  postJSON,
  ToolError,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import type { Entity, Project } from './tools/schemas.js';
import { objectId } from './tools/schemas.js';

const MAX_TREE_ENTITIES = 2_000;
export const MAX_FILE_BYTES = 1_048_576;
const TEXT_EXTENSION =
  /\.(?:tex|ltx|bib|sty|cls|bst|bbl|bbx|cbx|lbx|clo|cfg|def|dtx|ins|tikz|pgf|txt|md|csv|tsv|json|xml|ya?ml|rnw|rtex)$/i;
const BINARY_EXTENSION =
  /\.(?:pdf|png|jpe?g|gif|webp|svgz|eps|ps|zip|gz|bz2|xz|tar|woff2?|ttf|otf|mp[34]|mov|avi|docx?|xlsx?|pptx?)$/i;

export const pageOrigin = (): string => {
  const url = new URL(getCurrentUrl());
  if (url.protocol !== 'https:' || !['www.overleaf.com', 'overleaf.com'].includes(url.hostname) || url.port) {
    throw ToolError.validation('This plugin supports hosted https://www.overleaf.com only.');
  }
  return url.origin;
};

export const isAuthenticated = (): boolean => {
  const rawUser = getMetaContent('ol-user');
  if (!rawUser) return false;
  try {
    const user = z.union([z.object({ id: objectId }), z.object({ _id: objectId })]).safeParse(JSON.parse(rawUser));
    return user.success;
  } catch {
    return false;
  }
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5_000 }).then(
    () => true,
    () => false,
  );

export const requestError = (error: unknown, operation: string): ToolError => {
  if (error instanceof ToolError) {
    return new ToolError(`${operation} failed (${error.category ?? error.code}).`, error.code, {
      category: error.category,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    });
  }
  return ToolError.internal(`${operation} failed.`);
};

export const post = async <T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
  options: FetchFromPageOptions = {},
): Promise<z.infer<T>> => {
  const origin = pageOrigin();
  const csrf = getMetaContent('ol-csrfToken') ?? getMetaContent('csrf-token');
  if (!csrf) throw ToolError.auth('Open an authenticated Overleaf tab and sign in again.');
  try {
    return await postJSON(
      `${origin}${path}`,
      body,
      { ...options, headers: { 'X-CSRF-Token': csrf }, redirect: 'error' },
      schema,
    );
  } catch (error) {
    throw requestError(error, 'Overleaf request');
  }
};

export const getResponse = async (path: string, options: FetchFromPageOptions = {}): Promise<Response> => {
  try {
    return await fetchFromPage(`${pageOrigin()}${path}`, { ...options, redirect: 'error' });
  } catch (error) {
    throw requestError(error, 'Overleaf read');
  }
};

export const readBoundedText = async (
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytes: number }> => {
  if (!response.body) throw ToolError.internal('Overleaf returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (chunk?: Uint8Array, stream = false): string => {
    try {
      return decoder.decode(chunk, { stream });
    } catch {
      throw ToolError.validation('The file is not valid UTF-8 text.');
    }
  };
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.subarray(0, remaining);
      bytes += chunk.byteLength;
      text += decode(chunk, true);
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
    if (!truncated) text += decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) {
      throw ToolError.timeout('Overleaf response body timed out.');
    }
    throw requestError(error, 'Overleaf response body');
  } finally {
    reader.releaseLock();
  }
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) {
      throw ToolError.validation('Binary content cannot be read as source text.');
    }
  }
  return { text, bytes, truncated };
};

const rawFile = z.object({ _id: objectId, name: z.string().max(512) });
interface Folder {
  _id: string;
  name: string;
  docs: z.infer<typeof rawFile>[];
  fileRefs: z.infer<typeof rawFile>[];
  folders: Folder[];
}
const folderSchema: z.ZodType<Folder> = z.lazy(() =>
  rawFile.extend({
    docs: z.array(rawFile),
    fileRefs: z.array(rawFile),
    folders: z.array(folderSchema),
  }),
);
const joinSchema = z.object({
  permissionsLevel: z.string().min(1),
  project: z.object({
    _id: objectId,
    name: z.string(),
    description: z.string().nullish(),
    owner: z.object({ _id: objectId }).optional(),
    publicAccesLevel: z.string().optional(),
    rootDoc_id: objectId.nullish(),
    compiler: z.string().optional(),
    imageName: z.string().optional(),
    png2pdf: z.boolean().optional(),
    rootFolder: z.array(folderSchema).length(1),
  }),
});

export const mapProject = (payload: unknown, projectId: string): Project => {
  const parsed = joinSchema.safeParse(payload);
  if (!parsed.success) throw ToolError.internal('Overleaf returned an unsupported project initialization response.');
  const { project, permissionsLevel } = parsed.data;
  if (project._id !== projectId) throw ToolError.internal('Overleaf returned a different project than requested.');
  const entities: Entity[] = [];
  const ids = new Set<string>();
  const append = (file: z.infer<typeof rawFile>, parent: Entity | null, type: Entity['type']) => {
    if (entities.length >= MAX_TREE_ENTITIES) {
      throw ToolError.validation('Project tree exceeds the supported limit of 2,000 entities.');
    }
    if (ids.has(file._id)) throw ToolError.internal('Overleaf returned duplicate entity IDs.');
    if (
      parent &&
      (!file.name || /[/\\]/.test(file.name) || file.name.includes('\0') || ['.', '..'].includes(file.name))
    ) {
      throw ToolError.internal('Overleaf returned an invalid entity path.');
    }
    ids.add(file._id);
    const entity: Entity = {
      id: file._id,
      parent_id: parent?.id ?? null,
      name: file.name,
      path: parent ? (parent.path ? `${parent.path}/${file.name}` : file.name) : '',
      type,
    };
    entities.push(entity);
    return entity;
  };
  const visit = (folder: Folder, parent: Entity | null, depth: number) => {
    if (depth > 40) throw ToolError.validation('Project folder nesting exceeds 40 levels.');
    const entity = append(folder, parent, 'folder');
    for (const doc of folder.docs) append(doc, entity, 'doc');
    for (const file of folder.fileRefs) append(file, entity, 'file');
    for (const child of folder.folders) visit(child, entity, depth + 1);
  };
  const root = project.rootFolder[0];
  if (!root) throw ToolError.internal('Overleaf returned no project root folder.');
  visit(root, null, 0);
  return {
    id: project._id,
    name: project.name,
    description: project.description ?? null,
    permission_level: permissionsLevel,
    owner_id: project.owner?._id ?? null,
    public_access_level: project.publicAccesLevel ?? null,
    main_document_id: project.rootDoc_id ?? null,
    compiler: project.compiler ?? null,
    tex_live_version: project.imageName ?? null,
    png_to_pdf: project.png2pdf ?? null,
    entities,
  };
};

type Listener = (payload?: unknown) => void;
interface ProjectSocket {
  on(event: string, listener: Listener): void;
  removeAllListeners(): void;
  disconnect(): void;
  connect(): void;
  socket?: { connect(): void };
}
interface SocketClient {
  version?: string;
  connect(origin: string, options: Record<string, unknown>): ProjectSocket;
}
const socketClient = (): SocketClient => {
  const client = getPageGlobal('io');
  if (
    !client ||
    (typeof client !== 'object' && typeof client !== 'function') ||
    !('connect' in client) ||
    typeof client.connect !== 'function'
  ) {
    throw ToolError.validation(
      'Open an Overleaf project editor tab before using project tools; the dashboard has no project socket client.',
    );
  }
  return client as SocketClient;
};

export const getProject = (projectId: string): Promise<Project> => {
  const origin = pageOrigin();
  const client = socketClient();
  let endpoint: URL;
  try {
    endpoint = new URL(getMetaContent('ol-wsUrl') || '/socket.io', origin);
  } catch {
    throw ToolError.validation('Overleaf advertised an invalid realtime endpoint.');
  }
  if (
    endpoint.protocol !== 'https:' ||
    !(endpoint.hostname === 'overleaf.com' || endpoint.hostname.endsWith('.overleaf.com')) ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw ToolError.validation('Overleaf advertised an unsupported realtime endpoint.');
  }
  const path = endpoint.pathname.replace(/\/$/, '');
  const query = buildQueryString({ projectId });
  return new Promise((resolve, reject) => {
    let socket: ProjectSocket | undefined;
    let settled = false;
    const finish = (error?: ToolError, project?: Project) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let cleanupFailure: ToolError | undefined;
      try {
        try {
          socket?.removeAllListeners();
        } finally {
          socket?.disconnect();
        }
      } catch (cleanupError) {
        cleanupFailure = requestError(cleanupError, 'Overleaf project connection cleanup');
      }
      if (error || cleanupFailure) reject(error ?? cleanupFailure);
      else if (project) resolve(project);
    };
    const timer = setTimeout(() => finish(ToolError.timeout('Overleaf project initialization timed out.')), 12_000);
    const rejected: Listener = payload => {
      const message = z.object({ message: z.string() }).safeParse(payload);
      const reason = message.success ? message.data.message : '';
      if (reason.includes('rate-limit')) {
        finish(ToolError.rateLimited('Overleaf rate limited project access.', 15_000));
      } else if (reason === 'project not found') {
        finish(ToolError.notFound('Overleaf project was not found.'));
      } else if (reason === 'not authorized' || reason === 'invalid session') {
        finish(ToolError.auth('Overleaf denied access to the project.'));
      } else {
        finish(ToolError.internal('Overleaf rejected project initialization.'));
      }
    };
    try {
      socket = client.connect(endpoint.origin, {
        resource: path.slice(1),
        path,
        query,
        'auto connect': false,
        autoConnect: false,
        'force new connection': true,
        forceNew: true,
        reconnect: false,
        reconnection: false,
        'connect timeout': 10_000,
        timeout: 10_000,
      });
      socket.on('joinProjectResponse', payload => {
        try {
          finish(undefined, mapProject(payload, projectId));
        } catch (error) {
          finish(requestError(error, 'Overleaf project initialization'));
        }
      });
      socket.on('connectionRejected', rejected);
      for (const event of ['error', 'connect_error', 'connect_failed', 'disconnect']) {
        socket.on(event, () => finish(ToolError.internal('Overleaf project connection failed.')));
      }
      socket.on('connect_timeout', () => finish(ToolError.timeout('Overleaf project initialization timed out.')));
      if (client.version?.startsWith('0') && socket.socket) socket.socket.connect();
      else socket.connect();
    } catch (error) {
      finish(requestError(error, 'Overleaf project connection'));
    }
  });
};

export const isSearchable = (entity: Entity): boolean =>
  entity.type !== 'folder' &&
  !BINARY_EXTENSION.test(entity.name) &&
  (entity.type === 'doc' || TEXT_EXTENSION.test(entity.name));

export const readEntity = async (
  projectId: string,
  entity: Entity,
  signal?: AbortSignal,
  maxBytes = MAX_FILE_BYTES,
) => {
  if (entity.type === 'folder' || BINARY_EXTENSION.test(entity.name)) {
    throw ToolError.validation('Only text documents and stored text files can be read.');
  }
  const path =
    entity.type === 'doc'
      ? `/Project/${projectId}/doc/${entity.id}/download`
      : `/Project/${projectId}/file/${entity.id}`;
  const response = await getResponse(path, { signal, timeout: 10_000 });
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime.includes('zip') ||
    (mime === 'application/octet-stream' && !TEXT_EXTENSION.test(entity.name))
  ) {
    await response.body?.cancel();
    throw ToolError.validation('The requested file is binary or has an unsupported content type.');
  }
  if (mime === 'text/html' && entity.type === 'doc') {
    await response.body?.cancel();
    throw ToolError.auth('Overleaf returned an HTML page instead of document text. Sign in again.');
  }
  return readBoundedText(response, Math.min(maxBytes, MAX_FILE_BYTES));
};
