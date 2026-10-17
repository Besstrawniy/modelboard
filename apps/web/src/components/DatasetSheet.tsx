import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Check,
  ClipboardPaste,
  Copy,
  Database,
  Pencil,
  Plus,
  Search,
  Sigma,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DatasetCellValue,
  DatasetColumn,
  DatasetFormula,
  DatasetRow,
} from '@modelboard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import {
  compileFormula,
  formatFormula,
  formulaKey,
} from '../lib/formulas';

const PAGE_SIZE = 200;

type SortState = {
  columnId: string;
  direction: 'asc' | 'desc';
} | null;

type CellSelectionRange = {
  columnId: string;
  startRowId: string;
  endRowId: string;
};

type AutofillDrag = {
  columnId: string;
  sourceStart: number;
  sourceEnd: number;
  targetEnd: number;
};

function compareValues(a: DatasetCellValue, b: DatasetCellValue) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function normalizeInput(value: string, column: DatasetColumn): DatasetCellValue {
  if (value === '') return null;

  if (column.dataType === 'BOOLEAN') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    return value;
  }

  if (column.dataType === 'INTEGER' && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return value;
}

type ConversionFailure = {
  rowId: string;
  ordinal: number;
  value: DatasetCellValue;
  reason: string;
};

type ConversionPreview = {
  values: Record<string, DatasetCellValue>;
  convertedCount: number;
  nullCount: number;
  unchangedCount: number;
  failures: ConversionFailure[];
};

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function convertCellValue(
  value: DatasetCellValue | undefined,
  targetType: DatasetColumn['dataType'],
): { ok: true; value: DatasetCellValue } | { ok: false; reason: string } {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return { ok: true, value: null };
  }

  if (targetType === 'TEXT') {
    return { ok: true, value: String(value) };
  }

  if (targetType === 'INTEGER') {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return { ok: true, value };
    }

    if (
      typeof value === 'string' &&
      /^[+-]?\d+$/.test(value.trim())
    ) {
      const parsed = Number(value.trim());
      if (Number.isSafeInteger(parsed)) {
        return { ok: true, value: parsed };
      }
    }

    return {
      ok: false,
      reason: 'Ожидается целое безопасное число',
    };
  }

  if (targetType === 'BOOLEAN') {
    if (typeof value === 'boolean') {
      return { ok: true, value };
    }

    if (typeof value === 'number' && (value === 0 || value === 1)) {
      return { ok: true, value: value === 1 };
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return { ok: true, value: true };
      }
      if (normalized === 'false' || normalized === '0') {
        return { ok: true, value: false };
      }
    }

    return {
      ok: false,
      reason: 'Допустимы true/false или 1/0',
    };
  }

  if (targetType === 'DATE') {
    if (typeof value === 'string' && isIsoDate(value.trim())) {
      return { ok: true, value: value.trim() };
    }

    return {
      ok: false,
      reason: 'Ожидается дата YYYY-MM-DD',
    };
  }

  if (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    return { ok: true, value: value.trim().toLowerCase() };
  }

  return {
    ok: false,
    reason: 'Ожидается UUID RFC 4122',
  };
}

function SheetCell({
  row,
  column,
  readOnly,
  onChange,
  onFocus,
  onNavigate,
  formulaActive = false,
}: {
  row: DatasetRow;
  column: DatasetColumn;
  readOnly: boolean;
  onChange: (value: DatasetCellValue) => void;
  onFocus?: () => void;
  onNavigate?: (
    direction: 'up' | 'down' | 'left' | 'right',
  ) => void;
  formulaActive?: boolean;
}) {
  const raw = row.values[column.id];

  if (column.dataType === 'BOOLEAN' && !formulaActive) {
    return (
      <select
        className="dataset-sheet__cell-editor"
        disabled={readOnly}
        value={raw === null || raw === undefined ? '' : String(raw)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            onNavigate?.(
              event.key === 'Tab'
                ? event.shiftKey
                  ? 'left'
                  : 'right'
                : event.shiftKey
                  ? 'up'
                  : 'down',
            );
          }
        }}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value === ''
              ? null
              : value === 'true'
                ? true
                : false,
          );
        }}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      className="dataset-sheet__cell-editor"
      disabled={readOnly}
      value={raw === null || raw === undefined ? '' : String(raw)}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          onNavigate?.(
            event.key === 'Tab'
              ? event.shiftKey
                ? 'left'
                : 'right'
              : event.shiftKey
                ? 'up'
                : 'down',
          );
          return;
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          onNavigate?.(
            event.key === 'ArrowUp' ? 'up' : 'down',
          );
          return;
        }

        if (
          event.key === 'ArrowLeft' &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0
        ) {
          event.preventDefault();
          onNavigate?.('left');
          return;
        }

        if (
          event.key === 'ArrowRight' &&
          event.currentTarget.selectionStart ===
            event.currentTarget.value.length &&
          event.currentTarget.selectionEnd ===
            event.currentTarget.value.length
        ) {
          event.preventDefault();
          onNavigate?.('right');
        }
      }}
      onChange={(event) =>
        onChange(normalizeInput(event.target.value, column))
      }
    />
  );
}

