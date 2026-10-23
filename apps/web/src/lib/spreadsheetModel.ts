import type { DatasetCellFormat, DatasetCellValue, DatasetColumn, DatasetConditionalRule, DatasetRow } from '@modelboard/shared';

/** Infer a numeric progression once per row/column; otherwise repeat the seed. */
export function createSheetAutofill(series: Array<DatasetCellValue | undefined>, allowSeries = true) {
  const repeat = (index: number): DatasetCellValue => series[index % series.length] ?? null;
  if (!allowSeries || series.length < 2) return repeat;
  const numbers = series.map(value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim())) return NaN;
    return Number(value.trim().replace(',', '.'));
  });
  if (!numbers.every(Number.isFinite)) return repeat;
  if (numbers.some(value => Number.isInteger(value) && !Number.isSafeInteger(value))) return repeat;
  const step = numbers[1] - numbers[0];
  if (!Number.isFinite(step)) return repeat;
  if (!numbers.slice(2).every((value, index) => Math.abs(value - numbers[index + 1] - step) <= Math.max(1, Math.abs(step)) * 1e-9)) return repeat;
  const textSeries = series.every(value => typeof value === 'string');
  const strings = series.map(value => String(value).trim());
  const precision = Math.max(...strings.map(value => {
    const [mantissa, exponent = '0'] = value.toLowerCase().replace(',', '.').split('e');
    return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
  }));
  const places = Math.min(100, precision);
  const padded = textSeries && strings.every(value => /^[+-]?\d+$/.test(value)) && strings.some(value => /^[+-]?0\d/.test(value));
  const width = padded ? Math.max(...strings.map(value => value.replace(/^[+-]/, '').length)) : 0;
  const comma = textSeries && strings.some(value => value.includes(',')) && strings.every(value => !value.includes('.'));
  const plus = textSeries && strings.every(value => value.startsWith('+'));
  return (index: number): DatasetCellValue => {
    if (index < series.length) return series[index] ?? null;
    const raw = numbers[numbers.length - 1] + step * (index - series.length + 1);
    if (!Number.isFinite(raw)) throw new Error('Значение последовательности выходит за допустимый диапазон');
    const value = precision > 100 ? Number(raw.toPrecision(15)) : Number(raw.toFixed(places));
    if (!textSeries) return value;
    let text = Math.abs(value).toFixed(places);
    if (padded) text = text.padStart(width, '0');
    if (comma) text = text.replace('.', ',');
    return `${value < 0 ? '-' : plus ? '+' : ''}${text}`;
  };
}

export function parseSheetInput(value:string,column:DatasetColumn):DatasetCellValue {
  if(value==='')return null;
  if(column.dataType==='TEXT')return value;
  if(column.dataType==='INTEGER'){const parsed=Number(value.trim());if(/^[+-]?\d+$/.test(value.trim())&&Number.isSafeInteger(parsed))return parsed;throw new Error('Ожидается целое безопасное число');}
  if(column.dataType==='NUMBER'){const parsed=Number(value.trim().replace(',','.'));if(value.trim()&&Number.isFinite(parsed))return parsed;throw new Error('Ожидается число');}
  if(column.dataType==='BOOLEAN'){if(/^(true|1)$/i.test(value))return true;if(/^(false|0)$/i.test(value))return false;throw new Error('Ожидается true или false');}
  if(column.dataType==='DATE'){const date=new Date(value);if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value)return value;throw new Error('Ожидается дата YYYY-MM-DD');}
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))return value.toLowerCase();
  throw new Error('Ожидается UUID');
}

/** Quoted TSV preserves tabs, embedded newlines and doubled quotes from spreadsheets. */
export function parseSheetTsv(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'&&(quoted||cell==='')){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(char==='\t'||char==='\n'||char==='\r')){
      row.push(cell);cell='';if(char!=='\t'){rows.push(row);row=[];if(char==='\r'&&text[i+1]==='\n')i++;}
    }else cell+=char;
  }
  if(quoted)throw new Error('Незакрытая кавычка в clipboard');
  if(cell!==''||row.length||!rows.length){row.push(cell);rows.push(row);}
  return rows;
}
export function sheetTsv(rows:DatasetCellValue[][]){return rows.map(row=>row.map(value=>{const s=String(value??'');return /[\t\r\n"]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}).join('\t')).join('\n');}

export function matchesSheetFilter(value:DatasetCellValue|undefined,filter:string){
  const text=String(value??'');const match=filter.trim().match(/^(>=|<=|!=|<>|>|<|=)(.*)$/);
  if(!match)return text.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const right=match[2].trim();const a=Number(text),b=Number(right);
  const difference=text.trim()!==''&&right!==''&&Number.isFinite(a)&&Number.isFinite(b)?a-b:text.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
  return match[1]==='>'?difference>0:match[1]==='<'?difference<0:match[1]==='>='?difference>=0:match[1]==='<='?difference<=0:match[1]==='='?difference===0:difference!==0;
}
export function sheetConditionalFormat(row:DatasetRow,columnId:string,rules:DatasetConditionalRule[],rows:DatasetRow[]):Partial<DatasetCellFormat>{
  const value=row.values[columnId];let format:Partial<DatasetCellFormat>={};
  for(const rule of rules){
    if(rule.columnId!==columnId)continue;
    const match=rule.operator==='empty'?value===null||value===undefined||value==='':rule.operator==='duplicate'?rows.filter(item=>item.values[columnId]===value).length>1:rule.operator==='contains'?String(value??'').toLowerCase().includes(rule.value.toLowerCase()):rule.operator==='between'?Number(value)>=Number(rule.value)&&Number(value)<=Number(rule.value2):matchesSheetFilter(value,`${rule.operator==='gt'?'>':rule.operator==='lt'?'<':'='}${rule.value}`);
    if(match)format={...format,background:rule.background,...(rule.color?{color:rule.color}:{})};
  }
  return format;
}
export function sheetSelectionSummary(values:DatasetCellValue[]){const numbers=values.filter(value=>typeof value==='number'&&Number.isFinite(value)) as number[];return {count:values.filter(value=>value!==null&&value!=='').length,numbers:numbers.length,sum:numbers.reduce((a,b)=>a+b,0),average:numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:null};}
