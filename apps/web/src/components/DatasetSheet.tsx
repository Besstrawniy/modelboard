import { TextFormatControls } from './TextFormatControls';
import { ColorControl } from './ColorControl';
import { formulaSuggestions, formulaReferences, formulaReferenceStyle } from '../lib/formulaEditing';
import { useDialogFocus } from '../lib/useDialogFocus';
import { DatasetExport } from './DatasetExport';
import { DatasetConnections } from './DatasetConnections';
import { DatasetRename } from './DatasetRename';
import { SpreadsheetTools } from './SpreadsheetTools';
import { parseSheetInput, parseSheetTsv, sheetTsv, matchesSheetFilter, sheetConditionalFormat, sheetSelectionSummary } from '../lib/spreadsheetModel';
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
  Pin,
  PinOff,
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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';
import { displayCellValue } from '../lib/cellFormatting';
import {
  columnLabel,
  compileFormula,
  formatFormula,
  formulaKey,
  translateFormulaForCopy,
  retargetFormula,
} from '../lib/formulas';

const PAGE_SIZE = 1000000;
const ROW_HEIGHT = 36;

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
  sourceStartColumn:number;
  sourceEndColumn:number;
  targetColumn:number;
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

function normalizeInput(value:string,column:DatasetColumn):DatasetCellValue {
  return value.trim().startsWith('=')?value:parseSheetInput(value,column);
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

  if (targetType === 'NUMBER') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { ok: true, value };
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return { ok: true, value: parsed };
      }
    }

    return {
      ok: false,
      reason: 'Ожидается конечное число',
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

export function SheetCell({
  row,
  column,
  readOnly,
  onChange,
  onFocus,
  onNavigate,
  formulaActive = false,
  formulaText,
  format,
}: {
  row: DatasetRow;
  column: DatasetColumn;
  readOnly: boolean;
  onChange: (value: DatasetCellValue) => void;
  onFocus?: () => void;
  onNavigate?: (
    direction: 'up' | 'down' | 'left' | 'right',
    extend?: boolean,
  ) => void;
  formulaActive?: boolean;
  formulaText?: string;
  format?: DatasetCellFormat;
}) {
  const raw = row.values[column.id];
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [editError,setEditError]=useState('');
  const original=useRef('');
  const cancelled=useRef(false);

  useEffect(()=>{if(editDraft===null)original.current=formulaText??(raw===null||raw===undefined?'':String(raw));},[raw,formulaText,editDraft]);

  if (column.dataType === 'BOOLEAN' && !formulaActive) {
    return (
      <select
        className="dataset-sheet__cell-editor"
        style={{
          fontFamily:format?.fontFamily||undefined,fontSize:format?.fontSize?`${format.fontSize}px`:undefined,
        color: format?.color || undefined, textDecoration: format?.underline ? 'underline' : undefined, whiteSpace: format?.wrap ? 'pre-wrap' : undefined,
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
    <textarea
      rows={1}
      wrap={format?.wrap ? "soft" : "off"}
      data-editing={editDraft !== null}
      className="dataset-sheet__cell-editor"
      style={{
        fontFamily:format?.fontFamily||undefined,fontSize:format?.fontSize?`${format.fontSize}px`:undefined,
        color: format?.color || undefined, textDecoration: format?.underline ? 'underline' : undefined, whiteSpace: format?.wrap ? 'pre-wrap' : undefined,
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
      readOnly={readOnly}
      aria-invalid={Boolean(editError)}
      title={editError||(raw==='#CYCLE!'?'Циклическая ссылка: формула зависит от собственной ячейки':'')}
      value={
        editDraft !== null
          ? editDraft
          : displayCellValue(raw, format)
      }
      onFocus={() => {
        original.current=formulaText ?? (raw === null || raw === undefined ? '' : String(raw));
        cancelled.current=false;
        onFocus?.();
      }}
      onDoubleClick={() => {if(!readOnly){cancelled.current=false;setEditDraft(original.current);}}}
      onBlur={() => {
        if(cancelled.current){setEditDraft(null);return;}
        try{if(editDraft!==null&&editDraft!==original.current)onChange(normalizeInput(editDraft,column));setEditDraft(null);setEditError('');}
        catch(error){setEditError(error instanceof Error?error.message:String(error));}
      }}
      onKeyDown={(event) => {
        if(editDraft===null && event.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();onNavigate?.(({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'} as const)[event.key as 'ArrowUp'],true);return;}
        if(editDraft===null&&!readOnly&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();cancelled.current=false;setEditDraft(event.key);setEditError('');return;}
        if(event.key==='F2'){event.preventDefault();if(!readOnly){cancelled.current=false;setEditDraft(original.current);}return;}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;setEditDraft(null);setEditError('');return;}

        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          if(!onNavigate)event.currentTarget.blur();
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

        if (editDraft===null && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          onNavigate?.(
            event.key === 'ArrowUp' ? 'up' : 'down',
          );
          return;
        }

        if (
          editDraft===null && event.key === 'ArrowLeft' &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0
        ) {
          event.preventDefault();
          onNavigate?.('left');
          return;
        }

        if (
          editDraft===null && event.key === 'ArrowRight' &&
          event.currentTarget.selectionStart ===
            event.currentTarget.value.length &&
          event.currentTarget.selectionEnd ===
            event.currentTarget.value.length
        ) {
          event.preventDefault();
          onNavigate?.('right');
        }
      }}
      onChange={(event) => {cancelled.current=false;setEditDraft(event.target.value);setEditError('');
      }}
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
    applyCellBatch,
    applyFormatBatch,
    addColumn,
    renameColumn,
    convertColumn,
    deleteColumn,
    deletedColumns,restoreColumn,
    addRow,
    deleteRow,
    reorder,saveView,deleteView,saveRule,deleteRule,pendingChanges,storageError,prepareRows,
  } = useCollaborativeDataset(
    datasetId,
    token,
    readOnly,
  );
  const [currentView,setCurrentView]=useState('');
  const [hiddenColumns,setHiddenColumns]=useState<string[]>([]);
  const [secondarySort,setSecondarySort]=useState<Array<{columnId:string;direction:'asc'|'desc'}>>([]);
  const viewportRef=useRef<HTMLDivElement>(null);
  const [scrollTop,setScrollTop]=useState(0);
  const clipboardRef=useRef<{text:string;cut:boolean;cells:Array<Array<{rowId:string;columnId:string;value:DatasetCellValue;expression?:string;format?:DatasetCellFormat}>>}|null>(null);
  const [query, setQuery] = useState('');
  const [findOpen,setFindOpen]=useState(false);
  const [findText,setFindText]=useState('');
  const [findRegex,setFindRegex]=useState(false);
  const [findIndex,setFindIndex]=useState(0);
  const findInputRef=useRef<HTMLInputElement>(null);
  const [formulaEditing,setFormulaEditing]=useState(false);
  const formulaTarget=useRef<{rowId:string;columnId:string}|null>(null);
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
  const rangeDragRef = useRef<{
    anchorRowId: string;
    anchorColumnId: string;
  } | null>(null);
  const [draggingRange, setDraggingRange] = useState(false);
  const [autofillDrag, setAutofillDrag] =
    useState<AutofillDrag | null>(null);
  const [clipboardMessage, setClipboardMessage] = useState('');
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const headerDrag = useRef<{kind:'rows'|'columns';id:string}|null>(null);
  const [columnWidths, setColumnWidths] = useState<
    Record<string, number>
  >({});
  const [frozenColumns, setFrozenColumns] = useState(0);
  const [frozenRows, setFrozenRows] = useState(0);
  const [cellMenu, setCellMenu] = useState<{
    x: number;
    y: number;
    rowId: string;
    columnId: string;
  } | null>(null);

  const dialog = useDialogFocus({ containerRef: sheetRef, onClose: () => {
    if (columnDialog) { setColumnDialog(null); return; }
    if (findOpen) { setFindOpen(false); return; }
    if (clipboardRef.current?.cut) { clipboardRef.current=null;setClipboardMessage('');return; }
    if (cellMenu) { setCellMenu(null); return; }
    onClose();
  } });

  const deleteModal = useDialogFocus({ open: Boolean(deleteColumnTarget), onClose: () => { if (!columnBusy) setDeleteColumnTarget(null); } });
  const columnModal = useDialogFocus({ open: Boolean(columnDialog), restoreFocus:()=>sheetRef.current?.querySelector<HTMLElement>('.sheet-command-menu>summary')??null, onClose: () => { if (!columnBusy) setColumnDialog(null); } });

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
    setPage(0);setScrollTop(0);if(viewportRef.current)viewportRef.current.scrollTop=0;
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
    try {
      const value = JSON.parse(
        localStorage.getItem(`modelboard:dataset-freeze:${datasetId}`) || '{}',
      );
      setFrozenColumns(Math.max(0, Math.min(5, Number(value.columns) || 0)));
      setFrozenRows(Math.max(0, Math.min(5, Number(value.rows) || 0)));
    } catch {
      setFrozenColumns(0);
      setFrozenRows(0);
    }
  }, [datasetId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        `modelboard:dataset-freeze:${datasetId}`,
        JSON.stringify({ columns: frozenColumns, rows: frozenRows }),
      );
    } catch {
      // Local view preference is optional.
    }
  }, [datasetId, frozenColumns, frozenRows]);

  useEffect(() => {
    if (!dataset || !focusRowId || query || sort) return;

    const rowIndex = dataset.rows.findIndex(
      (row) => row.id === focusRowId,
    );

    if (rowIndex >= 0) {
      if(viewportRef.current)viewportRef.current.scrollTop=Math.max(0,(rowIndex-3)*ROW_HEIGHT);
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
          matchesSheetFilter(row.values[columnId],filter),
        ),
      );
    }

    const sorts=[...(sort?[sort]:[]),...secondarySort];
    if(sorts.length)result=result.sort((a,b)=>{for(const item of sorts){const order=compareValues(a.values[item.columnId],b.values[item.columnId]);if(order)return item.direction==='asc'?order:-order;}return a.ordinal-b.ordinal;});

    return result;
  }, [columnFilters, dataset, query, sort,secondarySort]);

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
        visibleRows.map((row, index) => [
          row.id,
          index,
        ]),
      ),
    [visibleRows],
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
    if(document.activeElement?.closest('.dataset-sheet__formula-input-wrap') && formulaTarget.current?.rowId===selectedCell?.rowId && formulaTarget.current?.columnId===selectedCell?.columnId)return;
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
      const target=formulaTarget.current??selectedCell;
      const targetColumn=dataset?.columns.find(c=>c.id===target.columnId);
      if(!targetColumn)return;
      const trimmed = formulaInput.trim();

      if (trimmed.startsWith('=')) {
        const canonical = compileFormula(
          trimmed,
          dataset?.columns ?? [],
          dataset?.rows ?? [],
        );
        setFormula(
          target.rowId,
          target.columnId,
          canonical,
        );
      } else {
        setCell(target.rowId,target.columnId,normalizeInput(formulaInput,targetColumn));
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

  useEffect(() => {
    const finishRangeDrag = () => {
      rangeDragRef.current = null;
      setDraggingRange(false);
    };

    window.addEventListener('mouseup', finishRangeDrag);
    window.addEventListener('blur', finishRangeDrag);
    return () => {
      window.removeEventListener('mouseup', finishRangeDrag);
      window.removeEventListener('blur', finishRangeDrag);
    };
  }, []);

  const selectCell = (
    event: React.MouseEvent,
    rowId: string,
    columnId: string,
  ) => {
    if (event.button !== 0) return;

    // Double click should focus the actual cell editor, not start dragging.
    if (event.detail >= 2) {
      rangeDragRef.current = null;
      setDraggingRange(false);
      return;
    }

    const anchor =
      event.shiftKey && selectionRange
        ? {
            anchorRowId: selectionRange.startRowId,
            anchorColumnId: selectionRange.startColumnId,
          }
        : { anchorRowId: rowId, anchorColumnId: columnId };

    rangeDragRef.current = anchor;
    setDraggingRange(true);
    setSelectedCell({
      rowId: anchor.anchorRowId,
      columnId: anchor.anchorColumnId,
    });
    setSelectionRange({
      startRowId: anchor.anchorRowId,
      startColumnId: anchor.anchorColumnId,
      endRowId: rowId,
      endColumnId: columnId,
    });
  };

  const extendRangeDrag = (
    event: React.MouseEvent,
    rowId: string,
    columnId: string,
  ) => {
    const anchor = rangeDragRef.current;
    if (!anchor || (event.buttons & 1) === 0) return;

    setSelectionRange({
      startRowId: anchor.anchorRowId,
      startColumnId: anchor.anchorColumnId,
      endRowId: rowId,
      endColumnId: columnId,
    });
  };

  const applyAutofill = (drag: AutofillDrag) => {
    if(!dataset)return;
    const horizontal=drag.targetColumn>drag.sourceEndColumn;
    const writes:any[]=[];
    const height=drag.sourceEnd-drag.sourceStart+1,width=drag.sourceEndColumn-drag.sourceStartColumn+1;
    for(let r=drag.sourceStart;r<=drag.targetEnd;r++)for(let c=drag.sourceStartColumn;c<=drag.targetColumn;c++){
      if(r<=drag.sourceEnd&&c<=drag.sourceEndColumn)continue;
      const sourceR=drag.sourceStart+(r-drag.sourceStart)%height,sourceC=drag.sourceStartColumn+(c-drag.sourceStartColumn)%width;
      const sourceRow=visibleRows[sourceR],sourceColumn=dataset.columns[sourceC],row=visibleRows[r],column=dataset.columns[c];
      if(!sourceRow||!sourceColumn||!row||!column)continue;
      const expression=formulaByCell.get(formulaKey(sourceRow.id,sourceColumn.id))?.expression;
      const format=formatByCell.get(formulaKey(sourceRow.id,sourceColumn.id))??null;
      if(expression){writes.push({rowId:row.id,columnId:column.id,formulaExpression:translateFormulaForCopy(expression,sourceRow.id,sourceColumn.id,row.id,column.id,dataset.rows,dataset.columns),format});continue;}
      const series=horizontal?dataset.columns.slice(drag.sourceStartColumn,drag.sourceEndColumn+1).map(col=>sourceRow.values[col.id]):visibleRows.slice(drag.sourceStart,drag.sourceEnd+1).map(item=>item.values[sourceColumn.id]);
      const numeric=series.length>=2&&series.every(value=>typeof value==='number'&&Number.isFinite(value));
      const step=numeric?Number(series[1])-Number(series[0]):0;
      const arithmetic=numeric&&series.slice(2).every((v,i)=>Math.abs(Number(v)-Number(series[i+1])-step)<1e-9);
      const offset=horizontal?c-drag.sourceEndColumn:r-drag.sourceEnd;
      const value=arithmetic?Number(series.at(-1))+step*offset:sourceRow.values[sourceColumn.id]??null;
      const typed=value===null?null:parseSheetInput(String(value),column);
      writes.push({rowId:row.id,columnId:column.id,value:typed,formulaExpression:null,format});
    }
    if(!writes.length)return;
    try{applyCellBatch(writes);setSelectionRange({startRowId:visibleRows[drag.sourceStart].id,endRowId:visibleRows[drag.targetEnd].id,startColumnId:dataset.columns[drag.sourceStartColumn].id,endColumnId:dataset.columns[drag.targetColumn].id});}
    catch(error){setRowError((error as Error).message);}
  };

  const beginAutofill = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    if (
      readOnly ||
      !selectionBounds ||
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
      sourceStartColumn:selectionBounds.startColumn,sourceEndColumn:selectionBounds.endColumn,targetColumn:selectionBounds.endColumn,
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

    if(!cell)return;
    const row=rowIndexById.get(cell.dataset.rowId??''),column=dataset?.columns.findIndex(item=>item.id===cell.dataset.columnId)??-1;
    if(row===undefined||column<0)return;
    const down=Math.max(0,row-autofillDrag.sourceEnd),right=Math.max(0,column-autofillDrag.sourceEndColumn);
    setAutofillDrag(current=>current?{...current,targetEnd:right>down?current.sourceEnd:Math.max(current.sourceEnd,row),targetColumn:right>down?Math.max(current.sourceEndColumn,column):current.sourceEndColumn}:current);
  };

  const finishAutofill = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    if (!autofillDrag) return;

    try{applyAutofill(autofillDrag);}catch(error){setRowError((error as Error).message);}
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

    const fallbackRow = visibleRows.findIndex(
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
        const row = visibleRows[rowIndex];
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
    extend = false,
  ) => {
    if (!dataset) return;

    const rowIndex = visibleRows.findIndex(
      (row) => row.id === rowId,
    );
    if (rowIndex >= 0) {
      setPage(0);
      if(viewportRef.current)viewportRef.current.scrollTop=Math.max(0,(rowIndex-3)*ROW_HEIGHT);
    }

    setSelectedCell({ rowId, columnId });
    setSelectionRange(previous=>({
      startRowId: extend ? previous?.startRowId ?? selectedCell?.rowId ?? rowId : rowId,
      endRowId: rowId,
      startColumnId: extend ? previous?.startColumnId ?? selectedCell?.columnId ?? columnId : columnId,
      endColumnId: columnId,
    }));

    window.requestAnimationFrame(() => {
      const editor = sheetRef.current?.querySelector(
        `td[data-row-id="${rowId}"][data-column-id="${columnId}"] .dataset-sheet__cell-editor`,
      ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;

      editor?.focus();
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        editor.select();
      }
    });
  };

  const moveSelectedCell = (
    direction: 'up' | 'down' | 'left' | 'right',
    extend = false,
  ) => {
    if (!dataset || !selectedCell) return;

    const columns=dataset.columns.filter(column=>!hiddenColumns.includes(column.id));
    const rowIndex = visibleRows.findIndex(
      (row) => row.id === selectedCell.rowId,
    );
    const columnIndex = columns.findIndex(
      (column) => column.id === selectedCell.columnId,
    );
    if (rowIndex < 0 || columnIndex < 0) return;

    let nextRow = rowIndex;
    let nextColumn = columnIndex;

    if (direction === 'up') nextRow -= 1;
    if (direction === 'down') nextRow += 1;
    if (direction === 'left') nextColumn -= 1;
    if (direction === 'right') nextColumn += 1;

    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    }
    if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }

    nextRow = Math.max(
      0,
      Math.min(visibleRows.length - 1, nextRow),
    );

    const row = visibleRows[nextRow];
    const column = columns[nextColumn];
    if (row && column) {
      focusCell(row.id, column.id, extend);
    }
  };

  const copyCells = async (cut=false) => {
    if (!dataset || !selectedCell) return;

    setClipboardMessage('');

    const fallbackColumnIndex =
      dataset.columns.findIndex(
        (item) => item.id === selectedCell.columnId,
      );
    const fallbackRowIndex =
      visibleRows.findIndex(
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

    const rows = visibleRows.slice(
      bounds.startRow,
      bounds.endRow + 1,
    );
    const columns = dataset.columns.slice(
      bounds.startColumn,
      bounds.endColumn + 1,
    );

    const cells=rows.map(row=>columns.map(column=>({rowId:row.id,columnId:column.id,value:row.values[column.id]??null,expression:formulaByCell.get(formulaKey(row.id,column.id))?.expression,format:formatByCell.get(formulaKey(row.id,column.id))})));
    const text=sheetTsv(cells.map(row=>row.map(cell=>cell.expression?formatFormula(cell.expression,dataset.columns,dataset.rows):cell.value)));
    clipboardRef.current={text,cut:cut&&!readOnly,cells};
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

  const pasteCells = async (valuesOnly=false) => {
    if(readOnly||!dataset||!selectedCell)return;
    setClipboardMessage('');
    try {
      let text:string;
      try{text=await navigator.clipboard.readText();}catch{if(!clipboardRef.current)throw new Error('Браузер не разрешил чтение clipboard');text=clipboardRef.current.text;}
      const matrix=parseSheetTsv(text),internal=clipboardRef.current?.text.replace(/\r\n/g,'\n')===text.replace(/\r\n/g,'\n')?clipboardRef.current:null;
      const startRow=visibleRows.findIndex(row=>row.id===selectedCell.rowId),startColumn=dataset.columns.findIndex(column=>column.id===selectedCell.columnId);
      if(startRow<0||startColumn<0)return;
      const width=Math.max(...matrix.map(row=>row.length));
      if(startColumn+width>dataset.columns.length)throw new Error('Добавьте колонки справа перед вставкой');
      if(hiddenColumns.some(id=>dataset.columns.slice(startColumn,startColumn+width).some(column=>column.id===id)))throw new Error('Перед вставкой покажите колонки выбранного диапазона');
      const required=Math.max(0,startRow+matrix.length-visibleRows.length);
      if(required&&(query||sort||hasColumnFilters||secondarySort.length))throw new Error('Для добавления строк при вставке сбросьте фильтры и сортировку');
      const newRows:Array<DatasetRow>=Array.from({length:required},(_,index)=>({id:crypto.randomUUID(),ordinal:dataset.rows.length+index,values:{}}));
      const targets=[...visibleRows,...newRows],canonicalRows=[...dataset.rows,...newRows];
      const moves=new Map<string,{rowId:string;columnId:string}>();
      if(internal?.cut&&!valuesOnly)internal.cells.forEach((row,r)=>row.forEach((cell,c)=>moves.set(formulaKey(cell.rowId,cell.columnId),{rowId:targets[startRow+r].id,columnId:dataset.columns[startColumn+c].id})));
      const writes:any[]=[];
      if(internal?.cut&&!valuesOnly)for(const row of internal.cells)for(const cell of row)writes.push({rowId:cell.rowId,columnId:cell.columnId,value:null,formulaExpression:null,format:null});
      const targetKeys=new Set<string>();
      for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix[r].length;c++){
        const row=targets[startRow+r],column=dataset.columns[startColumn+c],source=internal?.cells[r]?.[c],raw=matrix[r][c];
        const write:any={rowId:row.id,columnId:column.id};targetKeys.add(formulaKey(row.id,column.id));
        if(source?.expression&&!valuesOnly)write.formulaExpression=internal?.cut?retargetFormula(source.expression,moves):translateFormulaForCopy(source.expression,source.rowId,source.columnId,row.id,column.id,canonicalRows,dataset.columns);
        else if(!valuesOnly&&raw.trim().startsWith('='))write.formulaExpression=compileFormula(raw,dataset.columns,canonicalRows);
        else {write.value=source&&valuesOnly?source.value:parseSheetInput(raw,column);write.formulaExpression=null;}
        if(source&&!valuesOnly)write.format=source.format??null;
        writes.push(write);
      }
      if(moves.size)for(const formula of dataset.formulas){const key=formulaKey(formula.rowId,formula.columnId);if(moves.has(key)||targetKeys.has(key))continue;const expression=retargetFormula(formula.expression,moves);if(expression!==formula.expression)writes.push({rowId:formula.rowId,columnId:formula.columnId,formulaExpression:expression});}
      const currentRows=new Map(dataset.rows.map(row=>[row.id,row]));
      const finalWrites=new Map(writes.map(write=>[formulaKey(write.rowId,write.columnId),write]));
      const occupied=[...targetKeys].filter(key=>{const write=finalWrites.get(key);const value=currentRows.get(write.rowId)?.values[write.columnId];return value!==null&&value!==undefined&&value!==''||formulaByCell.has(key);}).length;
      if(occupied && !window.confirm(`В области вставки уже есть данные (${occupied} ячеек). Заменить их?`))return;
      const created=newRows.length?await prepareRows(newRows):[];
      applyCellBatch(writes,created);
      if(internal?.cut&&!valuesOnly)clipboardRef.current=null;
      const endRow=targets[startRow+matrix.length-1],endColumn=dataset.columns[startColumn+width-1];
      setSelectionRange({startRowId:targets[startRow].id,endRowId:endRow.id,startColumnId:dataset.columns[startColumn].id,endColumnId:endColumn.id});
      setClipboardMessage(`Вставлено ячеек: ${matrix.reduce((n,row)=>n+row.length,0)}`);
    }catch(error){setClipboardMessage(error instanceof Error?error.message:String(error));}
  };

  const clearHeaderDrop = () => document.querySelectorAll('[data-sheet-drop]').forEach(element => element.removeAttribute('data-sheet-drop'));
  const dragHeader = (event: React.DragEvent, kind: 'rows'|'columns', id: string) => {
    event.stopPropagation();
    if (readOnly || (kind === 'rows' && (sort || secondarySort.length || query || hasColumnFilters))) { event.preventDefault(); return; }
    headerDrag.current = {kind,id};
    if (kind === 'columns') selectWholeColumn(id); else selectWholeRow(id);
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('application/x-modelboard-sheet', JSON.stringify({kind,id}));
  };
  const overHeader = (event: React.DragEvent, kind:'rows'|'columns') => {
    if (headerDrag.current?.kind !== kind) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect='move';
    const rect=event.currentTarget.getBoundingClientRect();
    const after=kind==='columns'?event.clientX>rect.left+rect.width/2:event.clientY>rect.top+rect.height/2;
    clearHeaderDrop();event.currentTarget.setAttribute('data-sheet-drop',kind==='columns'?(after?'right':'left'):(after?'bottom':'top'));
  };
  const dropHeader = (event: React.DragEvent, kind:'rows'|'columns', targetId:string) => {
    const source=headerDrag.current;if(!source||source.kind!==kind||!dataset)return;
    event.preventDefault();event.stopPropagation();
    const rect=event.currentTarget.getBoundingClientRect();
    const after=kind==='columns'?event.clientX>rect.left+rect.width/2:event.clientY>rect.top+rect.height/2;
    const items=kind==='columns'?dataset.columns:dataset.rows;
    const from=items.findIndex(item=>item.id===source.id),target=items.findIndex(item=>item.id===targetId);
    const destination=target+(after?1:0)-(from<target+(after?1:0)?1:0);
    if(from>=0&&target>=0&&source.id!==targetId)reorder(kind,source.id,destination);
    headerDrag.current=null;clearHeaderDrop();
  };

  const columnWidth = (columnId: string) =>
    Math.max(
      90,
      Math.min(640, columnWidths[columnId] ?? 180),
    );

  const frozenLeftOffset = (columnIndex: number) => {
    if (!dataset) return 54;
    let offset = 54;
    for (let i = 0; i < columnIndex; i += 1) {
      if(!hiddenColumns.includes(dataset.columns[i].id))offset += columnWidth(dataset.columns[i].id);
    }
    return offset;
  };

  const frozenTopOffset = (pageRowIndex: number) =>
    48 + (filtersOpen ? 36 : 0) + pageRowIndex * ROW_HEIGHT;

  const frozenCellStyle = (
    columnIndex: number,
    pageRowIndex?: number,
  ): React.CSSProperties => {
    const col = columnIndex < frozenColumns;
    const row = pageRowIndex !== undefined && pageRowIndex < frozenRows;
    return {
      ...(col ? { position: 'sticky', left: frozenLeftOffset(columnIndex) } : {}),
      ...(row ? { position: 'sticky', top: frozenTopOffset(pageRowIndex) } : {}),
      ...(col || row ? {
        zIndex: col && row ? 6 : row ? 4 : pageRowIndex === undefined ? 11 : 3,
      } : {}),
    };
  };

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
    if (!dataset || visibleRows.length === 0) return;

    setSelectedCell({
      rowId: visibleRows[0].id,
      columnId,
    });
    setSelectionRange({
      startRowId: visibleRows[0].id,
      endRowId:
        visibleRows[visibleRows.length - 1].id,
      startColumnId: columnId,
      endColumnId: columnId,
    });
  };

  const selectAllCells = () => {
    if (
      !dataset ||
      visibleRows.length === 0 ||
      dataset.columns.length === 0
    ) {
      return;
    }

    setSelectedCell({
      rowId: visibleRows[0].id,
      columnId: dataset.columns[0].id,
    });
    setSelectionRange({
      startRowId: visibleRows[0].id,
      endRowId:
        visibleRows[visibleRows.length - 1].id,
      startColumnId: dataset.columns[0].id,
      endColumnId:
        dataset.columns[dataset.columns.length - 1].id,
    });
  };

  const clearSelectedCells = () => {
    if (!dataset || !selectedCell || readOnly) return;

    const fallbackRow = visibleRows.findIndex(
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
      const row = visibleRows[rowIndex];

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
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]') !== sheetRef.current) return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();setFindOpen(true);requestAnimationFrame(()=>{findInputRef.current?.focus();findInputRef.current?.select();});return;}
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const cellNavigation = target?.classList.contains('dataset-sheet__cell-editor') && target.dataset.editing !== 'true';
      const typing = !cellNavigation && (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable);

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

      if (!readOnly && mod && key === 'x' && !typing) {event.preventDefault();void copyCells(true);return;}
      if (!readOnly && mod && key === 'v' && !typing) {
        event.preventDefault();
        void pasteCells(event.shiftKey);
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

      if (!mod || isFormulaInput || typing) return;

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
  const firstVirtual=Math.min(Math.max(frozenRows,Math.floor(Math.max(0,scrollTop-80)/ROW_HEIGHT)-8),Math.max(frozenRows,visibleRows.length-1));
  const lastVirtual=Math.min(visibleRows.length,firstVirtual+50);
  const pageRows=[...visibleRows.slice(0,frozenRows),...visibleRows.slice(firstVirtual,lastVirtual)];
  const virtualTop=Math.max(0,firstVirtual-frozenRows)*ROW_HEIGHT;
  const virtualBottom=Math.max(0,visibleRows.length-lastVirtual)*ROW_HEIGHT;
  const hiddenSet=new Set(hiddenColumns);
  const applyView=(view:import('@modelboard/shared').DatasetView|null)=>{
    setCurrentView(view?.id??'');setQuery(view?.query??'');setColumnFilters(view?.filters??{});setSort(view?.sort[0]??null);setSecondarySort(view?.sort.slice(1)??[]);
    setHiddenColumns(view?.hiddenColumns??[]);setColumnWidths(view?.columnWidths??{});setFrozenRows(view?.frozenRows??0);setFrozenColumns(view?.frozenColumns??0);if(viewportRef.current)viewportRef.current.scrollTop=0;
  };
  const selectionStats=useMemo(()=>{
    if(!dataset||!selectionBounds)return null;
    return sheetSelectionSummary(visibleRows.slice(selectionBounds.startRow,selectionBounds.endRow+1).flatMap(row=>dataset.columns.slice(selectionBounds.startColumn,selectionBounds.endColumn+1).map(column=>row.values[column.id]??null)));
  },[dataset,visibleRows,selectionBounds]);

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

  const activeReferences=useMemo(()=>formulaEditing?formulaReferences(formulaInput,dataset?.rows.length??0,dataset?.columns.length??0):[],[formulaEditing,formulaInput,dataset?.rows.length,dataset?.columns.length]);
  const findResults=useMemo(()=>{
    const cells:Array<{rowId:string;columnId:string}>=[];
    if(!findOpen||!dataset||!findText)return {cells,error:''};
    let match:(text:string)=>boolean;
    try{const regex=findRegex?new RegExp(findText,'i'):null;match=text=>regex?regex.test(text):text.toLocaleLowerCase().includes(findText.toLocaleLowerCase());}
    catch{return {cells,error:'Некорректное регулярное выражение'};}
    for(const row of visibleRows)for(const column of dataset.columns){if(hiddenColumns.includes(column.id))continue;if(match(String(row.values[column.id]??'')))cells.push({rowId:row.id,columnId:column.id});}
    return {cells,error:''};
  },[dataset,visibleRows,findOpen,findText,findRegex,hiddenColumns]);
  const canonicalRowIndexes=useMemo(()=>new Map((dataset?.rows??[]).map((row,index)=>[row.id,index])),[dataset?.rows]);
  const findCellKeys=useMemo(()=>new Set(findResults.cells.map(cell=>formulaKey(cell.rowId,cell.columnId))),[findResults]);
  const cutCellKeys=new Set(clipboardRef.current?.cut?clipboardRef.current.cells.flat().map(cell=>formulaKey(cell.rowId,cell.columnId)):[]);
  const goToFind=(direction:number)=>{
    if(!findResults.cells.length)return;
    const index=(findIndex+direction+findResults.cells.length)%findResults.cells.length;
    setFindIndex(index);const cell=findResults.cells[index];setSelectedCell(cell);setSelectionRange({startRowId:cell.rowId,endRowId:cell.rowId,startColumnId:cell.columnId,endColumnId:cell.columnId});
    const row=visibleRows.findIndex(item=>item.id===cell.rowId);if(viewportRef.current)viewportRef.current.scrollTop=Math.max(0,(row-3)*ROW_HEIGHT);
    requestAnimationFrame(()=>sheetRef.current?.querySelector(`td[data-row-id="${cell.rowId}"][data-column-id="${cell.columnId}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'}));
  };

  const conversionModal = useDialogFocus({ open: Boolean(convertColumnTarget && conversionPreview), onClose: () => { if (!columnBusy) setConvertColumnTarget(null); } });

  return (
    <div
      className={`dataset-sheet ${draggingRange ? 'is-drag-selecting' : ''}`}
      role="dialog" aria-modal="true" aria-label="Редактор таблицы"
      {...dialog}
      onMouseDown={() => {
        if (cellMenu) setCellMenu(null);
      }}
    >
      {columnDialog && (
        <div className="dataset-sheet__dialog-backdrop">
          <section {...columnModal} className="dataset-sheet__column-dialog" role="dialog" aria-modal="true" aria-label="Настройка колонки">
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
                    <option value="NUMBER">NUMBER</option>
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
          <section {...conversionModal} className="dataset-sheet__column-dialog dataset-sheet__column-dialog--wide" role="dialog" aria-modal="true" aria-label="Изменить тип колонки">
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
                  <option value="NUMBER">NUMBER</option>
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
          <section {...deleteModal} className="dataset-sheet__column-dialog" role="dialog" aria-modal="true" aria-label="Удалить колонку">
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

      {storageError&&<div className="sheet-storage-error" role="alert">{storageError}</div>}
      <header className="dataset-sheet__topbar">
        <div className="dataset-sheet__identity">
          <span className="dataset-sheet__icon">
            <Database size={18} />
          </span>
          <div>
            <strong>{dataset?.name ?? 'Dataset'}</strong><DatasetRename id={datasetId} name={dataset?.name??''} token={token} readOnly={readOnly}/>
            <small>
              {dataset?.kind ?? '—'} · {pendingChanges?'saving':status}
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

      {!readOnly && deletedColumns.length>0 && <details className="sheet-deleted-columns"><summary>Удалённые колонки ({deletedColumns.length}) — восстановить</summary><p>Восстанавливаются исходный ID поля, значения существующих строк, формулы и оформление. Последнее действие также можно отменить через Ctrl+Z.</p>{deletedColumns.map(column=><button key={column.id} onClick={()=>restoreColumn(column.id)}>Восстановить «{column.name}»</button>)}</details>}

      <div className="dataset-sheet__toolbar">
        <button title="Найти в таблице (Ctrl+F)" aria-label="Найти в таблице" onClick={()=>{setFindOpen(true);requestAnimationFrame(()=>findInputRef.current?.focus());}}><Search size={15}/></button>

        <button
          className={`dataset-sheet__filter-toggle ${filtersOpen ? 'is-active' : ''}`}
          onClick={() =>
            setFiltersOpen((value) => !value)
          }
          title="Фильтры по колонкам" aria-label="Фильтры"
        >
          <Filter size={14} />
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

        {!readOnly && (
          <fieldset className="dataset-sheet__format-group" disabled={!selectedCell} aria-label="Оформление ячеек">
            <select
              className="dataset-sheet__number-format"
              title="Числовой формат выделения (исходные значения не изменяются)"
              value={selectedFormat?.numberFormat ?? 'GENERAL'}
              onChange={(event) =>
                formatCellsInSelection({
                  numberFormat: event.target.value as DatasetCellFormat['numberFormat'],
                })
              }
            >
              <option value="GENERAL">Общий</option>
              <option value="NUMBER">Число</option>
              <option value="PERCENT">%</option>
              <option value="RUB">₽</option>
              <option value="USD">$</option>
              <option value="EUR">€</option>
            </select>
            <button
              title="Уменьшить количество знаков после запятой"
              onClick={() =>
                formatCellsInSelection({
                  decimalPlaces: Math.max(
                    0,
                    (selectedFormat?.decimalPlaces ?? 2) - 1,
                  ),
                })
              }
            >
              −.0
            </button>
            <button
              title="Увеличить количество знаков после запятой"
              onClick={() =>
                formatCellsInSelection({
                  decimalPlaces: Math.min(
                    6,
                    (selectedFormat?.decimalPlaces ?? 2) + 1,
                  ),
                })
              }
            >
              +.0
            </button>
            <TextFormatControls key={`${selectedCell?.rowId}:${selectedCell?.columnId}`} value={selectedFormat??{}} onChange={formatCellsInSelection} colorLabel="Цвет текста ячеек" onPreviewColor={color=>sheetRef.current?.querySelectorAll<HTMLElement>('td.is-range-selected .dataset-sheet__cell-editor,td.is-selected-cell .dataset-sheet__cell-editor').forEach(element=>element.style.color=color)}/>
            <button title="Перенос текста" aria-label="Перенос текста" aria-pressed={Boolean(selectedFormat?.wrap)} onClick={()=>formatCellsInSelection({wrap:!selectedFormat?.wrap})}>↵</button>
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

            <ColorControl key={`background:${selectedCell?.rowId}:${selectedCell?.columnId}`} label="Цвет фона" value={selectedFormat?.background??'#ffffff'} onChange={background=>formatCellsInSelection({background})} onPreview={color=>sheetRef.current?.querySelectorAll<HTMLElement>('td.is-range-selected .dataset-sheet__cell-editor,td.is-selected-cell .dataset-sheet__cell-editor').forEach(element=>element.style.backgroundColor=color)}><PaintBucket size={14}/></ColorControl>

            <button
              onClick={() =>
                formatCellsInSelection({
                  fontFamily:null,fontSize:null,color:null,underline:false,wrap:false,
                  bold: false,
                  italic: false,
                  align: null,
                  background: null,
                  numberFormat: null,
                  decimalPlaces: null,
                })
              }
              title="Очистить формат"
            >
              <X size={13} />
            </button>
          </fieldset>
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
          title="Копировать выбранную ячейку/диапазон" aria-label="Копировать"
        >
          <Copy size={14} />
        </button>

        {!readOnly && (
          <button
            className="dataset-sheet__clipboard-button"
            disabled={!selectedCell}
            onClick={() => void pasteCells()}
            title="Вставить из Excel / Google Sheets / clipboard" aria-label="Вставить"
          >
            <ClipboardPaste size={14} />
          </button>
        )}

        <details className="sheet-command-menu"><summary>Структура</summary><div className="sheet-command-menu__body" onClick={event=>{if((event.target as Element).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}>        {!readOnly && (
          <button
            className="dataset-sheet__add-column" title="Добавить колонку справа" aria-label="Добавить колонку"
            onClick={() => {
              setColumnDialog({
                mode: 'create',
                afterColumnId: dataset?.columns.at(-1)?.id,
              });
              setColumnName('');
              setColumnType('TEXT');
              setColumnError('');
            }}
          >
            <Plus size={14} /> Добавить колонку
          </button>
        )}

        {!readOnly && (
          <button
            className="dataset-sheet__add-row" title="Добавить строку / вставить ниже выбранной" aria-label="Добавить строку"
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
            <Plus size={14} /> Добавить строку
          </button>
        )}

        <div className="dataset-sheet__freeze-buttons">
          <button
            title="Закрепить до выбранной ячейки: не более пяти верхних строк и левых колонок"
            onClick={() => {
              setFrozenRows(Math.min(5, Math.max(1, selectedRowIndex + 1)));
              setFrozenColumns(Math.min(5, Math.max(1, selectedColumnIndex + 1)));
            }}
          >
            <Pin size={13} /> Закрепить
          </button>
          {(frozenRows > 0 || frozenColumns > 0) && (
            <>
              <button
                title="Снять закрепление"
                onClick={() => {
                  setFrozenRows(0);
                  setFrozenColumns(0);
                }}
              >
                <PinOff size={13} /> Снять
              </button>
              <span>{frozenRows} стр. · {frozenColumns} кол.</span>
            </>
          )}
        </div>
<p>Закрепление оставляет верхние строки и левые колонки видимыми при прокрутке.</p></div></details>
        {dataset&&<DatasetExport dataset={dataset}/>}
        <div className="dataset-sheet__page-info">
          Показано {pageRows.length} из {visibleRows.length}
        </div>
      </div>

      <details className="sheet-options"><summary>Данные и сохранённые виды</summary><p>Вид сохраняет фильтры, порядок сортировки, скрытые колонки и закрепление, чтобы быстро возвращаться к нужной выборке.</p><label>Фильтр строк<input aria-label="Фильтр строк" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Оставить строки с текстом…"/></label>      {dataset&&<SpreadsheetTools dataset={dataset} readOnly={readOnly} rowId={selectedCell?.rowId} columnId={selectedCell?.columnId}
        currentView={currentView} onApplyView={applyView} onSaveView={(name)=>{const id=currentView||crypto.randomUUID();saveView({id,name,query,filters:columnFilters,sort:[...(sort?[sort]:[]),...secondarySort],hiddenColumns,columnWidths,frozenRows,frozenColumns});setCurrentView(id);}}
        onDeleteView={(id)=>{deleteView(id);setCurrentView('');}} onSaveRule={saveRule} onDeleteRule={deleteRule}
        onHide={(id)=>{if(dataset.columns.length-hiddenColumns.length>1)setHiddenColumns(list=>[...new Set([...list,id])]);}} onShowAll={()=>setHiddenColumns([])}
        onMultiSort={(columnId,direction)=>setSecondarySort(list=>[...list.filter(item=>item.columnId!==columnId),{columnId,direction}])}/ >}
</details>

      {findOpen&&<div className="sheet-find" role="search" aria-label="Поиск в таблице"><Search size={15}/><input ref={findInputRef} aria-label="Найти в таблице" value={findText} maxLength={200} onChange={e=>{setFindText(e.target.value);setFindIndex(0);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();goToFind(event.shiftKey?-1:1);}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setFindOpen(false);}}}/><label><input type="checkbox" aria-label="Регулярное выражение" checked={findRegex} onChange={e=>setFindRegex(e.target.checked)}/>.*</label><span role="status">{findResults.error||`${findResults.cells.length?findIndex%findResults.cells.length+1:0} / ${findResults.cells.length}`}</span><button aria-label="Предыдущее совпадение" onClick={()=>goToFind(-1)}>↑</button><button aria-label="Следующее совпадение" onClick={()=>goToFind(1)}>↓</button><button aria-label="Закрыть поиск в таблице" onClick={()=>setFindOpen(false)}><X size={14}/></button></div>}
      <div className="dataset-sheet__formula-bar">
        <div className="dataset-sheet__formula-cell">
          {selectedCell && selectedColumn && selectedRow
            ? `${selectedAddress} · ${selectedColumn.name} · строка ${selectedRow.ordinal + 1}`
            : 'Ячейка не выбрана'}
        </div>

        <div className="dataset-sheet__formula-input-wrap">
          <Sigma size={15} />
          <input
            aria-label="Формула или значение ячейки"
            value={formulaInput}
            onFocus={()=>{formulaTarget.current=selectedCell;setFormulaEditing(true);}}
            onBlur={()=>setFormulaEditing(false)}
            disabled={!selectedCell || readOnly}
            placeholder="Формула: =B2*C2, =SUM(B2:B10) или =[price]*[quantity]"
            onChange={(event) =>
              setFormulaInput(event.target.value)
            }
            onKeyDown={(event) => {
              if(event.key==='Tab'&&formulaSuggestions(formulaInput).length){event.preventDefault();const name=formulaSuggestions(formulaInput)[0][0];setFormulaInput(text=>text.replace(/[A-Z]+$/i,`${name}(`));return;}
              if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setFormulaEditing(false);event.currentTarget.blur();return;}
              if (event.key === 'Enter') {
                event.preventDefault();
                commitFormulaBar();
              }
            }}
          />
          {formulaEditing&&formulaSuggestions(formulaInput).length>0&&<div className="formula-suggestions" role="listbox" aria-label="Подсказки формул">{formulaSuggestions(formulaInput).map(([name,example,description])=><button key={name} role="option" aria-selected="false" onMouseDown={event=>event.preventDefault()} onClick={()=>setFormulaInput(text=>text.replace(/[A-Z]+$/i,`${name}(`))}><strong>{name}</strong><span>{description}</span><small>={example}</small></button>)}</div>}
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

      <div className="dataset-sheet__viewport" ref={viewportRef} onScroll={(event)=>setScrollTop(event.currentTarget.scrollTop)}>
        {!dataset || !synced ? (
          <div className="dataset-sheet__loading">
            Синхронизация Dataset…
          </div>
        ) : dataset.columns.length === 0 ? (
          <div className="dataset-sheet__loading">В Dataset нет колонок.</div>
        ) : (
          <table className="dataset-sheet__table" style={{width:54+dataset.columns.filter(column=>!hiddenColumns.includes(column.id)).reduce((total,column)=>total+columnWidth(column.id),0)}} role="grid" aria-rowcount={visibleRows.length} aria-colcount={dataset.columns.length}>
            <colgroup><col style={{width:54}}/>{dataset.columns.filter(column=>!hiddenColumns.includes(column.id)).map(column=><col key={column.id} style={{width:columnWidth(column.id)}}/>)}</colgroup>
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
                  if(hiddenColumns.includes(column.id))return null;
                  const activeSort = sort?.columnId === column.id;

                  return (
                    <th
                      key={column.id}
                      draggable={!readOnly}
                      onDragStart={event=>dragHeader(event,'columns',column.id)}
                      onDragOver={event=>overHeader(event,'columns')}
                      onDrop={event=>dropHeader(event,'columns',column.id)}
                      onDragEnd={()=>{headerDrag.current=null;clearHeaderDrop();}}
                      style={{
                        width: columnWidth(column.id),
                        minWidth: columnWidth(column.id),
                        maxWidth: columnWidth(column.id),
                        ...frozenCellStyle(columnIndex),
                      }}
                      className={columnIndex < frozenColumns ? 'is-frozen-column' : ''}
                    >
                      <button
                        className="dataset-sheet__column-header"
                        onClick={() => selectWholeColumn(column.id)}
                        title="Выделить колонку; перетащите заголовок для перемещения"
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

                        <span role="button" tabIndex={0} title="Сортировать колонку" aria-label={`Сортировать ${column.name}`} onClick={event=>{event.stopPropagation();toggleSort(column.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();toggleSort(column.id);}}}>{activeSort ? (sort?.direction==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>):<ArrowUpDown size={13}/>}</span>
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
                  {dataset.columns.map((column, columnIndex) => hiddenColumns.includes(column.id)?null:(
                    <th
                      key={column.id}
                      className={columnIndex < frozenColumns ? 'is-frozen-column' : ''}
                      style={{
                        width: columnWidth(column.id),
                        minWidth: columnWidth(column.id),
                        maxWidth: columnWidth(column.id),
                        ...frozenCellStyle(columnIndex),
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
              {pageRows.map((row, renderIndex) => {
                const rowIndex=visibleRows.findIndex(item=>item.id===row.id);
                return (<Fragment key={row.id}>
                {renderIndex===frozenRows&&virtualTop>0&&<tr aria-hidden="true" className="sheet-spacer"><td colSpan={dataset.columns.length+1} style={{height:virtualTop,padding:0,border:0}}/></tr>}
                <tr
                  key={row.id}
                  className={row.id === focusRowId ? 'is-focused' : ''}
                >
                  <th
                    className="dataset-sheet__row-number"
                    style={rowIndex < frozenRows ? {
                      top: frozenTopOffset(rowIndex),
                      zIndex: 7,
                    } : undefined}
                    draggable={!readOnly && !sort && !secondarySort.length && !query && !hasColumnFilters}
                    onDragStart={event=>dragHeader(event,'rows',row.id)}
                    onDragOver={event=>overHeader(event,'rows')}
                    onDrop={event=>dropHeader(event,'rows',row.id)}
                    onDragEnd={()=>{headerDrag.current=null;clearHeaderDrop();}}
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
                    if(hiddenColumns.includes(column.id))return null;
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
                    const fillPreview = Boolean(autofillDrag)&&rowIndex>=autofillDrag!.sourceStart&&rowIndex<=autofillDrag!.targetEnd&&columnIndex>=autofillDrag!.sourceStartColumn&&columnIndex<=autofillDrag!.targetColumn&&(rowIndex>autofillDrag!.sourceEnd||columnIndex>autofillDrag!.sourceEndColumn);
                    const fillHandle =
                      !readOnly &&
                      !query &&
                      !sort &&
                      !hasColumnFilters &&
                      Boolean(selectionBounds) &&
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
                          ...frozenCellStyle(columnIndex, rowIndex),
                          ...formulaReferenceStyle(activeReferences,canonicalRowIndexes.get(row.id)??-1,columnIndex),
                        }}
                        data-column-id={column.id}
                        role="gridcell" aria-colindex={columnIndex+1} aria-rowindex={rowIndex+1}
                        className={[
                          columnIndex < frozenColumns ? 'is-frozen-column' : '',
                          rowIndex < frozenRows ? 'is-frozen-row' : '',
                          selected ? 'is-selected-cell' : '',
                          inRange ? 'is-range-selected' : '',
                          fillPreview ? 'is-fill-preview' : '',
                          formula ? 'has-formula' : '',
                          findCellKeys.has(key)?'is-search-match':'',
                          cutCellKeys.has(key)?'is-cut-cell':'',
                        ].filter(Boolean).join(' ')}
                        onMouseDown={(event) =>
                          selectCell(
                            event,
                            row.id,
                            column.id,
                          )
                        }
                        onMouseEnter={(event) =>
                          extendRangeDrag(
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
                          formulaText={formula ? formatFormula(formula.expression,dataset.columns,dataset.rows):undefined}
                          format={{rowId:row.id,columnId:column.id,...formatByCell.get(key),...sheetConditionalFormat(row,column.id,dataset.rules??[],dataset.rows)}}
                          onFocus={() => {
                            if (rangeDragRef.current) return;
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
                          onChange={(value) => {if(typeof value==='string'&&value.trim().startsWith('='))setFormula(row.id,column.id,compileFormula(value,dataset.columns,dataset.rows));else setCell(row.id,column.id,value);}}
                        />
                        {fillHandle && (
                          <span
                            className="dataset-sheet__fill-handle"
                            title="Потянуть вниз или вправо для автозаполнения"
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
              </Fragment>);})}
              {virtualBottom>0&&<tr aria-hidden="true" className="sheet-spacer"><td colSpan={dataset.columns.length+1} style={{height:virtualBottom,padding:0,border:0}}/></tr>}

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
            title="Копировать" aria-label="Копировать"
            onClick={() => {
              void copyCells();
              setCellMenu(null);
            }}
          >
            <Copy size={13} />
              <kbd>Ctrl+C</kbd>
          </button>

          {!readOnly && (
            <button
              title="Вставить" aria-label="Вставить"
              onClick={() => {
                void pasteCells();
                setCellMenu(null);
              }}
            >
              <ClipboardPaste size={13} />
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

      {dataset&&<div className="sheet-summary" role="status"><DatasetConnections dataset={dataset}/>{selectionStats ? <>Заполнено: {selectionStats.count} · Чисел: {selectionStats.numbers} · Сумма: {selectionStats.sum} · Среднее: {selectionStats.average??'—'}</> : 'Выделите ячейки для расчёта суммы и среднего'}{pendingChanges>0?' · Сохранение…':''}</div>}
    </div>
  );
}
