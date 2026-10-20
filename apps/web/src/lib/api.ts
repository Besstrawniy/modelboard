import { API_URL } from './config';
import type {
  AuthSession,
  BoardDatasetLocation,
  BoardMeta,
  ConvertDatasetColumnInput,
  ConvertDatasetColumnResult,
  CreateDatasetInput,
  CreateDatasetRelationInput,
  CreateWorkspaceObjectTemplateInput,
  DatasetColumn,
  DatasetMeta,
  DatasetRelation,
  DatasetRow,
  ObjectBindingRecord,
  UpsertObjectBindingInput,
  WorkspaceObjectTemplate,
  WorkspaceRole,
  WorkspaceSearchResult,
} from '@modelboard/shared';

const baseUrl = API_URL;

export type DevUser = {
  id: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
};

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${url}`, options);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let message='';
    try{const parsed=JSON.parse(detail);message=Array.isArray(parsed.message)?parsed.message.join('; '):typeof parsed.message==='string'?parsed.message:'';}catch{/* Non-JSON response, e.g. an unavailable proxy. */}
    if(!message||message==='Internal server error')message='Не удалось выполнить операцию на сервере.';
    if(message==='Forbidden resource')message='Недостаточно прав для этой операции.';
    throw new Error(message);
  }
  return response.json();
}

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
});

export type StoredFile = {id:string;name:string;mime:string;size:number;createdAt?:string};
export const api = {
  files:(workspaceId:string,token:string)=>json<StoredFile[]>(`/workspaces/${workspaceId}/files`,{headers:authHeaders(token)}),
  fileBlob:async(id:string,token:string)=>{const response=await fetch(`${baseUrl}/files/${id}/content`,{headers:authHeaders(token)});if(!response.ok)throw new Error('Файл недоступен');return response.blob();},
  importFiles:(workspaceId:string,token:string,body:{datasets:import('@modelboard/shared').DatasetSnapshot[];files:import('@modelboard/shared').FileAssetInput[]})=>json<{datasets:Array<{id:string;name:string}>;files:StoredFile[]}>(`/workspaces/${workspaceId}/files/import`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify(body)}),
  exportBoard:(id:string,token:string,state:unknown)=>json<import('@modelboard/shared').BoardArchive>(`/boards/${id}/export`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify(state)}),
  importBoard:(workspaceId:string,token:string,archive:import('@modelboard/shared').BoardArchive)=>json<{id:string;name:string}>(`/workspaces/${workspaceId}/boards/import`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify(archive)}),
  appendRecordLinks:(workspaceId:string,id:string,token:string,links:Array<{sourceRowId:string;targetRowId:string}>)=>json<DatasetRelation>(`/workspaces/${workspaceId}/relations/${id}/links`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify({links})}),
  changeRecordLink:(workspaceId:string,id:string,token:string,body:{sourceRowId:string;targetRowId:string;remove?:boolean})=>json<DatasetRelation>(`/workspaces/${workspaceId}/relations/${id}/links`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify(body)}),
  renameDataset:(id:string,token:string,name:string)=>json<{id:string;name:string}>(`/datasets/${id}`,{method:'PUT',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify({name})}),
  datasetColumns:(id:string,token:string)=>json<DatasetColumn[]>(`/datasets/${id}/columns`,{headers:authHeaders(token)}),
  datasetDeletionPreview:(id:string,token:string)=>json<{name:string;rows:number;bindings:number;relations:number;views:number}>(`/datasets/${id}/deletion-preview`,{headers:authHeaders(token)}),
  deleteDataset:(id:string,token:string)=>json<{ok:true}>(`/datasets/${id}`,{method:'DELETE',headers:authHeaders(token)}),
  updateRelation:(workspaceId:string,id:string,token:string,body:CreateDatasetRelationInput)=>json<DatasetRelation>(`/workspaces/${workspaceId}/relations/${id}`,{method:'PUT',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify(body)}),
  deleteRelation:(workspaceId:string,id:string,token:string)=>json<{ok:true}>(`/workspaces/${workspaceId}/relations/${id}`,{method:'DELETE',headers:authHeaders(token)}),
  validateRelation:(workspaceId:string,id:string,token:string)=>json<{valid:boolean;issues:string[];matchedRows:number;orphanCount:number;sourceDuplicates:number;targetDuplicates:number}>(`/workspaces/${workspaceId}/relations/${id}/validation`,{headers:authHeaders(token)}),
  createDatasetRows:(datasetId:string,token:string,rows:Array<{id:string;values?:DatasetRow['values']}>)=>json<DatasetRow[]>(`/datasets/${datasetId}/rows/batch`,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json'},body:JSON.stringify({rows})}),
  devUsers: () => json<DevUser[]>('/auth/dev-users'),

  devLogin: (userId: string) =>
    json<AuthSession>('/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),

  board: (boardId: string, token: string) =>
    json<BoardMeta>(`/boards/${boardId}`, {
      headers: authHeaders(token),
    }),

  renameBoard: (
    boardId: string,
    token: string,
    name: string,
  ) =>
    json<BoardMeta>(`/boards/${boardId}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name }),
    }),

  deleteBoard: (boardId: string, token: string) =>
    json<{ ok: true }>(`/boards/${boardId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    }),

  boards: (workspaceId: string, token: string) =>
    json<BoardMeta[]>(`/workspaces/${workspaceId}/boards`, {
      headers: authHeaders(token),
    }),

  createBoard: (
    workspaceId: string,
    token: string,
    name: string,
  ) =>
    json<BoardMeta>(`/workspaces/${workspaceId}/boards`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name }),
    }),

  datasets: (workspaceId: string, token: string) =>
    json<DatasetMeta[]>(`/workspaces/${workspaceId}/datasets`, {
      headers: authHeaders(token),
    }),

  dataset: (datasetId: string, token: string) =>
    json<DatasetMeta>(`/datasets/${datasetId}`, {
      headers: authHeaders(token),
    }),

  datasetLocations: (
    workspaceId: string,
    datasetId: string,
    token: string,
  ) =>
    json<BoardDatasetLocation[]>(
      `/workspaces/${workspaceId}/datasets/${datasetId}/locations`,
      { headers: authHeaders(token) },
    ),

  createDataset: (
    workspaceId: string,
    token: string,
    input: CreateDatasetInput,
  ) =>
    json<DatasetMeta>(`/workspaces/${workspaceId}/datasets`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),

  createDatasetColumn: (
    datasetId: string,
    token: string,
    input: Pick<DatasetColumn, 'name' | 'dataType'> & {
      afterColumnId?: string;
    },
  ) =>
    json<DatasetColumn>(`/datasets/${datasetId}/columns`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),

  renameDatasetColumn: (
    datasetId: string,
    columnId: string,
    token: string,
    name: string,
  ) =>
    json<DatasetColumn>(
      `/datasets/${datasetId}/columns/${columnId}`,
      {
        method: 'PUT',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name }),
      },
    ),

  convertDatasetColumn: (
    datasetId: string,
    columnId: string,
    token: string,
    input: ConvertDatasetColumnInput,
  ) =>
    json<ConvertDatasetColumnResult>(
      `/datasets/${datasetId}/columns/${columnId}/type`,
      {
        method: 'PUT',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    ),

  deleteDatasetColumn: (
    datasetId: string,
    columnId: string,
    token: string,
  ) =>
    json<{ ok: true }>(
      `/datasets/${datasetId}/columns/${columnId}`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    ),

  createDatasetRow: (
    datasetId: string,
    token: string,
    values: DatasetRow['values'] = {},
    afterRowId?: string,
  ) =>
    json<DatasetRow>(`/datasets/${datasetId}/rows`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        values,
        ...(afterRowId ? { afterRowId } : {}),
      }),
    }),

  deleteDatasetRow: (
    datasetId: string,
    rowId: string,
    token: string,
  ) =>
    json<{ ok: true }>(
      `/datasets/${datasetId}/rows/${rowId}`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    ),

  searchWorkspace: (
    workspaceId: string,
    token: string,
    queryText: string,
  ) =>
    json<WorkspaceSearchResult[]>(
      `/workspaces/${workspaceId}/search?q=${encodeURIComponent(queryText)}`,
      { headers: authHeaders(token) },
    ),

  templates: (workspaceId: string, token: string) =>
    json<WorkspaceObjectTemplate[]>(`/workspaces/${workspaceId}/templates`, {
      headers: authHeaders(token),
    }),

  createTemplate: (
    workspaceId: string,
    token: string,
    input: CreateWorkspaceObjectTemplateInput,
  ) =>
    json<WorkspaceObjectTemplate>(`/workspaces/${workspaceId}/templates`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),

  deleteTemplate: (
    workspaceId: string,
    templateId: string,
    token: string,
  ) =>
    json<{ ok: true }>(
      `/workspaces/${workspaceId}/templates/${templateId}`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    ),

  relations: (workspaceId: string, token: string) =>
    json<DatasetRelation[]>(`/workspaces/${workspaceId}/relations`, {
      headers: authHeaders(token),
    }),

  createRelation: (
    workspaceId: string,
    token: string,
    input: CreateDatasetRelationInput,
  ) =>
    json<DatasetRelation>(`/workspaces/${workspaceId}/relations`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),

  objectBinding: (boardId: string, objectId: string, token: string) =>
    json<ObjectBindingRecord | null>(
      `/boards/${boardId}/objects/${encodeURIComponent(objectId)}/binding`,
      { headers: authHeaders(token) },
    ),

  upsertObjectBinding: (
    boardId: string,
    objectId: string,
    token: string,
    input: UpsertObjectBindingInput,
  ) =>
    json<ObjectBindingRecord>(
      `/boards/${boardId}/objects/${encodeURIComponent(objectId)}/binding`,
      {
        method: 'PUT',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    ),

  deleteObjectBinding: (
    boardId: string,
    objectId: string,
    token: string,
  ) =>
    json<{ ok: true }>(
      `/boards/${boardId}/objects/${encodeURIComponent(objectId)}/binding`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
      },
    ),

  comments: (boardId: string, token: string) =>
    json<any[]>(`/boards/${boardId}/comments`, {
      headers: authHeaders(token),
    }),

  addComment: (boardId: string, token: string, body: string) =>
    json<any>(`/boards/${boardId}/comments`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }),
};
