import type {
  DatasetCellValue,
  DatasetColumn,
  DatasetFormula,
  DatasetRow,
} from './index.js';

/** Public names used by both the parser and the editor suggestions. */
export const FORMULA_FUNCTIONS = [
 ['SUM','СУММ','Сумма','SUM(A1:A10)'],['AVERAGE','СРЗНАЧ','Среднее значение','AVERAGE(A1:A10)'],['AVG','СРЗНАЧ','Среднее значение','AVG(A1:A10)'],
 ['MIN','МИН','Минимум','MIN(A1:A10)'],['MAX','МАКС','Максимум','MAX(A1:A10)'],['COUNT','СЧЁТ','Количество чисел','COUNT(A1:A10)'],['COUNTA','СЧЁТЗ','Заполненные ячейки','COUNTA(A1:A10)'],['COUNTBLANK','СЧИТАТЬПУСТОТЫ','Пустые ячейки','COUNTBLANK(A1:A10)'],
 ['COUNTIF','СЧЁТЕСЛИ','Количество по условию','COUNTIF(A1:A10, ">0")'],['SUMIF','СУММЕСЛИ','Сумма по условию','SUMIF(A1:A10, ">0", B1:B10)'],['AVERAGEIF','СРЗНАЧЕСЛИ','Среднее по условию','AVERAGEIF(A1:A10, ">0", B1:B10)'],
 ['IF','ЕСЛИ','Условие','IF(A1>0, "Да", "Нет")'],['IFERROR','ЕСЛИОШИБКА','Значение при ошибке','IFERROR(A1/B1, 0)'],['AND','И','Все условия истинны','AND(A1>0, B1>0)'],['OR','ИЛИ','Хотя бы одно условие','OR(A1>0, B1>0)'],['NOT','НЕ','Отрицание','NOT(A1>0)'],
 ['ROUND','ОКРУГЛ','Округление','ROUND(A1, 2)'],['ROUNDUP','ОКРУГЛВВЕРХ','Округление вверх','ROUNDUP(A1, 2)'],['ROUNDDOWN','ОКРУГЛВНИЗ','Округление вниз','ROUNDDOWN(A1, 2)'],['ABS','ABS','Модуль числа','ABS(A1)'],['INT','ЦЕЛОЕ','Целая часть','INT(A1)'],['MOD','ОСТАТ','Остаток деления','MOD(A1, 2)'],['POWER','СТЕПЕНЬ','Возведение в степень','POWER(A1, 2)'],['SQRT','КОРЕНЬ','Квадратный корень','SQRT(A1)'],
 ['CONCAT','СЦЕП','Объединение текста','CONCAT(A1, " ", B1)'],['CONCATENATE','СЦЕПИТЬ','Объединение текста','CONCATENATE(A1, B1)'],['TEXTJOIN','ОБЪЕДИНИТЬ','Текст с разделителем','TEXTJOIN(", ", TRUE, A1:A10)'],['LEN','ДЛСТР','Длина текста','LEN(A1)'],['LOWER','СТРОЧН','Нижний регистр','LOWER(A1)'],['UPPER','ПРОПИСН','Верхний регистр','UPPER(A1)'],['TRIM','СЖПРОБЕЛЫ','Удаление лишних пробелов','TRIM(A1)'],['LEFT','ЛЕВСИМВ','Начало текста','LEFT(A1, 3)'],['RIGHT','ПРАВСИМВ','Конец текста','RIGHT(A1, 3)'],['MID','ПСТР','Часть текста','MID(A1, 2, 3)'],
 ['DATE','ДАТА','Дата из частей','DATE(2026, 10, 20)'],['YEAR','ГОД','Год даты','YEAR(A1)'],['MONTH','МЕСЯЦ','Месяц даты','MONTH(A1)'],['DAY','ДЕНЬ','День даты','DAY(A1)'],
 ['INDEX','ИНДЕКС','Значение по позиции','INDEX(A1:C10, 2, 1)'],['MATCH','ПОИСКПОЗ','Позиция значения','MATCH(A1, B1:B10, 0)'],['VLOOKUP','ВПР','Поиск по колонке','VLOOKUP(A1, B1:C10, 2, FALSE)'],['HLOOKUP','ГПР','Поиск по строке','HLOOKUP(A1, A2:C3, 2, FALSE)'],['XLOOKUP','ПРОСМОТРX','Поиск значения','XLOOKUP(A1, B1:B10, C1:C10)'],
] as const;
const FORMULA_ALIASES: Record<string,string> = {ИСТИНА:'TRUE',ЛОЖЬ:'FALSE',СУМ:'SUM',СУМЕСЛИ:'SUMIF',СЧЕТ:'COUNT',СЧЕТЗ:'COUNTA',СЧЕТЕСЛИ:'COUNTIF','ПРОСМОТРХ':'XLOOKUP'};
for(const [name,russian] of FORMULA_FUNCTIONS){FORMULA_ALIASES[name]=name;FORMULA_ALIASES[russian.toUpperCase()]=name;}
FORMULA_ALIASES['СРЗНАЧ']='AVERAGE';
export function canonicalFormulaName(name:string){return FORMULA_ALIASES[name.toUpperCase()]??name.toUpperCase();}

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ref'; value: string }
  | {
      type: 'cell';
      rowId: string;
      columnId: string;
    }
  | {
      type: 'range';
      startRowId: string;
      startColumnId: string;
      endRowId: string;
      endColumnId: string;
    }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'punctuation'; value: '(' | ')' | ',' | ';' }
  | { type: 'error'; value: string }
  | { type: 'eof' };

