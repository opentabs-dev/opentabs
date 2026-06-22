import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { chatGPTFileContentUrl, fetchChatGPTFile } from '../chatgpt-api.js';

const CHATGPT_CONTENT_URL_PREFIX = 'https://chatgpt.com/backend-api/estuary/content';

const fileDownloadSchema = z.object({
  filename: z.string().describe('Resolved file name'),
  mime_type: z.string().describe('MIME type returned by ChatGPT'),
  size_bytes: z.number().describe('File size in bytes'),
  encoding: z.literal('base64').describe('Content encoding'),
  content: z.string().describe('Base64-encoded file content'),
  download_started: z.boolean().describe('Whether a browser download was also started'),
});

type FileDownloadResult = z.infer<typeof fileDownloadSchema>;

interface DownloadUrlResponse {
  status?: string;
  download_url?: string;
  file_name?: string;
  mime_type?: string | null;
  file_size_bytes?: number;
}

const normalizeContentUrl = (params: { file_id?: string; content_url?: string }): string => {
  if (params.content_url) {
    const url = new URL(params.content_url);
    if (url.origin !== 'https://chatgpt.com' || url.pathname !== '/backend-api/estuary/content') {
      throw ToolError.validation('content_url must be a ChatGPT estuary content URL.');
    }
    return url.toString();
  }

  if (!params.file_id) {
    throw ToolError.validation('Provide either file_id or content_url.');
  }

  return chatGPTFileContentUrl(params.file_id);
};

const resolveFileDownload = async (params: {
  file_id?: string;
  content_url?: string;
}): Promise<{ url: string; fileName: string; mimeType: string; sizeBytes: number }> => {
  if (params.content_url) {
    return { url: normalizeContentUrl(params), fileName: '', mimeType: '', sizeBytes: 0 };
  }

  if (!params.file_id) {
    throw ToolError.validation('Provide either file_id or content_url.');
  }

  const response = await fetchChatGPTFile(`/backend-api/files/${encodeURIComponent(params.file_id)}/download`);
  const data = (await response.json()) as DownloadUrlResponse;
  if (!data.download_url) {
    throw ToolError.notFound(`No download URL returned for file ${params.file_id}.`);
  }

  return {
    url: data.download_url,
    fileName: data.file_name?.split('/').pop() ?? '',
    mimeType: data.mime_type ?? '',
    sizeBytes: data.file_size_bytes ?? 0,
  };
};

const inferExtension = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'bin';
};

const filenameFromHeaders = (headers: Headers): string | null => {
  const disposition = headers.get('content-disposition');
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);

  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] ?? null;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const triggerBrowserDownload = (base64: string, filename: string, mimeType: string): void => {
  const bytes = base64ToBytes(base64);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
};

const downloadChatGPTFileContent = async (params: {
  file_id?: string;
  content_url?: string;
  filename?: string;
  download_to_browser?: boolean;
}): Promise<FileDownloadResult> => {
  const resolved = await resolveFileDownload(params);
  const url = resolved.url;
  const response = await fetchChatGPTFile(url);
  const mimeType =
    response.headers.get('content-type')?.split(';')[0]?.trim() || resolved.mimeType || 'application/octet-stream';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const urlFileId = new URL(url).searchParams.get('id') ?? params.file_id ?? 'chatgpt-file';
  const filename =
    params.filename ??
    filenameFromHeaders(response.headers) ??
    resolved.fileName ??
    `${urlFileId}.${inferExtension(mimeType)}`;
  const content = bytesToBase64(bytes);

  if (params.download_to_browser) {
    triggerBrowserDownload(content, filename, mimeType);
  }

  return {
    filename,
    mime_type: mimeType,
    size_bytes: resolved.sizeBytes || bytes.byteLength,
    encoding: 'base64',
    content,
    download_started: params.download_to_browser ?? false,
  };
};

export const getFileContent = defineTool({
  name: 'get_file_content',
  displayName: 'Get File Content',
  description:
    'Download a ChatGPT conversation file or generated image and return its base64 content. Accepts a file ID or a ChatGPT estuary content URL from list_conversation_files.',
  summary: 'Get file content',
  icon: 'file-down',
  group: 'Files',
  input: z.object({
    file_id: z.string().optional().describe('ChatGPT file ID, for example file_abc123.'),
    content_url: z
      .string()
      .optional()
      .describe('Full ChatGPT estuary content URL. Use this when list_conversation_files returns one.'),
    filename: z.string().optional().describe('Optional output file name. Defaults to the server filename or file ID.'),
    download_to_browser: z
      .boolean()
      .optional()
      .describe('Also trigger a normal browser download into the user Downloads folder (default false).'),
  }),
  output: fileDownloadSchema,
  handle: async params => {
    return downloadChatGPTFileContent(params);
  },
});

export const downloadFile = defineTool({
  name: 'download_file',
  displayName: 'Download File',
  description:
    'Download a ChatGPT conversation file or generated image to the browser Downloads folder. Accepts a file ID or a ChatGPT estuary content URL from list_conversation_files.',
  summary: 'Save file to Downloads folder',
  icon: 'download',
  group: 'Files',
  input: z.object({
    file_id: z.string().optional().describe('ChatGPT file ID, for example file_abc123.'),
    content_url: z
      .string()
      .optional()
      .describe('Full ChatGPT estuary content URL. Use this when list_conversation_files returns one.'),
    filename: z.string().optional().describe('Optional output file name. Defaults to the server filename or file ID.'),
  }),
  output: z.object({
    filename: z.string().describe('Downloaded file name'),
    mime_type: z.string().describe('MIME type returned by ChatGPT'),
    size_bytes: z.number().describe('File size in bytes'),
    downloaded: z.boolean().describe('Whether the browser download was triggered'),
  }),
  handle: async params => {
    const result = await downloadChatGPTFileContent({ ...params, download_to_browser: true });
    return {
      filename: result.filename,
      mime_type: result.mime_type,
      size_bytes: result.size_bytes,
      downloaded: result.download_started,
    };
  },
});

export const isChatGPTContentUrl = (value: string): boolean => value.startsWith(CHATGPT_CONTENT_URL_PREFIX);
