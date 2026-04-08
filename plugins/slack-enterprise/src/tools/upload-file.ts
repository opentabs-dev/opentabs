import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

const BLOCKED_EXTENSIONS = new Set(['exe', 'sh', 'bat', 'cmd', 'com', 'app', 'dmg', 'msi', 'bin']);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Validate file extension against blocked list.
 */
const validateExtension = (filename: string): void => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw ToolError.validation(`File extension ".${ext}" is blocked for security reasons`);
  }
};

/**
 * Validate base64 magic bytes for common image/document formats.
 */
const validateMagicBytes = (base64Content: string, filename: string): void => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const prefix = base64Content.substring(0, 12);

  const magicMap: Record<string, string[]> = {
    png: ['iVBORw0KGgo'],
    jpg: ['/9j/'],
    jpeg: ['/9j/'],
    gif: ['R0lGODlh', 'R0lGODdh'],
    pdf: ['JVBERi0'],
    zip: ['UEsDB'],
  };

  const expected = magicMap[ext];
  if (expected && !expected.some(magic => prefix.startsWith(magic))) {
    throw ToolError.validation(`File content does not match expected format for ".${ext}"`);
  }
};

export const uploadFile = defineTool({
  name: 'upload_file',
  displayName: 'Upload File',
  description:
    'Upload a file to a Slack channel. Supports UTF-8 text content or base64-encoded binary files. Maximum file size is 20MB. Executable file types are blocked.',
  summary: 'Upload a file to a channel',
  icon: 'upload',
  group: 'Files',
  input: z.object({
    channel: z.string().describe('Channel ID to share the file to (e.g., C1234567890)'),
    content: z
      .string()
      .describe('File content as a UTF-8 string (text files) or base64-encoded string (binary files). Max 20MB.'),
    filename: z.string().describe('Name of the file including extension (e.g., report.txt, image.png)'),
    is_base64: z
      .boolean()
      .optional()
      .default(false)
      .describe('Set to true when content is base64-encoded (e.g., binary files). Defaults to false (UTF-8 text).'),
    title: z.string().optional().describe('Title for the file displayed in Slack'),
    filetype: z
      .string()
      .optional()
      .describe('Slack file type identifier (e.g., txt, png, pdf) — auto-detected if omitted'),
    initial_comment: z.string().optional().describe('Message text to include with the file upload'),
  }),
  output: z.object({
    file_id: z.string(),
    title: z.string(),
    permalink: z.string(),
  }),
  handle: async params => {
    validateExtension(params.filename);

    let contentBytes: Uint8Array;
    if (params.is_base64) {
      validateMagicBytes(params.content, params.filename);
      const binaryStr = atob(params.content);
      contentBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        contentBytes[i] = binaryStr.charCodeAt(i);
      }
    } else {
      contentBytes = new TextEncoder().encode(params.content);
    }

    if (contentBytes.length > MAX_FILE_SIZE) {
      throw ToolError.validation(
        `File exceeds maximum size of 20MB (got ${Math.round(contentBytes.length / 1024 / 1024)}MB)`,
      );
    }

    // Step 1: Get upload URL
    const uploadData = await slackApi<{
      upload_url: string;
      file_id: string;
    }>('files.getUploadURLExternal', {
      filename: params.filename,
      length: contentBytes.length,
    });

    const uploadUrl = uploadData.upload_url;
    if (!uploadUrl) {
      throw ToolError.internal('Failed to get upload URL from Slack');
    }

    // Validate upload URL domain
    try {
      const urlObj = new URL(uploadUrl);
      if (!urlObj.hostname.endsWith('.slack.com') && !urlObj.hostname.endsWith('.slack-edge.com')) {
        throw ToolError.validation('Upload URL points to unexpected domain');
      }
      if (urlObj.protocol !== 'https:') {
        throw ToolError.validation('Upload URL must use HTTPS');
      }
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw ToolError.validation('Invalid upload URL');
    }

    // Step 2: Upload file content to the pre-signed URL.
    // Do not include credentials — the URL is on a different origin (files.slack.com)
    // and already contains auth via query parameters.
    const signal = AbortSignal.timeout(60_000);
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      body: contentBytes as unknown as BodyInit,
      signal,
    });

    if (!uploadResp.ok) {
      throw ToolError.internal(`File upload failed: HTTP ${uploadResp.status}`);
    }

    // Step 3: Complete the upload
    const completeData = await slackApi<{
      files: Array<{ id: string; title: string; permalink: string }>;
    }>('files.completeUploadExternal', {
      files: [{ id: uploadData.file_id, title: params.title ?? params.filename }],
      channel_id: params.channel,
      ...(params.initial_comment ? { initial_comment: params.initial_comment } : {}),
    });

    const file = completeData.files?.[0];
    return {
      file_id: file?.id ?? uploadData.file_id,
      title: file?.title ?? params.title ?? params.filename,
      permalink: file?.permalink ?? '',
    };
  },
});
