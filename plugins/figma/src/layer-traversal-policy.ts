export interface LayerTraversalNode {
  id: string;
  name: string;
  kind: string;
  depth: number;
  hasChildren: boolean;
}

export interface LayerTraversalPolicy {
  shouldTraverseChildren(node: Readonly<LayerTraversalNode>): boolean;
}

export const exhaustiveLayerTraversalPolicy: LayerTraversalPolicy = Object.freeze({
  shouldTraverseChildren: () => true,
});
