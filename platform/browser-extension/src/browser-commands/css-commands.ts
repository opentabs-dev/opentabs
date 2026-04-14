import { requireSelector, requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { withDebugger } from './resource-commands.js';

interface CdpComputedStyle {
  name: string;
  value: string;
}

interface CdpCssProperty {
  name: string;
  value: string;
}

interface CdpRuleMatch {
  rule: {
    selectorList: { selectors: Array<{ text: string }> };
    style: { cssProperties: CdpCssProperty[]; shorthandEntries?: unknown[] };
    origin: string;
    styleSheetId?: string;
  };
}

interface CdpMatchedStyles {
  matchedCSSRules?: CdpRuleMatch[];
}

interface CdpRuleUsage {
  styleSheetId: string;
  startOffset: number;
  endOffset: number;
  used: boolean;
}

export const handleBrowserGetElementStyles = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
      await chrome.debugger.sendCommand({ tabId }, 'CSS.enable');

      try {
        const docResult = (await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument')) as {
          root: { nodeId: number };
        };
        const queryResult = (await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: docResult.root.nodeId,
          selector,
        })) as { nodeId: number };

        if (!queryResult.nodeId || queryResult.nodeId === 0) {
          sendErrorResult(id, new Error(`No element found matching selector: ${selector}`));
          return;
        }

        const nodeId = queryResult.nodeId;

        const computedResult = (await chrome.debugger.sendCommand({ tabId }, 'CSS.getComputedStyleForNode', {
          nodeId,
        })) as { computedStyle: CdpComputedStyle[] };

        const computed: Record<string, string> = {};
        for (const entry of computedResult.computedStyle) {
          if (entry.value !== '') {
            computed[entry.name] = entry.value;
          }
        }

        const matchedResult = (await chrome.debugger.sendCommand({ tabId }, 'CSS.getMatchedStylesForNode', {
          nodeId,
        })) as CdpMatchedStyles;

        const matchedRules: Array<{
          selector: string;
          properties: Record<string, string>;
          origin: string;
          styleSheetId?: string;
        }> = [];

        if (matchedResult.matchedCSSRules) {
          for (const match of matchedResult.matchedCSSRules) {
            const selectorText = match.rule.selectorList.selectors.map(s => s.text).join(', ');
            const properties: Record<string, string> = {};
            for (const prop of match.rule.style.cssProperties) {
              if (prop.value !== '') {
                properties[prop.name] = prop.value;
              }
            }
            matchedRules.push({
              selector: selectorText,
              properties,
              origin: match.rule.origin,
              ...(match.rule.styleSheetId ? { styleSheetId: match.rule.styleSheetId } : {}),
            });
          }
        }

        sendSuccessResult(id, { tabId, selector, computed, matchedRules });
      } finally {
        await chrome.debugger.sendCommand({ tabId }, 'CSS.disable').catch(() => {});
        await chrome.debugger.sendCommand({ tabId }, 'DOM.disable').catch(() => {});
      }
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserForcePseudoState = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;

    const rawPseudoClasses = Array.isArray(params.pseudoClasses) ? params.pseudoClasses : [];
    const validPseudo = new Set([':hover', ':focus', ':active', ':visited', ':focus-within', ':focus-visible']);
    const pseudoClasses = rawPseudoClasses.filter((p): p is string => typeof p === 'string' && validPseudo.has(p));

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
      await chrome.debugger.sendCommand({ tabId }, 'CSS.enable');

      try {
        const docResult = (await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument')) as {
          root: { nodeId: number };
        };
        const queryResult = (await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: docResult.root.nodeId,
          selector,
        })) as { nodeId: number };

        if (!queryResult.nodeId || queryResult.nodeId === 0) {
          sendErrorResult(id, new Error(`No element found matching selector: ${selector}`));
          return;
        }

        await chrome.debugger.sendCommand({ tabId }, 'CSS.forcePseudoState', {
          nodeId: queryResult.nodeId,
          forcedPseudoClasses: pseudoClasses,
        });

        sendSuccessResult(id, {
          tabId,
          selector,
          forcedPseudoClasses: pseudoClasses,
        });
      } finally {
        await chrome.debugger.sendCommand({ tabId }, 'CSS.disable').catch(() => {});
        await chrome.debugger.sendCommand({ tabId }, 'DOM.disable').catch(() => {});
      }
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserGetCssCoverage = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'CSS.enable');

      try {
        await chrome.debugger.sendCommand({ tabId }, 'CSS.startRuleUsageTracking');

        // Brief wait to capture page activity and rule usage
        await new Promise<void>(resolve => setTimeout(resolve, 1500));

        const stopResult = (await chrome.debugger.sendCommand({ tabId }, 'CSS.stopRuleUsageTracking')) as {
          ruleUsage: CdpRuleUsage[];
        };

        // Group usage by stylesheet
        const sheetStats = new Map<string, { used: number; total: number }>();
        for (const rule of stopResult.ruleUsage) {
          const sheetId = rule.styleSheetId;
          let stats = sheetStats.get(sheetId);
          if (!stats) {
            stats = { used: 0, total: 0 };
            sheetStats.set(sheetId, stats);
          }
          stats.total++;
          if (rule.used) stats.used++;
        }

        const stylesheets: Array<{
          styleSheetId: string;
          usedRules: number;
          totalRules: number;
          usagePercent: number;
        }> = [];

        let totalUsed = 0;
        let totalRules = 0;

        for (const [sheetId, stats] of sheetStats) {
          const usagePercent = stats.total > 0 ? Math.round((stats.used / stats.total) * 100) : 0;
          stylesheets.push({
            styleSheetId: sheetId,
            usedRules: stats.used,
            totalRules: stats.total,
            usagePercent,
          });
          totalUsed += stats.used;
          totalRules += stats.total;
        }

        const overallUsage = totalRules > 0 ? Math.round((totalUsed / totalRules) * 100) : 0;

        sendSuccessResult(id, {
          tabId,
          stylesheets,
          summary: {
            totalStylesheets: stylesheets.length,
            totalRules,
            usedRules: totalUsed,
            unusedRules: totalRules - totalUsed,
            overallUsagePercent: overallUsage,
          },
        });
      } finally {
        await chrome.debugger.sendCommand({ tabId }, 'CSS.disable').catch(() => {});
      }
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