type Expr =
  | { type: 'literal'; value: DatasetCellValue }
  | { type: 'ref'; columnId: string }
  | { type: 'cell'; rowId: string; columnId: string }
  | {
      type: 'range';
      startRowId: string;
      startColumnId: string;
      endRowId: string;
      endColumnId: string;
    }
  | { type: 'unary'; operator: '+' | '-'; value: Expr }
  | { type: 'binary'; operator: string; left: Expr; right: Expr }
  | { type: 'call'; name: string; args: Expr[] }
  | { type: 'error'; value: string };

type FormulaValue = DatasetCellValue | DatasetCellValue[];

type EvalContext = {
  resolveColumn: (columnId: string) => DatasetCellValue;
  resolveCell: (
    rowId: string,
    columnId: string,
  ) => DatasetCellValue;
  rangeWidth?: (startColumnId:string,endColumnId:string)=>number;
  resolveRange: (
    startRowId: string,
    startColumnId: string,
    endRowId: string,
    endColumnId: string,
  ) => DatasetCellValue[];
};

export class FormulaSyntaxError extends Error {}

const UUID = '[0-9a-f-]{36}';
const CELL_SOURCE = `(\\$?)#\\{(${UUID})\\}(\\$?)@\\{(${UUID})\\}`;
const RANGE_REFERENCE = new RegExp(`${CELL_SOURCE}:${CELL_SOURCE}`, 'iy');
const CELL_REFERENCE = new RegExp(CELL_SOURCE, 'iy');
const REFERENCE = new RegExp(
  `@\\{(${UUID})\\}`,
  'iy',
);

export function columnLabel(index: number) {
  if (!Number.isInteger(index) || index < 0) {
    return '?';
  }

  let value = index + 1;
  let label = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label =
      String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function columnIndex(label: string) {
  let value = 0;

  for (const char of label.toUpperCase()) {
    if (char < 'A' || char > 'Z') return -1;
    value = value * 26 + char.charCodeAt(0) - 64;
  }

  return value - 1;
}

function replaceOutsideStrings(
  source: string,
  transform: (chunk: string) => string,
) {
  let result = '';
  let chunk = '';
  let quote = '';
  let escaped = false;

  const flush = () => {
    if (chunk) {
      result += transform(chunk);
      chunk = '';
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      result += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = '';
      }

      continue;
    }

    if (char === '"' || char === "'") {
      flush();
      quote = char;
      result += char;
      continue;
    }

    chunk += char;
  }

  flush();
  return result;
}

function displayCellToCanonical(
  label: string,
  rowNumberText: string,
  columns: DatasetColumn[],
  rows: DatasetRow[],
) {
  const columnPosition = columnIndex(label);
  const rowPosition = Number(rowNumberText) - 1;

  const column = columns[columnPosition];
  const row = rows[rowPosition];

  if (!column || !row) {
    throw new FormulaSyntaxError(
      `Ячейка ${label.toUpperCase()}${rowNumberText} находится вне Dataset.`,
    );
  }

  return `#{${row.id}}@{${column.id}}`;
}

