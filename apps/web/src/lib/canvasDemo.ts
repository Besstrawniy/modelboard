import { createId } from './uuid.ts';
import type { Node, Edge } from '@xyflow/react';

/** A small standalone board: no Dataset, imported files or API bindings. */
export function createCanvasDemo() {
  const prefix = createId();
  const nodes: Node[] = [
    {id:`${prefix}-public`,type:'frame',position:{x:0,y:0},style:{width:800,height:280},zIndex:-10,data:{title:'DMZ · входящий трафик'}},
    {id:`${prefix}-private`,type:'frame',position:{x:0,y:330},style:{width:800,height:520},zIndex:-10,data:{title:'Production · сервисы и данные'}},
  ];
  const items = [
    ['ROUTER','Gateway',80,90,'public'],['FIREWALL','Firewall',460,90,'public'],
    ['SWITCH','Service network',80,420,'private'],['SERVER','API server',460,420,'private'],
    ['DATABASE','PostgreSQL',80,650,'private'],['VM','Worker',460,650,'private'],
  ] as const;
  items.forEach(([kind,label,x,y,parent],index)=>nodes.push({id:`${prefix}-${index}`,type:'device',position:{x,y},style:{width:220,height:130},data:{deviceKind:kind,label,containerId:`${prefix}-${parent}`}}));
  const edges: Edge[] = [[0,1],[1,2],[2,3],[3,4],[3,5]].map(([source,target],index)=>({id:`${prefix}-edge-${index}`,source:`${prefix}-${source}`,target:`${prefix}-${target}`,type:'smoothstep',markerEnd:{type:'arrowclosed' as any}}));
  nodes.push({id:`${prefix}-note`,type:'sticky',position:{x:870,y:90},style:{width:260,height:180},data:{text:'Двойной клик — изменить подпись.\nПеремещайте Frame за заголовок.\nCtrl+G — группа, Ctrl+Z — отмена.'}});
  return { nodes,edges };
}
