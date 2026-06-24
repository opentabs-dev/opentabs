/**
 * Shared helpers for tools that download, modify, and re-upload .docx files.
 */
import { ToolError, clearAuthCache } from '@opentabs-dev/plugin-sdk';
import { type ZipEntry, extractAllZipEntries, rebuildZip } from '../docx-utils.js';
import { FILE_LOCKED_MESSAGE, authError, getGraphToken } from '../microsoft-word-api.js';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Download a .docx file and return all ZIP entries plus the document.xml as text. */
export async function downloadDocxEntries(itemId: string): Promise<{
  entries: ZipEntry[];
  documentXml: string;
  documentXmlIndex: number;
}> {
  const token = getGraphToken();

  // Get the pre-authenticated download URL
  const metaResp = await fetchWithErrorHandling(`${GRAPH_API_BASE}/me/drive/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
  const meta = (await metaResp.json()) as {
    '@microsoft.graph.downloadUrl'?: string;
    file?: { mimeType?: string };
  };

  if (!meta['@microsoft.graph.downloadUrl']) {
    throw ToolError.internal('No download URL available for this item.');
  }

  const mimeType = meta.file?.mimeType ?? '';
  if (mimeType && !mimeType.includes('wordprocessingml') && !mimeType.includes('msword')) {
    throw ToolError.validation(`This file is not a Word document (${mimeType}). Only .docx files can be edited.`);
  }

  // Download the binary
  const docResp = await fetchWithErrorHandling(meta['@microsoft.graph.downloadUrl'], {});
  const docBytes = new Uint8Array(await docResp.arrayBuffer());

  // Extract all ZIP entries
  const entries = await extractAllZipEntries(docBytes);
  const docIndex = entries.findIndex(e => e.name === 'word/document.xml');
  if (docIndex === -1) {
    throw ToolError.internal('Could not find word/document.xml in the .docx archive.');
  }

  const entry = entries[docIndex];
  if (!entry) {
    throw ToolError.internal('Could not read word/document.xml from the .docx archive.');
  }
  const documentXml = new TextDecoder().decode(entry.data);
  return { entries, documentXml, documentXmlIndex: docIndex };
}

/** Replace the document.xml in entries and re-upload the .docx to OneDrive. */
export async function uploadModifiedDocx(
  itemId: string,
  entries: ZipEntry[],
  documentXmlIndex: number,
  newDocumentXml: string,
): Promise<void> {
  const token = getGraphToken();
  const encoder = new TextEncoder();

  // Replace document.xml content
  entries[documentXmlIndex] = {
    name: 'word/document.xml',
    data: encoder.encode(newDocumentXml),
  };

  // Rebuild the ZIP
  const zipBytes = rebuildZip(entries);

  // Upload back — PUT to /content endpoint
  const body = new ArrayBuffer(zipBytes.byteLength);
  new Uint8Array(body).set(zipBytes);

  const resp = await fetchWithErrorHandling(`${GRAPH_API_BASE}/me/drive/items/${itemId}/content`, {
    method: 'PUT',
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': DOCX_MIME,
    },
    body,
  });

  // Consume the response to avoid leaking
  await resp.json();
}

/** Wrapper around fetch with standard error handling for Graph API calls. */
async function fetchWithErrorHandling(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Microsoft Graph API request timed out.');
    }
    throw ToolError.internal(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  if (response.status === 401 || response.status === 403) {
    clearAuthCache('microsoft-word');
    authError('Authentication expired — please refresh the page.');
  }
  if (response.status === 423) {
    throw ToolError.validation(FILE_LOCKED_MESSAGE);
  }
  if (response.status === 404) {
    throw ToolError.notFound('Document not found.');
  }
  if (!response.ok) {
    let errorMsg = `Microsoft Graph API error (${response.status})`;
    try {
      const errBody = (await response.json()) as { error?: { message?: string } };
      if (errBody.error?.message) errorMsg = errBody.error.message;
    } catch {
      // ignore parse errors
    }
    throw ToolError.internal(errorMsg);
  }

  return response;
}