function canonicalCellToDisplay(
  rowId: string,
  columnId: string,
  columns: DatasetColumn[],
  rows: DatasetRow[],
) {
  const rowPosition = rows.findIndex(
    (row) => row.id === rowId,
  );
  const columnPosition = columns.findIndex(
    (column) => column.id === columnId,
  );

  if (rowPosition < 0 || columnPosition < 0) {
    return '#REF!';
  }

  return `${columnLabel(columnPosition)}${rowPosition + 1}`;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = source.startsWith('=') ? 1 : 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    RANGE_REFERENCE.lastIndex = index;
    const range = RANGE_REFERENCE.exec(source);
    if (range && range.index === index) {
      tokens.push({
        type: 'range',
        startRowId: range[2],
        startColumnId: range[4],
        endRowId: range[6],
        endColumnId: range[8],
      });
      index = RANGE_REFERENCE.lastIndex;
      continue;
    }

    CELL_REFERENCE.lastIndex = index;
    const cell = CELL_REFERENCE.exec(source);
    if (cell && cell.index === index) {
      tokens.push({
        type: 'cell',
        rowId: cell[2],
        columnId: cell[4],
      });
      index = CELL_REFERENCE.lastIndex;
      continue;
    }

    REFERENCE.lastIndex = index;
    const ref = REFERENCE.exec(source);
    if (ref && ref.index === index) {
      tokens.push({ type: 'ref', value: ref[1] });
      index = REFERENCE.lastIndex;
      continue;
    }

    const errorToken=source.slice(index).match(/^#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A|NUM!|CYCLE!|ERROR!)/);
    if(errorToken){tokens.push({type:'error',value:errorToken[0]});index+=errorToken[0].length;continue;}
    const number = source
      .slice(index)
      .match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({
        type: 'number',
        value: Number(number[0]),
      });
      index += number[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      let closed = false;

      while (index < source.length) {
        const current = source[index];

        if (current === '\\' && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }

        if (current === quote) {
          if(source[index+1]===quote){value+=quote;index+=2;continue;}
          index += 1;
          closed = true;
          break;
        }

        value += current;
        index += 1;
      }

      if (!closed) {
        throw new FormulaSyntaxError(
          'Незакрытая строка в формуле.',
        );
      }

      tokens.push({ type: 'string', value });
      continue;
    }

    const identifier = source
      .slice(index)
      .match(/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.]*/);
    if (identifier) {
      tokens.push({
        type: 'identifier',
        value: canonicalFormulaName(identifier[0]),
      });
      index += identifier[0].length;
      continue;
    }

    const two = source.slice(index, index + 2);
    if (['<=', '>=', '<>', '!=', '=='].includes(two)) {
      tokens.push({ type: 'operator', value: two });
      index += 2;
      continue;
    }

    if ('+-*/^=<>&'.includes(char)) {
      tokens.push({
        type: 'operator',
        value: char,
      });
      index += 1;
      continue;
    }

    if ('(),;'.includes(char)) {
      tokens.push({
        type: 'punctuation',
        value: char as '(' | ')' | ',' | ';',
      });
      index += 1;
      continue;
    }

    throw new FormulaSyntaxError(
      `Неожиданный символ в формуле: ${char}`,
    );
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expression = this.comparison();

    if (this.peek().type !== 'eof') {
      throw new FormulaSyntaxError(
        'Лишний текст после формулы.',
      );
    }

    return expression;
  }

  private peek() {
    return this.tokens[this.position];
  }

  private take() {
    return this.tokens[this.position++];
  }

  private operator(value?: string) {
    const token = this.peek();
    return (
      token.type === 'operator' &&
      (value === undefined || token.value === value)
    );
  }

  private punctuation(value: string) {
    const token = this.peek();
    return (
      token.type === 'punctuation' &&
      token.value === value
    );
  }

  private comparison(): Expr {
    let left = this.additive();

    while (
      this.operator() &&
      ['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(
        (this.peek() as any).value,
      )
    ) {
      const operator = (this.take() as any).value as string;
      const right = this.additive();
      left = {
        type: 'binary',
        operator,
        left,
        right,
      };
    }

    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();

    while (
      this.operator('+') ||
      this.operator('-') || this.operator('&')
    ) {
      const operator = (this.take() as any)
        .value as '+' | '-';
      const right = this.multiplicative();
      left = {
        type: 'binary',
        operator,
        left,
        right,
      };
    }

    return left;
  }

  private multiplicative(): Expr {
    let left = this.power();

    while (
      this.operator('*') ||
      this.operator('/')
    ) {
      const operator = (this.take() as any)
        .value as '*' | '/';
      const right = this.power();
      left = {
        type: 'binary',
        operator,
        left,
        right,
      };
    }

    return left;
  }

  private power(): Expr {
    let left = this.unary();

    if (this.operator('^')) {
      this.take();
      const right = this.power();
      left = {
        type: 'binary',
        operator: '^',
        left,
        right,
      };
    }

    return left;
  }

  private unary(): Expr {
    if (
      this.operator('+') ||
      this.operator('-')
    ) {
      const operator = (this.take() as any)
        .value as '+' | '-';

      return {
        type: 'unary',
        operator,
        value: this.unary(),
      };
    }

    return this.primary();
  }

  private primary(): Expr {
    const token = this.take();

    if (
      token.type === 'number' ||
      token.type === 'string'
    ) {
      return {
        type: 'literal',
        value: token.value,
      };
    }

    if(token.type==='error')return {type:'error',value:token.value};
    if (token.type === 'ref') {
      return {
        type: 'ref',
        columnId: token.value,
      };
    }

    if (token.type === 'cell') {
      return {
        type: 'cell',
        rowId: token.rowId,
        columnId: token.columnId,
      };
    }

    if (token.type === 'range') {
      return {
        type: 'range',
        startRowId: token.startRowId,
        startColumnId: token.startColumnId,
        endRowId: token.endRowId,
        endColumnId: token.endColumnId,
      };
    }

    if (token.type === 'identifier') {
      if (token.value === 'TRUE') {
        return {
          type: 'literal',
          value: true,
        };
      }
      if (token.value === 'FALSE') {
        return {
          type: 'literal',
          value: false,
        };
      }
      if (token.value === 'NULL') {
        return {
          type: 'literal',
          value: null,
        };
      }

      if (!this.punctuation('(')) {
        throw new FormulaSyntaxError(
          `Неизвестное имя: ${token.value}`,
        );
      }

      this.take();
      const args: Expr[] = [];

      if (!this.punctuation(')')) {
        while (true) {
          args.push(this.comparison());

          if (
            this.punctuation(',') ||
            this.punctuation(';')
          ) {
            this.take();
            continue;
          }

          break;
        }
      }

      if (!this.punctuation(')')) {
        throw new FormulaSyntaxError(
          `Ожидалась закрывающая скобка после ${token.value}.`,
        );
      }
      this.take();

      return {
        type: 'call',
        name: token.value,
        args,
      };
    }

    if (
      token.type === 'punctuation' &&
      token.value === '('
    ) {
      const expression = this.comparison();

      if (!this.punctuation(')')) {
        throw new FormulaSyntaxError(
          'Ожидалась закрывающая скобка.',
        );
      }

      this.take();
      return expression;
    }

    throw new FormulaSyntaxError(
      'Ожидалось значение или ссылка на ячейку.',
    );
  }
}

