import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileFormula,
  evaluateDatasetFormulas,
  formatFormula,
  formulaKey,
  translateFormulaForCopy,
} from '../apps/web/src/lib/formulas.ts';
import { displayCellValue } from '../apps/web/src/lib/cellFormatting.ts';

const ids = {
  r1: '10000000-0000-0000-0000-000000000001',
  r2: '10000000-0000-0000-0000-000000000002',
  r3: '10000000-0000-0000-0000-000000000003',
  a: '20000000-0000-0000-0000-000000000001',
  b: '20000000-0000-0000-0000-000000000002',
  c: '20000000-0000-0000-0000-000000000003',
};
const columns = [
  { id: ids.a, name: 'price', ordinal: 0, dataType: 'NUMBER' },
  { id: ids.b, name: 'quantity', ordinal: 1, dataType: 'INTEGER' },
  { id: ids.c, name: 'total', ordinal: 2, dataType: 'NUMBER' },
];
const rows = [
  { id: ids.r1, ordinal: 0, values: { [ids.a]: 2, [ids.b]: 3 } },
  { id: ids.r2, ordinal: 1, values: { [ids.a]: 4, [ids.b]: 5 } },
  { id: ids.r3, ordinal: 2, values: { [ids.a]: 6, [ids.b]: 7 } },
];

test('A1 references compile into stable row/column identifiers', () => {
  const formula = compileFormula('=A1*B1', columns, rows);
  assert.equal(formatFormula(formula, columns, rows), '=A1*B1');

  const reordered = [rows[2], rows[0], rows[1]];
  assert.equal(formatFormula(formula, columns, reordered), '=A2*B2');

  const result = evaluateDatasetFormulas(rows, columns, [
    { rowId: ids.r1, columnId: ids.c, expression: formula },
  ]);
  assert.equal(result.get(formulaKey(ids.r1, ids.c)), 6);
});

test('ranges aggregate a rectangular region', () => {
  const expression = compileFormula('=SUM(A1:B2)', columns, rows);
  assert.equal(formatFormula(expression, columns, rows), '=SUM(A1:B2)');

  const result = evaluateDatasetFormulas(rows, columns, [
    { rowId: ids.r3, columnId: ids.c, expression },
  ]);
  assert.equal(result.get(formulaKey(ids.r3, ids.c)), 14);
});

test('autofill shifts relative A1 references', () => {
  const first = compileFormula('=A1*B1', columns, rows);
  const shifted = translateFormulaForCopy(
    first, ids.r1, ids.c, ids.r2, ids.c, rows, columns,
  );

  assert.equal(formatFormula(shifted, columns, rows), '=A2*B2');
  const result = evaluateDatasetFormulas(rows, columns, [
    { rowId: ids.r2, columnId: ids.c, expression: shifted },
  ]);
  assert.equal(result.get(formulaKey(ids.r2, ids.c)), 20);
});

test('invalid A1 addresses and cyclic references produce clear results', () => {
  assert.throws(
    () => compileFormula('=A99', columns, rows),
    /вне Dataset/,
  );
  const cycle = compileFormula('=C1', columns, rows);
  const result = evaluateDatasetFormulas(rows, columns, [
    { rowId: ids.r1, columnId: ids.c, expression: cycle },
  ]);
  assert.equal(result.get(formulaKey(ids.r1, ids.c)), '#CYCLE!');
});

test('number formatting is non-destructive and locale-aware', () => {
  const fmt = (value, opts) =>
    displayCellValue(value, { rowId: ids.r1, columnId: ids.a, ...opts })
      .replace(/[\u00A0\u202F]/g, ' ');

  assert.equal(displayCellValue(0.125), '0.125');
  assert.equal(fmt(1234.5, { numberFormat: 'NUMBER', decimalPlaces: 2 }), '1 234,50');
  assert.equal(fmt(0.125, { numberFormat: 'PERCENT', decimalPlaces: 1 }), '12,5 %');
  assert.match(fmt(10, { numberFormat: 'RUB', decimalPlaces: 0 }), /₽/);
  assert.match(fmt(10, { numberFormat: 'USD', decimalPlaces: 0 }), /\$/);
  assert.equal(fmt('00123', { numberFormat: 'NUMBER', decimalPlaces: 2 }), '00123');
});
