import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export const projectInput = z.object({
  project_id: objectId.describe('Explicit Overleaf project ID, obtained from list_projects or the project URL'),
});

export const entitySchema = z.object({
  id: objectId.describe('Entity ID; use this as file_id for documents and stored text files'),
  parent_id: objectId.nullable().describe('Parent folder ID, or null for the root folder'),
  name: z.string().describe('Entity name'),
  path: z.string().describe('Project-relative path; the root folder has an empty path'),
  type: z.enum(['folder', 'doc', 'file']).describe('Folder, editable text document, or stored file'),
});
export type Entity = z.infer<typeof entitySchema>;

export const projectSchema = z.object({
  id: objectId.describe('Project ID'),
  name: z.string().describe('Project name'),
  description: z.string().nullable().describe('Project description when available'),
  permission_level: z.string().describe('Permission level reported by the authenticated project join'),
  owner_id: objectId.nullable().describe('Project owner ID when available'),
  public_access_level: z.string().nullable().describe('Public access level reported by Overleaf'),
  main_document_id: objectId.nullable().describe('Configured main document ID, or null if unset'),
  compiler: z.string().nullable().describe('Configured compiler; null means the server default'),
  tex_live_version: z.string().nullable().describe('Configured TeX Live image name when available'),
  png_to_pdf: z.boolean().nullable().describe('Existing PNG optimization setting when available'),
  entities: z
    .array(entitySchema)
    .describe('Complete ID-bearing flat tree, including folders; limited to 2,000 entities'),
});
export type Project = z.infer<typeof projectSchema>;

export const diagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'typesetting']).describe('Diagnostic severity'),
  source: z.enum(['latex', 'bibtex', 'biber', 'validation']).describe('Diagnostic producer'),
  log_file: z.string().nullable().describe('Build output log path, or null for validation problems'),
  file: z.string().nullable().describe('Source filename when present in the diagnostic'),
  line: z.number().int().positive().nullable().describe('One-based source line when available'),
  message: z.string().describe('Diagnostic message, limited to 1,000 characters'),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const logSchema = z.object({
  path: z.string().describe('Build output log path'),
  status: z
    .enum(['partial', 'unavailable', 'unparsed'])
    .describe('Pattern extraction is partial, never a full log analysis'),
  reason: z.string().describe('Extraction limitation or reason the log could not be read'),
  truncated: z.boolean().describe('Whether the log exceeded its byte limit'),
  unparsed_excerpt: z.string().nullable().describe('Up to 2,000 characters when no diagnostics could be parsed'),
});
export type LogResult = z.infer<typeof logSchema>;

export const pdfResultSchema = z.object({
  project_id: objectId.describe('Requested project ID'),
  success: z.boolean().describe('True only for a successful fresh compile with a build-specific PDF'),
  status: z.string().describe('Overleaf compile status, or a local preflight failure status'),
  failure_reason: z.string().nullable().describe('Why no current PDF can be returned'),
  compilation_requested: z.boolean().describe('Whether a compile POST was sent'),
  compilation_ran: z.boolean().nullable().describe('Whether compilation ran; null for an unrecognized server status'),
  build_id: z.string().nullable().describe('Build ID from the output files, not an assumed top-level field'),
  pdf_url: z.string().nullable().describe('Build-specific authenticated browser URL, never a public sharing link'),
  freshness: z.string().describe('Freshness applies to the server compile snapshot, not unsynced text or later edits'),
  diagnostics: z.array(diagnosticSchema).describe('Up to 100 structured LaTeX and bibliography diagnostics'),
  diagnostics_truncated: z.boolean().describe('Whether the diagnostic limit was reached'),
  logs: z.array(logSchema).describe('Per-log availability, truncation, and parsing limitations'),
  logs_omitted: z.number().int().nonnegative().describe('Number of logs omitted by the log limit or an aborted read'),
});
export type PdfResult = z.infer<typeof pdfResultSchema>;
