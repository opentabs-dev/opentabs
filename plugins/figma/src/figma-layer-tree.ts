import { getCurrentUrl, getPageTitle, querySelectorAll, ToolError, waitForSelector } from '@opentabs-dev/plugin-sdk';
import {
  exhaustiveLayerTraversalPolicy,
  type LayerTraversalNode,
  type LayerTraversalPolicy,
} from './layer-traversal-policy.js';

const OBJECTS_PANEL_SELECTOR = '[role="treegrid"][data-testid="objects-panel"]';
const LAYER_ROW_SELECTOR = `${OBJECTS_PANEL_SELECTOR} [role="row"][aria-level][aria-rowindex]`;
const LAYER_ROW_CONTENT_SELECTOR = '[data-testid$="-layers-panel-row"]';
const EXPAND_CARET_SELECTOR = '[data-testid="layers-panel-expand-caret"]';
const ACTIVE_PAGE_SELECTOR = '[data-testid="PagesRowWrapper"] button[aria-current="page"]';
const PANEL_SETTLE_TASKS = 2;
const ROW_STATE_TIMEOUT_MS = 5_000;
const CRAWL_TIME_BUDGET_MS = 210_000;

export type LayerTreeTruncationReason = 'max_depth' | 'max_nodes' | 'time_budget';

const TRUNCATION_REASON_ORDER = ['max_depth', 'max_nodes', 'time_budget'] as const;

export interface FigmaLayerTreeNode {
  id: string;
  parent_id: string | null;
  depth: number;
  sibling_index: number;
  name: string;
  kind: string;
  has_children: boolean;
}

export interface FigmaLayerTreeResult {
  source: {
    url: string;
    file_key: string;
    file_name: string;
    page_name: string;
    root_node_id: string | null;
  };
  nodes: FigmaLayerTreeNode[];
  complete: boolean;
  truncated_reasons: LayerTreeTruncationReason[];
  frontier_node_ids: string[];
}

interface RenderedLayerRow {
  element: HTMLElement;
  id: string;
  name: string;
  kind: string;
  absoluteDepth: number;
  siblingIndex: number;
  rowIndex: number;
  hasChildren: boolean;
  expanded: boolean;
}

interface TraversalScope {
  rootNodeId: string | null;
  rootRowIndex: number;
  baseDepth: number;
  initialScrollTop: number;
}

interface CapturedPanelState {
  url: string;
  pageName: string;
  selectedNodeId: string | null;
  focusedElement: HTMLElement | null;
  scrollTop: number;
  scrollLeft: number;
}

interface ExpandedLayer {
  id: string;
  absoluteDepth: number;
  rowIndex: number;
}

interface ScopedRows {
  rows: RenderedLayerRow[];
  reachedEnd: boolean;
  endRowIndex: number | null;
}

interface WalkFigmaLayerTreeOptions {
  rootNodeId?: string;
  maxDepth: number;
  maxNodes: number;
  traversalPolicy?: LayerTraversalPolicy;
  onProgress?: (progress: LayerTreeWalkProgress) => void;
}

interface LayerTreeWalkProgress {
  phase: 'reading' | 'restoring';
  expandedNodes: number;
  observedNodes: number;
  restoredNodes: number;
}

const parsePositiveIntegerAttribute = (element: Element, name: string): number | null => {
  const value = Number(element.getAttribute(name));
  return Number.isInteger(value) && value > 0 ? value : null;
};

const parseNonnegativeIntegerAttribute = (element: Element, name: string): number | null => {
  const value = Number(element.getAttribute(name));
  return Number.isInteger(value) && value >= 0 ? value : null;
};

