import { getAuth } from '../slack-api.js';
import { ToolError, defineTool, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const uploadFile = defineTool({
  name: 'upload_file',
  displayName: 'Upload File',
  description: 'Upload a file to a Slack channel',
  summary: 'Upload a file to a channel',
  icon: 'upload',
  group: 'Files',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to share the file to (e.g., C01234567)'),
    content: z
      .string()
      .min(1)
      .max(20_000_000)
      .describe('File content as a UTF-8 string (text files) or base64-encoded string (binary files). Max 20MB.'),
    is_base64: z
      .boolean()
      .optional()
      .describe(
        'Set to true when content is base64-encoded (e.g., binary files like images or PDFs). Defaults to false (UTF-8 text).',
      ),
    filename: z.string().min(1).describe('Name of the file including extension (e.g., report.txt, image.png)'),
    title: z.string().optional().describe('Title for the file displayed in Slack'),
    initial_comment: z.string().optional().describe('Message text to include with the file upload'),
    filetype: z
      .string()
      .optional()
      .describe('Slack file type identifier (e.g., txt, png, pdf) — auto-detected if omitted'),
  }),
  output: z.object({
    file: z
      .object({
        id: z.string().describe('File ID'),
        title: z.string().describe('File title'),
      })
      .describe('Uploaded file metadata'),
  }),
  handle: async params => {
    const BLOCKED_EXTENSIONS = new Set(['exe', 'sh', 'bat', 'cmd', 'com', 'app', 'dmg', 'msi', 'bin']);
    const ext = params.filename.includes('.') ? params.filename.split('.').pop()?.toLowerCase() || '' : '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw ToolError.validation(`File extension .${ext} is not allowed`);
    }

    const decodeBase64 = (content: string): Uint8Array<ArrayBuffer> => {
      try {
        return Uint8Array.from(atob(content), c => c.charCodeAt(0));
      } catch {
        throw ToolError.validation('Invalid base64 content — ensure the content is properly base64-encoded');
      }
    };

    const contentBytes = params.is_base64 ? decodeBase64(params.content) : new TextEncoder().encode(params.content);

    if (params.is_base64) {
      const MAGIC_BYTES: Record<string, number[]> = {
        png: [0x89, 0x50, 0x4e, 0x47],
        jpg: [0xff, 0xd8, 0xff],
        jpeg: [0xff, 0xd8, 0xff],
        pdf: [0x25, 0x50, 0x44, 0x46],
        gif: [0x47, 0x49, 0x46],
      };
      const expectedMagic = MAGIC_BYTES[ext];
      if (expectedMagic) {
        const headerBytes = contentBytes.slice(0, expectedMagic.length);
        const matches = expectedMagic.every((byte, i) => headerBytes[i] === byte);
        if (!matches) {
          throw ToolError.validation(`File content does not match expected .${ext} format (magic bytes mismatch)`);
        }
      }
    }

    // V1 files.upload: same-origin multipart form POST via getAuth() credentials.
    const auth = getAuth();
    if (!auth) {
      throw ToolError.auth('Not authenticated — no Slack session token found');
    }

    if (!auth.workspaceUrl.startsWith('https://')) {
      throw ToolError.validation('HTTPS required for Slack API calls');
    }

    const formData = new FormData();
    formData.append('token', auth.token);
    formData.append('channels', params.channel);
    formData.append('filename', params.filename);

    const fileBlob = new Blob([contentBytes]);
    formData.append('file', fileBlob, params.filename);

    if (params.title) {
      formData.append('title', params.title);
    }
    if (params.initial_comment) {
      formData.append('initial_comment', params.initial_comment);
    }
    if (params.filetype) {
      formData.append('filetype', params.filetype);
    }

    const signal = AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await fetch(`${auth.workspaceUrl}/api/files.upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw ToolError.timeout('upload-file: file upload timed out after 30000ms');
      }
      if (signal.aborted) {
        throw new ToolError('upload-file: file upload aborted', 'aborted');
      }
      throw new ToolError(
        `upload-file: network error during file upload: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        { category: 'internal', retryable: true },
      );
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryMs = retryAfterHeader !== null ? parseRetryAfterMs(retryAfterHeader) : undefined;
      const retryHint = retryMs !== undefined ? `. Retry after ${Math.ceil(retryMs / 1000)}s` : '';
      throw ToolError.rateLimited(`Slack API rate limited (429) during file upload${retryHint}`, retryMs);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      const errorMsg = `File upload HTTP ${response.status}: ${errorText}`;
      if (response.status === 401 || response.status === 403) {
        throw ToolError.auth(errorMsg);
      } else if (response.status === 404) {
        throw ToolError.notFound(errorMsg);
      } else if (response.status === 400) {
        throw ToolError.validation(errorMsg);
      } else {
        throw ToolError.internal(errorMsg);
      }
    }

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      throw ToolError.internal('Failed to parse file upload response');
    }

    if (data.ok !== true) {
      const error = typeof data.error === 'string' ? data.error : 'unknown_error';
      if (
        ['not_authed', 'invalid_auth', 'account_inactive', 'token_revoked', 'token_expired', 'missing_scope'].includes(
          error,
        )
      ) {
        throw ToolError.auth(`Slack API error: ${error}`);
      } else if (['channel_not_found', 'not_in_channel'].includes(error)) {
        throw ToolError.notFound(`Slack API error: ${error}`);
      } else if (error === 'ratelimited') {
        throw ToolError.rateLimited(`Slack API error: ${error}`);
      } else if (['invalid_arguments', 'too_many_attachments'].includes(error)) {
        throw ToolError.validation(`Slack API error: ${error}`);
      } else {
        throw ToolError.internal(`Slack API error: ${error}`);
      }
    }

    const file =
      typeof data.file === 'object' && data.file !== null ? (data.file as Record<string, unknown>) : undefined;
    if (typeof file?.id !== 'string' || file.id.length === 0) {
      throw ToolError.internal('Slack files.upload response missing file.id');
    }
    const fileId = file.id;
    const fileTitle = params.title ?? params.filename;

    return {
      file: {
        id: fileId,
        title: fileTitle,
      },
    };
  },
});
