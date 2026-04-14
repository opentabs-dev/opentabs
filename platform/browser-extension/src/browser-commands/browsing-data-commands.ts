import { sendErrorResult, sendSuccessResult, sendValidationError } from './helpers.js';

/** Clears browsing data for a specific origin. */
export const handleBrowserClearSiteData = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const origin = params.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
      sendValidationError(id, 'Missing or invalid origin parameter');
      return;
    }

    // Validate the origin is a valid URL
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      sendValidationError(id, 'Invalid origin URL format');
      return;
    }

    // Use just the origin portion (protocol + host)
    const normalizedOrigin = parsedOrigin.origin;

    const cookies = params.cookies !== false;
    const localStorage = params.localStorage !== false;
    const cache = params.cache === true;
    const indexedDB = params.indexedDB === true;
    const serviceWorkers = params.serviceWorkers === true;

    await chrome.browsingData.remove(
      { origins: [normalizedOrigin] },
      {
        cookies,
        localStorage,
        cache,
        indexedDB,
        serviceWorkers,
      },
    );

    sendSuccessResult(id, {
      origin: normalizedOrigin,
      cleared: {
        cookies,
        localStorage,
        cache,
        indexedDB,
        serviceWorkers,
      },
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
