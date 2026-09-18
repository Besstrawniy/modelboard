import type { AuthSession, BoardMeta, WorkspaceRole } from '@modelboard/shared';

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
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

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
      headers: { authorization: `Bearer ${token}` },
    }),

  comments: (boardId: string, token: string) =>
    json<any[]>(`/boards/${boardId}/comments`, {
      headers: { authorization: `Bearer ${token}` },
    }),

  addComment: (boardId: string, token: string, body: string) =>
    json<any>(`/boards/${boardId}/comments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }),
};