const parseLayerRow = (element: HTMLElement): RenderedLayerRow | null => {
  const content = element.querySelector<HTMLElement>(LAYER_ROW_CONTENT_SELECTOR);
  const testId = content?.dataset.testid;
  const absoluteDepth = parseNonnegativeIntegerAttribute(element, 'aria-level');
  const rowIndex = parsePositiveIntegerAttribute(element, 'aria-rowindex');
  const siblingPosition = parsePositiveIntegerAttribute(element, 'aria-posinset');
  const kind = element.querySelector<HTMLElement>('[role="img"][aria-label]')?.getAttribute('aria-label')?.trim();

  if (content === null || !testId?.endsWith('-layers-panel-row') || absoluteDepth === null || !rowIndex || !kind) {
    return null;
  }

  const id = testId.slice(0, -'-layers-panel-row'.length);
  const expandedAttribute = element.getAttribute('aria-expanded');

  return {
    element,
    id,
    name: content.textContent?.trim() ?? '',
    kind,
    absoluteDepth,
    siblingIndex: Math.max(0, (siblingPosition ?? 1) - 1),
    rowIndex,
    hasChildren: expandedAttribute !== null,
    expanded: expandedAttribute === 'true',
  };
};

const getRenderedLayerRows = (): RenderedLayerRow[] => {
  const rowsById = new Map<string, RenderedLayerRow>();

  for (const element of querySelectorAll<HTMLElement>(LAYER_ROW_SELECTOR)) {
    const row = parseLayerRow(element);
    if (!row) continue;

    const current = rowsById.get(row.id);
    if (!current || row.rowIndex < current.rowIndex) rowsById.set(row.id, row);
  }

  return [...rowsById.values()].sort((left, right) => left.rowIndex - right.rowIndex);
};

const getActivePageName = (): string | null => {
  const button = querySelectorAll<HTMLElement>(ACTIVE_PAGE_SELECTOR)[0];
  const pageRow = button?.closest<HTMLElement>('[data-testid="PagesRowWrapper"]');
  const name = pageRow?.textContent?.trim() ?? button?.textContent?.trim();
  return name || null;
};

const getSelectedNodeId = (): string | null => {
  const selectedRows = querySelectorAll<HTMLElement>(`${OBJECTS_PANEL_SELECTOR} [role="row"][aria-selected="true"]`);
  for (const selectedRow of selectedRows) {
    const parsed = parseLayerRow(selectedRow);
    if (parsed) return parsed.id;
  }
  return null;
};

const findScrollContainer = (panel: HTMLElement): HTMLElement | null => {
  let current: HTMLElement | null = panel;
  let overflowContainer: HTMLElement | null = null;

  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      overflowContainer ??= current;
      if (current.scrollHeight > current.clientHeight) return current;
    }
    current = current.parentElement;
  }

  return overflowContainer;
};

const normalizeRootNodeId = (value: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.trim());
  } catch {
    throw ToolError.validation('root_node_id contains invalid URL encoding.');
  }
  if (/^\d+:\d+$/.test(decoded)) return decoded;
  if (/^\d+-\d+$/.test(decoded)) return decoded.replace('-', ':');
  throw ToolError.validation('root_node_id must use the Figma node ID format "123:456" or URL format "123-456".');
};

const getDesignFileIdentity = (): { fileKey: string; fileName: string } => {
  const url = new URL(getCurrentUrl());
  const match = url.pathname.match(/^\/design\/([^/]+)\/([^/]+)/);
  if (!match?.[1] || !match[2]) {
    throw ToolError.validation('Open a Figma Design file before calling get_layer_tree.');
  }

  const titleName = getPageTitle()
    .replace(/\s+(?:\u2013|\u2014|-)\s+Figma(?:\s.*)?$/u, '')
    .trim();
  const pathName = decodeURIComponent(match[2]).replaceAll('-', ' ').trim();

  return {
    fileKey: match[1],
    fileName: titleName || pathName,
  };
};

const capturePanelState = (scrollContainer: HTMLElement, pageName: string): CapturedPanelState => ({
  url: getCurrentUrl(),
  pageName,
  selectedNodeId: getSelectedNodeId(),
  focusedElement: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  scrollTop: scrollContainer.scrollTop,
  scrollLeft: scrollContainer.scrollLeft,
});

