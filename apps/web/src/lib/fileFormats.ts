import Papa from 'papaparse';
import {
  FILE_LIMITS,
  assertSafeJson,
  validateBoardArchive,
  validateDatasetFile,
  type BoardArchive,
  type DatasetSnapshot,
  type DatasetCellValue,
  type DatasetCellFormat,
  type FileAssetInput,
} from '@modelboard/shared';
import { buildCsvImportDraft, type ParsedCsv } from './csv';
import {
  compileFormula,
  evaluateDatasetFormulas,
  formatFormula,
} from './formulas';
export type ImportedSheet = {
  id: string;
  name: string;
  matrix: string[][];
  source?: any;
  warnings: string[];
  native?: DatasetSnapshot;
};
export type ParsedFiles = {
  sheets: ImportedSheet[];
  images: Array<FileAssetInput & { width: number; height: number }>;
  archive?: BoardArchive;
  warnings: string[];
};
export const FILE_ACCEPT = '.csv,.tsv,.xlsx,.json,.svg,.png,.jpg,.jpeg,.webp';
const nameOf = (name: string) =>
  name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Таблица';
export function downloadFile(
  name: string,
  data: Blob | string,
  mime = 'application/json',
) {
  const blob =
    typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[/\\]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function checkMatrix(matrix: string[][]) {
  if (!matrix.length || !matrix.some((r) => r.some((v) => v !== '')))
    throw new Error('Файл не содержит данных');
  if (
    matrix.length > FILE_LIMITS.maxRows + 1 ||
    matrix.some((r) => r.length > FILE_LIMITS.maxColumns)
  )
    throw new Error('Файл: до 10 000 строк и 100 колонок');
}
/** Inspect the central directory before inflating XLSX (including shared strings/media). */
export function checkXlsxZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (
    let i = view.byteLength - 22;
    i >= Math.max(0, view.byteLength - 65557);
    i--
  )
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Некорректный XLSX/ZIP');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    bytes = 0;
  if (count > 2000 || offset === 0xffffffff)
    throw new Error('Слишком сложная книга XLSX');
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > view.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error('Повреждённая структура XLSX');
    bytes += view.getUint32(offset + 24, true);
    if (bytes > 50 * 1024 * 1024)
      throw new Error('Распакованный XLSX превышает 50 МБ');
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
}
export function shiftExcelRows(formula: string, delta: number) {
  return formula
    .split(/("(?:[^"]|"")*")/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /(?<![A-Za-z0-9_])(\$?[A-Za-z]+)(\$?)([1-9]\d*)\b/g,
            (all, column, lock, row) => {
              const value = Number(row) + delta;
              if (value < 1)
                throw new Error('Формула ссылается на строку заголовков');
              return column + lock + value;
            },
          ),
    )
    .join('');
}
function cellValue(value: any): DatasetCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value || 'formula' in value || 'sharedFormula' in value)
      return cellValue(value.result);
    if (value.richText) return value.richText.map((p: any) => p.text).join('');
    if (value.hyperlink) return String(value.text ?? value.hyperlink);
    if (value.error) return String(value.error);
    throw new Error('Неподдерживаемый тип ячейки XLSX');
  }
  return typeof value === 'number' || typeof value === 'boolean'
    ? value
    : String(value);
}
export function buildImportedSheet(
  sheet: ImportedSheet,
  header: boolean,
): DatasetSnapshot {
  if (sheet.native) return structuredClone(sheet.native);
  const draft = buildCsvImportDraft(
    { fileName: sheet.name, fileSize: 0, delimiter: ',', matrix: sheet.matrix },
    header,
  );
  const ds: DatasetSnapshot = {
    id: crypto.randomUUID(),
    workspaceId: '',
    name: sheet.name,
    kind: 'CSV',
    ...draft,
    formulas: [],
    formats: [],
  };
  if (sheet.source) {
    const ws = sheet.source;
    for (let i = 0; i < ds.rows.length; i++)
      for (let c = 0; c < ds.columns.length; c++) {
        const cell = ws.getCell(i + 1 + (header ? 1 : 0), c + 1),
          row = ds.rows[i],
          column = ds.columns[c];
        const value = cellValue(cell.value);
        row.values[column.id] = value;
        const format: DatasetCellFormat = {
          rowId: row.id,
          columnId: column.id,
        };
        if (cell.font?.bold) format.bold = true;
        if (cell.font?.italic) format.italic = true;
        if (['left', 'center', 'right'].includes(cell.alignment?.horizontal))
          format.align = cell.alignment.horizontal.toUpperCase();
        const color = cell.fill?.fgColor?.argb;
        if (typeof color === 'string' && /^[0-9A-F]{8}$/i.test(color))
          format.background = '#' + color.slice(2);
        if (cell.numFmt?.includes('%')) format.numberFormat = 'PERCENT';
        else if (cell.numFmt?.includes('$')) format.numberFormat = 'USD';
        else if (cell.numFmt?.includes('₽')) format.numberFormat = 'RUB';
        else if (cell.numFmt?.includes('€')) format.numberFormat = 'EUR';
        else if (cell.numFmt && /0\.0/.test(cell.numFmt))
          format.numberFormat = 'NUMBER';
        if (Object.keys(format).length > 2) ds.formats.push(format);
        if (cell.formula) {
          try {
            const expression = compileFormula(
              '=' + shiftExcelRows(cell.formula, header ? -1 : 0),
              ds.columns,
              ds.rows,
            );
            if (cell.formula.includes('!') || cell.formula.includes('['))
              throw new Error('Ссылка на другой лист');
            ds.formulas.push({
              rowId: row.id,
              columnId: column.id,
              expression,
            });
          } catch {
            if (value === null)
              throw new Error(
                `У формулы ${cell.address} нет сохранённого результата; пересчитайте книгу в Excel`,
              );
          }
        }
      }
    const results = evaluateDatasetFormulas(ds.rows, ds.columns, ds.formulas);
    ds.formulas = ds.formulas.filter((f) => {
      const result = results.get(`${f.rowId}:${f.columnId}`);
      if (result === '#NAME?' || result === '#ERROR!') {
        if (ds.rows.find((r) => r.id === f.rowId)?.values[f.columnId] === null)
          throw new Error(
            'Неподдерживаемая формула без сохранённого результата',
          );
        return false;
      }
      return true;
    });
    const importedRows = new Map(ds.rows.map((row) => [row.id, row]));
    for (const formula of ds.formulas) {
      const result = results.get(`${formula.rowId}:${formula.columnId}`);
      if (result !== undefined)
        importedRows.get(formula.rowId)!.values[formula.columnId] = result;
    }
    // Infer types from actual values, including dates and booleans (not just formatted text).
    for (const column of ds.columns) {
      const values = ds.rows
        .map((r) => r.values[column.id])
        .filter((v) => v !== null);
      if (values.length && values.every((v) => typeof v === 'number'))
        column.dataType = values.every((v) => Number.isInteger(v))
          ? 'INTEGER'
          : 'NUMBER';
      else if (values.length && values.every((v) => typeof v === 'boolean'))
        column.dataType = 'BOOLEAN';
      else if (
        values.some((v) => typeof v === 'string') &&
        values.some((v) => typeof v !== 'string')
      )
        column.dataType = 'TEXT';
    }
  }
  validateDatasetFile(ds);
  return ds;
}
export async function parseImportFiles(files: File[]): Promise<ParsedFiles> {
  if (!files.length || files.length > 20)
    throw new Error('Выберите от 1 до 20 файлов');
  const out: ParsedFiles = { sheets: [], images: [], warnings: [] };
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (total > FILE_LIMITS.maxArchiveBytes)
      throw new Error('Общий размер файлов — до 30 МБ');
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (
      file.size >
      (ext === 'json' ? FILE_LIMITS.maxArchiveBytes : FILE_LIMITS.maxFileBytes)
    )
      throw new Error(`${file.name}: файл слишком большой`);
    if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext ?? '')) {
      if (file.size > FILE_LIMITS.maxImageBytes)
        throw new Error('Изображение: до 3 МБ');
      const mime =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : `image/${ext}`;
      const data = await file.arrayBuffer();
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const base64 = btoa(binary),
        url = URL.createObjectURL(new Blob([data], { type: mime }));
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () =>
            reject(new Error(`${file.name}: изображение не читается`));
          image.src = url;
        });
        if (image.naturalWidth * image.naturalHeight > 40_000_000)
          throw new Error('Изображение: максимум 40 млн пикселей');
        out.images.push({
          name: file.name,
          mime,
          base64,
          width: image.naturalWidth || 300,
          height: image.naturalHeight || 200,
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      continue;
    }
    if (ext === 'csv' || ext === 'tsv') {
      const result = Papa.parse<string[]>(await file.text(), {
        delimiter: ext === 'tsv' ? '\t' : '',
        skipEmptyLines: 'greedy',
      });
      if (result.errors.some((e) => e.type === 'Quotes'))
        throw new Error(`${file.name}: повреждены кавычки CSV`);
      const matrix = result.data.map((row) => row.map((v) => String(v ?? '')));
      checkMatrix(matrix);
      out.sheets.push({
        id: crypto.randomUUID(),
        name: nameOf(file.name),
        matrix,
        warnings: [],
      });
      continue;
    }
    if (ext === 'xlsx') {
      const buffer = await file.arrayBuffer();
      checkXlsxZip(buffer);
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      if (workbook.worksheets.length > 50)
        throw new Error('В книге больше 50 листов');
      for (const ws of workbook.worksheets) {
        if (!ws.actualRowCount) continue;
        if (ws.rowCount > 10001 || ws.columnCount > 100)
          throw new Error(`Лист ${ws.name}: до 10 000 строк и 100 колонок`);
        const matrix = Array.from({ length: ws.rowCount }, (_, i) =>
          Array.from({ length: ws.columnCount }, (_, c) =>
            String(cellValue(ws.getCell(i + 1, c + 1).value) ?? ''),
          ),
        );
        checkMatrix(matrix);
        const warnings: string[] = [];
        if (ws.model.merges?.length)
          warnings.push(
            'Объединённые ячейки разворачиваются в обычные строки/колонки',
          );
        let formulaCount = 0;
        ws.eachRow((row) =>
          row.eachCell((cell) => {
            if (cell.formula) formulaCount++;
          }),
        );
        if (formulaCount)
          warnings.push(
            'Формулы текущего листа сохраняются, неподдерживаемые и внешние ссылки заменяются сохранёнными результатами',
          );
        warnings.push(
          'Диаграммы, изображения внутри XLSX, макросы и оформление за пределами базовых стилей не импортируются',
        );
        out.sheets.push({
          id: crypto.randomUUID(),
          name: ws.name,
          matrix,
          source: ws,
          warnings,
        });
      }
      continue;
    }
    if (ext === 'json') {
      const value = JSON.parse(await file.text());
      assertSafeJson(value);
      if (value?.format === 'modelboard') {
        if (files.length !== 1)
          throw new Error('Архив доски импортируется отдельным файлом');
        validateBoardArchive(value);
        out.archive = value;
        continue;
      }
      if (value?.format === 'modelboard.dataset' && value.version === 1) {
        validateDatasetFile(value.dataset);
        out.sheets.push({
          id: crypto.randomUUID(),
          name: value.dataset.name,
          native: value.dataset,
          matrix: [
            value.dataset.columns.map((c: any) => c.name),
            ...value.dataset.rows
              .slice(0, 8)
              .map((r: any) =>
                value.dataset.columns.map((c: any) =>
                  String(r.values[c.id] ?? ''),
                ),
              ),
          ],
          warnings: [],
        });
        continue;
      }
      const records = Array.isArray(value)
        ? value
        : Array.isArray(value?.rows)
          ? value.rows
          : null;
      if (
        !records?.length ||
        records.some(
          (r: any) => !r || typeof r !== 'object' || Array.isArray(r),
        )
      )
        throw new Error('JSON: ожидается массив объектов или архив ModelBoard');
      const keys = [
        ...new Set<string>(records.flatMap((r: any) => Object.keys(r))),
      ];
      const matrix = [
        keys,
        ...records.map((r: any) =>
          keys.map((key) => {
            const v = r[key];
            if (v !== null && typeof v === 'object')
              throw new Error('JSON: вложенные объекты не помещаются в ячейки');
            return String(v ?? '');
          }),
        ),
      ];
      checkMatrix(matrix);
      const columns = keys.map((name, ordinal) => {
        const values = records
          .map((r: any) => r[name])
          .filter((v: any) => v !== null && v !== undefined);
        const dataType =
          values.length && values.every((v: any) => typeof v === 'number')
            ? values.every((v: any) => Number.isInteger(v))
              ? 'INTEGER'
              : 'NUMBER'
            : values.length && values.every((v: any) => typeof v === 'boolean')
              ? 'BOOLEAN'
              : 'TEXT';
        return {
          id: crypto.randomUUID(),
          name,
          ordinal,
          dataType,
        } as import('@modelboard/shared').DatasetColumn;
      });
      const native: DatasetSnapshot = {
        id: crypto.randomUUID(),
        workspaceId: '',
        name: nameOf(file.name),
        kind: 'CSV',
        columns,
        rows: records.map((r: any, ordinal: number) => ({
          id: crypto.randomUUID(),
          ordinal,
          values: Object.fromEntries(
            columns.map((c) => [c.id, r[c.name] ?? null]),
          ),
        })),
        formulas: [],
        formats: [],
        views: [],
        rules: [],
      };
      validateDatasetFile(native);
      out.sheets.push({
        id: crypto.randomUUID(),
        name: native.name,
        native,
        matrix,
        warnings: [],
      });
      continue;
    }
    throw new Error(
      `${file.name}: поддерживаются CSV, TSV, XLSX, JSON, SVG, PNG, JPEG и WebP. Для старого XLS сохраните книгу как XLSX.`,
    );
  }
  if (
    out.sheets.length > 50 ||
    (!out.sheets.length && !out.images.length && !out.archive)
  )
    throw new Error('Нет поддерживаемых данных или слишком много листов');
  return out;
}
export async function exportDatasetFile(
  ds: DatasetSnapshot,
  format: 'json' | 'csv' | 'tsv' | 'xlsx',
) {
  const filename = ds.name.replace(/[/\\]/g, '_');
  if (format === 'json') {
    downloadFile(
      filename + '.dataset.json',
      JSON.stringify(
        { format: 'modelboard.dataset', version: 1, dataset: ds },
        null,
        2,
      ),
    );
    return;
  }
  if (format === 'csv' || format === 'tsv') {
    const matrix = [
      ds.columns.map((c) => c.name),
      ...ds.rows.map((row) => ds.columns.map((c) => row.values[c.id] ?? '')),
    ];
    downloadFile(
      filename + '.' + format,
      '\ufeff' +
        Papa.unparse(matrix, {
          delimiter: format === 'tsv' ? '\t' : ',',
          escapeFormulae: true,
        }),
      'text/csv;charset=utf-8',
    );
    return;
  }
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet(
      ds.name.replace(/[\\/?*\[\]:]/g, '_').slice(0, 31) || 'Sheet',
    );
  ws.addRow(ds.columns.map((c) => c.name));
  for (const row of ds.rows)
    ws.addRow(
      ds.columns.map((c) =>
        c.dataType === 'DATE' &&
        typeof row.values[c.id] === 'string' &&
        !Number.isNaN(Date.parse(String(row.values[c.id])))
          ? new Date(String(row.values[c.id]))
          : row.values[c.id],
      ),
    );
  const rowIndex = new Map(ds.rows.map((r, i) => [r.id, i + 2])),
    colIndex = new Map(ds.columns.map((c, i) => [c.id, i + 1]));
  for (const f of ds.formulas) {
    const ri = rowIndex.get(f.rowId),
      ci = colIndex.get(f.columnId);
    if (ri && ci) {
      const result = ds.rows.find((r) => r.id === f.rowId)?.values[f.columnId];
      ws.getCell(ri, ci).value = {
        formula: shiftExcelRows(
          formatFormula(f.expression, ds.columns, ds.rows).slice(1),
          1,
        ),
        result: result as any,
      };
    }
  }
  for (const f of ds.formats) {
    const ri = rowIndex.get(f.rowId),
      ci = colIndex.get(f.columnId);
    if (!ri || !ci) continue;
    const cell = ws.getCell(ri, ci);
    cell.font = { bold: Boolean(f.bold), italic: Boolean(f.italic) };
    if (f.align) cell.alignment = { horizontal: f.align.toLowerCase() as any };
    if (f.background && /^#[\da-f]{6}$/i.test(f.background))
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF' + f.background.slice(1) },
      };
    const fmts: Record<string, string> = {
      PERCENT: '0.00%',
      USD: '"$"#,##0.00',
      RUB: '#,##0.00" ₽"',
      EUR: '"€"#,##0.00',
      NUMBER: '0.00',
    };
    if (f.numberFormat) cell.numFmt = fmts[f.numberFormat] ?? 'General';
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await wb.xlsx.writeBuffer();
  downloadFile(
    filename + '.xlsx',
    new Blob([buffer as any], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}
