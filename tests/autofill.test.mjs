import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetAutofill } from '../apps/web/src/lib/spreadsheetModel.ts';
import { edgeWithDefaults } from '../apps/web/src/lib/canvasEdges.ts';

for (const [seed, expected] of [
  [[1,2,3], [4,5,6]],
  [['1','2','3'], ['4','5','6']],
  [[2,4,6], [8,10,12]],
  [[3,2,1], [0,-1,-2]],
  [[0.1,0.2,0.3], [0.4,0.5,0.6]],
  [['1,25','1,50','1,75'], ['2,00','2,25','2,50']],
  [['001','002','003'], ['004','005','006']],
  [['+01','+02'], ['+03','+04','+05']],
  [[1e-20,2e-20], [3e-20,4e-20,5e-20]],
  [[5,5], [5,5,5]],
]) test(`autofill continues ${JSON.stringify(seed)}`, () => {
  const fill = createSheetAutofill(seed);
  assert.deepEqual(expected.map((_, index) => fill(seed.length + index)), expected);
  assert.deepEqual(seed.map((_, index) => fill(index)), seed);
});

test('single cells, irregular seeds, blanks, text and formulas repeat rather than inventing a trend', () => {
  for (const seed of [[1], ['hello','world'], [1,2,4], [1,null,3], [true,false], ['9007199254740992','9007199254740993']]) {
    const fill = createSheetAutofill(seed);
    for (let index=seed.length;index<seed.length*3;index++) assert.equal(fill(index),seed[index%seed.length]);
  }
  const formulaSeed = createSheetAutofill([1,2,3],false);
  assert.equal(formulaSeed(3),1);
  assert.equal(createSheetAutofill([])(0),null);
});

test('connector defaults match the panel and retain explicit styles on existing edges', () => {
  const edge={id:'old',source:'a',target:'b',style:{strokeDasharray:'6 4'}};
  const normalized=edgeWithDefaults(edge);
  assert.equal(normalized.style.strokeWidth,2);
  assert.equal(normalized.style.strokeDasharray,'6 4');
  assert.deepEqual(edge.style,{strokeDasharray:'6 4'});
  assert.equal(edgeWithDefaults({...edge,style:{strokeWidth:1,stroke:'#f00'}}).style.strokeWidth,1);
  assert.equal(edgeWithDefaults({...edge,style:{strokeWidth:1,stroke:'#f00'}}).style.stroke,'#f00');
});
