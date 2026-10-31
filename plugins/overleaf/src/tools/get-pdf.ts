import { defineTool } from '@opentabs-dev/plugin-sdk';
import { compilePdf } from '../compile.js';
import { pdfResultSchema, projectInput } from './schemas.js';

export const getPdf = defineTool({
  name: 'get_pdf',
  displayName: 'Get PDF',
  description:
    'Obtain a fresh PDF from server-saved source with the existing main document/compiler settings. ' +
    'This is the only compilation entry point: it currently compiles on each call because cache freshness cannot be proven. ' +
    'Waits for the actual compile response, never polls an invented job endpoint, interrupts another compile, flushes editor text, ' +
    'or retries an ambiguous timeout. Returns a build-specific authenticated URL and bounded same-build LaTeX/Bib diagnostics. ' +
    'A failed build never returns an old PDF. Parsing and unavailable/truncated logs are explicit. ' +
    'Freshness refers to the compile snapshot, not unsynced text or an atomic snapshot at return time. ' +
    'Requires an authenticated editor tab. Compiles exceeding four minutes have an unknown outcome and a 13-minute retry guard.',
  summary: 'Compile saved source and return a current PDF URL',
  icon: 'file-down',
  group: 'Output',
  input: projectInput,
  output: pdfResultSchema,
  handle: async (params, context) => {
    context?.reportProgress({ message: 'Preparing a PDF from server-saved source' });
    const heartbeat = setInterval(
      () => context?.reportProgress({ message: 'Waiting for the Overleaf compile response and same-build logs' }),
      10_000,
    );
    try {
      return await compilePdf(params.project_id);
    } finally {
      clearInterval(heartbeat);
    }
  },
});
