import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const uploadFile = defineTool({
  name: 'upload_file',
  description: 'Upload a file to a Slack channel (content as text or base64)',
  input: z.object({
    channels: z.string().describe('Comma-separated channel IDs to share the file to (e.g., C01234567)'),
    content: z.string().describe('File content as a string (text files) or base64-encoded string (binary files)'),
    filename: z.string().describe('Name of the file including extension (e.g., report.txt, image.png)'),
    title: z.string().optional().describe('Title for the file displayed in Slack'),
    initial_comment: z.string().optional().describe('Message text to include with the file upload'),
    filetype: z.string().optional().describe('Slack file type identifier (e.g., txt, png, pdf) — auto-detected if omitted'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the file was uploaded successfully'),
    file: z.object({
      id: z.string().describe('File ID'),
      name: z.string().describe('File name'),
      title: z.string().describe('File title'),
      permalink: z.string().describe('Permanent link to the file in Slack'),
    }).describe('Uploaded file metadata'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      channels: params.channels,
      content: params.content,
      filename: params.filename,
    }
    if (params.title) body.title = params.title
    if (params.initial_comment) body.initial_comment = params.initial_comment
    if (params.filetype) body.filetype = params.filetype
    const res = await fetch('/api/files.upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to upload file', data.error ?? 'unknown_error')
    }
    return {
      ok: data.ok,
      file: {
        id: data.file.id,
        name: data.file.name,
        title: data.file.title ?? data.file.name,
        permalink: data.file.permalink ?? '',
      },
    }
  },
})
