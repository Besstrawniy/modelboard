import type { DatasetCellFormat, DatasetCellValue } from '@modelboard/shared';

/**
 * Formatting only changes presentation. The stored value remains a number,
 * including for percentages (0.25 => 25%) and currencies.
 */
export function displayCellValue(
  value: DatasetCellValue | undefined,
  format?: DatasetCellFormat,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return String(value);
  }

  const mode = format?.numberFormat ?? 'GENERAL';
  if (mode === 'GENERAL') return String(value);

  const decimals = Math.max(
    0,
    Math.min(6, format?.decimalPlaces ?? 2),
  );

  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };

  if (mode === 'PERCENT') {
    options.style = 'percent';
  } else if (mode === 'RUB' || mode === 'USD' || mode === 'EUR') {
    options.style = 'currency';
    options.currency = mode;
  }

  return new Intl.NumberFormat('ru-RU', options).format(value);
}