function parseCanonical(expression: string) {
  return new Parser(
    tokenize(expression),
  ).parse();
}

export function formulaKey(
  rowId: string,
  columnId: string,
) {
  return `${rowId}:${columnId}`;
}

export function compileFormula(
  displayExpression: string,
  columns: DatasetColumn[],
  rows: DatasetRow[] = [],
) {
  const trimmed = displayExpression.trim();

  if (!trimmed.startsWith('=')) {
    throw new FormulaSyntaxError(
      'Формула должна начинаться со знака =.',
    );
  }

  const normalized=replaceOutsideStrings(trimmed,chunk=>chunk.replace(/\[[^\]]*\]|[\p{L}_][\p{L}\p{N}_.]*/gu,name=>name.startsWith('[')?name:FORMULA_ALIASES[name.toUpperCase()]??name));
  const a1Resolved = replaceOutsideStrings(normalized,(chunk)=>chunk.replace(
    /(?<![A-Za-z0-9_])(\$?)([A-Za-z]+)(\$?)([1-9]\d*)(?![A-Za-z0-9_])/g,
    (match,colLock:string,label:string,rowLock:string,row:string,offset:number)=>{
      if(chunk.slice(offset+match.length).trimStart().startsWith('('))return match;
      const value=displayCellToCanonical(label,row,columns,rows);
      return value.replace(/^#/,rowLock+'#').replace('@',colLock+'@');
    }));

  const byName = new Map(
    columns.map((column) => [
      column.name.trim().toLowerCase(),
      column.id,
    ]),
  );

  const canonical = replaceOutsideStrings(
    a1Resolved,
    (chunk) =>
      chunk.replace(
        /\[([^\]]+)\]/g,
        (_, rawName: string) => {
          const name = rawName.trim();
          const columnId = byName.get(
            name.toLowerCase(),
          );

          if (!columnId) {
            throw new FormulaSyntaxError(
              `Колонка [${name}] не найдена.`,
            );
          }

          return `@{${columnId}}`;
        },
      ),
  );

  parseCanonical(canonical);
  return canonical;
}

