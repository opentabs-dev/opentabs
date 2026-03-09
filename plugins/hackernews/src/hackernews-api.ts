import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';

// --- HTML fetching (same-origin, works within CSP connect-src 'self') ---
// HN serves a strict CSP: default-src 'self' with no connect-src override.
// All cross-origin requests (Firebase, Algolia) are blocked by the browser.
// Data is fetched from HN's own server-rendered HTML pages and parsed.

const fetchHtml = async (path: string): Promise<Document> => {
  const html = await fetchText(path);
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
};

// --- Story parsing ---

export interface ParsedStory {
  id: number;
  title: string;
  url: string;
  site: string;
  score: number;
  by: string;
  time: string;
  descendants: number;
}

const parseStoryRow = (row: Element): ParsedStory | null => {
  const id = Number(row.id);
  if (!id) return null;

  const titleLink = row.querySelector('.titleline > a');
  const title = titleLink?.textContent ?? '';
  const rawUrl = titleLink?.getAttribute('href') ?? '';
  const url = rawUrl.startsWith('item?id=') ? '' : rawUrl;
  const site = row.querySelector('.sitestr')?.textContent ?? '';

  const subRow = row.nextElementSibling;
  const score = Number.parseInt(subRow?.querySelector('.score')?.textContent ?? '0', 10) || 0;
  const by = subRow?.querySelector('.hnuser')?.textContent ?? '';
  const ageEl = subRow?.querySelector('.age');
  const time = ageEl?.getAttribute('title')?.split(' ')[0] ?? '';
  const commLinks = Array.from(subRow?.querySelectorAll('a') ?? []);
  const commLink = commLinks.find(a => a.textContent?.includes('comment'));
  const descendants = commLink ? Number.parseInt(commLink.textContent ?? '0', 10) || 0 : 0;

  return { id, title, url, site, score, by, time, descendants };
};

export const fetchStoryPage = async (
  path: string,
  page: number,
): Promise<{ stories: ParsedStory[]; has_more: boolean }> => {
  let url = path;
  if (page > 1) {
    url += url.includes('?') ? `&p=${page}` : `?p=${page}`;
  }
  const doc = await fetchHtml(url);
  const rows = Array.from(doc.querySelectorAll('tr.athing'));
  const stories = rows.map(parseStoryRow).filter((s): s is ParsedStory => s !== null);
  const moreLink = doc.querySelector('a.morelink');
  return { stories, has_more: moreLink !== null };
};

// --- Item detail parsing ---

export interface ParsedItem {
  id: number;
  type: string;
  title: string;
  url: string;
  text: string;
  score: number;
  by: string;
  time: string;
  descendants: number;
}

export const fetchItem = async (id: number): Promise<ParsedItem> => {
  const doc = await fetchHtml(`/item?id=${id}`);

  // Check for "No such item." error page
  const body = doc.body?.textContent ?? '';
  if (body.includes('No such item')) {
    throw ToolError.notFound(`Item ${id} not found`);
  }

  // Find the main item row (first tr.athing on the page)
  const mainRow = doc.querySelector('tr.athing');
  if (!mainRow) throw ToolError.notFound(`Item ${id} not found`);

  // Detect comment pages: the main row has .commtext but no .titleline
  const isComment = mainRow.querySelector('.commtext') !== null;
  if (isComment) {
    const by = mainRow.querySelector('.hnuser')?.textContent ?? '';
    const text = mainRow.querySelector('.commtext')?.innerHTML ?? '';
    const ageEl = mainRow.querySelector('.age');
    const time = ageEl?.getAttribute('title')?.split(' ')[0] ?? '';
    return { id, type: 'comment', title: '', url: '', text, score: 0, by, time, descendants: 0 };
  }

  const titleLink = mainRow.querySelector('.titleline > a');
  const title = titleLink?.textContent ?? '';
  const rawUrl = titleLink?.getAttribute('href') ?? '';
  const url = rawUrl.startsWith('item?id=') ? '' : rawUrl;

  const subRow = mainRow.nextElementSibling;
  const score = Number.parseInt(subRow?.querySelector('.score')?.textContent ?? '0', 10) || 0;
  const by = subRow?.querySelector('.hnuser')?.textContent ?? '';
  const ageEl = subRow?.querySelector('.age');
  const time = ageEl?.getAttribute('title')?.split(' ')[0] ?? '';

  const toptext = doc.querySelector('.toptext');
  const text = toptext?.innerHTML ?? '';

  const commLinks = Array.from(subRow?.querySelectorAll('a') ?? []) as Element[];
  const commLink = commLinks.find(a => a.textContent?.includes('comment'));
  const descendants = commLink ? Number.parseInt(commLink.textContent ?? '0', 10) || 0 : 0;

  let type = 'story';
  if (!by && !score) type = 'job';

  return { id, type, title, url, text, score, by, time, descendants };
};

// --- Comment parsing ---

export interface ParsedComment {
  id: number;
  by: string;
  text: string;
  time: string;
  indent: number;
}

export const fetchStoryComments = async (
  storyId: number,
  page: number,
): Promise<{ comments: ParsedComment[]; has_more: boolean; total: number }> => {
  let url = `/item?id=${storyId}`;
  if (page > 1) url += `&p=${page}`;
  const doc = await fetchHtml(url);

  // Get total comment count from the subtext row
  const subRow = doc.querySelector('tr.athing:not(.comtr)')?.nextElementSibling;
  const commLinks = Array.from(subRow?.querySelectorAll('a') ?? []) as Element[];
  const commLink = commLinks.find(a => a.textContent?.includes('comment'));
  const total = commLink ? Number.parseInt(commLink.textContent ?? '0', 10) || 0 : 0;

  const commentRows = Array.from(doc.querySelectorAll('tr.athing.comtr'));
  const comments = commentRows.map((row): ParsedComment => {
    const cId = Number(row.id);
    const by = row.querySelector('.hnuser')?.textContent ?? '[deleted]';
    const text = row.querySelector('.commtext')?.innerHTML ?? '';
    const indent = Number.parseInt(row.querySelector('.ind img')?.getAttribute('width') ?? '0', 10) / 40;
    const ageEl = row.querySelector('.age');
    const time = ageEl?.getAttribute('title')?.split(' ')[0] ?? '';
    return { id: cId, by, text, time, indent };
  });

  const moreLink = doc.querySelector('a.morelink');
  return { comments, has_more: moreLink !== null, total };
};

// --- User parsing ---

export interface ParsedUser {
  username: string;
  created: string;
  karma: number;
  about: string;
}

export const fetchUser = async (username: string): Promise<ParsedUser> => {
  const doc = await fetchHtml(`/user?id=${username}`);

  const rows = Array.from(doc.querySelectorAll('table table tr'));

  let created = '';
  let karma = 0;
  let about = '';
  let foundUser = false;

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 2) continue;
    const labelCell = cells[0];
    const valueCell = cells[1];
    if (!labelCell || !valueCell) continue;
    const label = labelCell.textContent?.trim().replace(':', '') ?? '';

    if (label === 'user') foundUser = true;
    if (label === 'created') created = valueCell.textContent?.trim() ?? '';
    if (label === 'karma') karma = Number.parseInt(valueCell.textContent?.trim() ?? '0', 10) || 0;
    if (label === 'about') about = valueCell.innerHTML?.trim() ?? '';
  }

  if (!foundUser) throw ToolError.notFound(`User "${username}" not found`);

  return { username, created, karma, about };
};
