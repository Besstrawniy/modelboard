import type { DatasetSnapshot, ObjectBinding } from './index.js';
export function resolveBindingPresentation(
  binding: ObjectBinding,
  dataset: DatasetSnapshot,
) {
  const p = binding.presentation ?? {},
    empty = p.emptyText ?? '—',
    row = dataset.rows.find((row) => row.id === binding.rowId),
    column = dataset.columns.find((column) => column.id === binding.columnId);
  const text = (value: unknown) =>
    value === null || value === undefined || value === ''
      ? empty
      : String(value);
  let title = dataset.name,
    subtitle = '',
    missing = false;
  if (binding.type === 'DATASET')
    subtitle = `${dataset.rows.length} строк · ${dataset.columns.length} колонок`;
  else if (binding.type === 'COLUMN') {
    missing = !column;
    title = column?.name ?? 'Поле удалено';
    const values = dataset.rows.map((row) => row.values[binding.columnId!]),
      numbers = values.filter((value) => typeof value === 'number') as number[];
    const mode = p.aggregation ?? 'COUNT';
    let result: unknown;
    if (mode === 'COUNT')
      result = values.filter(
        (value) => value !== null && value !== undefined && value !== '',
      ).length;
    if (mode === 'SUM') result = numbers.reduce((a, b) => a + b, 0);
    if (mode === 'AVG')
      result = numbers.length
        ? numbers.reduce((a, b) => a + b, 0) / numbers.length
        : null;
    if (mode === 'MIN')
      result = numbers.length
        ? numbers.reduce((a, b) => Math.min(a, b), Infinity)
        : null;
    if (mode === 'MAX')
      result = numbers.length
        ? numbers.reduce((a, b) => Math.max(a, b), -Infinity)
        : null;
    if (mode === 'FIRST')
      result = values.find(
        (value) => value !== null && value !== undefined && value !== '',
      );
    subtitle = `${mode}: ${text(result)}`;
  } else if (binding.type === 'CELL') {
    missing = !row || !column;
    title = column?.name ?? 'Поле удалено';
    subtitle = text(row?.values[binding.columnId!]);
  } else {
    missing = !row;
    title = row
      ? text(row.values[p.titleColumnId ?? dataset.columns[0]?.id])
      : 'Запись удалена';
    subtitle =
      row && p.subtitleColumnId ? text(row.values[p.subtitleColumnId]) : '';
  }
  const fields = row
    ? (p.fieldColumnIds ?? []).map((id) => {
        const column = dataset.columns.find((column) => column.id === id);
        return {
          id,
          label: column?.name ?? 'Поле удалено',
          value: text(row.values[id]),
        };
      })
    : [];
  const status =
    row && p.statusColumnId ? String(row.values[p.statusColumnId] ?? '') : '';
  return {
    title,
    subtitle,
    fields,
    missing,
    status,
    color: p.statusColors?.[status],
    showLabels: p.showLabels !== false,
  };
}