export function DatasetSheet({
  datasetId,
  token,
  readOnly,
  focusRowId,
  onClose,
}: {
  datasetId: string;
  token: string;
  readOnly: boolean;
  focusRowId?: string;
  onClose: () => void;
}) {
  const {
    dataset,
    status,
    synced,
    setCell,
    setFormula,
    clearFormula,
    applyCellBatch,
    addColumn,
    renameColumn,
    convertColumn,
    deleteColumn,
    addRow,
    deleteRow,
  } = useCollaborativeDataset(
    datasetId,
    token,
    readOnly,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [rowAction, setRowAction] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [columnDialog, setColumnDialog] = useState<{
    mode: 'create' | 'rename';
    columnId?: string;
    initialName?: string;
  } | null>(null);
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] =
    useState<DatasetColumn['dataType']>('TEXT');
  const [columnBusy, setColumnBusy] = useState(false);
  const [columnError, setColumnError] = useState('');
  const [deleteColumnTarget, setDeleteColumnTarget] =
    useState<DatasetColumn | null>(null);
  const [convertColumnTarget, setConvertColumnTarget] =
    useState<DatasetColumn | null>(null);
  const [convertType, setConvertType] =
    useState<DatasetColumn['dataType']>('TEXT');
  const [selectedCell, setSelectedCell] = useState<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const [formulaInput, setFormulaInput] = useState('');
  const [formulaError, setFormulaError] = useState('');
  const [selectionRange, setSelectionRange] =
    useState<CellSelectionRange | null>(null);
  const [autofillDrag, setAutofillDrag] =
    useState<AutofillDrag | null>(null);
  const [clipboardMessage, setClipboardMessage] = useState('');
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setPage(0);
  }, [datasetId, query, sort?.columnId, sort?.direction]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        `modelboard:dataset-widths:${datasetId}`,
      );
      setColumnWidths(
        raw ? JSON.parse(raw) : {},
      );
    } catch {
      setColumnWidths({});
    }
  }, [datasetId]);

  useEffect(() => {
    localStorage.setItem(
      `modelboard:dataset-widths:${datasetId}`,
      JSON.stringify(columnWidths),
    );
  }, [columnWidths, datasetId]);

  useEffect(() => {
    if (!dataset || !focusRowId || query || sort) return;

    const rowIndex = dataset.rows.findIndex(
      (row) => row.id === focusRowId,
    );

    if (rowIndex >= 0) {
      setPage(Math.floor(rowIndex / PAGE_SIZE));
    }
  }, [
    dataset?.id,
    dataset?.rows.length,
    focusRowId,
    query,
    sort?.columnId,
    sort?.direction,
  ]);

  const formulaByCell = useMemo(
    () =>
      new Map(
        (dataset?.formulas ?? []).map((formula) => [
          formulaKey(formula.rowId, formula.columnId),
          formula,
        ]),
      ),
    [dataset?.formulas],
  );

  const rowIndexById = useMemo(
    () =>
      new Map(
        (dataset?.rows ?? []).map((row, index) => [
          row.id,
          index,
        ]),
      ),
    [dataset?.rows],
  );

  const selectionBounds = useMemo(() => {
    if (!selectionRange || !dataset) return null;

    const start = rowIndexById.get(
      selectionRange.startRowId,
    );
    const end = rowIndexById.get(
      selectionRange.endRowId,
    );

    if (start === undefined || end === undefined) {
      return null;
    }

    return {
      columnId: selectionRange.columnId,
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }, [dataset, rowIndexById, selectionRange]);

  const selectedColumn = selectedCell
    ? dataset?.columns.find(
        (column) => column.id === selectedCell.columnId,
      )
    : undefined;

  const selectedRow = selectedCell
    ? dataset?.rows.find((row) => row.id === selectedCell.rowId)
    : undefined;

  const selectedFormula: DatasetFormula | undefined =
    selectedCell
      ? formulaByCell.get(
          formulaKey(
            selectedCell.rowId,
            selectedCell.columnId,
          ),
        )
      : undefined;

  useEffect(() => {
    if (!selectedCell || !selectedColumn || !selectedRow) {
      setFormulaInput('');
      setFormulaError('');
      return;
    }

    setFormulaInput(
      selectedFormula
        ? formatFormula(
            selectedFormula.expression,
            dataset?.columns ?? [],
          )
        : String(
            selectedRow.values[selectedColumn.id] ?? '',
          ),
    );
    setFormulaError('');
  }, [
    dataset?.columns,
    selectedCell?.columnId,
    selectedCell?.rowId,
    selectedColumn?.id,
    selectedFormula?.expression,
    selectedRow?.id,
    selectedRow?.values,
  ]);

  const commitFormulaBar = () => {
    if (
      readOnly ||
      !selectedCell ||
      !selectedColumn
    ) {
      return;
    }

    setFormulaError('');

    try {
      const trimmed = formulaInput.trim();

      if (trimmed.startsWith('=')) {
        const canonical = compileFormula(
          trimmed,
          dataset?.columns ?? [],
        );
        setFormula(
          selectedCell.rowId,
          selectedCell.columnId,
          canonical,
        );
      } else {
        clearFormula(
          selectedCell.rowId,
          selectedCell.columnId,
        );
        setCell(
          selectedCell.rowId,
          selectedCell.columnId,
          normalizeInput(trimmed, selectedColumn),
        );
      }
    } catch (error) {
      setFormulaError(
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  };

  useEffect(() => {
    if (query || sort) {
      setAutofillDrag(null);
      setSelectionRange(null);
    }
  }, [query, sort]);

  const selectCell = (
    event: React.MouseEvent,
    rowId: string,
    columnId: string,
  ) => {
    setSelectedCell({ rowId, columnId });

    if (
      event.shiftKey &&
      selectionRange?.columnId === columnId
    ) {
      setSelectionRange({
        ...selectionRange,
        endRowId: rowId,
      });
      return;
    }

    setSelectionRange({
      columnId,
      startRowId: rowId,
      endRowId: rowId,
    });
  };

  const applyAutofill = (drag: AutofillDrag) => {
    if (
      !dataset ||
      drag.targetEnd <= drag.sourceEnd
    ) {
      return;
    }

    const sourceRows = dataset.rows.slice(
      drag.sourceStart,
      drag.sourceEnd + 1,
    );
    const targetRows = dataset.rows.slice(
      drag.sourceEnd + 1,
      drag.targetEnd + 1,
    );

    if (
      sourceRows.length === 0 ||
      targetRows.length === 0
    ) {
      return;
    }

    const source = sourceRows.map((row) => ({
      value: row.values[drag.columnId] ?? null,
      formula: formulaByCell.get(
        formulaKey(row.id, drag.columnId),
      ),
    }));

    const numeric =
      source.length >= 2 &&
      source.every(
        (item) =>
          !item.formula &&
          typeof item.value === 'number' &&
          Number.isFinite(item.value),
      );

    let arithmetic = false;
    let step = 0;

    if (numeric) {
      const values = source.map(
        (item) => item.value as number,
      );
      step = values[1] - values[0];
      arithmetic = values
        .slice(2)
        .every(
          (value, index) =>
            Math.abs(
              value - values[index + 1] - step,
            ) < 1e-9,
        );
    }

    const writes = targetRows.map((row, index) => {
      if (numeric && arithmetic) {
        const last =
          source[source.length - 1].value as number;
        return {
          rowId: row.id,
          columnId: drag.columnId,
          value: last + step * (index + 1),
          formulaExpression: null,
        };
      }

      const template = source[index % source.length];

      if (template.formula) {
        return {
          rowId: row.id,
          columnId: drag.columnId,
          formulaExpression:
            template.formula.expression,
        };
      }

      return {
        rowId: row.id,
        columnId: drag.columnId,
        value: template.value,
        formulaExpression: null,
      };
    });

    applyCellBatch(writes);

    const targetRow =
      dataset.rows[drag.targetEnd];

    if (targetRow) {
      setSelectionRange({
        columnId: drag.columnId,
        startRowId:
          dataset.rows[drag.sourceStart].id,
        endRowId: targetRow.id,
      });
      setSelectedCell({
        rowId: targetRow.id,
        columnId: drag.columnId,
      });
    }
  };

  const beginAutofill = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    if (
      readOnly ||
      !selectionBounds ||
      query ||
      sort
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(
      event.pointerId,
    );

    setAutofillDrag({
      columnId: selectionBounds.columnId,
      sourceStart: selectionBounds.start,
      sourceEnd: selectionBounds.end,
      targetEnd: selectionBounds.end,
    });
  };

  const moveAutofill = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    if (!autofillDrag) return;

    const element = document.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    const cell = element?.closest(
      'td[data-row-id][data-column-id]',
    ) as HTMLTableCellElement | null;

    if (
      !cell ||
      cell.dataset.columnId !==
        autofillDrag.columnId
    ) {
      return;
    }

    const rowId = cell.dataset.rowId;
    if (!rowId) return;

    const index = rowIndexById.get(rowId);
    if (
      index === undefined ||
      index < autofillDrag.sourceEnd
    ) {
      return;
    }

    setAutofillDrag((current) =>
      current
        ? {
            ...current,
            targetEnd: index,
          }
        : current,
    );
  };

  const finishAutofill = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    if (!autofillDrag) return;

    applyAutofill(autofillDrag);
    setAutofillDrag(null);

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  };

  const focusCell = (
    rowId: string,
    columnId: string,
  ) => {
    if (!dataset) return;

    const rowIndex = dataset.rows.findIndex(
      (row) => row.id === rowId,
    );
    if (rowIndex >= 0) {
      setPage(Math.floor(rowIndex / PAGE_SIZE));
    }

    setSelectedCell({ rowId, columnId });
    setSelectionRange({
      columnId,
      startRowId: rowId,
      endRowId: rowId,
    });

    window.requestAnimationFrame(() => {
      const editor = sheetRef.current?.querySelector(
        `td[data-row-id="${rowId}"][data-column-id="${columnId}"] .dataset-sheet__cell-editor`,
      ) as HTMLInputElement | HTMLSelectElement | null;

      editor?.focus();
      if (editor instanceof HTMLInputElement) {
        editor.select();
      }
    });
  };

  const moveSelectedCell = (
    direction: 'up' | 'down' | 'left' | 'right',
  ) => {
    if (!dataset || !selectedCell) return;

    const rowIndex = dataset.rows.findIndex(
      (row) => row.id === selectedCell.rowId,
    );
    const columnIndex = dataset.columns.findIndex(
      (column) => column.id === selectedCell.columnId,
    );
    if (rowIndex < 0 || columnIndex < 0) return;

    let nextRow = rowIndex;
    let nextColumn = columnIndex;

    if (direction === 'up') nextRow -= 1;
    if (direction === 'down') nextRow += 1;
    if (direction === 'left') nextColumn -= 1;
    if (direction === 'right') nextColumn += 1;

    if (nextColumn >= dataset.columns.length) {
      nextColumn = 0;
      nextRow += 1;
    }
    if (nextColumn < 0) {
      nextColumn = dataset.columns.length - 1;
      nextRow -= 1;
    }

    nextRow = Math.max(
      0,
      Math.min(dataset.rows.length - 1, nextRow),
    );

    const row = dataset.rows[nextRow];
    const column = dataset.columns[nextColumn];
    if (row && column) {
      focusCell(row.id, column.id);
    }
  };

  const copyCells = async () => {
    if (!dataset || !selectedCell) return;

    setClipboardMessage('');

    const column = dataset.columns.find(
      (item) => item.id === selectedCell.columnId,
    );
    if (!column) return;

    const rows =
      selectionBounds?.columnId === column.id
        ? dataset.rows.slice(
            selectionBounds.start,
            selectionBounds.end + 1,
          )
        : dataset.rows.filter(
            (row) => row.id === selectedCell.rowId,
          );

    const text = rows
      .map((row) => {
        const formula = formulaByCell.get(
          formulaKey(row.id, column.id),
        );

        return formula
          ? formatFormula(
              formula.expression,
              dataset.columns,
            )
          : String(row.values[column.id] ?? '');
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setClipboardMessage(
        rows.length > 1
          ? `Скопировано ячеек: ${rows.length}`
          : 'Ячейка скопирована',
      );
    } catch {
      setClipboardMessage(
        'Браузер не разрешил доступ к clipboard.',
      );
    }
  };

  const pasteCells = async () => {
    if (
      readOnly ||
      !dataset ||
      !selectedCell
    ) {
      return;
    }

    if (query || sort) {
      setClipboardMessage(
        'Перед вставкой уберите поиск и сортировку, чтобы порядок строк был однозначным.',
      );
      return;
    }

    setClipboardMessage('');

    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setClipboardMessage(
        'Браузер не разрешил чтение clipboard.',
      );
      return;
    }

    const matrix = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line, index, all) =>
        !(index === all.length - 1 && line === ''),
      )
      .map((line) => line.split('\t'));

    if (matrix.length === 0) return;

    const startRowIndex = dataset.rows.findIndex(
      (row) => row.id === selectedCell.rowId,
    );
    const startColumnIndex = dataset.columns.findIndex(
      (column) => column.id === selectedCell.columnId,
    );

    if (startRowIndex < 0 || startColumnIndex < 0) {
      return;
    }

    const requiredColumns =
      Math.max(...matrix.map((row) => row.length));

    if (
      startColumnIndex + requiredColumns >
      dataset.columns.length
    ) {
      setClipboardMessage(
        'В clipboard больше колонок, чем помещается справа. Сначала добавьте колонки.',
      );
      return;
    }

    const targetRows = [...dataset.rows];
    const requiredRows = startRowIndex + matrix.length;

    while (
      targetRows.length < requiredRows &&
      !readOnly
    ) {
      const row = await addRow();
      if (!row) break;
      targetRows.push(row);
    }

    if (targetRows.length < requiredRows) {
      setClipboardMessage(
        'Не удалось создать достаточно строк для вставки.',
      );
      return;
    }

    const writes: Array<{
      rowId: string;
      columnId: string;
      value?: DatasetCellValue;
      formulaExpression?: string | null;
    }> = [];

    try {
      for (
        let rowOffset = 0;
        rowOffset < matrix.length;
        rowOffset += 1
      ) {
        const targetRow =
          targetRows[startRowIndex + rowOffset];

        for (
          let columnOffset = 0;
          columnOffset < matrix[rowOffset].length;
          columnOffset += 1
        ) {
          const column =
            dataset.columns[
              startColumnIndex + columnOffset
            ];
          const raw = matrix[rowOffset][columnOffset];

          if (raw.trim().startsWith('=')) {
            writes.push({
              rowId: targetRow.id,
              columnId: column.id,
              formulaExpression: compileFormula(
                raw.trim(),
                dataset.columns,
              ),
            });
          } else {
            writes.push({
              rowId: targetRow.id,
              columnId: column.id,
              value: normalizeInput(raw, column),
              formulaExpression: null,
            });
          }
        }
      }
    } catch (error) {
      setClipboardMessage(
        error instanceof Error
          ? error.message
          : String(error),
      );
      return;
    }

    applyCellBatch(writes);

    const lastRow =
      targetRows[startRowIndex + matrix.length - 1];
    const lastColumn =
      dataset.columns[
        startColumnIndex + requiredColumns - 1
      ];

    if (lastRow && lastColumn) {
      setSelectedCell({
        rowId: lastRow.id,
        columnId: lastColumn.id,
      });
      setPage(
        Math.floor(
          (startRowIndex + matrix.length - 1) /
            PAGE_SIZE,
        ),
      );
    }

    setClipboardMessage(
      `Вставлено ячеек: ${writes.length}`,
    );
  };

  const columnWidth = (columnId: string) =>
    Math.max(
      90,
      Math.min(640, columnWidths[columnId] ?? 180),
    );

  const beginColumnResize = (
    event: React.PointerEvent<HTMLSpanElement>,
    columnId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const th = event.currentTarget.closest('th');
    const width =
      th?.getBoundingClientRect().width ??
      columnWidth(columnId);

    resizeRef.current = {
      columnId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(
      event.pointerId,
    );
  };

  const moveColumnResize = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    const resize = resizeRef.current;
    if (!resize) return;

    const next = Math.max(
      90,
      Math.min(
        640,
        resize.startWidth +
          event.clientX -
          resize.startX,
      ),
    );

    setColumnWidths((current) => ({
      ...current,
      [resize.columnId]: Math.round(next),
    }));
  };

  const finishColumnResize = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    resizeRef.current = null;
    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  };

  const visibleRows = useMemo(() => {
    if (!dataset) return [];

    const normalizedQuery = query.trim().toLowerCase();

    let result = normalizedQuery
      ? dataset.rows.filter((row) =>
          dataset.columns.some((column) =>
            String(row.values[column.id] ?? '')
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        )
      : [...dataset.rows];

    if (sort) {
      result = result.sort((left, right) => {
        const compared = compareValues(
          left.values[sort.columnId],
          right.values[sort.columnId],
        );
        return sort.direction === 'asc' ? compared : -compared;
      });
    }

    return result;
  }, [dataset, query, sort]);

  const conversionPreview = useMemo<ConversionPreview | null>(() => {
    if (!dataset || !convertColumnTarget) return null;

    const values: Record<string, DatasetCellValue> = {};
    const failures: ConversionFailure[] = [];
    let convertedCount = 0;
    let nullCount = 0;
    let unchangedCount = 0;

    for (const row of dataset.rows) {
      const source = row.values[convertColumnTarget.id];
      const converted = convertCellValue(source, convertType);

      if (!converted.ok) {
        failures.push({
          rowId: row.id,
          ordinal: row.ordinal,
          value: source ?? null,
          reason: converted.reason,
        });
        continue;
      }

      values[row.id] = converted.value;

      if (converted.value === null) {
        nullCount += 1;
      } else if (
        typeof source === typeof converted.value &&
        source === converted.value
      ) {
        unchangedCount += 1;
      } else {
        convertedCount += 1;
      }
    }

    return {
      values,
      convertedCount,
      nullCount,
      unchangedCount,
      failures,
    };
  }, [convertColumnTarget, convertType, dataset]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = visibleRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const toggleSort = (columnId: string) => {
    setSort((current) => {
      if (!current || current.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { columnId, direction: 'desc' };
      }

      return null;
    });
  };

  return (
    <div className="dataset-sheet" ref={sheetRef}>
      {columnDialog && (
        <div className="dataset-sheet__dialog-backdrop">
          <section className="dataset-sheet__column-dialog">
            <header>
              <strong>
                {columnDialog.mode === 'create'
                  ? 'Новая колонка'
                  : 'Переименовать колонку'}
              </strong>
              <button
                className="icon-button"
                onClick={() => setColumnDialog(null)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="dataset-sheet__column-dialog-body">
              <label>
                Название
                <input
                  autoFocus
                  maxLength={120}
                  value={columnName}
                  onChange={(event) =>
                    setColumnName(event.target.value)
                  }
                />
              </label>

              {columnDialog.mode === 'create' && (
                <label>
                  Тип данных
                  <select
                    value={columnType}
                    onChange={(event) =>
                      setColumnType(
                        event.target.value as DatasetColumn['dataType'],
                      )
                    }
                  >
                    <option value="TEXT">TEXT</option>
                    <option value="INTEGER">INTEGER</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="DATE">DATE</option>
                    <option value="UUID">UUID</option>
                  </select>
                </label>
              )}

              {columnError && (
                <div className="dataset-sheet__column-error">
                  {columnError}
                </div>
              )}
            </div>

            <footer>
              <button
                className="secondary-button"
                disabled={columnBusy}
                onClick={() => setColumnDialog(null)}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={columnBusy || !columnName.trim()}
                onClick={async () => {
                  setColumnBusy(true);
                  setColumnError('');
                  try {
                    if (
                      columnDialog.mode === 'rename' &&
                      columnDialog.columnId
                    ) {
                      await renameColumn(
                        columnDialog.columnId,
                        columnName.trim(),
                      );
                    } else {
                      await addColumn(
                        columnName.trim(),
                        columnType,
                      );
                    }
                    setColumnDialog(null);
                  } catch (error) {
                    setColumnError(
                      error instanceof Error
                        ? error.message
                        : String(error),
                    );
                  } finally {
                    setColumnBusy(false);
                  }
                }}
              >
                {columnBusy
                  ? 'Сохранение…'
                  : columnDialog.mode === 'create'
                    ? 'Создать'
                    : 'Сохранить'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {convertColumnTarget && conversionPreview && (
        <div className="dataset-sheet__dialog-backdrop">
          <section className="dataset-sheet__column-dialog dataset-sheet__column-dialog--wide">
            <header>
              <strong>Изменить тип колонки</strong>
              <button
                className="icon-button"
                onClick={() => setConvertColumnTarget(null)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="dataset-sheet__column-dialog-body">
              <div className="dataset-sheet__conversion-title">
                <strong>{convertColumnTarget.name}</strong>
                <span>{convertColumnTarget.dataType}</span>
                <span>→</span>
                <select
                  value={convertType}
                  onChange={(event) =>
                    setConvertType(
                      event.target.value as DatasetColumn['dataType'],
                    )
                  }
                >
                  <option value="TEXT">TEXT</option>
                  <option value="INTEGER">INTEGER</option>
                  <option value="BOOLEAN">BOOLEAN</option>
                  <option value="DATE">DATE</option>
                  <option value="UUID">UUID</option>
                </select>
              </div>

              <div className="dataset-sheet__conversion-stats">
                <span>
                  <strong>{conversionPreview.convertedCount}</strong>
                  преобразуется
                </span>
                <span>
                  <strong>{conversionPreview.unchangedCount}</strong>
                  уже подходит
                </span>
                <span>
                  <strong>{conversionPreview.nullCount}</strong>
                  NULL
                </span>
                <span className={conversionPreview.failures.length ? 'is-error' : ''}>
                  <strong>{conversionPreview.failures.length}</strong>
                  ошибок
                </span>
              </div>

              {conversionPreview.failures.length > 0 ? (
                <div className="dataset-sheet__conversion-errors">
                  <strong>
                    Конвертацию нельзя применить, пока есть ошибки:
                  </strong>
                  {conversionPreview.failures.slice(0, 10).map((failure) => (
                    <div key={failure.rowId}>
                      <span>Строка {failure.ordinal + 1}</span>
                      <code>{String(failure.value)}</code>
                      <small>{failure.reason}</small>
                    </div>
                  ))}
                  {conversionPreview.failures.length > 10 && (
                    <p>
                      + ещё {conversionPreview.failures.length - 10} ошибок
                    </p>
                  )}
                </div>
              ) : (
                <p className="dataset-sheet__conversion-ok">
                  Все значения можно безопасно привести к выбранному типу.
                </p>
              )}

              {columnError && (
                <div className="dataset-sheet__column-error">
                  {columnError}
                </div>
              )}
            </div>

            <footer>
              <button
                className="secondary-button"
                disabled={columnBusy}
                onClick={() => setConvertColumnTarget(null)}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={
                  columnBusy ||
                  conversionPreview.failures.length > 0 ||
                  convertType === convertColumnTarget.dataType
                }
                onClick={async () => {
                  setColumnBusy(true);
                  setColumnError('');
                  try {
                    await convertColumn(
                      convertColumnTarget.id,
                      convertType,
                      conversionPreview.values,
                    );
                    setConvertColumnTarget(null);
                  } catch (error) {
                    setColumnError(
                      error instanceof Error
                        ? error.message
                        : String(error),
                    );
                  } finally {
                    setColumnBusy(false);
                  }
                }}
              >
                {columnBusy ? 'Конвертация…' : 'Применить'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {deleteColumnTarget && (
        <div className="dataset-sheet__dialog-backdrop">
          <section className="dataset-sheet__column-dialog">
            <header>
              <strong>Удалить колонку</strong>
              <button
                className="icon-button"
                onClick={() => setDeleteColumnTarget(null)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="dataset-sheet__column-dialog-body">
              <p className="dataset-sheet__delete-warning">
                Колонка <strong>{deleteColumnTarget.name}</strong> будет
                удалена из структуры Dataset и из всех строк.
                Если она используется relation или Object Binding,
                сервер запретит операцию.
              </p>

              {columnError && (
                <div className="dataset-sheet__column-error">
                  {columnError}
                </div>
              )}
            </div>

            <footer>
              <button
                className="secondary-button"
                disabled={columnBusy}
                onClick={() => setDeleteColumnTarget(null)}
              >
                Отмена
              </button>
              <button
                className="danger-button"
                disabled={columnBusy}
                onClick={async () => {
                  setColumnBusy(true);
                  setColumnError('');
                  try {
                    await deleteColumn(deleteColumnTarget.id);
                    setDeleteColumnTarget(null);
                  } catch (error) {
                    setColumnError(
                      error instanceof Error
                        ? error.message
                        : String(error),
                    );
                  } finally {
                    setColumnBusy(false);
                  }
                }}
              >
                <Trash2 size={14} />
                {columnBusy ? 'Удаление…' : 'Удалить'}
              </button>
            </footer>
          </section>
        </div>
      )}

      <header className="dataset-sheet__topbar">
        <div className="dataset-sheet__identity">
          <span className="dataset-sheet__icon">
            <Database size={18} />
          </span>
          <div>
            <strong>{dataset?.name ?? 'Dataset'}</strong>
            <small>
              {dataset?.kind ?? '—'} · {status}
            </small>
          </div>
        </div>

        <div className="dataset-sheet__stats">
          <span>{dataset?.rows.length ?? 0} строк</span>
          <span>{dataset?.columns.length ?? 0} колонок</span>
          {readOnly && <span>только чтение</span>}
        </div>

        <button
          className="icon-button"
          onClick={onClose}
          title="Закрыть (Esc)"
        >
          <X size={19} />
        </button>
      </header>

      <div className="dataset-sheet__formula-bar">
        <div className="dataset-sheet__formula-cell">
          {selectedCell && selectedColumn && selectedRow
            ? `${selectedColumn.name} · строка ${selectedRow.ordinal + 1}`
            : 'Ячейка не выбрана'}
        </div>

        <div className="dataset-sheet__formula-input-wrap">
          <Sigma size={15} />
          <input
            value={formulaInput}
            disabled={!selectedCell || readOnly}
            placeholder="Значение или формула: =[price]*[quantity]"
            onChange={(event) =>
              setFormulaInput(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitFormulaBar();
              }
            }}
          />
          {!readOnly && selectedCell && (
            <button
              onClick={commitFormulaBar}
              title="Применить (Enter)"
            >
              <Check size={14} />
            </button>
          )}
        </div>

        {formulaError ? (
          <div className="dataset-sheet__formula-error">
            {formulaError}
          </div>
        ) : (
          <div className="dataset-sheet__formula-hint">
            Shift-клик по второй ячейке колонки → потяните маркер вниз.
            Числа продолжают последовательность, формулы копируются по строкам.
          </div>
        )}
      </div>

      <div className="dataset-sheet__toolbar">
        <label className="dataset-sheet__search">
          <Search size={15} />
          <input
            value={query}
            placeholder="Поиск по всем колонкам…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <button
          className="dataset-sheet__clipboard-button"
          disabled={!selectedCell}
          onClick={() => void copyCells()}
          title="Копировать выбранную ячейку/диапазон"
        >
          <Copy size={14} />
          Копировать
        </button>

        {!readOnly && (
          <button
            className="dataset-sheet__clipboard-button"
            disabled={!selectedCell}
            onClick={() => void pasteCells()}
            title="Вставить из Excel / Google Sheets / clipboard"
          >
            <ClipboardPaste size={14} />
            Вставить
          </button>
        )}

        {!readOnly && (
          <button
            className="dataset-sheet__add-column"
            onClick={() => {
              setColumnDialog({ mode: 'create' });
              setColumnName('');
              setColumnType('TEXT');
              setColumnError('');
            }}
          >
            <Plus size={14} />
            Добавить колонку
          </button>
        )}

        {!readOnly && (
          <button
            className="dataset-sheet__add-row"
            disabled={rowAction === 'add'}
            onClick={async () => {
              setRowAction('add');
              setRowError('');
              try {
                setQuery('');
                setSort(null);
                const nextPage = Math.floor(
                  (dataset?.rows.length ?? 0) / PAGE_SIZE,
                );
                await addRow();
                setPage(nextPage);
              } catch (error) {
                setRowError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setRowAction(null);
              }
            }}
          >
            <Plus size={14} />
            Добавить строку
          </button>
        )}

        <div className="dataset-sheet__page-info">
          Показано {pageRows.length} из {visibleRows.length}
        </div>
      </div>

      <div className="dataset-sheet__viewport">
        {!dataset || !synced ? (
          <div className="dataset-sheet__loading">
            Синхронизация Dataset…
          </div>
        ) : dataset.columns.length === 0 ? (
          <div className="dataset-sheet__loading">В Dataset нет колонок.</div>
        ) : (
          <table className="dataset-sheet__table">
            <thead>
              <tr>
                <th className="dataset-sheet__row-number">#</th>
                {dataset.columns.map((column) => {
                  const activeSort = sort?.columnId === column.id;

                  return (
                    <th
                      key={column.id}
                      style={{
                        width: columnWidth(column.id),
                        minWidth: columnWidth(column.id),
                        maxWidth: columnWidth(column.id),
                      }}
                    >
                      <button
                        className="dataset-sheet__column-header"
                        onClick={() => toggleSort(column.id)}
                      >
                        <span>
                          <strong>
                            {column.name}
                            {!readOnly && (
                              <>
                              <span
                                className="dataset-sheet__rename-column"
                                role="button"
                                tabIndex={0}
                                title="Переименовать колонку"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setColumnDialog({
                                    mode: 'rename',
                                    columnId: column.id,
                                    initialName: column.name,
                                  });
                                  setColumnName(column.name);
                                  setColumnType(column.dataType);
                                  setColumnError('');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.stopPropagation();
                                    setColumnDialog({
                                      mode: 'rename',
                                      columnId: column.id,
                                      initialName: column.name,
                                    });
                                    setColumnName(column.name);
                                    setColumnType(column.dataType);
                                    setColumnError('');
                                  }
                                }}
                              >
                                <Pencil size={10} />
                              </span>
                              <span
                                className="dataset-sheet__delete-column"
                                role="button"
                                tabIndex={0}
                                title="Удалить колонку"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteColumnTarget(column);
                                  setColumnError('');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.stopPropagation();
                                    setDeleteColumnTarget(column);
                                    setColumnError('');
                                  }
                                }}
                              >
                                <Trash2 size={10} />
                              </span>
                              </>
                            )}
                          </strong>
                          <small>
                            <span
                              className={`dataset-sheet__column-type ${readOnly ? '' : 'is-editable'}`}
                              role={readOnly ? undefined : 'button'}
                              tabIndex={readOnly ? undefined : 0}
                              title={readOnly ? undefined : 'Изменить тип колонки'}
                              onClick={(event) => {
                                if (readOnly) return;
                                event.stopPropagation();
                                setConvertColumnTarget(column);
                                setConvertType(column.dataType);
                                setColumnError('');
                              }}
                              onKeyDown={(event) => {
                                if (
                                  !readOnly &&
                                  (event.key === 'Enter' || event.key === ' ')
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setConvertColumnTarget(column);
                                  setConvertType(column.dataType);
                                  setColumnError('');
                                }
                              }}
                            >
                              {column.dataType}
                            </span>
                            {column.key ? ` · ${column.key}` : ''}
                          </small>
                        </span>

                        {activeSort ? (
                          sort?.direction === 'asc'
                            ? <ArrowUp size={13} />
                            : <ArrowDown size={13} />
                        ) : (
                          <ArrowUpDown size={13} />
                        )}
                      </button>
                      <span
                        className="dataset-sheet__column-resizer"
                        title="Изменить ширину колонки"
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setColumnWidths((current) => {
                            const next = { ...current };
                            delete next[column.id];
                            return next;
                          });
                        }}
                        onPointerDown={(event) =>
                          beginColumnResize(
                            event,
                            column.id,
                          )
                        }
                        onPointerMove={moveColumnResize}
                        onPointerUp={finishColumnResize}
                        onPointerCancel={finishColumnResize}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={row.id === focusRowId ? 'is-focused' : ''}
                >
                  <th className="dataset-sheet__row-number">
                    <span>
                      {safePage * PAGE_SIZE + rowIndex + 1}
                    </span>
                    {!readOnly && (
                      <button
                        className="dataset-sheet__delete-row"
                        disabled={rowAction === row.id}
                        onClick={async () => {
                          setRowAction(row.id);
                          setRowError('');
                          try {
                            await deleteRow(row.id);
                          } catch (error) {
                            setRowError(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            );
                          } finally {
                            setRowAction(null);
                          }
                        }}
                        title="Удалить строку"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </th>

                  {dataset.columns.map((column) => {
                    const key = formulaKey(row.id, column.id);
                    const formula = formulaByCell.get(key);
                    const selected =
                      selectedCell?.rowId === row.id &&
                      selectedCell?.columnId === column.id;
                    const rowIndex =
                      rowIndexById.get(row.id) ?? -1;
                    const inRange =
                      selectionBounds?.columnId === column.id &&
                      rowIndex >= selectionBounds.start &&
                      rowIndex <= selectionBounds.end;
                    const fillPreview =
                      autofillDrag?.columnId === column.id &&
                      rowIndex > autofillDrag.sourceEnd &&
                      rowIndex <= autofillDrag.targetEnd;
                    const fillHandle =
                      !readOnly &&
                      !query &&
                      !sort &&
                      selectionBounds?.columnId === column.id &&
                      rowIndex === selectionBounds.end;

                    return (
                      <td
                        key={column.id}
                        data-row-id={row.id}
                        style={{
                          width: columnWidth(column.id),
                          minWidth: columnWidth(column.id),
                          maxWidth: columnWidth(column.id),
                        }}
                        data-column-id={column.id}
                        className={[
                          selected ? 'is-selected-cell' : '',
                          inRange ? 'is-range-selected' : '',
                          fillPreview ? 'is-fill-preview' : '',
                          formula ? 'has-formula' : '',
                        ].filter(Boolean).join(' ')}
                        onMouseDown={(event) =>
                          selectCell(
                            event,
                            row.id,
                            column.id,
                          )
                        }
                      >
                        {formula && (
                          <span
                            className="dataset-sheet__formula-badge"
                            title={formatFormula(
                              formula.expression,
                              dataset.columns,
                            )}
                          >
                            fx
                          </span>
                        )}
                        <SheetCell
                          row={row}
                          column={column}
                          readOnly={readOnly}
                          formulaActive={Boolean(formula)}
                          onFocus={() => {
                            setSelectedCell({
                              rowId: row.id,
                              columnId: column.id,
                            });
                            if (
                              selectionRange?.columnId !== column.id ||
                              !selectionBounds ||
                              rowIndex < selectionBounds.start ||
                              rowIndex > selectionBounds.end
                            ) {
                              setSelectionRange({
                                columnId: column.id,
                                startRowId: row.id,
                                endRowId: row.id,
                              });
                            }
                          }}
                          onNavigate={moveSelectedCell}
                          onChange={(value) =>
                            setCell(row.id, column.id, value)
                          }
                        />
                        {fillHandle && (
                          <span
                            className="dataset-sheet__fill-handle"
                            title="Потянуть вниз для автозаполнения"
                            onPointerDown={beginAutofill}
                            onPointerMove={moveAutofill}
                            onPointerUp={finishAutofill}
                            onPointerCancel={() =>
                              setAutofillDrag(null)
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {pageRows.length === 0 && (
                <tr>
                  <td
                    className="dataset-sheet__empty"
                    colSpan={dataset.columns.length + 1}
                  >
                    По запросу ничего не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {rowError && (
        <div className="dataset-sheet__error">
          {rowError}
        </div>
      )}

      {clipboardMessage && (
        <div className="dataset-sheet__clipboard-toast">
          {clipboardMessage}
          <button
            onClick={() => setClipboardMessage('')}
          >
            ×
          </button>
        </div>
      )}

      <footer className="dataset-sheet__footer">
        <div>
          Страница {safePage + 1} из {totalPages}
        </div>

        <div className="dataset-sheet__pagination">
          <button
            disabled={safePage <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={15} />
            Назад
          </button>
          <button
            disabled={safePage >= totalPages - 1}
            onClick={() =>
              setPage((value) => Math.min(totalPages - 1, value + 1))
            }
          >
            Далее
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}
