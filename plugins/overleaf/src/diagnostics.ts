import type { Diagnostic } from './tools/schemas.js';

export const parseDiagnostics = (text: string, logPath: string): Diagnostic[] => {
  const entries: Diagnostic[] = [];
  const lines = text.split(/\r?\n/);
  const bibliography = logPath.endsWith('.blg');
  for (let index = 0; index < lines.length && entries.length < 101; index++) {
    const line = lines[index] ?? '';
    let message: string | undefined;
    let file: string | null = null;
    let sourceLine: number | null = null;
    let severity: Diagnostic['severity'] = 'error';
    let source: Diagnostic['source'] = bibliography ? 'bibtex' : 'latex';
    const fileError = /^(.+\.(?:tex|ltx|sty|cls|bib|bbl)):(\d+):\s*(.+)$/.exec(line);
    const latexError = /^!\s*(.+)$/.exec(line);
    const warning = /^(?:LaTeX(?: Font)?|Package \S+|Class \S+)\s+Warning:\s*(.+)$/.exec(line);
    const typesetting = /^(?:Overfull|Underfull) \\[hv]box\b.*$/.exec(line);
    const biber = /\b(WARN|ERROR|FATAL)\s+-\s+(.+)$/.exec(line);
    if (fileError) {
      file = fileError[1] ?? null;
      sourceLine = Number(fileError[2]);
      message = fileError[3];
      severity = /warning/i.test(message ?? '') ? 'warning' : 'error';
    } else if (latexError) {
      message = latexError[1];
      for (let next = index + 1; next <= Math.min(index + 8, lines.length - 1); next++) {
        const location = /^l\.(\d+)\b/.exec(lines[next] ?? '');
        if (location) {
          sourceLine = Number(location[1]);
          break;
        }
      }
    } else if (warning) {
      message = warning[1];
      severity = 'warning';
      const location = /on input line (\d+)/.exec(message ?? '');
      if (location) sourceLine = Number(location[1]);
    } else if (typesetting) {
      message = line;
      severity = 'typesetting';
      const location = /at lines? (\d+)/.exec(line);
      if (location) sourceLine = Number(location[1]);
    } else if (bibliography && biber) {
      source = 'biber';
      severity = biber[1] === 'WARN' ? 'warning' : 'error';
      message = biber[2];
    } else if (bibliography && /^Warning--/.test(line)) {
      message = line.replace(/^Warning--/, '');
      severity = 'warning';
    } else if (
      bibliography &&
      /^(?:I couldn't |I found no |Repeated entry|Illegal, another |You're missing |I was expecting )/.test(line)
    ) {
      message = line;
    }
    if (!message) continue;
    const bibLocation = /(?:---|\s)line (\d+) of file (.+)$/.exec(message);
    if (bibLocation) {
      sourceLine = Number(bibLocation[1]);
      file = bibLocation[2] ?? null;
    }
    entries.push({
      severity,
      source,
      log_file: logPath,
      file,
      line: sourceLine !== null && sourceLine > 0 && Number.isSafeInteger(sourceLine) ? sourceLine : null,
      message: message.slice(0, 1_000),
    });
  }
  return entries;
};