export function formatFormula(canonical:string,columns:DatasetColumn[],rows:DatasetRow[]=[]) {
  const names=new Map(columns.map(column=>[column.id,column.name]));
  return replaceOutsideStrings(canonical,chunk=>chunk.replace(new RegExp(CELL_SOURCE,'gi'),(_,rowLock:string,rowId:string,colLock:string,columnId:string)=>{
    const display=canonicalCellToDisplay(rowId,columnId,columns,rows);
    return display.replace(/^([A-Z]+)(\d+)$/,(_,label:string,row:string)=>colLock+label+rowLock+row);
  }).replace(new RegExp(`@\\{(${UUID})\\}`,'gi'),(_,id:string)=>`[${names.get(id)??'#REF!'}]`));
}

export function translateFormulaForCopy(
  canonical: string,
  sourceRowId: string,
  sourceColumnId: string,
  targetRowId: string,
  targetColumnId: string,
  rows: DatasetRow[],
  columns: DatasetColumn[],
) {
  const sourceRow = rows.findIndex(
    (row) => row.id === sourceRowId,
  );
  const targetRow = rows.findIndex(
    (row) => row.id === targetRowId,
  );
  const sourceColumn = columns.findIndex(
    (column) => column.id === sourceColumnId,
  );
  const targetColumn = columns.findIndex(
    (column) => column.id === targetColumnId,
  );

  if (
    sourceRow < 0 ||
    targetRow < 0 ||
    sourceColumn < 0 ||
    targetColumn < 0
  ) {
    return canonical;
  }

  const rowDelta = targetRow - sourceRow;
  const columnDelta =
    targetColumn - sourceColumn;

  return replaceOutsideStrings(canonical,chunk=>chunk.replace(new RegExp(CELL_SOURCE,'gi'),(_,rowLock:string,rowId:string,colLock:string,columnId:string)=>{
    const ri=rows.findIndex(row=>row.id===rowId),ci=columns.findIndex(column=>column.id===columnId);
    const r=ri+(rowLock?0:rowDelta),c=ci+(colLock?0:columnDelta);
    if(ri<0||ci<0||r<0||c<0||r>=rows.length||c>=columns.length)return '#REF!';
    return `${rowLock}#{${rows[r].id}}${colLock}@{${columns[c].id}}`;
  }));
}

/** Reassign archive identities while leaving quoted business text intact. */
export function remapFormulaIds(canonical: string, ids: ReadonlyMap<string, string>) {
  return replaceOutsideStrings(canonical, chunk => chunk.replace(
    /([#@])\{([^}]+)\}/g,
    (match, marker: string, id: string) => `${marker}{${ids.get(id) ?? id}}`,
  ));
}

export function retargetFormula(canonical:string,targets:Map<string,{rowId:string;columnId:string}>) {
  return replaceOutsideStrings(canonical,chunk=>chunk.replace(new RegExp(CELL_SOURCE,'gi'),(match,rowLock:string,rowId:string,colLock:string,columnId:string)=>{
    const target=targets.get(formulaKey(rowId,columnId));return target?`${rowLock}#{${target.rowId}}${colLock}@{${target.columnId}}`:match;
  }));
}

function scalar(
  value: FormulaValue,
): DatasetCellValue {
  if (Array.isArray(value)) {
    throw new Error('#VALUE!');
  }

  if(typeof value==='string' && /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|N\/A|NUM!|CYCLE!|ERROR!)/.test(value))throw new Error(value);
  return value;
}

function flatten(
  values: FormulaValue[],
) {
  return values.flatMap((value) =>
    Array.isArray(value) ? value : [value],
  );
}

function toNumber(value: DatasetCellValue) {
  scalar(value);
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const normalized = value.trim();
  if (!normalized) return 0;

  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new Error('#VALUE!');
  }

  return number;
}

function compare(
  left: DatasetCellValue,
  right: DatasetCellValue,
) {
  if (
    typeof left === 'number' ||
    typeof right === 'number'
  ) {
    return toNumber(left) - toNumber(right);
  }

  return String(left ?? '').localeCompare(
    String(right ?? ''),
    undefined,
    {
      numeric: true,
      sensitivity: 'base',
    },
  );
}

