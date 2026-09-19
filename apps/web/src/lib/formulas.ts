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
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'punctuation'; value: '(' | ')' | ',' | ';' }
  | { type: 'eof' };

type Expr =
  | { type: 'literal'; value: DatasetCellValue }
  | { type: 'ref'; columnId: string }
  | { type: 'unary'; operator: '+' | '-'; value: Expr }
  | { type: 'binary'; operator: string; left: Expr; right: Expr }
  | { type: 'call'; name: string; args: Expr[] };

export class FormulaSyntaxError extends Error {}

const REFERENCE = /@\{([0-9a-f-]{36})\}/iy;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = source.startsWith('=') ? 1 : 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
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
        throw new FormulaSyntaxError('Незакрытая строка в формуле.');
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
      tokens.push({ type: 'operator', value: char });
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
      throw new FormulaSyntaxError('Лишний текст после формулы.');
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
      left = { type: 'binary', operator, left, right };
    }

    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();

    while (this.operator('+') || this.operator('-')) {
      const operator = (this.take() as any).value as '+' | '-';
      const right = this.multiplicative();
      left = { type: 'binary', operator, left, right };
    }

    return left;
  }

  private multiplicative(): Expr {
    let left = this.power();

    while (this.operator('*') || this.operator('/')) {
      const operator = (this.take() as any).value as '*' | '/';
      const right = this.power();
      left = { type: 'binary', operator, left, right };
    }

    return left;
  }

  private power(): Expr {
    let left = this.unary();

    if (this.operator('^')) {
      this.take();
      const right = this.power();
      left = { type: 'binary', operator: '^', left, right };
    }

    return left;
  }

  private unary(): Expr {
    if (this.operator('+') || this.operator('-')) {
      const operator = (this.take() as any).value as '+' | '-';
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

    if (token.type === 'number' || token.type === 'string') {
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'ref') {
      return { type: 'ref', columnId: token.value };
    }

    if (token.type === 'identifier') {
      if (token.value === 'TRUE') {
        return { type: 'literal', value: true };
      }
      if (token.value === 'FALSE') {
        return { type: 'literal', value: false };
      }
      if (token.value === 'NULL') {
        return { type: 'literal', value: null };
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

          if (this.punctuation(',') || this.punctuation(';')) {
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
        throw new FormulaSyntaxError('Ожидалась закрывающая скобка.');
      }
      this.take();
      return expression;
    }

    throw new FormulaSyntaxError('Ожидалось значение или ссылка на колонку.');
  }
}

function parseCanonical(expression: string) {
  return new Parser(tokenize(expression)).parse();
}

export function formulaKey(rowId: string, columnId: string) {
  return `${rowId}:${columnId}`;
}

export function compileFormula(
  displayExpression: string,
  columns: DatasetColumn[],
) {
  const trimmed = displayExpression.trim();
  if (!trimmed.startsWith('=')) {
    throw new FormulaSyntaxError('Формула должна начинаться со знака =.');
  }

  const byName = new Map(
    columns.map((column) => [
      column.name.trim().toLowerCase(),
      column.id,
    ]),
  );

  const canonical = trimmed.replace(
    /\[([^\]]+)\]/g,
    (_, rawName: string) => {
      const name = rawName.trim();
      const columnId = byName.get(name.toLowerCase());
      if (!columnId) {
        throw new FormulaSyntaxError(
          `Колонка [${name}] не найдена.`,
        );
      }
      return `@{${columnId}}`;
    },
  );

  parseCanonical(canonical);
  return canonical;
}

export function formatFormula(
  canonical: string,
  columns: DatasetColumn[],
) {
  const names = new Map(
    columns.map((column) => [column.id, column.name]),
  );

  return canonical.replace(
    /@\{([0-9a-f-]{36})\}/gi,
    (_, columnId: string) =>
      `[${names.get(columnId) ?? '#REF!'}]`,
  );
}

