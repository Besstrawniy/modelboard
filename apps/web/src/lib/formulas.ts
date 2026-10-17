import type {
  DatasetCellValue,
  DatasetColumn,
  DatasetFormula,
  DatasetRow,
} from '@modelboard/shared';

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
  | { type: 'call'; name: string; args: Expr[] };

type FormulaValue = DatasetCellValue | DatasetCellValue[];

type EvalContext = {
  resolveColumn: (columnId: string) => DatasetCellValue;
  resolveCell: (
    rowId: string,
    columnId: string,
  ) => DatasetCellValue;
  resolveRange: (
    startRowId: string,
    startColumnId: string,
    endRowId: string,
    endColumnId: string,
  ) => DatasetCellValue[];
};

export class FormulaSyntaxError extends Error {}

const UUID = '[0-9a-f-]{36}';
const RANGE_REFERENCE = new RegExp(
  `#\\{(${UUID})\\}@\\{(${UUID})\\}:#\\{(${UUID})\\}@\\{(${UUID})\\}`,
  'iy',
);
const CELL_REFERENCE = new RegExp(
  `#\\{(${UUID})\\}@\\{(${UUID})\\}`,
  'iy',
);
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
        startRowId: range[1],
        startColumnId: range[2],
        endRowId: range[3],
        endColumnId: range[4],
      });
      index = RANGE_REFERENCE.lastIndex;
      continue;
    }

    CELL_REFERENCE.lastIndex = index;
    const cell = CELL_REFERENCE.exec(source);
    if (cell && cell.index === index) {
      tokens.push({
        type: 'cell',
        rowId: cell[1],
        columnId: cell[2],
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
      .match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({
        type: 'identifier',
        value: identifier[0].toUpperCase(),
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

    if ('+-*/^=<>'.includes(char)) {
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
      this.operator('-')
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

  const a1Resolved = replaceOutsideStrings(
    trimmed,
    (chunk) =>
      chunk.replace(
        /\b([A-Za-z]+)([1-9]\d*)(?::([A-Za-z]+)([1-9]\d*))?\b/g,
        (
          match,
          startColumn: string,
          startRow: string,
          endColumn?: string,
          endRow?: string,
        ) => {
          const start =
            displayCellToCanonical(
              startColumn,
              startRow,
              columns,
              rows,
            );

          if (!endColumn || !endRow) {
            return start;
          }

          const end =
            displayCellToCanonical(
              endColumn,
              endRow,
              columns,
              rows,
            );

          return `${start}:${end}`;
        },
      ),
  );

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

export function formatFormula(
  canonical: string,
  columns: DatasetColumn[],
  rows: DatasetRow[] = [],
) {
  let result = canonical.replace(
    new RegExp(
      `#\\{(${UUID})\\}@\\{(${UUID})\\}:#\\{(${UUID})\\}@\\{(${UUID})\\}`,
      'gi',
    ),
    (
      _,
      startRowId: string,
      startColumnId: string,
      endRowId: string,
      endColumnId: string,
    ) =>
      `${canonicalCellToDisplay(
        startRowId,
        startColumnId,
        columns,
        rows,
      )}:${canonicalCellToDisplay(
        endRowId,
        endColumnId,
        columns,
        rows,
      )}`,
  );

  result = result.replace(
    new RegExp(
      `#\\{(${UUID})\\}@\\{(${UUID})\\}`,
      'gi',
    ),
    (
      _,
      rowId: string,
      columnId: string,
    ) =>
      canonicalCellToDisplay(
        rowId,
        columnId,
        columns,
        rows,
      ),
  );

  const names = new Map(
    columns.map((column) => [
      column.id,
      column.name,
    ]),
  );

  return result.replace(
    new RegExp(
      `@\\{(${UUID})\\}`,
      'gi',
    ),
    (_, columnId: string) =>
      `[${names.get(columnId) ?? '#REF!'}]`,
  );
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

  const referencePattern = new RegExp(
    `#\\{(${UUID})\\}@\\{(${UUID})\\}(?::#\\{(${UUID})\\}@\\{(${UUID})\\})?`,
    'gi',
  );

  return canonical.replace(
    referencePattern,
    (
      match,
      firstRowId: string,
      firstColumnId: string,
      secondRowId?: string,
      secondColumnId?: string,
    ) => {
      const shiftCell = (
        rowId: string,
        columnId: string,
      ) => {
        const rowIndex = rows.findIndex(
          (row) => row.id === rowId,
        );
        const columnIndex = columns.findIndex(
          (column) => column.id === columnId,
        );

        const nextRow =
          rowIndex + rowDelta;
        const nextColumn =
          columnIndex + columnDelta;

        if (
          rowIndex < 0 ||
          columnIndex < 0 ||
          nextRow < 0 ||
          nextRow >= rows.length ||
          nextColumn < 0 ||
          nextColumn >= columns.length
        ) {
          return null;
        }

        return `#{${rows[nextRow].id}}@{${columns[nextColumn].id}}`;
      };

      const first = shiftCell(
        firstRowId,
        firstColumnId,
      );

      if (!first) {
        return match;
      }

      if (!secondRowId || !secondColumnId) {
        return first;
      }

      const second = shiftCell(
        secondRowId,
        secondColumnId,
      );

      return second
        ? `${first}:${second}`
        : match;
    },
  );
}


function scalar(
  value: FormulaValue,
): DatasetCellValue {
  if (Array.isArray(value)) {
    throw new Error('#VALUE!');
  }

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
  const numeric = () =>
    values.map(toNumber);

  switch (expression.name) {
    case 'SUM':
      return numeric().reduce(
        (sum, value) => sum + value,
        0,
      );
    case 'AVG': {
      const numbers = numeric();

      return numbers.length
        ? numbers.reduce(
            (sum, value) => sum + value,
            0,
          ) / numbers.length
        : 0;
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
    case 'CONCAT':
      return values
        .map(
          (value) =>
            String(value ?? ''),
        )
        .join('');
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

    if (!row) {
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
