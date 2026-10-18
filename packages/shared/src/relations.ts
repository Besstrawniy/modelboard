import type { DatasetRelation, DatasetRow } from './index.js';

/** Comparison is typed: a textual identifier "001" is distinct from the number 1. */
export function relationValueKey(value: unknown): string | null {
  return value === null || value === undefined || value === ''
    ? null
    : JSON.stringify(value);
}
export function validateRelationData(
  relation: Pick<
    DatasetRelation,
    | 'sourceColumnId'
    | 'targetColumnId'
    | 'cardinality'
    | 'relationType'
    | 'enforceIntegrity'
  >,
  source: DatasetRow[],
  target: DatasetRow[],
) {
  const counts = (rows: DatasetRow[], column: string) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = relationValueKey(row.values[column]);
      if (key !== null) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const a = counts(source, relation.sourceColumnId),
    b = counts(target, relation.targetColumnId);
  const sourceDuplicates = [...a.values()].filter((count) => count > 1).length,
    targetDuplicates = [...b.values()].filter((count) => count > 1).length;
  const orphanRows = source
    .filter((row) => {
      const key = relationValueKey(row.values[relation.sourceColumnId]);
      return key !== null && !b.has(key);
    })
    .map((row) => row.id);
  const sourceUnique =
    relation.cardinality === '1:1' || relation.cardinality === '1:N';
  const targetUnique =
    relation.relationType === 'FOREIGN_KEY' ||
    relation.cardinality === '1:1' ||
    relation.cardinality === 'N:1';
  const issues: string[] = [];
  if (sourceUnique && sourceDuplicates)
    issues.push(
      `Исходный ключ содержит повторяющиеся значения: ${sourceDuplicates}`,
    );
  if (targetUnique && targetDuplicates)
    issues.push(
      `Целевой ключ содержит повторяющиеся значения: ${targetDuplicates}`,
    );
  if (relation.relationType === 'FOREIGN_KEY' && orphanRows.length)
    issues.push(
      `Нет соответствия в целевой таблице для строк: ${orphanRows.length}`,
    );
  return {
    valid: issues.length === 0,
    issues,
    sourceDuplicates,
    targetDuplicates,
    orphanCount: orphanRows.length,
    orphanRowIds: orphanRows.slice(0, 20),
    matchedRows: source.filter((row) => {
      const key = relationValueKey(row.values[relation.sourceColumnId]);
      return key !== null && b.has(key);
    }).length,
  };
}