const assertPanelStateStable = (panel: HTMLElement, scrollContainer: HTMLElement, state: CapturedPanelState): void => {
  if (
    !panel.isConnected ||
    !scrollContainer.isConnected ||
    getCurrentUrl() !== state.url ||
    getActivePageName() !== state.pageName ||
    getSelectedNodeId() !== state.selectedNodeId
  ) {
    throw ToolError.validation(
      'The Figma file, page, selection, or Layers panel changed while get_layer_tree was running. Retry after the UI is stable.',
      'FIGMA_LAYER_CONTEXT_CHANGED',
    );
  }
};

const yieldToBrowserTask = (): Promise<void> =>
  new Promise(resolve => {
    // MessageChannel remains schedulable when background-tab timers and animation frames are throttled.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });

const setPanelScrollTop = async (scrollContainer: HTMLElement, scrollTop: number): Promise<void> => {
  const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const target = Math.min(Math.max(0, scrollTop), maximumScrollTop);
  scrollContainer.scrollTop = target;
  scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
  for (let task = 0; task < PANEL_SETTLE_TASKS; task += 1) await yieldToBrowserTask();
};

const getScopedRows = (rows: RenderedLayerRow[], scope: TraversalScope): ScopedRows => {
  if (scope.rootNodeId === null) return { rows, reachedEnd: false, endRowIndex: null };

  const scopedRows: RenderedLayerRow[] = [];
  let reachedEnd = false;
  let endRowIndex: number | null = null;

  for (const row of rows) {
    if (row.id === scope.rootNodeId) {
      scopedRows.push(row);
      continue;
    }
    if (row.rowIndex <= scope.rootRowIndex) continue;
    if (row.absoluteDepth <= scope.baseDepth) {
      reachedEnd = true;
      endRowIndex = row.rowIndex;
      break;
    }
    scopedRows.push(row);
  }

  return { rows: scopedRows, reachedEnd, endRowIndex };
};

const locateRootScope = async (
  panel: HTMLElement,
  scrollContainer: HTMLElement,
  state: CapturedPanelState,
  rootNodeId: string | null,
  deadline: number,
): Promise<TraversalScope> => {
  if (rootNodeId === null) {
    return { rootNodeId: null, rootRowIndex: 0, baseDepth: 0, initialScrollTop: 0 };
  }

  await setPanelScrollTop(scrollContainer, 0);
  let scrollTop = 0;

  while (true) {
    assertPanelStateStable(panel, scrollContainer, state);
    const row = getRenderedLayerRows().find(candidate => candidate.id === rootNodeId);
    if (row) {
      return {
        rootNodeId,
        rootRowIndex: row.rowIndex,
        baseDepth: row.absoluteDepth,
        initialScrollTop: scrollContainer.scrollTop,
      };
    }

    if (Date.now() >= deadline) {
      throw ToolError.timeout('Timed out while locating root_node_id in the visible Figma Layers tree.');
    }

    const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (scrollTop >= maximumScrollTop) break;

    const step = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.6));
    scrollTop = Math.min(maximumScrollTop, scrollTop + step);
    await setPanelScrollTop(scrollContainer, scrollTop);
  }

  throw ToolError.notFound(
    `Layer ${rootNodeId} is not exposed in the current Layers tree. Open its ancestor layers or omit root_node_id to traverse the active page.`,
    'FIGMA_LAYER_NOT_EXPOSED',
  );
};

const toTraversalNode = (row: RenderedLayerRow, scope: TraversalScope): LayerTraversalNode => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  depth: row.absoluteDepth - scope.baseDepth,
  hasChildren: row.hasChildren,
});