function toNumber(value: DatasetCellValue) {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;

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
    { numeric: true, sensitivity: 'base' },
  );
}

function evaluate(
  expression: Expr,
  resolveColumn: (columnId: string) => DatasetCellValue,
): DatasetCellValue {
  if (expression.type === 'literal') {
    return expression.value;
  }

  if (expression.type === 'ref') {
    return resolveColumn(expression.columnId);
  }

  if (expression.type === 'unary') {
    const number = toNumber(
      evaluate(expression.value, resolveColumn),
    );
    return expression.operator === '-' ? -number : number;
  }

  if (expression.type === 'binary') {
    const left = evaluate(expression.left, resolveColumn);
    const right = evaluate(expression.right, resolveColumn);

    switch (expression.operator) {
      case '+':
        return toNumber(left) + toNumber(right);
      case '-':
        return toNumber(left) - toNumber(right);
      case '*':
        return toNumber(left) * toNumber(right);
      case '/': {
        const divisor = toNumber(right);
        if (divisor === 0) throw new Error('#DIV/0!');
        return toNumber(left) / divisor;
      }
      case '^':
        return Math.pow(toNumber(left), toNumber(right));
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
    if (expression.args.length < 2 || expression.args.length > 3) {
      throw new Error('#ARGS!');
    }

    const condition = evaluate(
      expression.args[0],
      resolveColumn,
    );

    return condition
      ? evaluate(expression.args[1], resolveColumn)
      : expression.args[2]
        ? evaluate(expression.args[2], resolveColumn)
        : null;
  }

  const values = expression.args.map((argument) =>
    evaluate(argument, resolveColumn),
  );

  const numeric = () => values.map(toNumber);

  switch (expression.name) {
    case 'SUM':
      return numeric().reduce((sum, value) => sum + value, 0);
    case 'AVG': {
      const numbers = numeric();
      return numbers.length
        ? numbers.reduce((sum, value) => sum + value, 0) /
            numbers.length
        : 0;
    }
    case 'MIN':
      return Math.min(...numeric());
    case 'MAX':
      return Math.max(...numeric());
    case 'ROUND': {
      if (values.length < 1 || values.length > 2) {
        throw new Error('#ARGS!');
      }
      const value = toNumber(values[0]);
      const digits = values[1] === undefined
        ? 0
        : Math.trunc(toNumber(values[1]));
      const factor = Math.pow(10, digits);
      return Math.round(value * factor) / factor;
    }
    case 'CONCAT':
      return values.map((value) => String(value ?? '')).join('');
    default:
      throw new Error('#NAME?');
  }
}

export function evaluateDatasetFormulas(
  rows: DatasetRow[],
  formulas: DatasetFormula[],
) {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const formulasByKey = new Map(
    formulas.map((formula) => [
      formulaKey(formula.rowId, formula.columnId),
      formula,
    ]),
  );
  const parsed = new Map<string, Expr>();
  const cache = new Map<string, DatasetCellValue>();

  const calculate = (
    rowId: string,
    columnId: string,
    stack: Set<string>,
  ): DatasetCellValue => {
    const key = formulaKey(rowId, columnId);

    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    const formula = formulasByKey.get(key);
    if (!formula) {
      return rowsById.get(rowId)?.values[columnId] ?? null;
    }

    if (stack.has(key)) {
      throw new Error('#CYCLE!');
    }

    const nextStack = new Set(stack);
    nextStack.add(key);

    try {
      let tree = parsed.get(key);
      if (!tree) {
        tree = parseCanonical(formula.expression);
        parsed.set(key, tree);
      }

      const value = evaluate(
        tree,
        (referencedColumnId) =>
          calculate(rowId, referencedColumnId, nextStack),
      );

      cache.set(key, value);
      return value;
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

  const results = new Map<string, DatasetCellValue>();

  for (const formula of formulas) {
    results.set(
      formulaKey(formula.rowId, formula.columnId),
      calculate(formula.rowId, formula.columnId, new Set()),
    );
  }

  return results;
}
