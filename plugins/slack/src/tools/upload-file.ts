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
      .max(50_000_000)
      .describe('File content as a UTF-8 string (text files) or base64-encoded string (binary files). Max 50MB.'),
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

    const uploadResult = await fetch(uploadResponse.upload_url, {
      method: 'POST',
      body: contentBytes,
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
