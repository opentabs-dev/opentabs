import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const uploadFile = defineTool({
  name: 'upload_file',
  displayName: 'Upload File',
  description: 'Upload a file to a Discord channel. Supports text files and base64-encoded binary files.',
  summary: 'Upload a file to a channel',
  icon: 'upload',
  group: 'Files',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to share the file to'),
    content: z
      .string()
      .min(1)
      .describe('File content as a UTF-8 string (text files) or base64-encoded string (binary files)'),
    filename: z.string().min(1).describe('Name of the file including extension (e.g., report.txt, image.png)'),
    is_base64: z
      .boolean()
      .optional()
      .describe(
        'Set to true when content is base64-encoded (e.g., binary files like images or PDFs). Defaults to false (UTF-8 text).',
      ),
    initial_comment: z.string().optional().describe('Message text to include with the file upload'),
  }),
  output: z.object({
    message: messageSchema.describe('The message containing the uploaded file'),
  }),
  handle: async params => {
    let blob: Blob;
    if (params.is_base64) {
      let binary: string;
      try {
        binary = atob(params.content);
      } catch {
        throw ToolError.validation('Invalid base64 content — ensure the content is valid base64-encoded data');
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes]);
    } else {
      blob = new Blob([params.content], { type: 'text/plain' });
    }

    const form = new FormData();
    form.append('files[0]', blob, params.filename);
    if (params.initial_comment) {
      form.append('payload_json', JSON.stringify({ content: params.initial_comment }));
    }

    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}/messages`, {
      method: 'POST',
      body: form,
    });
    return { message: mapMessage(data) };
  },
});
