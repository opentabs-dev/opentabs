import { sendErrorResult, sendSuccessResult } from './helpers.js';

/** Returns recently closed tabs and windows. */
export const handleBrowserGetRecentlyClosed = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const maxResults =
      typeof params.maxResults === 'number' &&
      Number.isInteger(params.maxResults) &&
      params.maxResults > 0 &&
      params.maxResults <= 25
        ? params.maxResults
        : 25;

    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults });

    const result = sessions.map(session => {
      if (session.tab) {
        return {
          type: 'tab' as const,
          sessionId: session.tab.sessionId,
          closedAt: session.lastModified ? new Date(session.lastModified * 1000).toISOString() : undefined,
          title: session.tab.title,
          url: session.tab.url,
        };
      }
      return {
        type: 'window' as const,
        sessionId: session.window?.sessionId,
        closedAt: session.lastModified ? new Date(session.lastModified * 1000).toISOString() : undefined,
        tabCount: session.window?.tabs?.length ?? 0,
      };
    });

    sendSuccessResult(id, { sessions: result });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Restores a recently closed tab or window by session ID. */
export const handleBrowserRestoreSession = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const sessionId = params.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      sendErrorResult(id, new Error('Missing or invalid sessionId parameter'));
      return;
    }

    const restored = await chrome.sessions.restore(sessionId);

    if (restored.tab) {
      sendSuccessResult(id, {
        type: 'tab',
        tabId: restored.tab.id,
        title: restored.tab.title,
        url: restored.tab.url,
      });
    } else if (restored.window) {
      sendSuccessResult(id, {
        type: 'window',
        windowId: restored.window.id,
        tabCount: restored.window.tabs?.length ?? 0,
      });
    } else {
      sendSuccessResult(id, { restored: true });
    }
  } catch (err) {
    sendErrorResult(id, err);
  }
};
