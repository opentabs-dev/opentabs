import { extractScriptResult, requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { TEXT_PREVIEW_MAX_LENGTH } from '../constants.js';
import { JSONRPC_INVALID_PARAMS } from '../json-rpc-errors.js';
import { sendToServer } from '../messaging.js';

export const handleBrowserScroll = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = typeof params.selector === 'string' && params.selector.length > 0 ? params.selector : null;
    const direction = typeof params.direction === 'string' ? params.direction : null;
    if (
      direction !== null &&
      direction !== 'up' &&
      direction !== 'down' &&
      direction !== 'left' &&
      direction !== 'right'
    ) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: JSONRPC_INVALID_PARAMS,
          message: `Invalid direction: "${direction}". Must be one of: up, down, left, right`,
        },
        id,
      });
      return;
    }
    const distance = typeof params.distance === 'number' ? params.distance : null;
    const position =
      typeof params.position === 'object' && params.position !== null
        ? (params.position as Record<string, unknown>)
        : null;
    const container = typeof params.container === 'string' && params.container.length > 0 ? params.container : null;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (
        sel: string | null,
        dir: string | null,
        dist: number | null,
        pos: { x?: number; y?: number } | null,
        ctr: string | null,
        maxPreview: number,
      ) => {
        // Resolve scroll target (container or page)
        let scrollEl: Element | null = null;
        if (ctr) {
          scrollEl = document.querySelector(ctr);
          if (!scrollEl) return { error: `Container not found: ${ctr}` };
        }

        // Helper to get scroll metrics from the scroll target
        const getMetrics = () => {
          if (scrollEl) {
            return {
              scrollPosition: { x: scrollEl.scrollLeft, y: scrollEl.scrollTop },
              scrollSize: { width: scrollEl.scrollWidth, height: scrollEl.scrollHeight },
              viewportSize: { width: scrollEl.clientWidth, height: scrollEl.clientHeight },
            };
          }
          return {
            scrollPosition: { x: window.scrollX, y: window.scrollY },
            scrollSize: {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            },
            viewportSize: { width: window.innerWidth, height: window.innerHeight },
          };
        };

        // Mode 1: scroll element into view
        if (sel) {
          const el = document.querySelector(sel);
          if (!el) return { error: `Element not found: ${sel}` };
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const text = (el.textContent || '').trim().slice(0, maxPreview);
          return {
            scrolledTo: { tagName: el.tagName.toLowerCase(), text },
            ...getMetrics(),
          };
        }

        // Mode 2: relative scroll by direction
        if (dir) {
          const metrics = getMetrics();
          const defaultVertical = metrics.viewportSize.height;
          const defaultHorizontal = metrics.viewportSize.width;
          let dx = 0;
          let dy = 0;

          if (dir === 'down') dy = dist ?? defaultVertical;
          else if (dir === 'up') dy = -(dist ?? defaultVertical);
          else if (dir === 'right') dx = dist ?? defaultHorizontal;
          else if (dir === 'left') dx = -(dist ?? defaultHorizontal);

          if (scrollEl) {
            scrollEl.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          } else {
            window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
          }

          return getMetrics();
        }

        // Mode 3: absolute scroll to position
        if (pos) {
          const opts: ScrollToOptions = { behavior: 'instant' };
          if (pos.x !== undefined) opts.left = pos.x;
          if (pos.y !== undefined) opts.top = pos.y;

          if (scrollEl) {
            scrollEl.scrollTo(opts);
          } else {
            window.scrollTo(opts);
          }

          return getMetrics();
        }

        // No scroll target specified — return current position
        return getMetrics();
      },
      args: [
        selector,
        direction,
        distance,
        position
          ? {
              x: position.x as number | undefined,
              y: position.y as number | undefined,
            }
          : null,
        container,
        TEXT_PREVIEW_MAX_LENGTH,
      ],
    });

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};
