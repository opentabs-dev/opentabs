import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { withDebugger } from './resource-commands.js';

const MAX_ISSUES = 100;

interface CdpIssue {
  code: string;
  details: Record<string, unknown>;
}

interface CleanIssue {
  code: string;
  severity: string;
  message: string;
  sourceFile: string | null;
  lineNumber: number | null;
}

type IssueCategory = 'mixedContent' | 'cors' | 'csp' | 'cookies' | 'deprecations' | 'generic';

const categorizeIssue = (code: string): IssueCategory => {
  if (code.includes('MixedContent')) return 'mixedContent';
  if (code.includes('CorsIssue') || code.includes('CrossOrigin')) return 'cors';
  if (code.includes('ContentSecurityPolicy')) return 'csp';
  if (code.includes('Cookie') || code.includes('SameSite')) return 'cookies';
  if (code.includes('Deprecation')) return 'deprecations';
  return 'generic';
};

const extractSeverity = (details: Record<string, unknown>): string => {
  for (const value of Object.values(details)) {
    if (typeof value === 'object' && value !== null && 'severity' in value) {
      const sev = (value as Record<string, unknown>).severity;
      if (typeof sev === 'string') return sev;
    }
  }
  return 'unknown';
};

const extractSourceLocation = (
  details: Record<string, unknown>,
): { sourceFile: string | null; lineNumber: number | null } => {
  for (const value of Object.values(details)) {
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      if (typeof obj.sourceFile === 'string' || typeof obj.url === 'string' || typeof obj.scriptId === 'string') {
        return {
          sourceFile:
            typeof obj.sourceFile === 'string' ? obj.sourceFile : typeof obj.url === 'string' ? obj.url : null,
          lineNumber:
            typeof obj.lineNumber === 'number' ? obj.lineNumber : typeof obj.line === 'number' ? obj.line : null,
        };
      }
    }
  }
  return { sourceFile: null, lineNumber: null };
};

const cleanIssue = (issue: CdpIssue): CleanIssue => {
  const location = extractSourceLocation(issue.details);
  return {
    code: issue.code,
    severity: extractSeverity(issue.details),
    message: issue.code
      .replace(/Issue$/, '')
      .replace(/([A-Z])/g, ' $1')
      .trim(),
    sourceFile: location.sourceFile,
    lineNumber: location.lineNumber,
  };
};

export const handleBrowserAuditPage = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const waitSeconds = typeof params.waitSeconds === 'number' ? Math.min(Math.max(params.waitSeconds, 1), 30) : 2;
    const waitMs = waitSeconds * 1000;

    const collectedIssues: CdpIssue[] = [];

    await withDebugger(tabId, async () => {
      const listener = (source: chrome.debugger.Debuggee, method: string, cdpParams?: object) => {
        if (source.tabId !== tabId || method !== 'Audits.issueAdded') return;
        const cdpRecord = cdpParams as Record<string, unknown> | undefined;
        const issue = cdpRecord?.issue as { code?: string; details?: Record<string, unknown> } | undefined;
        if (issue?.code && issue.details) {
          collectedIssues.push({ code: issue.code, details: issue.details });
        }
      };

      chrome.debugger.onEvent.addListener(listener);
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Audits.enable');
        await new Promise<void>(resolve => setTimeout(resolve, waitMs));
        await chrome.debugger.sendCommand({ tabId }, 'Audits.disable').catch(() => {});
      } finally {
        chrome.debugger.onEvent.removeListener(listener);
      }
    });

    const cleaned = collectedIssues.map(cleanIssue);
    const totalIssues = cleaned.length;
    const truncated = totalIssues > MAX_ISSUES;
    const issues = truncated ? cleaned.slice(0, MAX_ISSUES) : cleaned;

    const grouped: Record<IssueCategory, CleanIssue[]> = {
      mixedContent: [],
      cors: [],
      csp: [],
      cookies: [],
      deprecations: [],
      generic: [],
    };

    for (const issue of issues) {
      const category = categorizeIssue(issue.code);
      grouped[category].push(issue);
    }

    const summary: Record<IssueCategory, number> = {
      mixedContent: grouped.mixedContent.length,
      cors: grouped.cors.length,
      csp: grouped.csp.length,
      cookies: grouped.cookies.length,
      deprecations: grouped.deprecations.length,
      generic: grouped.generic.length,
    };

    sendSuccessResult(id, {
      issues: grouped,
      summary,
      totalIssues,
      truncated,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
