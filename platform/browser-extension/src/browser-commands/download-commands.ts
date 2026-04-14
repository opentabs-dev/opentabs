import { sendErrorResult, sendSuccessResult, sendValidationError } from './helpers.js';

/** Valid chrome.downloads.State values */
const VALID_DOWNLOAD_STATES = new Set(['in_progress', 'interrupted', 'complete']);

/** Initiates a file download and returns the download ID. */
export const handleBrowserDownloadFile = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const url = params.url;
    if (typeof url !== 'string' || url.length === 0) {
      sendValidationError(id, 'Missing or invalid url parameter');
      return;
    }

    const options: chrome.downloads.DownloadOptions = { url };

    if (typeof params.filename === 'string' && params.filename.length > 0) {
      options.filename = params.filename;
    }

    options.saveAs = params.saveAs === true;

    const downloadId = await chrome.downloads.download(options);

    sendSuccessResult(id, { downloadId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Lists recent downloads with optional filtering by query, state, and limit. */
export const handleBrowserListDownloads = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const searchQuery: chrome.downloads.DownloadQuery = {
      orderBy: ['-startTime'],
    };

    if (typeof params.query === 'string' && params.query.length > 0) {
      searchQuery.query = [params.query];
    }

    if (params.state !== undefined) {
      if (typeof params.state !== 'string' || !VALID_DOWNLOAD_STATES.has(params.state)) {
        sendValidationError(
          id,
          `Invalid state "${String(params.state)}". Must be one of: in_progress, interrupted, complete`,
        );
        return;
      }
      searchQuery.state = params.state as chrome.downloads.DownloadItem['state'];
    }

    const limit =
      typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0 ? params.limit : 20;
    searchQuery.limit = limit;

    const downloads = await chrome.downloads.search(searchQuery);

    const result = downloads.map(dl => ({
      id: dl.id,
      filename: dl.filename,
      url: dl.url,
      state: dl.state,
      bytesReceived: dl.bytesReceived,
      totalBytes: dl.totalBytes,
      startTime: dl.startTime,
    }));

    sendSuccessResult(id, { downloads: result });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Gets the current status of a specific download by ID. */
export const handleBrowserGetDownloadStatus = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const downloadId = params.downloadId;
    if (typeof downloadId !== 'number' || !Number.isInteger(downloadId)) {
      sendValidationError(id, 'Missing or invalid downloadId parameter');
      return;
    }

    const results = await chrome.downloads.search({ id: downloadId });
    if (results.length === 0) {
      sendValidationError(id, `Download with id ${downloadId} not found`);
      return;
    }

    const dl = results[0] as chrome.downloads.DownloadItem;
    sendSuccessResult(id, {
      id: dl.id,
      filename: dl.filename,
      url: dl.url,
      state: dl.state,
      bytesReceived: dl.bytesReceived,
      totalBytes: dl.totalBytes,
      startTime: dl.startTime,
      endTime: dl.endTime,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
