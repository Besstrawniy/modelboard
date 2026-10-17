import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold as BoldIcon,
  ChevronLeft,
  ChevronRight,
  Check,
  ClipboardPaste,
  Copy,
  Database,
  Filter,
  FilterX,
  Italic as ItalicIcon,
  PaintBucket,
  Pencil,
  Plus,
  Search,
  Sigma,
  Shapes,
  Trash2,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import type {
  DatasetCellFormat,
  DatasetCellValue,
  DatasetColumn,
  DatasetFormula,
  DatasetRow,
} from '@modelboard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';
import {
  columnLabel,
  compileFormula,
  formatFormula,
  formulaKey,
  translateFormulaForCopy,
} from '../lib/formulas';

const PAGE_SIZE = 200;

type SortState = {
  columnId: string;
  direction: 'asc' | 'desc';
} | null;

type CellSelectionRange = {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
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
  format,
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
  format?: DatasetCellFormat;
}) {
  const raw = row.values[column.id];

  if (column.dataType === 'BOOLEAN' && !formulaActive) {
    return (
      <select
        className="dataset-sheet__cell-editor"
        style={{
          fontWeight: format?.bold ? 700 : undefined,
          fontStyle: format?.italic ? 'italic' : undefined,
          textAlign:
            format?.align === 'CENTER'
              ? 'center'
              : format?.align === 'RIGHT'
                ? 'right'
                : format?.align === 'LEFT'
                  ? 'left'
                  : undefined,
          backgroundColor:
            format?.background || undefined,
        }}
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
      style={{
        fontWeight: format?.bold ? 700 : undefined,
        fontStyle: format?.italic ? 'italic' : undefined,
        textAlign:
          format?.align === 'CENTER'
            ? 'center'
            : format?.align === 'RIGHT'
              ? 'right'
              : format?.align === 'LEFT'
                ? 'left'
                : undefined,
        backgroundColor:
          format?.background || undefined,
      }}
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
  const { createBoundRowObject } = useBoardActions();
  const {
    dataset,
    status,
    synced,
    canUndo,
    canRedo,
    undo,
    redo,
    setCell,
    setFormula,
    clearFormula,
    applyCellBatch,
    applyFormatBatch,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnFilters, setColumnFilters] =
    useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [rowAction, setRowAction] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [columnDialog, setColumnDialog] = useState<{
    mode: 'create' | 'rename';
    columnId?: string;
    initialName?: string;
    afterColumnId?: string;
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
  const [cellMenu, setCellMenu] = useState<{
    x: number;
    y: number;
    rowId: string;
    columnId: string;
  } | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.stopPropagation();

      if (cellMenu) {
        setCellMenu(null);
        return;
      }

      onClose();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cellMenu, onClose]);

  useEffect(() => {
    if (!cellMenu) return;

    const close = () => setCellMenu(null);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [cellMenu]);


  const filterSignature = JSON.stringify(
    columnFilters,
  );
  const hasColumnFilters = Object.values(
    columnFilters,
  ).some((value) => value.trim() !== '');

  useEffect(() => {
    setPage(0);
  }, [
    datasetId,
    query,
    sort?.columnId,
    sort?.direction,
    filterSignature,
  ]);

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

  const formatByCell = useMemo(
    () =>
      new Map(
        (dataset?.formats ?? []).map((format) => [
          formulaKey(format.rowId, format.columnId),
          format,
        ]),
      ),
    [dataset?.formats],
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

    const startRow = rowIndexById.get(
      selectionRange.startRowId,
    );
    const endRow = rowIndexById.get(
      selectionRange.endRowId,
    );
    const startColumn = dataset.columns.findIndex(
      (column) =>
        column.id === selectionRange.startColumnId,
    );
    const endColumn = dataset.columns.findIndex(
      (column) =>
        column.id === selectionRange.endColumnId,
    );

    if (
      startRow === undefined ||
      endRow === undefined ||
      startColumn < 0 ||
      endColumn < 0
    ) {
      return null;
    }

    return {
      startRow: Math.min(startRow, endRow),
      endRow: Math.max(startRow, endRow),
      startColumn: Math.min(startColumn, endColumn),
      endColumn: Math.max(startColumn, endColumn),
    };
  }, [dataset, rowIndexById, selectionRange]);

  const selectedColumn = selectedCell
    ? dataset?.columns.find(
        (column) => column.id === selectedCell.columnId,
      )
    : undefined;

  const selectedRowIndex = selectedCell
    ? dataset?.rows.findIndex(
        (row) => row.id === selectedCell.rowId,
      ) ?? -1
    : -1;
  const selectedColumnIndex = selectedCell
    ? dataset?.columns.findIndex(
        (column) =>
          column.id === selectedCell.columnId,
      ) ?? -1
    : -1;
  const selectedAddress =
    selectedRowIndex >= 0 &&
    selectedColumnIndex >= 0
      ? `${columnLabel(selectedColumnIndex)}${selectedRowIndex + 1}`
      : '';

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
            dataset?.rows ?? [],
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
          dataset?.rows ?? [],
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
    if (query || sort || hasColumnFilters) {
      setAutofillDrag(null);
      setSelectionRange(null);
    }
  }, [hasColumnFilters, query, sort]);

  const selectCell = (
    event: React.MouseEvent,
    rowId: string,
    columnId: string,
  ) => {
    setSelectedCell({ rowId, columnId });

    if (event.shiftKey && selectionRange) {
      setSelectionRange({
        ...selectionRange,
        endRowId: rowId,
        endColumnId: columnId,
      });
      return;
    }

    setSelectionRange({
      startRowId: rowId,
      endRowId: rowId,
      startColumnId: columnId,
      endColumnId: columnId,
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
      rowId: row.id,
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
            translateFormulaForCopy(
              template.formula.expression,
              template.rowId,
              drag.columnId,
              row.id,
              drag.columnId,
              dataset.rows,
              dataset.columns,
            ),
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
        startRowId:
          dataset.rows[drag.sourceStart].id,
        endRowId: targetRow.id,
        startColumnId: drag.columnId,
        endColumnId: drag.columnId,
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
      selectionBounds.startColumn !==
        selectionBounds.endColumn ||
      query ||
      sort ||
      hasColumnFilters
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(
      event.pointerId,
    );

    setAutofillDrag({
      columnId:
        dataset!.columns[selectionBounds.startColumn].id,
      sourceStart: selectionBounds.startRow,
      sourceEnd: selectionBounds.endRow,
      targetEnd: selectionBounds.endRow,
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

  const formatCellsInSelection = (
    patch: Partial<
      Omit<DatasetCellFormat, 'rowId' | 'columnId'>
    >,
  ) => {
    if (!dataset || !selectedCell || readOnly) return;

    const fallbackRow = dataset.rows.findIndex(
      (row) => row.id === selectedCell.rowId,
    );
    const fallbackColumn = dataset.columns.findIndex(
      (column) => column.id === selectedCell.columnId,
    );
    if (fallbackRow < 0 || fallbackColumn < 0) return;

    const bounds = selectionBounds ?? {
      startRow: fallbackRow,
      endRow: fallbackRow,
      startColumn: fallbackColumn,
      endColumn: fallbackColumn,
    };

    const cells: Array<{
      rowId: string;
      columnId: string;
    }> = [];

    for (
      let rowIndex = bounds.startRow;
      rowIndex <= bounds.endRow;
      rowIndex += 1
    ) {
      for (
        let columnIndex = bounds.startColumn;
        columnIndex <= bounds.endColumn;
        columnIndex += 1
      ) {
        const row = dataset.rows[rowIndex];
        const column = dataset.columns[columnIndex];
        if (!row || !column) continue;

        cells.push({
          rowId: row.id,
          columnId: column.id,
        });
      }
    }

    applyFormatBatch(cells, patch);
  };

  const selectedFormat =
    selectedCell
      ? formatByCell.get(
          formulaKey(
            selectedCell.rowId,
            selectedCell.columnId,
          ),
        )
      : undefined;

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
      startRowId: rowId,
      endRowId: rowId,
      startColumnId: columnId,
      endColumnId: columnId,
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

    const fallbackColumnIndex =
      dataset.columns.findIndex(
        (item) => item.id === selectedCell.columnId,
      );
    const fallbackRowIndex =
      dataset.rows.findIndex(
        (item) => item.id === selectedCell.rowId,
      );
    if (
      fallbackColumnIndex < 0 ||
      fallbackRowIndex < 0
    ) {
      return;
    }

    const bounds = selectionBounds ?? {
      startRow: fallbackRowIndex,
      endRow: fallbackRowIndex,
      startColumn: fallbackColumnIndex,
      endColumn: fallbackColumnIndex,
    };

    const rows = dataset.rows.slice(
      bounds.startRow,
      bounds.endRow + 1,
    );
    const columns = dataset.columns.slice(
      bounds.startColumn,
      bounds.endColumn + 1,
    );

    const text = rows
      .map((row) =>
        columns
          .map((column) => {
            const formula = formulaByCell.get(
              formulaKey(row.id, column.id),
            );

            return formula
              ? formatFormula(
                  formula.expression,
                  dataset.columns,
                  dataset.rows,
                )
              : String(
                  row.values[column.id] ?? '',
                );
          })
          .join('\t'),
      )
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setClipboardMessage(
        rows.length * columns.length > 1
          ? `Скопировано ячеек: ${rows.length * columns.length}`
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

    if (query || sort || hasColumnFilters) {
      setClipboardMessage(
        'Перед вставкой уберите поиск, сортировку и фильтры, чтобы порядок строк был однозначным.',
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
                dataset.rows,
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

  const selectWholeRow = (rowId: string) => {
    if (!dataset || dataset.columns.length === 0) return;

    setSelectedCell({
      rowId,
      columnId: dataset.columns[0].id,
    });
    setSelectionRange({
      startRowId: rowId,
      endRowId: rowId,
      startColumnId: dataset.columns[0].id,
      endColumnId:
        dataset.columns[dataset.columns.length - 1].id,
    });
  };

  const selectWholeColumn = (columnId: string) => {
    if (!dataset || dataset.rows.length === 0) return;

    setSelectedCell({
      rowId: dataset.rows[0].id,
      columnId,
    });
    setSelectionRange({
      startRowId: dataset.rows[0].id,
      endRowId:
        dataset.rows[dataset.rows.length - 1].id,
      startColumnId: columnId,
      endColumnId: columnId,
    });
  };

  const selectAllCells = () => {
    if (
      !dataset ||
      dataset.rows.length === 0 ||
      dataset.columns.length === 0
    ) {
      return;
    }

    setSelectedCell({
      rowId: dataset.rows[0].id,
      columnId: dataset.columns[0].id,
    });
    setSelectionRange({
      startRowId: dataset.rows[0].id,
      endRowId:
        dataset.rows[dataset.rows.length - 1].id,
      startColumnId: dataset.columns[0].id,
      endColumnId:
        dataset.columns[dataset.columns.length - 1].id,
    });
  };

  const clearSelectedCells = () => {
    if (!dataset || !selectedCell || readOnly) return;

    const fallbackRow = dataset.rows.findIndex(
      (row) => row.id === selectedCell.rowId,
    );
    const fallbackColumn = dataset.columns.findIndex(
      (column) => column.id === selectedCell.columnId,
    );
    if (fallbackRow < 0 || fallbackColumn < 0) return;

    const bounds = selectionBounds ?? {
      startRow: fallbackRow,
      endRow: fallbackRow,
      startColumn: fallbackColumn,
      endColumn: fallbackColumn,
    };

    const writes = [];

    for (
      let rowIndex = bounds.startRow;
      rowIndex <= bounds.endRow;
      rowIndex += 1
    ) {
      const row = dataset.rows[rowIndex];

      for (
        let columnIndex = bounds.startColumn;
        columnIndex <= bounds.endColumn;
        columnIndex += 1
      ) {
        const column = dataset.columns[columnIndex];
        if (!row || !column) continue;

        writes.push({
          rowId: row.id,
          columnId: column.id,
          value: null as DatasetCellValue,
          formulaExpression: null,
        });
      }
    }

    applyCellBatch(writes);
    setClipboardMessage(
      `Очищено ячеек: ${writes.length}`,
    );
  };

  useEffect(() => {
    const onDatasetKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      const isFormulaInput =
        target?.closest(
          '.dataset-sheet__formula-input-wrap',
        ) !== null;

      if (mod && key === 'a' && !typing) {
        event.preventDefault();
        selectAllCells();
        return;
      }

      if (mod && key === 'c' && !typing) {
        event.preventDefault();
        void copyCells();
        return;
      }

      if (!readOnly && mod && key === 'v' && !typing) {
        event.preventDefault();
        void pasteCells();
        return;
      }

      if (
        !readOnly &&
        !typing &&
        (event.key === 'Delete' ||
          event.key === 'Backspace')
      ) {
        event.preventDefault();
        clearSelectedCells();
        return;
      }

      if (!mod || isFormulaInput) return;

      if (!readOnly && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (!readOnly && key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener(
      'keydown',
      onDatasetKey,
    );
    return () =>
      window.removeEventListener(
        'keydown',
        onDatasetKey,
      );
  }, [
    clearSelectedCells,
    copyCells,
    pasteCells,
    readOnly,
    redo,
    selectAllCells,
    undo,
  ]);

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

    const activeFilters = Object.entries(
      columnFilters,
    ).filter(([, value]) => value.trim() !== '');

    if (activeFilters.length > 0) {
      result = result.filter((row) =>
        activeFilters.every(([columnId, filter]) =>
          String(row.values[columnId] ?? '')
            .toLowerCase()
            .includes(filter.trim().toLowerCase()),
        ),
      );
    }

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
  }, [columnFilters, dataset, query, sort]);

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
    <div
      className="dataset-sheet"
      ref={sheetRef}
      onMouseDown={() => {
        if (cellMenu) setCellMenu(null);
      }}
    >
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
                      const created = await addColumn(
                        columnName.trim(),
                        columnType,
                        columnDialog.afterColumnId,
                      );

                      if (
                        created &&
                        selectedCell
                      ) {
                        focusCell(
                          selectedCell.rowId,
                          created.id,
                        );
                      }
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
            ? `${selectedAddress} · ${selectedColumn.name} · строка ${selectedRow.ordinal + 1}`
            : 'Ячейка не выбрана'}
        </div>

        <div className="dataset-sheet__formula-input-wrap">
          <Sigma size={15} />
          <input
            value={formulaInput}
            disabled={!selectedCell || readOnly}
            placeholder="Формула: =B2*C2, =SUM(B2:B10) или =[price]*[quantity]"
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
            Shift-клик расширяет выделение до прямоугольного диапазона.
            Для одной колонки маркер в углу включает autofill.
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
          className={`dataset-sheet__filter-toggle ${filtersOpen ? 'is-active' : ''}`}
          onClick={() =>
            setFiltersOpen((value) => !value)
          }
          title="Фильтры по колонкам"
        >
          <Filter size={14} />
          Фильтры
          {hasColumnFilters && <span />}
        </button>

        {hasColumnFilters && (
          <button
            className="dataset-sheet__history-button"
            onClick={() => setColumnFilters({})}
            title="Очистить фильтры"
          >
            <FilterX size={14} />
          </button>
        )}

        {!readOnly && selectedCell && (
          <div className="dataset-sheet__format-group">
            <button
              className={selectedFormat?.bold ? 'is-active' : ''}
              onClick={() =>
                formatCellsInSelection({
                  bold: !selectedFormat?.bold,
                })
              }
              title="Жирный"
            >
              <BoldIcon size={14} />
            </button>

            <button
              className={selectedFormat?.italic ? 'is-active' : ''}
              onClick={() =>
                formatCellsInSelection({
                  italic: !selectedFormat?.italic,
                })
              }
              title="Курсив"
            >
              <ItalicIcon size={14} />
            </button>

            <button
              className={selectedFormat?.align === 'LEFT' ? 'is-active' : ''}
              onClick={() =>
                formatCellsInSelection({
                  align: 'LEFT',
                })
              }
              title="По левому краю"
            >
              <AlignLeft size={14} />
            </button>

            <button
              className={selectedFormat?.align === 'CENTER' ? 'is-active' : ''}
              onClick={() =>
                formatCellsInSelection({
                  align: 'CENTER',
                })
              }
              title="По центру"
            >
              <AlignCenter size={14} />
            </button>

            <button
              className={selectedFormat?.align === 'RIGHT' ? 'is-active' : ''}
              onClick={() =>
                formatCellsInSelection({
                  align: 'RIGHT',
                })
              }
              title="По правому краю"
            >
              <AlignRight size={14} />
            </button>

            <label
              className="dataset-sheet__background-picker"
              title="Цвет фона"
            >
              <PaintBucket size={13} />
              <input
                type="color"
                value={
                  selectedFormat?.background ??
                  '#ffffff'
                }
                onChange={(event) =>
                  formatCellsInSelection({
                    background:
                      event.target.value,
                  })
                }
              />
            </label>

            <button
              onClick={() =>
                formatCellsInSelection({
                  bold: false,
                  italic: false,
                  align: null,
                  background: null,
                })
              }
              title="Очистить формат"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <button
          className="dataset-sheet__history-button"
          disabled={readOnly || !canUndo}
          onClick={undo}
          title="Отменить изменение Dataset (Ctrl+Z)"
        >
          <Undo2 size={14} />
        </button>

        <button
          className="dataset-sheet__history-button"
          disabled={readOnly || !canRedo}
          onClick={redo}
          title="Повторить изменение Dataset (Ctrl+Y)"
        >
          <Redo2 size={14} />
        </button>

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
              setColumnDialog({
                mode: 'create',
                afterColumnId:
                  selectedCell?.columnId,
              });
              setColumnName('');
              setColumnType('TEXT');
              setColumnError('');
            }}
          >
            <Plus size={14} />
            {selectedCell
              ? 'Вставить колонку справа'
              : 'Добавить колонку'}
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
                const created = await addRow(
                  {},
                  selectedCell?.rowId,
                );

                if (created && dataset) {
                  const targetColumnId =
                    selectedCell?.columnId ??
                    dataset.columns[0]?.id;

                  if (targetColumnId) {
                    focusCell(
                      created.id,
                      targetColumnId,
                    );
                  }
                }
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
            {selectedCell
              ? 'Вставить строку ниже'
              : 'Добавить строку'}
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
                <th
                  className="dataset-sheet__row-number dataset-sheet__select-all"
                  onClick={selectAllCells}
                  title="Выделить весь Dataset"
                >
                  #
                </th>
                {dataset.columns.map((column, columnIndex) => {
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
                            <em
                              className="dataset-sheet__column-letter"
                              title="Выделить колонку"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                selectWholeColumn(column.id);
                              }}
                            >
                              {columnLabel(columnIndex)}
                            </em>
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

              {filtersOpen && (
                <tr className="dataset-sheet__filter-row">
                  <th className="dataset-sheet__row-number">
                    <Filter size={12} />
                  </th>
                  {dataset.columns.map((column) => (
                    <th
                      key={column.id}
                      style={{
                        width: columnWidth(column.id),
                        minWidth: columnWidth(column.id),
                        maxWidth: columnWidth(column.id),
                      }}
                    >
                      <input
                        value={columnFilters[column.id] ?? ''}
                        placeholder={`Фильтр: ${column.name}`}
                        onChange={(event) =>
                          setColumnFilters((current) => ({
                            ...current,
                            [column.id]: event.target.value,
                          }))
                        }
                      />
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={row.id === focusRowId ? 'is-focused' : ''}
                >
                  <th
                    className="dataset-sheet__row-number"
                    onClick={() => selectWholeRow(row.id)}
                    title="Выделить строку"
                  >
                    <span>
                      {safePage * PAGE_SIZE + rowIndex + 1}
                    </span>
                    {!readOnly && dataset && (
                      <button
                        className="dataset-sheet__row-to-canvas"
                        onClick={async (event) => {
                          event.stopPropagation();
                          setRowError('');
                          try {
                            await createBoundRowObject(
                              dataset,
                              row,
                            );
                            onClose();
                          } catch (error) {
                            setRowError(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            );
                          }
                        }}
                        title="Создать привязанный объект на canvas"
                      >
                        <Shapes size={12} />
                      </button>
                    )}

                    {!readOnly && (
                      <button
                        className="dataset-sheet__delete-row"
                        disabled={rowAction === row.id}
                        onClick={async (event) => {
                          event.stopPropagation();
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
                    const columnIndex =
                      dataset.columns.findIndex(
                        (item) => item.id === column.id,
                      );
                    const inRange =
                      Boolean(selectionBounds) &&
                      rowIndex >= selectionBounds!.startRow &&
                      rowIndex <= selectionBounds!.endRow &&
                      columnIndex >=
                        selectionBounds!.startColumn &&
                      columnIndex <=
                        selectionBounds!.endColumn;
                    const fillPreview =
                      autofillDrag?.columnId === column.id &&
                      rowIndex > autofillDrag.sourceEnd &&
                      rowIndex <= autofillDrag.targetEnd;
                    const fillHandle =
                      !readOnly &&
                      !query &&
                      !sort &&
                      !hasColumnFilters &&
                      Boolean(selectionBounds) &&
                      selectionBounds!.startColumn ===
                        selectionBounds!.endColumn &&
                      columnIndex ===
                        selectionBounds!.endColumn &&
                      rowIndex ===
                        selectionBounds!.endRow;

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
                        onContextMenu={(event) => {
                          event.preventDefault();

                          setSelectedCell({
                            rowId: row.id,
                            columnId: column.id,
                          });

                          if (!event.shiftKey) {
                            setSelectionRange({
                              startRowId: row.id,
                              endRowId: row.id,
                              startColumnId: column.id,
                              endColumnId: column.id,
                            });
                          }

                          setCellMenu({
                            x: Math.min(
                              event.clientX,
                              window.innerWidth - 245,
                            ),
                            y: Math.min(
                              event.clientY,
                              window.innerHeight - 330,
                            ),
                            rowId: row.id,
                            columnId: column.id,
                          });
                        }}
                      >
                        {formula && (
                          <span
                            className="dataset-sheet__formula-badge"
                            title={formatFormula(
                              formula.expression,
                              dataset.columns,
                              dataset.rows,
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
                          format={formatByCell.get(key)}
                          onFocus={() => {
                            setSelectedCell({
                              rowId: row.id,
                              columnId: column.id,
                            });
                            if (
                              !selectionBounds ||
                              rowIndex < selectionBounds.startRow ||
                              rowIndex > selectionBounds.endRow ||
                              columnIndex <
                                selectionBounds.startColumn ||
                              columnIndex >
                                selectionBounds.endColumn
                            ) {
                              setSelectionRange({
                                startRowId: row.id,
                                endRowId: row.id,
                                startColumnId: column.id,
                                endColumnId: column.id,
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

      {cellMenu && dataset && (
        <div
          className="dataset-sheet__context-menu"
          style={{
            left: cellMenu.x,
            top: cellMenu.y,
          }}
          onMouseDown={(event) =>
            event.stopPropagation()
          }
        >
          <button
            onClick={() => {
              void copyCells();
              setCellMenu(null);
            }}
          >
            <Copy size={13} />
            Копировать
            <kbd>Ctrl+C</kbd>
          </button>

          {!readOnly && (
            <button
              onClick={() => {
                void pasteCells();
                setCellMenu(null);
              }}
            >
              <ClipboardPaste size={13} />
              Вставить
              <kbd>Ctrl+V</kbd>
            </button>
          )}

          {!readOnly && (
            <button
              onClick={() => {
                clearSelectedCells();
                setCellMenu(null);
              }}
            >
              <X size={13} />
              Очистить ячейку / диапазон
            </button>
          )}

          {!readOnly && (
            <>
              <div className="dataset-sheet__context-separator" />

              <button
                onClick={async () => {
                  const created = await addRow(
                    {},
                    cellMenu.rowId,
                  );
                  setCellMenu(null);

                  if (created) {
                    focusCell(
                      created.id,
                      cellMenu.columnId,
                    );
                  }
                }}
              >
                <Plus size={13} />
                Вставить строку ниже
              </button>

              <button
                className="is-danger"
                onClick={async () => {
                  setRowError('');
                  try {
                    await deleteRow(cellMenu.rowId);
                    setSelectedCell(null);
                    setSelectionRange(null);
                  } catch (error) {
                    setRowError(
                      error instanceof Error
                        ? error.message
                        : String(error),
                    );
                  } finally {
                    setCellMenu(null);
                  }
                }}
              >
                <Trash2 size={13} />
                Удалить строку
              </button>

              <div className="dataset-sheet__context-separator" />

              <button
                onClick={() => {
                  setColumnDialog({
                    mode: 'create',
                    afterColumnId:
                      cellMenu.columnId,
                  });
                  setColumnName('');
                  setColumnType('TEXT');
                  setColumnError('');
                  setCellMenu(null);
                }}
              >
                <Plus size={13} />
                Вставить колонку справа
              </button>

              <button
                onClick={() => {
                  const column =
                    dataset.columns.find(
                      (item) =>
                        item.id === cellMenu.columnId,
                    );
                  if (!column) return;

                  setColumnDialog({
                    mode: 'rename',
                    columnId: column.id,
                    initialName: column.name,
                  });
                  setColumnName(column.name);
                  setColumnType(column.dataType);
                  setColumnError('');
                  setCellMenu(null);
                }}
              >
                <Pencil size={13} />
                Переименовать колонку
              </button>

              <button
                className="is-danger"
                onClick={() => {
                  const column =
                    dataset.columns.find(
                      (item) =>
                        item.id === cellMenu.columnId,
                    );
                  if (column) {
                    setDeleteColumnTarget(column);
                  }
                  setCellMenu(null);
                }}
              >
                <Trash2 size={13} />
                Удалить колонку
              </button>
            </>
          )}
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
