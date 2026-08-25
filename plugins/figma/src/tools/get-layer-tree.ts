import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { walkFigmaLayerTree } from '../figma-layer-tree.js';
import { layerTreeResultSchema } from './schemas.js';

export const getLayerTree = defineTool({
  name: 'get_layer_tree',
  displayName: 'Get Layer Tree',
  description:
    'Read the active Figma Design page Layers sidebar as a flat preorder tree. Expands collapsed layers, traverses component instances like other layers, handles virtualized rows, and restores the original expansion, scroll, focus, and selection state. Returns sidebar-observable names and kinds only; it does not infer semantics or resolve component references. The Layers panel must be open.',
  summary: 'Read the active page layer tree',
  icon: 'list-tree',
  group: 'Layers',
  input: z.object({
    root_node_id: z
      .string()
      .min(1)
      .optional()
      .describe('Optional subtree root node ID in Figma format "123:456" or URL format "123-456"'),
    max_depth: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe('Maximum relative layer depth to return (default 50, maximum 100)'),
    max_nodes: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum number of layers to return (default 5000, maximum 10000)'),
  }),
  output: layerTreeResultSchema,
  handle: async (params, context) =>
    walkFigmaLayerTree({
      rootNodeId: params.root_node_id,
      maxDepth: params.max_depth ?? 50,
      maxNodes: params.max_nodes ?? 5_000,
      onProgress: progress => {
        const message =
          progress.phase === 'reading'
            ? `Reading Figma layers (${progress.observedNodes} found, ${progress.expandedNodes} expanded)...`
            : `Restoring the Figma Layers panel (${progress.restoredNodes} of ${progress.expandedNodes} layers)...`;
        context?.reportProgress({
          progress: progress.observedNodes,
          total: params.max_nodes ?? 5_000,
          message,
        });
      },
    }),
});