const waitForExpandedState = (panel: HTMLElement, id: string, expanded: boolean): Promise<void> =>
  new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      const current = getRenderedLayerRows().find(candidate => candidate.id === id);
      if (current?.expanded !== expanded) return;

      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    });

    observer.observe(panel, { attributes: true, childList: true, subtree: true });

    timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Figma layer ${id} did not ${expanded ? 'expand' : 'collapse'} after clicking its caret.`));
    }, ROW_STATE_TIMEOUT_MS);
  });

const clickExpansionCaret = async (row: RenderedLayerRow, expanded: boolean): Promise<void> => {
  const caret = row.element.querySelector<HTMLElement>(EXPAND_CARET_SELECTOR);
  if (!caret) {
    throw ToolError.internal(`Figma layer ${row.id} reports children but has no expansion caret.`);
  }

  const panel = row.element.closest<HTMLElement>(OBJECTS_PANEL_SELECTOR);
  if (!panel) throw ToolError.internal(`Figma layer ${row.id} is no longer in the Layers panel.`);

  const expandedState = waitForExpandedState(panel, row.id, expanded);
  caret.click();
  await expandedState;
  for (let task = 0; task < PANEL_SETTLE_TASKS; task += 1) await yieldToBrowserTask();
};

const addFrontierNode = (frontierNodeIds: Set<string>, row: RenderedLayerRow): void => {
  if (row.hasChildren) frontierNodeIds.add(row.id);
};

interface ExpansionPassOptions {
  panel: HTMLElement;
  scrollContainer: HTMLElement;
  state: CapturedPanelState;
  scope: TraversalScope;
  policy: LayerTraversalPolicy;
  maxDepth: number;
  maxNodes: number;
  deadline: number;
  observedNodeIds: Set<string>;
  expandedLayers: Map<string, ExpandedLayer>;
  frontierNodeIds: Set<string>;
  truncationReasons: Set<LayerTreeTruncationReason>;
  onProgress?: WalkFigmaLayerTreeOptions['onProgress'];
}

const expandTraversalPass = async (options: ExpansionPassOptions): Promise<number> => {
  const {
    panel,
    scrollContainer,
    state,
    scope,
    policy,
    maxDepth,
    maxNodes,
    deadline,
    observedNodeIds,
    expandedLayers,
    frontierNodeIds,
    truncationReasons,
    onProgress,
  } = options;

  await setPanelScrollTop(scrollContainer, scope.initialScrollTop);
  let scrollTop = scrollContainer.scrollTop;
  let expandedThisPass = 0;

  while (true) {
    assertPanelStateStable(panel, scrollContainer, state);

    if (Date.now() >= deadline) {
      truncationReasons.add('time_budget');
      break;
    }

    const scoped = getScopedRows(getRenderedLayerRows(), scope);
    const observedBeforeWindow = observedNodeIds.size;
    for (const row of scoped.rows) {
      const relativeDepth = row.absoluteDepth - scope.baseDepth;
      if (relativeDepth >= 0 && relativeDepth <= maxDepth) observedNodeIds.add(row.id);
      if (relativeDepth === maxDepth) addFrontierNode(frontierNodeIds, row);
    }
    if (observedNodeIds.size > observedBeforeWindow) {
      onProgress?.({
        phase: 'reading',
        expandedNodes: expandedLayers.size,
        observedNodes: observedNodeIds.size,
        restoredNodes: 0,
      });
    }
    if (observedNodeIds.size > maxNodes) {
      truncationReasons.add('max_nodes');
      break;
    }

    const candidate = scoped.rows.find(row => {
      const relativeDepth = row.absoluteDepth - scope.baseDepth;
      if (!row.hasChildren || row.expanded || relativeDepth < 0) return false;
      if (relativeDepth >= maxDepth) return false;
      return policy.shouldTraverseChildren(toTraversalNode(row, scope));
    });

    if (candidate) {
      if (observedNodeIds.size >= maxNodes) {
        truncationReasons.add('max_nodes');
        addFrontierNode(frontierNodeIds, candidate);
        break;
      }

      expandedLayers.set(candidate.id, {
        id: candidate.id,
        absoluteDepth: candidate.absoluteDepth,
        rowIndex: candidate.rowIndex,
      });
      await clickExpansionCaret(candidate, true);
      expandedThisPass += 1;
      onProgress?.({
        phase: 'reading',
        expandedNodes: expandedLayers.size,
        observedNodes: observedNodeIds.size,
        restoredNodes: 0,
      });
      scrollTop = scrollContainer.scrollTop;
      continue;
    }

    if (scoped.reachedEnd) break;

    const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (scrollTop >= maximumScrollTop) break;

    const step = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.5));
    scrollTop = Math.min(maximumScrollTop, scrollTop + step);
    await setPanelScrollTop(scrollContainer, scrollTop);
  }

  return expandedThisPass;
};

const collectTraversalRows = async (
  panel: HTMLElement,
  scrollContainer: HTMLElement,
  state: CapturedPanelState,
  scope: TraversalScope,
  maxDepth: number,
  maxNodes: number,
  deadline: number,
  frontierNodeIds: Set<string>,
  truncationReasons: Set<LayerTreeTruncationReason>,
  expandedNodeCount: number,
  onProgress?: WalkFigmaLayerTreeOptions['onProgress'],
): Promise<RenderedLayerRow[]> => {
  const collectedRows = new Map<string, RenderedLayerRow>();
  const visitedRowIndexes = new Set<number>();
  await setPanelScrollTop(scrollContainer, scope.initialScrollTop);
  let scrollTop = scrollContainer.scrollTop;
  let exceededMaxNodes = false;
  let endRowIndex: number | null = null;

  while (true) {
    assertPanelStateStable(panel, scrollContainer, state);
    if (Date.now() >= deadline) {
      truncationReasons.add('time_budget');
      break;
    }

    const scoped = getScopedRows(getRenderedLayerRows(), scope);
    for (const row of scoped.rows) visitedRowIndexes.add(row.rowIndex);
    endRowIndex ??= scoped.endRowIndex;
    const collectedBeforeWindow = collectedRows.size;
    for (const row of scoped.rows) {
      const relativeDepth = row.absoluteDepth - scope.baseDepth;
      if (relativeDepth < 0) continue;
      if (relativeDepth > maxDepth) {
        truncationReasons.add('max_depth');
        continue;
      }
      if (relativeDepth === maxDepth && row.hasChildren) {
        truncationReasons.add('max_depth');
        frontierNodeIds.add(row.id);
      }

      if (!collectedRows.has(row.id)) collectedRows.set(row.id, row);
      if (collectedRows.size > maxNodes) {
        exceededMaxNodes = true;
        truncationReasons.add('max_nodes');
        break;
      }
    }
    if (collectedRows.size > collectedBeforeWindow) {
      onProgress?.({
        phase: 'reading',
        expandedNodes: expandedNodeCount,
        observedNodes: Math.min(collectedRows.size, maxNodes),
        restoredNodes: 0,
      });
    }

    if (exceededMaxNodes || scoped.reachedEnd) break;

    const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (scrollTop >= maximumScrollTop) break;

    const step = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.5));
    scrollTop = Math.min(maximumScrollTop, scrollTop + step);
    await setPanelScrollTop(scrollContainer, scrollTop);
  }

  if (!exceededMaxNodes && !truncationReasons.has('time_budget') && visitedRowIndexes.size > 0) {
    const firstRowIndex = scope.rootNodeId === null ? Math.min(...visitedRowIndexes) : scope.rootRowIndex;
    const lastRowIndex = endRowIndex === null ? Math.max(...visitedRowIndexes) : endRowIndex - 1;
    for (let rowIndex = firstRowIndex; rowIndex <= lastRowIndex; rowIndex += 1) {
      if (!visitedRowIndexes.has(rowIndex)) {
        throw ToolError.internal(`The virtualized Figma Layers tree skipped row ${rowIndex} while scrolling.`);
      }
    }
  }

  return [...collectedRows.values()].sort((left, right) => left.rowIndex - right.rowIndex);
};

const buildLayerTreeNodes = (
  rows: RenderedLayerRow[],
  scope: TraversalScope,
  maxNodes: number,
  frontierNodeIds: Set<string>,
): FigmaLayerTreeNode[] => {
  const nodes: FigmaLayerTreeNode[] = [];
  const ancestorIds: string[] = [];

  for (const row of rows) {
    if (nodes.length >= maxNodes) {
      const parentId = ancestorIds[row.absoluteDepth - scope.baseDepth - 1];
      if (parentId) frontierNodeIds.add(parentId);
      break;
    }

    const depth = row.absoluteDepth - scope.baseDepth;
    const parentId = depth === 0 ? null : (ancestorIds[depth - 1] ?? null);
    if (depth > 0 && parentId === null) {
      throw ToolError.internal(`Could not reconstruct the parent of Figma layer ${row.id}.`);
    }

    nodes.push({
      id: row.id,
      parent_id: parentId,
      depth,
      sibling_index: row.siblingIndex,
      name: row.name,
      kind: row.kind,
      has_children: row.hasChildren,
    });
    ancestorIds[depth] = row.id;
    ancestorIds.length = depth + 1;
  }

  return nodes;
};

const locateLayerForRestoration = async (
  scrollContainer: HTMLElement,
  id: string,
  rowIndex: number,
): Promise<RenderedLayerRow | null> => {
  const rendered = getRenderedLayerRows().find(row => row.id === id);
  if (rendered) return rendered;

  const renderedRows = getRenderedLayerRows();
  const rowHeight = renderedRows[0]?.element.getBoundingClientRect().height || 32;
  await setPanelScrollTop(scrollContainer, Math.max(0, (rowIndex - 1) * rowHeight - scrollContainer.clientHeight / 3));

  const estimated = getRenderedLayerRows().find(row => row.id === id);
  if (estimated) return estimated;

  await setPanelScrollTop(scrollContainer, 0);
  let scrollTop = 0;
  while (true) {
    const row = getRenderedLayerRows().find(candidate => candidate.id === id);
    if (row) return row;

    const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (scrollTop >= maximumScrollTop) return null;

    const step = Math.max(100, Math.floor(scrollContainer.clientHeight * 0.6));
    scrollTop = Math.min(maximumScrollTop, scrollTop + step);
    await setPanelScrollTop(scrollContainer, scrollTop);
  }
};

const restorePanelState = async (
  scrollContainer: HTMLElement,
  state: CapturedPanelState,
  expandedLayers: Map<string, ExpandedLayer>,
  finalRows: RenderedLayerRow[],
  observedNodeCount: number,
  onProgress?: WalkFigmaLayerTreeOptions['onProgress'],
): Promise<void> => {
  const assertOriginalPanelAvailable = () => {
    if (!scrollContainer.isConnected || getCurrentUrl() !== state.url || getActivePageName() !== state.pageName) {
      throw new Error('The original Figma file, page, or Layers panel is no longer available.');
    }
  };

  assertOriginalPanelAvailable();
  const finalRowsById = new Map(finalRows.map(row => [row.id, row]));
  const layersToCollapse = [...expandedLayers.values()].sort((left, right) => {
    const depthDifference = right.absoluteDepth - left.absoluteDepth;
    if (depthDifference !== 0) return depthDifference;
    const leftRow = finalRowsById.get(left.id);
    const rightRow = finalRowsById.get(right.id);
    return (rightRow?.rowIndex ?? right.rowIndex) - (leftRow?.rowIndex ?? left.rowIndex);
  });

  for (const [index, layer] of layersToCollapse.entries()) {
    assertOriginalPanelAvailable();
    const rowIndex = finalRowsById.get(layer.id)?.rowIndex ?? layer.rowIndex;
    const row = await locateLayerForRestoration(scrollContainer, layer.id, rowIndex);
    if (!row) throw new Error(`Could not relocate expanded Figma layer ${layer.id}.`);
    if (row.expanded) await clickExpansionCaret(row, false);
    onProgress?.({
      phase: 'restoring',
      expandedNodes: layersToCollapse.length,
      observedNodes: observedNodeCount,
      restoredNodes: index + 1,
    });
  }

  assertOriginalPanelAvailable();
  scrollContainer.scrollLeft = state.scrollLeft;
  await setPanelScrollTop(scrollContainer, state.scrollTop);
  state.focusedElement?.focus({ preventScroll: true });
};

export const walkFigmaLayerTree = async (options: WalkFigmaLayerTreeOptions): Promise<FigmaLayerTreeResult> => {
  const file = getDesignFileIdentity();
  const pageName = getActivePageName();
  if (!pageName) {
    throw ToolError.validation('Open the Layers panel for an active page before calling get_layer_tree.');
  }

  let panel: HTMLElement;
  try {
    panel = await waitForSelector<HTMLElement>(OBJECTS_PANEL_SELECTOR, { timeout: 5_000 });
  } catch {
    throw ToolError.validation('Open the Layers panel before calling get_layer_tree.');
  }

  const scrollContainer = findScrollContainer(panel);
  if (!scrollContainer || scrollContainer.clientHeight <= 0) {
    throw ToolError.validation('Keep the Figma Layers panel visible before calling get_layer_tree.');
  }

  const state = capturePanelState(scrollContainer, pageName);
  const deadline = Date.now() + CRAWL_TIME_BUDGET_MS;
  const rootNodeId = options.rootNodeId ? normalizeRootNodeId(options.rootNodeId) : null;
  const policy = options.traversalPolicy ?? exhaustiveLayerTraversalPolicy;
  const observedNodeIds = new Set<string>();
  const expandedLayers = new Map<string, ExpandedLayer>();
  const frontierNodeIds = new Set<string>();
  const truncationReasons = new Set<LayerTreeTruncationReason>();
  let finalRows: RenderedLayerRow[] = [];
  let result: FigmaLayerTreeResult | undefined;
  let operationError: unknown;

  try {
    options.onProgress?.({ phase: 'reading', expandedNodes: 0, observedNodes: 0, restoredNodes: 0 });
    const scope = await locateRootScope(panel, scrollContainer, state, rootNodeId, deadline);

    while (Date.now() < deadline) {
      const expandedThisPass = await expandTraversalPass({
        panel,
        scrollContainer,
        state,
        scope,
        policy,
        maxDepth: options.maxDepth,
        maxNodes: options.maxNodes,
        deadline,
        observedNodeIds,
        expandedLayers,
        frontierNodeIds,
        truncationReasons,
        onProgress: options.onProgress,
      });
      if (expandedThisPass === 0 || truncationReasons.has('max_nodes') || truncationReasons.has('time_budget')) break;
    }

    if (Date.now() >= deadline) truncationReasons.add('time_budget');

    finalRows = await collectTraversalRows(
      panel,
      scrollContainer,
      state,
      scope,
      options.maxDepth,
      options.maxNodes,
      deadline,
      frontierNodeIds,
      truncationReasons,
      expandedLayers.size,
      options.onProgress,
    );
    const nodes = buildLayerTreeNodes(finalRows, scope, options.maxNodes, frontierNodeIds);

    result = {
      source: {
        url: state.url,
        file_key: file.fileKey,
        file_name: file.fileName,
        page_name: state.pageName,
        root_node_id: rootNodeId,
      },
      nodes,
      complete: truncationReasons.size === 0,
      truncated_reasons: TRUNCATION_REASON_ORDER.filter(reason => truncationReasons.has(reason)),
      frontier_node_ids: [...frontierNodeIds],
    };
  } catch (error) {
    operationError = error;
  }

  try {
    await restorePanelState(
      scrollContainer,
      state,
      expandedLayers,
      finalRows,
      observedNodeIds.size,
      options.onProgress,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw ToolError.internal(`get_layer_tree could not restore the Figma Layers panel state: ${message}`);
  }

  if (
    getCurrentUrl() !== state.url ||
    getActivePageName() !== state.pageName ||
    getSelectedNodeId() !== state.selectedNodeId
  ) {
    throw ToolError.validation(
      'The Figma file, page, or selection changed while get_layer_tree was running.',
      'FIGMA_LAYER_CONTEXT_CHANGED',
    );
  }

  if (operationError) throw operationError;
  if (!result) throw ToolError.internal('get_layer_tree finished without a result.');
  return result;
};
