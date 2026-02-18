import { slackApi } from '../slack-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const uploadFile = defineTool({
  name: 'upload_file',
  description: 'Upload a file to a Slack channel',
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
    const ext = params.filename.includes('.') ? params.filename.split('.').pop()!.toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new ToolError(`File extension .${ext} is not allowed`, 'blocked_file_type');
    }

    const decodeBase64 = (content: string): Uint8Array<ArrayBuffer> => {
      try {
        return Uint8Array.from(atob(content), c => c.charCodeAt(0));
      } catch {
        throw new ToolError(
          'Invalid base64 content — ensure the content is properly base64-encoded',
          'invalid_base64',
        );
      }
    };

    const contentBytes = params.is_base64
      ? decodeBase64(params.content)
      : new TextEncoder().encode(params.content);

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
          throw new ToolError(
            `File content does not match expected .${ext} format (magic bytes mismatch)`,
            'magic_bytes_mismatch',
          );
        }
      }
    }

    const uploadResponse = await slackApi<{
      upload_url?: string;
      file_id?: string;
    }>('files.getUploadURLExternal', {
      filename: params.filename,
      length: contentBytes.byteLength,
      ...(params.filetype ? { filetype: params.filetype } : {}),
    });

    if (!uploadResponse.upload_url || !uploadResponse.file_id) {
      throw new ToolError('Failed to obtain upload URL from Slack', 'upload_url_failed');
    }

    const uploadUrl = new URL(uploadResponse.upload_url);
    if (uploadUrl.protocol !== 'https:') {
      throw new ToolError('Upload URL must use HTTPS', 'insecure_protocol');
    }
    const SLACK_DOMAINS = ['slack.com', 'slack-edge.com'];
    if (!SLACK_DOMAINS.some(d => uploadUrl.hostname === d || uploadUrl.hostname.endsWith('.' + d))) {
      throw new ToolError('Upload URL domain is not a trusted Slack domain', 'untrusted_upload_domain');
    }

    const uploadResult = await fetch(uploadResponse.upload_url, {
      method: 'POST',
      body: contentBytes,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadResult.ok) {
      throw new ToolError(`File upload HTTP ${uploadResult.status}`, 'upload_failed');
    }

    const fileTitle = params.title ?? params.filename;

    await slackApi('files.completeUploadExternal', {
      files: [{ id: uploadResponse.file_id, title: fileTitle }],
      channel_id: params.channel,
      initial_comment: params.initial_comment,
    });

    return {
      file: {
        id: uploadResponse.file_id,
        title: fileTitle,
      },
    };
  },
});
