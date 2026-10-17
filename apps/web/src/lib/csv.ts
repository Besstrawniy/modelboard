import Papa from 'papaparse';
import type {
  CreateDatasetInput,
  DatasetCellValue,
  DatasetColumn,
  DatasetDataType,
  DatasetRow,
} from '@modelboard/shared';

export const CSV_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxColumns: 100,
  maxRows: 2000,
} as const;

export type ParsedCsv = {
  fileName: string;
  fileSize: number;
  delimiter: string;
  matrix: string[][];
};

export type CsvImportDraft = {
  columns: DatasetColumn[];
  rows: DatasetRow[];
  preview: string[][];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const numberPattern =
  /^[+-]?(?:(?:0|[1-9]\d*)?\.\d+|(?:0|[1-9]\d*)[eE][+-]?\d+)$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-][0-2]\d:[0-5]\d)?)?$/;

function normalizeRow(row: unknown[]): string[] {
  return row.map((value) => String(value ?? '').trim());
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('For this MVP only .csv files are supported.');
  }

  if (file.size > CSV_LIMITS.maxBytes) {
    throw new Error('CSV is larger than 5 MB.');
  }

  const text = await file.text();
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  });

  const fatalError = result.errors.find((error) => error.type === 'Quotes');
  if (fatalError) {
    throw new Error(`CSV parse error on row ${fatalError.row ?? '?'}: ${fatalError.message}`);
  }

  const matrix = result.data.map((row) => normalizeRow(row as unknown[]));
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);

  if (width === 0 || matrix.length === 0) {
    throw new Error('CSV does not contain any data.');
  }

  if (width > CSV_LIMITS.maxColumns) {
    throw new Error(`CSV contains ${width} columns. MVP limit is ${CSV_LIMITS.maxColumns}.`);
  }

  if (matrix.length > CSV_LIMITS.maxRows + 1) {
    throw new Error(
      `CSV contains more than ${CSV_LIMITS.maxRows} data rows. Reduce the file for this MVP.`,
    );
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    delimiter: result.meta.delimiter || ',',
    matrix,
  };
}

function uniqueHeaders(rawHeaders: string[], width: number) {
  const used = new Map<string, number>();

  return Array.from({ length: width }, (_, index) => {
    const base = rawHeaders[index]?.trim() || `column_${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function inferType(values: string[]): DatasetDataType {
  const samples = values.filter((value) => value !== '').slice(0, 200);
  if (samples.length === 0) return 'TEXT';

  if (samples.every((value) => uuidPattern.test(value))) return 'UUID';
  if (samples.every((value) => /^(true|false)$/i.test(value))) return 'BOOLEAN';
  if (samples.every((value) => integerPattern.test(value))) return 'INTEGER';
  if (samples.every((value) => numberPattern.test(value))) return 'NUMBER';
  if (
    samples.every(
      (value) => isoDatePattern.test(value) && !Number.isNaN(Date.parse(value)),
    )
  ) {
    return 'DATE';
  }

  return 'TEXT';
}

function coerce(value: string, type: DatasetDataType): DatasetCellValue {
  if (value === '') return null;

  if (type === 'INTEGER') {
    return Number.parseInt(value, 10);
  }

  if (type === 'NUMBER') {
    return Number(value);
  }

  if (type === 'BOOLEAN') {
    return value.toLowerCase() === 'true';
  }

  return value;
}

export function buildCsvImportDraft(
  parsed: ParsedCsv,
  firstRowIsHeader: boolean,
): CsvImportDraft {
  const width = parsed.matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const rawHeaders = firstRowIsHeader ? parsed.matrix[0] : [];
  const dataRows = firstRowIsHeader ? parsed.matrix.slice(1) : parsed.matrix;

  if (dataRows.length > CSV_LIMITS.maxRows) {
    throw new Error(`MVP limit is ${CSV_LIMITS.maxRows} data rows.`);
  }

  const headers = uniqueHeaders(rawHeaders, width);
  const types = headers.map((_, columnIndex) =>
    inferType(dataRows.map((row) => row[columnIndex] ?? '')),
  );

  const columns: DatasetColumn[] = headers.map((name, ordinal) => ({
    id: crypto.randomUUID(),
    name,
    dataType: types[ordinal],
    ordinal,
  }));

  const rows: DatasetRow[] = dataRows.map((sourceRow, ordinal) => {
    const values: DatasetRow['values'] = {};

    columns.forEach((column, columnIndex) => {
      values[column.id] = coerce(
        sourceRow[columnIndex] ?? '',
        column.dataType,
      );
    });

    return {
      id: crypto.randomUUID(),
      ordinal,
      values,
    };
  });

  return {
    columns,
    rows,
    preview: dataRows.slice(0, 8).map((row) =>
      Array.from({ length: width }, (_, index) => row[index] ?? ''),
    ),
  };
}

export function toCreateDatasetInput(
  name: string,
  draft: CsvImportDraft,
): CreateDatasetInput {
  return {
    name,
    kind: 'CSV',
    columns: draft.columns,
    rows: draft.rows,
  };
}

export function csvDefaultName(fileName: string) {
  return fileName.replace(/\.csv$/i, '') || 'csv_dataset';
}