function evaluate(
  expression: Expr,
  context: EvalContext,
): FormulaValue {
  if(expression.type==='error')throw new Error(expression.value);
  if (expression.type === 'literal') {
    return expression.value;
  }

  if (expression.type === 'ref') {
    return context.resolveColumn(
      expression.columnId,
    );
  }

  if (expression.type === 'cell') {
    return context.resolveCell(
      expression.rowId,
      expression.columnId,
    );
  }

  if (expression.type === 'range') {
    return context.resolveRange(
      expression.startRowId,
      expression.startColumnId,
      expression.endRowId,
      expression.endColumnId,
    );
  }

  if (expression.type === 'unary') {
    const number = toNumber(
      scalar(
        evaluate(
          expression.value,
          context,
        ),
      ),
    );

    return expression.operator === '-'
      ? -number
      : number;
  }

  if (expression.type === 'binary') {
    const left = scalar(
      evaluate(
        expression.left,
        context,
      ),
    );
    const right = scalar(
      evaluate(
        expression.right,
        context,
      ),
    );

    switch (expression.operator) {
      case '&': return String(left??'')+String(right??'');
      case '+':
        return toNumber(left) + toNumber(right);
      case '-':
        return toNumber(left) - toNumber(right);
      case '*':
        return toNumber(left) * toNumber(right);
      case '/': {
        const divisor = toNumber(right);

        if (divisor === 0) {
          throw new Error('#DIV/0!');
        }

        return toNumber(left) / divisor;
      }
      case '^':
        return Math.pow(
          toNumber(left),
          toNumber(right),
        );
      case '=':
      case '==':
        return compare(left, right) === 0;
      case '<>':
      case '!=':
        return compare(left, right) !== 0;
      case '<':
        return compare(left, right) < 0;
      case '<=':
        return compare(left, right) <= 0;
      case '>':
        return compare(left, right) > 0;
      case '>=':
        return compare(left, right) >= 0;
      default:
        throw new Error('#ERROR!');
    }
  }

  if(expression.name==='IFERROR'){if(expression.args.length!==2)throw new Error('#ARGS!');try{return scalar(evaluate(expression.args[0],context));}catch{return evaluate(expression.args[1],context);}}
  if (expression.name === 'IF') {
    if (
      expression.args.length < 2 ||
      expression.args.length > 3
    ) {
      throw new Error('#ARGS!');
    }

    const condition = scalar(
      evaluate(
        expression.args[0],
        context,
      ),
    );

    return condition
      ? evaluate(
          expression.args[1],
          context,
        )
      : expression.args[2]
        ? evaluate(
            expression.args[2],
            context,
          )
        : null;
  }

  const evaluated = expression.args.map(
    (argument) =>
      evaluate(
        argument,
        context,
      ),
  );
  const values = flatten(evaluated);
  const numeric = () => evaluated.flatMap((value)=>Array.isArray(value)?value.filter((item)=>typeof item==='number').map(toNumber):[toNumber(value)]);
  const arg=(index:number)=>scalar(evaluated[index]??null);
  const num=(index:number)=>toNumber(arg(index));
  const arr=(index:number):DatasetCellValue[]=>Array.isArray(evaluated[index])?evaluated[index] as DatasetCellValue[]:[arg(index)];
  const text=(index:number)=>String(arg(index)??'');
  const criterion=(value:DatasetCellValue,test:DatasetCellValue)=>{
    const match=String(test??'').match(/^(>=|<=|<>|>|<|=)?(.*)$/)!;
    const operand=/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(match[2])?Number(match[2]):match[2];
    if(!match[1] && /[*?]/.test(match[2])) {
      const pattern=match[2].replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.');
      return new RegExp(`^${pattern}$`,'i').test(String(value??''));
    }
    const difference=compare(value,operand);
    return match[1]==='>'?difference>0:match[1]==='<'?difference<0:match[1]==='>='?difference>=0:match[1]==='<='?difference<=0:match[1]==='<>'?difference!==0:difference===0;
  };
  const width=(index:number)=>{const exp=expression.args[index];return exp?.type==='range'?(context.rangeWidth?.(exp.startColumnId,exp.endColumnId)??1):1;};

  switch (expression.name) {
    case 'SUM':
      return numeric().reduce(
        (sum, value) => sum + value,
        0,
      );
    case 'AVERAGE':
    case 'AVG': {
      const numbers = numeric();

      return numbers.length
        ? numbers.reduce(
            (sum, value) => sum + value,
            0,
          ) / numbers.length
        : (()=>{throw new Error('#DIV/0!');})();
    }
    case 'MIN': {
      const numbers = numeric();
      return numbers.length
        ? Math.min(...numbers)
        : 0;
    }
    case 'MAX': {
      const numbers = numeric();
      return numbers.length
        ? Math.max(...numbers)
        : 0;
    }
    case 'COUNT':
      return values.filter(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value),
      ).length;
    case 'ROUND': {
      if (
        evaluated.length < 1 ||
        evaluated.length > 2
      ) {
        throw new Error('#ARGS!');
      }

      const value = toNumber(
        scalar(evaluated[0]),
      );
      const digits =
        evaluated[1] === undefined
          ? 0
          : Math.trunc(
              toNumber(
                scalar(evaluated[1]),
              ),
            );
      const factor = Math.pow(10, digits);

      return (
        Math.round(value * factor) /
        factor
      );
    }
    case 'CONCATENATE':
    case 'CONCAT':
      return values
        .map(
          (value) =>
            String(value ?? ''),
        )
        .join('');
    case 'COUNTA': return values.filter(value=>value!==null&&value!=='').length;
    case 'COUNTBLANK': return values.filter(value=>value===null||value==='').length;
    case 'COUNTIF': return arr(0).filter(value=>criterion(value,arg(1))).length;
    case 'SUMIF': case 'AVERAGEIF': {
      const range=arr(0),sum=evaluated[2]===undefined?range:arr(2);
      if(range.length!==sum.length)throw new Error('#VALUE!');
      const numbers=sum.filter((value,index)=>criterion(range[index],arg(1))&&typeof value==='number') as number[];
      if(expression.name==='AVERAGEIF'&&!numbers.length)throw new Error('#DIV/0!');
      return numbers.reduce((a,b)=>a+b,0)/(expression.name==='AVERAGEIF'?numbers.length:1);
    }
    case 'AND': return values.every(value=>Boolean(scalar(value)));
    case 'OR': return values.some(value=>Boolean(scalar(value)));
    case 'NOT': return !arg(0);
    case 'ABS': return Math.abs(num(0));
    case 'INT': return Math.floor(num(0));
    case 'MOD': {const divisor=num(1);if(!divisor)throw new Error('#DIV/0!');return ((num(0)%divisor)+divisor)%divisor;}
    case 'POWER': return Math.pow(num(0),num(1));
    case 'SQRT': {if(num(0)<0)throw new Error('#NUM!');return Math.sqrt(num(0));}
    case 'ROUNDUP': case 'ROUNDDOWN': {const factor=10**num(1),value=num(0);return Math.sign(value)*(expression.name==='ROUNDUP'?Math.ceil(Math.abs(value)*factor):Math.floor(Math.abs(value)*factor))/factor;}
    case 'LEN': return text(0).length;
    case 'LOWER': return text(0).toLowerCase();
    case 'UPPER': return text(0).toUpperCase();
    case 'TRIM': return text(0).trim().replace(/\s+/g,' ');
    case 'LEFT': return text(0).slice(0,evaluated[1]===undefined?1:Math.max(0,num(1)));
    case 'RIGHT': {const n=evaluated[1]===undefined?1:Math.max(0,num(1));return n?text(0).slice(-n):'';}
    case 'MID': {if(num(1)<1||num(2)<0)throw new Error('#VALUE!');return text(0).slice(num(1)-1,num(1)-1+num(2));}
    case 'TEXTJOIN': return flatten(evaluated.slice(2)).filter(value=>!arg(1)||(value!==null&&value!=='')).map(value=>String(value??'')).join(text(0));
    case 'DATE': {const date=new Date(Date.UTC(num(0),num(1)-1,num(2)));return date.toISOString().slice(0,10);}
    case 'YEAR': case 'MONTH': case 'DAY': {const date=new Date(text(0));if(!Number.isFinite(date.getTime()))throw new Error('#VALUE!');return expression.name==='YEAR'?date.getUTCFullYear():expression.name==='MONTH'?date.getUTCMonth()+1:date.getUTCDate();}
    case 'INDEX': {const r=num(1),c=evaluated[2]===undefined?1:num(2);const index=(r-1)*width(0)+c-1;if(!Number.isInteger(r)||!Number.isInteger(c)||r<1||c<1||c>width(0)||index>=arr(0).length)throw new Error('#REF!');return arr(0)[index];}
    case 'MATCH': {const list=arr(1);let index=-1;const mode=evaluated[2]===undefined?1:num(2);for(let i=0;i<list.length;i++){const delta=compare(list[i],arg(0));if(delta===0){index=i;break;}if(mode===1&&delta<0||mode===-1&&delta>0)index=i;}if(index<0)throw new Error('#N/A');return index+1;}
    case 'XLOOKUP': {const index=arr(1).findIndex(value=>compare(value,arg(0))===0);if(index<0){if(evaluated[3]!==undefined)return arg(3);throw new Error('#N/A');}return arr(2)[index]??null;}
    case 'VLOOKUP': case 'HLOOKUP': {
      const table=arr(1),w=width(1),h=table.length/w,vertical=expression.name==='VLOOKUP',target=num(2)-1;
      if(target<0||target>=(vertical?w:h))throw new Error('#REF!');
      const length=vertical?h:w;let found=-1;
      for(let i=0;i<length;i++){const delta=compare(table[vertical?i*w:i],arg(0));if(delta===0){found=i;break;}if((evaluated[3]===undefined||Boolean(arg(3)))&&delta<0)found=i;}
      if(found<0)throw new Error('#N/A');return table[vertical?found*w+target:target*w+found];
    }
    default:
      throw new Error('#NAME?');
  }
}

