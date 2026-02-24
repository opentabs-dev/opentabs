import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { CDP_VERSION } from '../constants.js';
import { JSONRPC_INVALID_PARAMS } from '../json-rpc-errors.js';
import { sendToServer } from '../messaging.js';
import { isCapturing } from '../network-capture.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { toErrorMessage } from '@opentabs-dev/shared';

export interface CdpFrame {
  id: string;
  url: string;
  securityOrigin: string;
}

export interface CdpResource {
  url: string;
  type: string;
  mimeType: string;
  contentLength?: number;
}

export interface CdpFrameResourceTree {
  frame: CdpFrame;
  childFrames?: CdpFrameResourceTree[];
  resources: CdpResource[];
}

/** MIME types that represent text content and should be decoded from base64 */
export const TEXT_MIME_PREFIXES = ['text/'];
export const TEXT_MIME_EXACT = new Set([
  'application/javascript',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/x-javascript',
  'application/ecmascript',
]);

export const isTextMimeType = (mimeType: string): boolean => {
  if (TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return true;
  return TEXT_MIME_EXACT.has(mimeType);
};

/**
 * Find the frameId that owns a resource URL by walking the CDP resource tree.
 * Returns the frame ID or null if the resource is not found in any frame.
 */
export const findFrameForResource = (
  tree: CdpFrameResourceTree,
  targetUrl: string,
): { frameId: string; mimeType: string } | null => {
  for (const r of tree.resources) {
    if (r.url === targetUrl) {
      return { frameId: tree.frame.id, mimeType: r.mimeType };
    }
  }
  if (tree.childFrames) {
    for (const child of tree.childFrames) {
      const found = findFrameForResource(child, targetUrl);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Manages Chrome debugger attach/detach lifecycle for commands that need CDP access.
 * Reuses an existing debugger session (from network capture) if one is active,
 * otherwise temporarily attaches and detaches in the finally block.
 */
export const withDebugger = async <T>(tabId: number, fn: () => Promise<T>): Promise<T> => {
  const alreadyAttached = isCapturing(tabId);
  if (!alreadyAttached) {
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (err) {
      const msg = toErrorMessage(err);
      throw new Error(
        msg.includes('Another debugger')
          ? 'Failed to attach debugger — another debugger (e.g., DevTools) is already attached. ' +
              'Close DevTools or enable network capture first (browser_enable_network_capture) ' +
              'so this tool can reuse the existing debugger session.'
          : `Failed to attach debugger: ${sanitizeErrorMessage(msg)}`,
      );
    }
  }
  try {
    return await fn();
  } finally {
    if (!alreadyAttached) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }
};

export const handleBrowserListResources = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const typeFilter = typeof params.type === 'string' ? params.type : undefined;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      const treeResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceTree')) as {
        frameTree: CdpFrameResourceTree;
      };

      const frames: Array<{ url: string; securityOrigin: string }> = [];
      const resources: Array<{ url: string; type: string; mimeType: string; contentLength: number }> = [];

      const walk = (node: CdpFrameResourceTree): void => {
        frames.push({ url: node.frame.url, securityOrigin: node.frame.securityOrigin });
        for (const r of node.resources) {
          if (typeFilter && r.type !== typeFilter) continue;
          resources.push({
            url: r.url,
            type: r.type,
            mimeType: r.mimeType,
            contentLength: r.contentLength ?? -1,
          });
        }
        if (node.childFrames) {
          for (const child of node.childFrames) walk(child);
        }
      };

      walk(treeResult.frameTree);

      resources.sort((a, b) => a.type.localeCompare(b.type) || a.url.localeCompare(b.url));

      sendSuccessResult(id, { frames, resources });
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserGetResourceContent = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const url = params.url;
    if (typeof url !== 'string' || url.length === 0) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid url parameter' },
        id,
      });
      return;
    }
    const maxLength = typeof params.maxLength === 'number' ? params.maxLength : 500_000;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

      // Get the resource tree to find which frame owns the requested resource
      const treeResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceTree')) as {
        frameTree: CdpFrameResourceTree;
      };

      const match = findFrameForResource(treeResult.frameTree, url);
      if (!match) {
        sendToServer({
          jsonrpc: '2.0',
          error: {
            code: JSONRPC_INVALID_PARAMS,
            message: `Resource not found in page: ${url}. Use browser_list_resources to find valid resource URLs.`,
          },
          id,
        });
        return;
      }

      const contentResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceContent', {
        frameId: match.frameId,
        url,
      })) as { content: string; base64Encoded: boolean };

      let content = contentResult.content;
      let base64Encoded = contentResult.base64Encoded;

      // Decode base64 text resources to UTF-8 strings
      if (base64Encoded && isTextMimeType(match.mimeType)) {
        try {
          content = new TextDecoder().decode(Uint8Array.from(atob(content), c => c.charCodeAt(0)));
          base64Encoded = false;
        } catch {
          // Decoding failed — return base64 as-is
        }
      }

      // Truncate text content that exceeds maxLength
      let truncated = false;
      if (!base64Encoded && content.length > maxLength) {
        content = content.slice(0, maxLength) + '... (truncated)';
        truncated = true;
      }

      sendSuccessResult(id, { url, content, base64Encoded, mimeType: match.mimeType, truncated });
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
