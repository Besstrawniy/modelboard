import type {
  AuthSession,
  BoardMeta,
  CreateDatasetInput,
  DatasetMeta,
  WorkspaceRole,
} from '@modelboard/shared';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

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
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
});

export const api = {
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

  datasets: (workspaceId: string, token: string) =>
    json<DatasetMeta[]>(`/workspaces/${workspaceId}/datasets`, {
      headers: authHeaders(token),
    }),

  dataset: (datasetId: string, token: string) =>
    json<DatasetMeta>(`/datasets/${datasetId}`, {
      headers: authHeaders(token),
    }),

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