export function evaluateDatasetFormulas(
  rows: DatasetRow[],
  columns: DatasetColumn[],
  formulas: DatasetFormula[],
) {
  const rowsById = new Map(
    rows.map((row) => [row.id, row]),
  );
  const rowPosition = new Map(
    rows.map((row, index) => [
      row.id,
      index,
    ]),
  );
  const columnPosition = new Map(
    columns.map((column, index) => [
      column.id,
      index,
    ]),
  );
  const formulasByKey = new Map(
    formulas.map((formula) => [
      formulaKey(
        formula.rowId,
        formula.columnId,
      ),
      formula,
    ]),
  );
  const parsed = new Map<string, Expr>();
  const cache = new Map<
    string,
    DatasetCellValue
  >();

  const calculate = (
    rowId: string,
    columnId: string,
    stack: Set<string>,
  ): DatasetCellValue => {
    const key = formulaKey(
      rowId,
      columnId,
    );

    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    const row = rowsById.get(rowId);

    if (!row || !columnPosition.has(columnId)) {
      throw new Error('#REF!');
    }

    const formula = formulasByKey.get(key);

    if (!formula) {
      return row.values[columnId] ?? null;
    }

    if (stack.has(key)) {
      throw new Error('#CYCLE!');
    }

    const nextStack = new Set(stack);
    nextStack.add(key);

    try {
      let tree = parsed.get(key);

      if (!tree) {
        tree = parseCanonical(
          formula.expression,
        );
        parsed.set(key, tree);
      }

      const value = evaluate(
        tree,
        {
          rangeWidth:(a,b)=>Math.abs((columnPosition.get(a)??0)-(columnPosition.get(b)??0))+1,
          resolveColumn: (
            referencedColumnId,
          ) =>
            calculate(
              rowId,
              referencedColumnId,
              nextStack,
            ),
          resolveCell: (
            referencedRowId,
            referencedColumnId,
          ) =>
            calculate(
              referencedRowId,
              referencedColumnId,
              nextStack,
            ),
          resolveRange: (
            startRowId,
            startColumnId,
            endRowId,
            endColumnId,
          ) => {
            const startRow =
              rowPosition.get(startRowId);
            const endRow =
              rowPosition.get(endRowId);
            const startColumn =
              columnPosition.get(
                startColumnId,
              );
            const endColumn =
              columnPosition.get(
                endColumnId,
              );

            if (
              startRow === undefined ||
              endRow === undefined ||
              startColumn === undefined ||
              endColumn === undefined
            ) {
              throw new Error('#REF!');
            }

            const firstRow = Math.min(
              startRow,
              endRow,
            );
            const lastRow = Math.max(
              startRow,
              endRow,
            );
            const firstColumn = Math.min(
              startColumn,
              endColumn,
            );
            const lastColumn = Math.max(
              startColumn,
              endColumn,
            );
            const values: DatasetCellValue[] = [];

            for (
              let rowIndex = firstRow;
              rowIndex <= lastRow;
              rowIndex += 1
            ) {
              for (
                let columnIndex = firstColumn;
                columnIndex <= lastColumn;
                columnIndex += 1
              ) {
                values.push(
                  calculate(
                    rows[rowIndex].id,
                    columns[columnIndex].id,
                    nextStack,
                  ),
                );
              }
            }

            return values;
          },
        },
      );

      const scalarValue = scalar(value);
      if(typeof scalarValue==='number'&&!Number.isFinite(scalarValue))throw new Error('#NUM!');
      cache.set(key, scalarValue);
      return scalarValue;
    } catch (error) {
      const value =
        error instanceof Error &&
        error.message.startsWith('#')
          ? error.message
          : '#ERROR!';

      cache.set(key, value);
      return value;
    }
  };

  const results = new Map<
    string,
    DatasetCellValue
  >();

  for (const formula of formulas) {
    results.set(
      formulaKey(
        formula.rowId,
        formula.columnId,
      ),
      calculate(
        formula.rowId,
        formula.columnId,
        new Set(),
      ),
    );
  }

  return results;
}
