import * as Y from 'yjs';
/** Tombstones make deletion survive offline clients, document reloads and board Undo. */
export function cleanBoardResources(
  document: Y.Doc,
  datasets: Set<string>,
  relations: Set<string>,
) {
  const nodes = document.getMap<any>('nodes'),
    edges = document.getMap<any>('edges'),
    removed = new Set<string>();
  const patchData = (
    id: string,
    stored: any,
    node: any,
    patch: Record<string, unknown>,
  ) => {
    const data = stored instanceof Y.Map ? stored.get('data') : null;
    if (data instanceof Y.Map) {
      for (const [key, value] of Object.entries(patch)) data.set(key, value);
    } else if (stored instanceof Y.Map)
      stored.set('data', { ...node.data, ...patch });
    else nodes.set(id, { ...node, data: { ...node.data, ...patch } });
  };
  document.transact(() => {
    for (const [id, stored] of nodes) {
      const node = stored instanceof Y.Map ? stored.toJSON() : stored;
      const binding = node.data?.binding,
        relationId = node.data?.relationId;
      if (
        (node.type === 'table' && datasets.has(node.data?.datasetId)) ||
        (node.type === 'relationView' &&
          (datasets.has(binding?.datasetId) || relations.has(relationId)))
      ) {
        nodes.delete(id);
        removed.add(id);
        continue;
      }
      if (
        binding &&
        (datasets.has(binding.datasetId) ||
          binding.relationPath?.some((id: string) => relations.has(id)))
      )
        patchData(id, stored, node, { binding: null });
      if (
        node.data?.generatedFrom &&
        relations.has(node.data.generatedFrom.relationId)
      )
        patchData(id, stored, node, { generatedFrom: null });
    }
    for (const [id, edge] of edges)
      if (
        removed.has(edge.source) ||
        removed.has(edge.target) ||
        relations.has(edge.data?.relationId)
      )
        edges.delete(id);
  }, 'resource-lifecycle');
}
