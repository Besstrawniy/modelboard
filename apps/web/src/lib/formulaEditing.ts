import { FORMULA_FUNCTIONS } from './formulas.ts';
export const FORMULA_HELP = FORMULA_FUNCTIONS.map(([name,,description,example])=>[name,example,description] as const);
export function formulaSuggestions(text: string): Array<readonly [string,string,string]> {
 if(!text.trimStart().startsWith('='))return [];
 const prefix=text.match(/(?:^=\s*|[+\-*/(,;]\s*)([A-ZА-ЯЁ]+)$/i)?.[1]?.toUpperCase();
 if(!prefix)return [];
 const russian=/[А-ЯЁ]/.test(prefix),seen=new Set<string>();
 return FORMULA_FUNCTIONS.flatMap(([name,ru,description,example])=>{
   const label=russian?ru:name;
   if(!label.startsWith(prefix)||seen.has(label))return [];
   seen.add(label);
   return [[label,russian?example.replace(name,ru).replace(/"(?:[^"]|"")*"|,/g,token=>token===','?';':token):example,description] as const];
 }).slice(0,5);
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
