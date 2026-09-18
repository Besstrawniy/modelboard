import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Logger } from '@hocuspocus/extension-logger';
import jwt from 'jsonwebtoken';
import { query } from '@modelboard/db';
import { canEditBoard, type WorkspaceRole } from '@modelboard/shared';

const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';
const port = Number(process.env.COLLAB_PORT ?? 1234);

function boardIdFromDocumentName(documentName: string) {
  const match = /^board:([0-9a-f-]{36})$/i.exec(documentName);
  return match?.[1] ?? null;
}

const server = new Server({
  name: 'modelboard-collab',
  port,
  debounce: 1000,
  maxDebounce: 5000,

  async onAuthenticate({ token, documentName, connection }) {
    if (!token) throw new Error('Missing auth token');

    const payload = jwt.verify(token, jwtSecret) as {
      sub: string;
      email: string;
      displayName: string;
    };

    const boardId = boardIdFromDocumentName(documentName);
    if (!boardId) throw new Error('Invalid document name');

    const result = await query<{ role: WorkspaceRole }>(
      `SELECT wm.role
       FROM boards b
       JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
       WHERE b.id = $1 AND wm.user_id = $2`,
      [boardId, payload.sub],
    );

    const membership = result.rows[0];
    if (!membership) throw new Error('Board access denied');

    connection.readOnly = !canEditBoard(membership.role);

    return {
      user: {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
      },
      role: membership.role,
      boardId,
    };
  },

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const result = await query<{ state: Buffer }>(
          'SELECT state FROM collab_documents WHERE document_name = $1',
          [documentName],
        );
        return result.rows[0]?.state ?? null;
      },
      store: async ({ documentName, state }) => {
        await query(
          `INSERT INTO collab_documents (document_name, state, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (document_name)
           DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
          [documentName, Buffer.from(state)],
        );
      },
    }),
    new Logger({
      onChange: false,
      onLoadDocument: false,
    }),
  ],
});

server.listen();
console.log(`ModelBoard collaboration server listening on ws://localhost:${port}`);
