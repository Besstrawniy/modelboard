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
    (relation.relationType === 'FOREIGN_KEY' &&
      relation.cardinality !== '1:N') ||
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
  if (
    relation.relationType === 'FOREIGN_KEY' &&
    relation.cardinality !== '1:N' &&
    orphanRows.length
  )
    issues.push(
      `Нет соответствия в целевой таблице для строк: ${orphanRows.length}`,
    );
  if (
    relation.relationType === 'FOREIGN_KEY' &&
    relation.cardinality === '1:N'
  ) {
    orphanRows.splice(
      0,
      orphanRows.length,
      ...target
        .filter((row) => {
          const key = relationValueKey(row.values[relation.targetColumnId]);
          return key !== null && !a.has(key);
        })
        .map((row) => row.id),
    );
    if (orphanRows.length)
      issues.push(
        `Нет соответствия в исходной таблице для строк: ${orphanRows.length}`,
      );
  }
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

export function relatedRows(
  relation: DatasetRelation,
  datasetId: string,
  row: DatasetRow,
  otherRows: DatasetRow[],
) {
  const source = relation.sourceDatasetId === datasetId;
  if (relation.matchMode === 'ROW_LINKS') {
    const ids = new Set(
      (relation.links ?? [])
        .filter(
          (link) => (source ? link.sourceRowId : link.targetRowId) === row.id,
        )
        .map((link) => (source ? link.targetRowId : link.sourceRowId)),
    );
    return otherRows.filter((row) => ids.has(row.id));
  }
  const value = relationValueKey(
    row.values[source ? relation.sourceColumnId : relation.targetColumnId],
  );
  return value === null
    ? []
    : otherRows.filter(
        (row) =>
          relationValueKey(
            row.values[
              source ? relation.targetColumnId : relation.sourceColumnId
            ],
          ) === value,
      );
}
export function validateRecordLinks(
  relation: DatasetRelation,
  source: DatasetRow[],
  target: DatasetRow[],
) {
  const a = new Set(source.map((row) => row.id)),
    b = new Set(target.map((row) => row.id)),
    left = new Map<string, number>(),
    right = new Map<string, number>();
  const links = relation.links ?? [];
  let missing = 0;
  for (const link of links) {
    if (!a.has(link.sourceRowId) || !b.has(link.targetRowId)) missing++;
    left.set(link.sourceRowId, (left.get(link.sourceRowId) ?? 0) + 1);
    right.set(link.targetRowId, (right.get(link.targetRowId) ?? 0) + 1);
  }
  const sourceDuplicates = [...left.values()].filter((n) => n > 1).length,
    targetDuplicates = [...right.values()].filter((n) => n > 1).length,
    issues: string[] = [];
  if (missing) issues.push('Связанные записи не найдены в выбранных таблицах');
  if (['1:1', 'N:1'].includes(relation.cardinality ?? '') && sourceDuplicates)
    issues.push(
      'Одной исходной записи назначено несколько целевых: измените кардинальность на 1:N или N:M',
    );
  if (['1:1', '1:N'].includes(relation.cardinality ?? '') && targetDuplicates)
    issues.push(
      'Одна целевая запись связана с несколькими исходными: измените кардинальность на N:1 или N:M',
    );
  return {
    valid: !issues.length,
    issues,
    sourceDuplicates,
    targetDuplicates,
    orphanCount: missing,
    orphanRowIds: [],
    matchedRows: links.length,
  };
}

/** Metadata and direction do not make a second relationship between the same ends. */
export function sameRelationEndpoints(
  a: Pick<
    DatasetRelation,
    | 'sourceDatasetId'
    | 'targetDatasetId'
    | 'sourceColumnId'
    | 'targetColumnId'
    | 'matchMode'
  >,
  b: Pick<
    DatasetRelation,
    | 'sourceDatasetId'
    | 'targetDatasetId'
    | 'sourceColumnId'
    | 'targetColumnId'
    | 'matchMode'
  >,
) {
  const mode = a.matchMode ?? 'FIELDS';
  if (mode !== (b.matchMode ?? 'FIELDS')) return false;
  const end = (dataset: string, column: string) =>
    dataset + ':' + (mode === 'ROW_LINKS' ? 'records' : column);
  const left = [
    end(a.sourceDatasetId, a.sourceColumnId),
    end(a.targetDatasetId, a.targetColumnId),
  ].sort();
  const right = [
    end(b.sourceDatasetId, b.sourceColumnId),
    end(b.targetDatasetId, b.targetColumnId),
  ].sort();
  return left[0] === right[0] && left[1] === right[1];
}
