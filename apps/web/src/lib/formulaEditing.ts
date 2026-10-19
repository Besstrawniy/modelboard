export const FORMULA_HELP = [
 ['SUM','SUM(A1:A10)','Сумма диапазона'],['AVERAGE','AVERAGE(A1:A10)','Среднее значение'],['MIN','MIN(A1:A10)','Минимум'],['MAX','MAX(A1:A10)','Максимум'],['COUNT','COUNT(A1:A10)','Количество чисел'],['COUNTA','COUNTA(A1:A10)','Заполненные ячейки'],['IF','IF(A1>0, "Да", "Нет")','Условие'],['IFERROR','IFERROR(A1/B1, 0)','Значение при ошибке'],['ROUND','ROUND(A1, 2)','Округление'],['COUNTIF','COUNTIF(A1:A10, ">0")','Количество по условию'],['SUMIF','SUMIF(A1:A10, ">0", B1:B10)','Сумма по условию'],['CONCAT','CONCAT(A1, " ", B1)','Объединение текста'],['XLOOKUP','XLOOKUP(A1, B1:B10, C1:C10)','Поиск значения'],
] as const;
export function formulaSuggestions(text: string) {
 if(!text.startsWith('='))return [];
 const prefix=text.match(/(?:^=|[+\-*/(,;]\s*)([A-Z]+)$/i)?.[1]?.toUpperCase();
 return prefix ? FORMULA_HELP.filter(([name])=>name.startsWith(prefix)).slice(0,5) : [];
}
export type FormulaReference={startRow:number;endRow:number;startColumn:number;endColumn:number;color:string};
export function formulaReferences(text:string,rowCount:number,columnCount:number):FormulaReference[]{
 if(!text.startsWith('='))return [];
 const colors=['#6366f1','#16a085','#e67e22','#d946ef'];
 const column=(s:string)=>[...s.toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1;
 const references:FormulaReference[]=[];
 const tokens=/"(?:[^"]|"")*"|\[[^\]]*\]|(?:\$?([A-Z]+)\$?(\d+))(?:\s*:\s*\$?([A-Z]+)\$?(\d+))?/gi;
 for(const match of text.matchAll(tokens)){
  if(!match[1])continue;
  const before=text[(match.index??0)-1],after=text[(match.index??0)+match[0].length];
  if(before&&/[\w.]/.test(before)||after&&/[\w.(]/.test(after))continue;
  const c1=column(match[1]),r1=Number(match[2])-1,c2=column(match[3]??match[1]),r2=Number(match[4]??match[2])-1;
  if(Math.min(r1,r2)<0||Math.max(r1,r2)>=rowCount||Math.max(c1,c2)>=columnCount)continue;
  references.push({startRow:Math.min(r1,r2),endRow:Math.max(r1,r2),startColumn:Math.min(c1,c2),endColumn:Math.max(c1,c2),color:colors[references.length%colors.length]});
 }
 return references;
}
export function formulaReferenceStyle(refs:FormulaReference[],row:number,column:number){
 const ref=refs.find(r=>row>=r.startRow&&row<=r.endRow&&column>=r.startColumn&&column<=r.endColumn);
 if(!ref)return {};
 const borders=[];
 if(row===ref.startRow)borders.push(`inset 0 2px ${ref.color}`);
 if(row===ref.endRow)borders.push(`inset 0 -2px ${ref.color}`);
 if(column===ref.startColumn)borders.push(`inset 2px 0 ${ref.color}`);
 if(column===ref.endColumn)borders.push(`inset -2px 0 ${ref.color}`);
 return {boxShadow:borders.join(', '),backgroundColor:`${ref.color}12`};
}
