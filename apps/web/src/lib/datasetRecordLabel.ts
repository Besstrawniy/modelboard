import type { DatasetRow, DatasetSnapshot } from '@modelboard/shared';

/** Prefer a readable name over imported key columns when choosing records. */
export function datasetRecordLabel(
  row: DatasetRow,
  dataset: Pick<DatasetSnapshot, 'columns'>,
) {
  const available = dataset.columns.filter(
    (column) =>
      row.values[column.id] !== null &&
      row.values[column.id] !== undefined &&
      row.values[column.id] !== '',
  );
  const fields = available.filter(
    (column) =>
      column.dataType !== 'UUID' && !/^(id|fk|.*_id)$/i.test(column.name),
  );
  const ordered = [...(fields.length ? fields : available)].sort(
    (left, right) =>
      Number(/^(hostname|name|title|label|service|device)$/i.test(right.name)) -
      Number(/^(hostname|name|title|label|service|device)$/i.test(left.name)),
  );
  return `${row.ordinal + 1}. ${
    ordered
      .slice(0, 3)
      .map((column) => row.values[column.id])
      .join(' · ') || 'Пустая запись'
  }`;
}
