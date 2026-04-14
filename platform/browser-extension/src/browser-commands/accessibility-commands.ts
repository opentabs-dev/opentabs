import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { withDebugger } from './resource-commands.js';

const MAX_NODES = 2000;

interface AXNode {
  nodeId: string;
  role: { value: string };
  name?: { value: string };
  value?: { value: string };
  description?: { value: string };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  ignored?: boolean;
  backendDOMNodeId?: number;
}

interface CleanNode {
  nodeId: string;
  role: string;
  name: string;
  value: string;
  description: string;
  states: string[];
  childIds: string[];
}

const IGNORED_ROLES = new Set(['none', 'ignored', 'GenericContainer', 'InlineTextBox']);

const STATE_PROPERTY_NAMES = new Set([
  'disabled',
  'expanded',
  'focused',
  'checked',
  'selected',
  'required',
  'pressed',
  'readonly',
  'busy',
  'hidden',
  'invalid',
  'modal',
  'multiselectable',
  'multiline',
]);

const extractStates = (properties: AXNode['properties']): string[] => {
  if (!properties) return [];
  const states: string[] = [];
  for (const prop of properties) {
    if (STATE_PROPERTY_NAMES.has(prop.name) && prop.value.value === true) {
      states.push(prop.name);
    }
  }
  return states;
};

const cleanNode = (node: AXNode): CleanNode => ({
  nodeId: node.nodeId,
  role: node.role?.value ?? 'unknown',
  name: node.name?.value ?? '',
  value: node.value?.value ?? '',
  description: node.description?.value ?? '',
  states: extractStates(node.properties),
  childIds: node.childIds ?? [],
});

const filterByDepth = (nodes: CleanNode[], maxDepth: number): CleanNode[] => {
  if (nodes.length === 0) return [];

  const childToParentDepth = new Map<string, number>();
  const result: CleanNode[] = [];

  // Root node is at depth 1
  const rootNode = nodes[0];
  if (!rootNode) return [];
  childToParentDepth.set(rootNode.nodeId, 1);
  result.push(rootNode);

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const depth = childToParentDepth.get(node.nodeId);
    if (depth === undefined) continue;
    if (depth > maxDepth) continue;
    result.push(node);
    for (const childId of node.childIds) {
      childToParentDepth.set(childId, depth + 1);
    }
  }

  // Build depth map from parent→child relationships
  for (const node of result) {
    const nodeDepth = childToParentDepth.get(node.nodeId) ?? 1;
    for (const childId of node.childIds) {
      childToParentDepth.set(childId, nodeDepth + 1);
    }
  }

  return result;
};

export const handleBrowserGetAccessibilityTree = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const interestingOnly = params.interestingOnly !== false;
    const depth = typeof params.depth === 'number' ? params.depth : undefined;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
      try {
        const result = (await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree')) as {
          nodes: AXNode[];
        };

        let cleaned = result.nodes.map(cleanNode);

        if (interestingOnly) {
          cleaned = cleaned.filter(n => !IGNORED_ROLES.has(n.role));
        }

        if (depth !== undefined) {
          cleaned = filterByDepth(cleaned, depth);
        }

        const totalNodes = cleaned.length;
        const truncated = totalNodes > MAX_NODES;
        if (truncated) {
          cleaned = cleaned.slice(0, MAX_NODES);
        }

        sendSuccessResult(id, {
          nodes: cleaned,
          totalNodes,
          truncated,
        });
      } finally {
        await chrome.debugger.sendCommand({ tabId }, 'Accessibility.disable').catch(() => {});
      }
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
