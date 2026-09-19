import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Logger } from '@hocuspocus/extension-logger';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import { pool, query } from '@modelboard/db';
import { canEditBoard, type WorkspaceRole } from '@modelboard/shared';

const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';
const port = Number(process.env.COLLAB_PORT ?? 1234);

type DocumentRef =
  | { kind: 'board'; id: string }
  | { kind: 'dataset'; id: string };

function parseDocumentName(documentName: string): DocumentRef | null {
  const match = /^(board|dataset):([0-9a-f-]{36})$/i.exec(documentName);
  if (!match) return null;

  return {
    kind: match[1].toLowerCase() as 'board' | 'dataset',
    id: match[2],
  };
}

async function projectDatasetStateToPostgres(
  datasetId: string,
  state: Uint8Array,
) {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, state);

    const columns = Array.from(
      doc.getMap<any>('columns').values(),
    ).map((column: any) => ({
      id: String(column.id),
      name: String(column.name),
      dataType: String(column.dataType),
      ordinal: Number(column.ordinal ?? 0),
      properties: column.key
        ? { key: String(column.key) }
        : {},
    }));

    const rows = Array.from(
      doc.getMap<any>('rows').values(),
    ).map((row: any) => ({
      id: String(row.id),
      ordinal: Number(row.ordinal ?? 0),
      values:
        row.values && typeof row.values === 'object'
          ? row.values
          : {},
    }));

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      if (columns.length > 0) {
        await client.query(
          `UPDATE dataset_columns AS target
           SET
             name = source.name,
             data_type = source.data_type,
             ordinal = source.ordinal,
             properties = source.properties
           FROM jsonb_to_recordset($2::jsonb) AS source(
             id uuid,
             name text,
             data_type text,
             ordinal integer,
             properties jsonb
           )
           WHERE target.dataset_id = $1
             AND target.id = source.id`,
          [
            datasetId,
            JSON.stringify(
              columns.map((column) => ({
                id: column.id,
                name: column.name,
                data_type: column.dataType,
                ordinal: column.ordinal,
                properties: column.properties,
              })),
            ),
          ],
        );
      }

      if (rows.length > 0) {
        await client.query(
          `UPDATE dataset_rows AS target
           SET
             ordinal = source.ordinal,
             values = source.values
           FROM jsonb_to_recordset($2::jsonb) AS source(
             id uuid,
             ordinal integer,
             values jsonb
           )
           WHERE target.dataset_id = $1
             AND target.id = source.id`,
          [datasetId, JSON.stringify(rows)],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    doc.destroy();
  }
}

async function bootstrapDataset(datasetId: string) {
  const datasetResult = await query<{
    id: string;
    workspace_id: string;
    name: string;
    kind: string;
  }>(
    'SELECT id, workspace_id, name, kind FROM datasets WHERE id = $1',
    [datasetId],
  );

  const dataset = datasetResult.rows[0];
  if (!dataset) return null;

  const columnsResult = await query<{
    id: string;
    name: string;
    data_type: string;
    ordinal: number;
    properties: { key?: 'PK' | 'FK' } | null;
  }>(
    `SELECT id, name, data_type, ordinal, properties
     FROM dataset_columns
     WHERE dataset_id = $1
     ORDER BY ordinal, id`,
    [datasetId],
  );

  const rowsResult = await query<{
    id: string;
    ordinal: number;
    values: Record<string, string | number | boolean | null>;
  }>(
    `SELECT id, ordinal, values
     FROM dataset_rows
     WHERE dataset_id = $1
     ORDER BY ordinal, id`,
    [datasetId],
  );

  const doc = new Y.Doc();
  const meta = doc.getMap<any>('meta');
  const columns = doc.getMap<any>('columns');
  const rows = doc.getMap<any>('rows');

  meta.set('id', dataset.id);
  meta.set('workspaceId', dataset.workspace_id);
  meta.set('name', dataset.name);
  meta.set('kind', dataset.kind);

  for (const column of columnsResult.rows) {
    columns.set(column.id, {
      id: column.id,
      name: column.name,
      dataType: column.data_type,
      ordinal: column.ordinal,
      ...(column.properties?.key ? { key: column.properties.key } : {}),
    });
  }

  for (const row of rowsResult.rows) {
    rows.set(row.id, {
      id: row.id,
      ordinal: row.ordinal,
      values: row.values ?? {},
    });
  }

  return Y.encodeStateAsUpdate(doc);
}

const server = new Server({
  name: 'modelboard-collab',
  port,
  debounce: 1000,
  maxDebounce: 5000,

  async onAuthenticate(data) {
    const { token, documentName } = data;
    const connection = (data as any).connection;
    if (!token) throw new Error('Missing auth token');

    const payload = jwt.verify(token, jwtSecret) as {
      sub: string;
      email: string;
      displayName: string;
    };

    const ref = parseDocumentName(documentName);
    if (!ref) throw new Error('Invalid document name');

    let result;

    if (ref.kind === 'board') {
      result = await query<{ role: WorkspaceRole; workspace_id: string }>(
        `SELECT wm.role, b.workspace_id
         FROM boards b
         JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
         WHERE b.id = $1 AND wm.user_id = $2`,
        [ref.id, payload.sub],
      );
    } else {
      result = await query<{ role: WorkspaceRole; workspace_id: string }>(
        `SELECT wm.role, d.workspace_id
         FROM datasets d
         JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
         WHERE d.id = $1 AND wm.user_id = $2`,
        [ref.id, payload.sub],
      );
    }

    const membership = result.rows[0];
    if (!membership) throw new Error('Document access denied');

    connection.readOnly = !canEditBoard(membership.role);

    return {
      user: {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
      },
      role: membership.role,
      workspaceId: membership.workspace_id,
      document: ref,
    };
  },

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const result = await query<{ state: Buffer }>(
          'SELECT state FROM collab_documents WHERE document_name = $1',
          [documentName],
        );

        if (result.rows[0]?.state) {
          return result.rows[0].state;
        }

        const ref = parseDocumentName(documentName);
        if (ref?.kind === 'dataset') {
          return bootstrapDataset(ref.id);
        }

        return null;
      },
      store: async ({ documentName, state }) => {
        const ref = parseDocumentName(documentName);
        if (!ref) return;

        const exists =
          ref.kind === 'board'
            ? await query<{ id: string }>(
                'SELECT id FROM boards WHERE id = $1',
                [ref.id],
              )
            : await query<{ id: string }>(
                'SELECT id FROM datasets WHERE id = $1',
                [ref.id],
              );

        if (!exists.rows[0]) {
          await query(
            'DELETE FROM collab_documents WHERE document_name = $1',
            [documentName],
          );
          return;
        }

        await query(
          `INSERT INTO collab_documents (document_name, state, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (document_name)
           DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
          [documentName, Buffer.from(state)],
        );

        if (ref.kind === 'dataset') {
          await projectDatasetStateToPostgres(
            ref.id,
            state,
          );
        }
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
