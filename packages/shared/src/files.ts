import { validateRelationData, validateRecordLinks } from './relations.js';
import { remapFormulaIds } from './formulas.js';
import type {
  DatasetSnapshot,
  DatasetRelation,
  WorkspaceObjectTemplate,
} from './index.js';
export const FILE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxImageBytes: 3 * 1024 * 1024,
  maxArchiveBytes: 30 * 1024 * 1024,
  maxRows: 10000,
  maxColumns: 100,
  maxDatasets: 50,
  maxNodes: 2000,
  maxWorkspaceBytes: 100 * 1024 * 1024,
};
export type FileAssetInput = {
  id?: string;
  name: string;
  mime: string;
  base64: string;
};
export type BoardArchive = {
  format: 'modelboard';
  version: 1;
  name: string;
  nodes: any[];
  edges: any[];
  strokes: any[];
  datasets: DatasetSnapshot[];
  relations: DatasetRelation[];
  templates: WorkspaceObjectTemplate[];
  files: FileAssetInput[];
};
export function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error('Слишком глубокая вложенность файла');
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error('Некорректное число');
  if (Array.isArray(value)) {
    if (value.length > 20000) throw new Error('Слишком много элементов');
    for (const item of value) assertSafeJson(item, depth + 1);
  } else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('Недопустимое поле файла');
      assertSafeJson(item, depth + 1);
    }
}
export function validateDatasetFile(ds: DatasetSnapshot) {
  if (
    !ds ||
    !Array.isArray(ds.columns) ||
    !ds.columns.length ||
    ds.columns.length > FILE_LIMITS.maxColumns ||
    !Array.isArray(ds.rows) ||
    ds.rows.length > FILE_LIMITS.maxRows
  )
    throw new Error('Таблица: от 1 до 100 полей, до 10 000 строк');
  const ids = new Set(ds.columns.map((c) => c.id));
  if (ids.size !== ds.columns.length) throw new Error('Повторяются ID колонок');
  if (new Set(ds.rows.map((r) => r.id)).size !== ds.rows.length)
    throw new Error('Повторяются ID строк');
  for (const col of ds.columns)
    if (
      typeof col.id !== 'string' ||
      !col.id ||
      typeof col.name !== 'string' ||
      !col.name.length ||
      col.name.length > 120 ||
      !['TEXT', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'UUID'].includes(
        col.dataType,
      )
    )
      throw new Error('Некорректная колонка');
  for (const row of ds.rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.values ||
      typeof row.values !== 'object' ||
      Array.isArray(row.values)
    )
      throw new Error('Некорректная строка');
    for (const [key, value] of Object.entries(row.values)) {
      if (
        !ids.has(key) ||
        !(
          value === null ||
          ['string', 'number', 'boolean'].includes(typeof value)
        )
      )
        throw new Error('Неизвестное поле или вложенное значение ячейки');
    }
  }
  const rows = new Set(ds.rows.map((r) => r.id));
  for (const item of [...(ds.formulas ?? []), ...(ds.formats ?? [])])
    if (!rows.has(item.rowId) || !ids.has(item.columnId))
      throw new Error('Формула или формат ссылается на неизвестную ячейку');
}
export function validateBoardArchive(
  value: unknown,
): asserts value is BoardArchive {
  assertSafeJson(value);
  const a = value as BoardArchive;
  if (a?.format !== 'modelboard' || a.version !== 1)
    throw new Error('Неподдерживаемая версия архива ModelBoard');
  for (const key of [
    'nodes',
    'edges',
    'strokes',
    'datasets',
    'relations',
    'templates',
    'files',
  ] as const)
    if (!Array.isArray(a[key])) throw new Error(`В архиве отсутствует ${key}`);
  if (
    a.nodes.length > FILE_LIMITS.maxNodes ||
    a.edges.length > 5000 ||
    a.strokes.length > 2000 ||
    a.datasets.length > FILE_LIMITS.maxDatasets ||
    a.relations.length > 1000 ||
    a.files.length > 100 ||
    a.templates.length > 100
  )
    throw new Error('Архив превышает ограничения');
  const all = new Set<string>();
  const add = (id: string) => {
    if (typeof id !== 'string' || !id || id.length > 250 || all.has(id))
      throw new Error('Пустой или повторяющийся ID в архиве');
    all.add(id);
  };
  for (const ds of a.datasets) {
    add(ds.id);
    validateDatasetFile(ds);
    for (const item of [
      ...ds.columns,
      ...ds.rows,
      ...(ds.views ?? []),
      ...(ds.rules ?? []),
    ])
      add(item.id);
  }
  for (const list of [
    a.nodes,
    a.edges,
    a.strokes,
    a.relations,
    a.templates,
    a.files,
  ])
    for (const item of list) add(item.id);
  const datasets = new Map(a.datasets.map((d) => [d.id, d])),
    nodes = new Map(a.nodes.map((n) => [n.id, n]));
  for (const n of a.nodes) {
    if (
      ![
        'shape',
        'sticky',
        'text',
        'table',
        'device',
        'template',
        'relationView',
        'frame',
        'group',
        'freehand',
        'image',
      ].includes(n.type) ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y)
    )
      throw new Error('Некорректный объект доски');
    if (
      (n.parentId ?? n.data?.containerId) &&
      !nodes.has(n.parentId ?? n.data?.containerId)
    )
      throw new Error('Не найден контейнер');
    const chain = new Set([n.id]);
    let parent = n.parentId ?? n.data?.containerId;
    while (parent) {
      if (chain.has(parent)) throw new Error('Цикл контейнеров');
      chain.add(parent);
      parent =
        nodes.get(parent)?.parentId ?? nodes.get(parent)?.data?.containerId;
    }
    if (n.style)
      for (const [key, value] of Object.entries(n.style)) {
        if (
          ![
            'width',
            'height',
            'zIndex',
            'opacity',
            'background',
            'backgroundColor',
            'color',
            'border',
            'borderRadius',
          ].includes(key) &&
          !key.startsWith('--canvas-')
        )
          throw new Error('Неподдерживаемое оформление объекта');
        if (
          typeof value === 'string' &&
          /url\s*\(|expression\s*\(|@import|javascript:/i.test(value)
        )
          throw new Error('Внешние ресурсы в оформлении не поддерживаются');
      }
    const b = n.data?.binding,
      dsid = n.data?.datasetId ?? b?.datasetId;
    if (dsid && !datasets.has(dsid))
      throw new Error('В архиве отсутствует связанная таблица');
    if (b) {
      const ds = datasets.get(b.datasetId);
      if (
        !ds ||
        (b.rowId && !ds.rows.some((r) => r.id === b.rowId)) ||
        (b.columnId && !ds.columns.some((c) => c.id === b.columnId))
      )
        throw new Error('Неверная привязка объекта');
      const fields = [
        b.presentation?.titleColumnId,
        b.presentation?.subtitleColumnId,
        b.presentation?.statusColumnId,
        ...(b.presentation?.fieldColumnIds ?? []),
      ].filter(Boolean);
      if (fields.some((id) => !ds.columns.some((c) => c.id === id)))
        throw new Error('Не найдены поля представления объекта');
    }
    if (
      n.type === 'template' &&
      !a.templates.some((t) => t.id === n.data?.templateId)
    )
      throw new Error('Отсутствует SVG-шаблон');
    if (n.type === 'image' && !a.files.some((f) => f.id === n.data?.assetId))
      throw new Error('Отсутствует изображение');
  }
  for (const e of a.edges)
    if (!nodes.has(e.source) || !nodes.has(e.target))
      throw new Error('Линия ссылается на отсутствующий объект');
  for (const r of a.relations) {
    const source = datasets.get(r.sourceDatasetId),
      target = datasets.get(r.targetDatasetId);
    if (
      !source ||
      !target ||
      !['REFERENCE', 'FOREIGN_KEY', 'DEPENDENCY', 'MAP', 'FLOW'].includes(
        r.relationType,
      ) ||
      (r.cardinality != null &&
        !['1:1', '1:N', 'N:1', 'N:M'].includes(r.cardinality))
    )
      throw new Error('Некорректная связь');
    if (r.matchMode === 'ROW_LINKS') {
      for (const pair of r.links ?? [])
        if (
          !source.rows.some((row) => row.id === pair.sourceRowId) ||
          !target.rows.some((row) => row.id === pair.targetRowId)
        )
          throw new Error('Не найдены связанные записи');
    } else if (
      !source.columns.some((c) => c.id === r.sourceColumnId) ||
      !target.columns.some((c) => c.id === r.targetColumnId)
    )
      throw new Error('Не найдены поля связи');
    if (
      r.enforceIntegrity ||
      r.relationType === 'FOREIGN_KEY' ||
      r.matchMode === 'ROW_LINKS'
    ) {
      const report =
        r.matchMode === 'ROW_LINKS'
          ? validateRecordLinks(r, source.rows, target.rows)
          : validateRelationData(r, source.rows, target.rows);
      if (!report.valid)
        throw new Error(
          'Некорректная связь в архиве: ' + report.issues.join('; '),
        );
    }
  }
  const relationIds = new Set(a.relations.map((r) => r.id));
  for (const n of a.nodes) {
    if (
      (n.data?.relationId && !relationIds.has(n.data.relationId)) ||
      n.data?.binding?.relationPath?.some((id: string) => !relationIds.has(id))
    )
      throw new Error('Отсутствует отношение объекта');
  }
}
const referenceKeys = new Set([
  'id',
  'datasetId',
  'sourceDatasetId',
  'targetDatasetId',
  'rowId',
  'columnId',
  'sourceColumnId',
  'targetColumnId',
  'sourceRowId',
  'targetRowId',
  'relationId',
  'templateId',
  'assetId',
  'parentId',
  'containerId',
  'parentNodeId',
  'boardObjectId',
  'source',
  'target',
  'savedViewId',
  'titleColumnId',
  'subtitleColumnId',
  'statusColumnId',
]);
export function remapBoardArchive(a: BoardArchive, uuid: () => string) {
  validateBoardArchive(a);
  const ids = new Map<string, string>();
  for (const list of [
    a.nodes,
    a.edges,
    a.strokes,
    a.datasets,
    a.relations,
    a.templates,
    a.files,
  ])
    for (const item of list) ids.set(item.id!, uuid());
  for (const ds of a.datasets)
    for (const item of [
      ...ds.columns,
      ...ds.rows,
      ...(ds.views ?? []),
      ...(ds.rules ?? []),
    ])
      ids.set(item.id, uuid());
  const ref = (id: string) => ids.get(id) ?? id;
  const deep = (value: any, key = ''): any => {
    if (typeof value === 'string') {
      if (
        referenceKeys.has(key) ||
        ['fieldColumnIds', 'hiddenColumns', 'relationPath'].includes(key)
      )
        return ref(value);
      if (key === 'sourceHandle' || key === 'targetHandle')
        return value.replace(
          /^(source|target):(.+)$/,
          (all, prefix, id) => `${prefix}:${ref(id)}`,
        );
      if (key === 'expression') return remapFormulaIds(value, ids);
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => deep(v, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          ['filters', 'columnWidths'].includes(key) ? ref(k) : k,
          deep(v, k),
        ]),
      );
    return value;
  };
  return {
    ...deep(a),
    datasets: a.datasets.map((ds) => ({
      ...deep({ ...ds, rows: [], formulas: [] }),
      rows: ds.rows.map((r) => ({
        ...r,
        id: ref(r.id),
        values: Object.fromEntries(
          Object.entries(r.values).map(([key, v]) => [ref(key), v]),
        ),
      })),
      formulas: (ds.formulas ?? []).map((f) => deep(f)),
    })),
  } as BoardArchive;
}
