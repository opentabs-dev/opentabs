import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getProject, readEntity } from '../overleaf-api.js';
import { objectId, projectInput } from './schemas.js';

export const readFile = defineTool({
  name: 'read_file',
  displayName: 'Read File',
  description:
    'Read server-current saved UTF-8 text by project and file ID, not unsynced editor contents. ' +
    'Line numbers are one-based and inclusive. Reads at most 1 MiB and returns at most 2,000 lines / 100,000 characters; ' +
    'truncation and unknown total line counts are explicit. Rejects binary content. Never compiles or flushes editor buffers.',
  summary: 'Read saved text with an optional line range',
  icon: 'file-text',
  group: 'Source',
  input: projectInput.extend({
    file_id: objectId.describe('Document or stored text-file ID from get_project'),
    start_line: z.number().int().positive().default(1).describe('First line to return, inclusive'),
    end_line: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Last line to return, inclusive; defaults to a 2,000-line page'),
  }),
  output: z.object({
    project_id: objectId.describe('Requested project ID'),
    file_id: objectId.describe('Requested file ID'),
    path: z.string().describe('Project-relative file path'),
    type: z.enum(['doc', 'file']).describe('Editable document or stored file'),
    content: z.string().describe('Server-saved text for the returned range'),
    start_line: z.number().int().positive().describe('First returned line, inclusive'),
    end_line: z.number().int().nonnegative().describe('Last returned line, inclusive; zero for no returned lines'),
    total_lines: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe('Full line count, or null when the byte limit was reached'),
    truncated: z.boolean().describe('Whether any file content was omitted'),
    truncation_reasons: z.array(z.string()).describe('Byte, range, line, or character limits that omitted content'),
    source: z.literal('server_saved').describe('Unsynced client editor text is not included'),
  }),
  handle: async params => {
    if (params.end_line !== undefined && params.end_line < params.start_line) {
      throw ToolError.validation('end_line must be greater than or equal to start_line.');
    }
    const project = await getProject(params.project_id);
    const entity = project.entities.find(file => file.id === params.file_id);
    if (!entity) throw ToolError.notFound('The requested file is not in this project.');
    if (entity.type === 'folder') throw ToolError.validation('A folder cannot be read as a text file.');
    const result = await readEntity(params.project_id, entity);
    const lines = result.text.split('\n');
    if (result.truncated) lines.pop();
    if (params.start_line > lines.length) {
      throw ToolError.validation(
        result.truncated
          ? 'start_line is beyond the readable byte limit.'
          : 'start_line is beyond the end of the file.',
      );
    }
    const requestedEnd = params.end_line ?? params.start_line + 1_999;
    const end = Math.min(requestedEnd, params.start_line + 1_999, lines.length);
    const selected = lines.slice(params.start_line - 1, end);
    let content = '';
    let returnedLines = 0;
    for (const line of selected) {
      const next = returnedLines ? `\n${line}` : line;
      if (content.length + next.length > 100_000) break;
      content += next;
      returnedLines++;
    }
    if (!returnedLines && selected.length) {
      throw ToolError.validation('A requested line exceeds the 100,000-character output limit.');
    }
    const reasons: string[] = [];
    if (result.truncated) reasons.push('file_byte_limit');
    if (params.start_line > 1 || end < lines.length) reasons.push('line_range');
    if (requestedEnd > params.start_line + 1_999 && end < Math.min(requestedEnd, lines.length))
      reasons.push('line_limit');
    if (returnedLines < selected.length) reasons.push('character_limit');
    return {
      project_id: params.project_id,
      file_id: entity.id,
      path: entity.path,
      type: entity.type,
      content,
      start_line: params.start_line,
      end_line: returnedLines ? params.start_line + returnedLines - 1 : 0,
      total_lines: result.truncated ? null : lines.length,
      truncated: reasons.length > 0,
      truncation_reasons: reasons,
      source: 'server_saved' as const,
    };
  },
});
