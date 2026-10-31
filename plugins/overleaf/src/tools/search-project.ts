import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getProject, isSearchable, MAX_FILE_BYTES, readEntity, requestError } from '../overleaf-api.js';
import { objectId, projectInput } from './schemas.js';

const MAX_SEARCH_BYTES = 10 * MAX_FILE_BYTES;

const issueSchema = z.object({
  file_id: objectId.describe('Skipped or failed file ID'),
  path: z.string().describe('Project-relative path'),
  reason: z.string().describe('Skip reason or structured failure category; no source content'),
});

export const searchProject = defineTool({
  name: 'search_project',
  displayName: 'Search Project',
  description:
    'Search server-saved source and bibliography text for a literal single-line query. ' +
    'Returns one match per matching line, with file IDs, paths, line numbers, and bounded excerpts. ' +
    'Scans at most 100 files, 1 MiB per file, and 10 MiB overall. Reports incomplete coverage, skipped/failed files, ' +
    'and omitted issue details explicitly. The path filter is a case-sensitive literal substring, not a glob. ' +
    'Requires an authenticated editor tab. Never compiles, joins documents, or flushes editor buffers.',
  summary: 'Search saved source with explicit coverage limits',
  icon: 'search',
  group: 'Source',
  input: projectInput.extend({
    query: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]+$/)
      .describe('Literal nonempty single-line text, not a regular expression'),
    path_filter: z
      .string()
      .max(512)
      .optional()
      .describe('Optional case-sensitive literal substring of project-relative paths'),
    case_sensitive: z.boolean().default(false).describe('Whether the query comparison is case-sensitive'),
    max_matches: z.number().int().min(1).max(100).default(50).describe('Maximum matching lines to return'),
    max_files: z.number().int().min(1).max(100).default(50).describe('Maximum source files to scan'),
  }),
  output: z.object({
    project_id: objectId.describe('Searched project ID'),
    matches: z
      .array(
        z.object({
          file_id: objectId.describe('Matching file ID'),
          path: z.string().describe('Project-relative path'),
          line: z.number().int().positive().describe('One-based matching line'),
          excerpt: z.string().describe('Up to 320 characters around the first match on the line'),
          excerpt_truncated: z.boolean().describe('Whether part of the matching line was omitted'),
        }),
      )
      .describe('Bounded source and bibliography matches'),
    complete: z.boolean().describe('Whether every eligible file in the requested path scope was fully searched'),
    scanned_files: z.number().int().nonnegative().describe('Files fully or partially scanned'),
    eligible_files: z.number().int().nonnegative().describe('Text/source candidates matching the path filter'),
    skipped_files: z.number().int().nonnegative().describe('Files excluded by path/type or not scanned due to limits'),
    failed_files: z.number().int().nonnegative().describe('Files whose content could not be read'),
    issues: z.array(issueSchema).describe('Up to 100 skipped, limited, or failed file details'),
    issues_omitted: z.number().int().nonnegative().describe('Issue details omitted beyond the 100-entry limit'),
    source: z.literal('server_saved').describe('Files are read independently, not as an atomic project snapshot'),
  }),
  handle: async (params, context) => {
    const heartbeat = setInterval(
      () => context?.reportProgress({ message: 'Searching server-saved source files' }),
      10_000,
    );
    try {
      const project = await getProject(params.project_id);
      const matches: {
        file_id: string;
        path: string;
        line: number;
        excerpt: string;
        excerpt_truncated: boolean;
      }[] = [];
      const issues: z.infer<typeof issueSchema>[] = [];
      let issueCount = 0;
      let skipped = 0;
      let failed = 0;
      let scanned = 0;
      let bytes = 0;
      let complete = true;
      const candidates = project.entities.filter(entity => entity.type !== 'folder');
      const eligible = candidates.filter(
        entity => isSearchable(entity) && (!params.path_filter || entity.path.includes(params.path_filter)),
      );
      const issue = (file: { id: string; path: string }, reason: string) => {
        issueCount++;
        if (issues.length < 100) issues.push({ file_id: file.id, path: file.path, reason });
      };
      for (const entity of candidates) {
        if (params.path_filter && !entity.path.includes(params.path_filter)) {
          skipped++;
          issue(entity, 'path_filter');
        } else if (!isSearchable(entity)) {
          skipped++;
          issue(entity, 'non_source_or_binary');
        }
      }
      const signal = AbortSignal.timeout(120_000);
      const needle = params.case_sensitive ? params.query : params.query.toLowerCase();
      for (const entity of eligible) {
        if (scanned + failed >= params.max_files || matches.length >= params.max_matches || bytes >= MAX_SEARCH_BYTES) {
          skipped++;
          complete = false;
          issue(entity, matches.length >= params.max_matches ? 'match_limit' : 'scan_limit');
          continue;
        }
        try {
          const byteLimit = Math.min(MAX_FILE_BYTES, MAX_SEARCH_BYTES - bytes);
          bytes += byteLimit;
          const result = await readEntity(params.project_id, entity, signal, byteLimit);
          bytes -= byteLimit - result.bytes;
          scanned++;
          if (result.truncated) {
            complete = false;
            issue(entity, byteLimit < MAX_FILE_BYTES ? 'project_byte_limit' : 'file_byte_limit');
          }
          const lines = result.text.split('\n');
          if (result.truncated) lines.pop();
          for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (line === undefined) continue;
            const searchableLine = params.case_sensitive ? line : line.toLowerCase();
            const position = searchableLine.indexOf(needle);
            if (position === -1) continue;
            const start = Math.max(0, position - 100);
            matches.push({
              file_id: entity.id,
              path: entity.path,
              line: index + 1,
              excerpt: line.slice(start, start + 320),
              excerpt_truncated: start > 0 || line.length > start + 320,
            });
            if (matches.length >= params.max_matches) {
              if (index < lines.length - 1) {
                complete = false;
                issue(entity, 'match_limit_within_file');
              }
              break;
            }
          }
          context?.reportProgress({
            progress: scanned + failed,
            total: Math.min(eligible.length, params.max_files),
            message: 'Searching server-saved source files',
          });
        } catch (error) {
          const classified = requestError(error, 'Overleaf source search');
          if (['auth', 'rate_limit', 'timeout'].includes(classified.category ?? '') || signal.aborted) {
            if (signal.aborted) throw ToolError.timeout('Overleaf source search exceeded its two-minute limit.');
            throw classified;
          }
          failed++;
          complete = false;
          issue(entity, classified.category ?? classified.code);
        }
      }
      return {
        project_id: params.project_id,
        matches,
        complete,
        scanned_files: scanned,
        eligible_files: eligible.length,
        skipped_files: skipped,
        failed_files: failed,
        issues,
        issues_omitted: issueCount - issues.length,
        source: 'server_saved' as const,
      };
    } finally {
      clearInterval(heartbeat);
    }
  },
});
