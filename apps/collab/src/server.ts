import { randomUUID } from 'node:crypto';
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Logger } from '@hocuspocus/extension-logger';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import {
  pool,
  query,
  runMigrations,
  assertDatasetRelations,
} from '@modelboard/db';
import {
  normalizeCanvasNodes,
  evaluateDatasetFormulas,
  cleanBoardResources,
  canEditBoard,
  type WorkspaceRole,
} from '@modelboard/shared';

const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production';
const port = Number(process.env.COLLAB_PORT ?? 1234);
const deletedDatasets = new Set<string>(),
  deletedRelations = new Set<string>();
const refreshTombstones = async () => {
  for (const row of (
    await query('SELECT id FROM datasets WHERE deleted_at IS NOT NULL')
  ).rows)
    deletedDatasets.add(row.id);
  for (const row of (
    await query('SELECT id FROM dataset_relations WHERE deleted_at IS NOT NULL')
  ).rows)
    deletedRelations.add(row.id);
};

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

function datasetStateHasColumns(state: Uint8Array) {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, state);
    return doc.getMap('columns').size > 0;
  } catch {
    return false;
  } finally {
    doc.destroy();
  }
}

async function refreshBoardRelationLabels(document: Y.Doc) {
  const edges = document.getMap<any>('edges'),
    ids = [
      ...new Set(
        Array.from(edges.values())
          .map((edge) => edge.data?.relationId)
          .filter(Boolean),
      ),
    ];
  if (!ids.length) return;
  const relations = new Map(
    (
      await query(
        'SELECT * FROM dataset_relations WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',
        [ids],
      )
    ).rows.map((row) => [row.id, row]),
  );
  document.transact(() => {
    for (const [id, edge] of edges) {
      const relation = relations.get(edge.data?.relationId);
      if (!relation) continue;
      const plainNode = (id: string) => {
        const value = document.getMap<any>('nodes').get(id);
        return value instanceof Y.Map ? value.toJSON() : value;
      };
      const source = plainNode(edge.source),
        target = plainNode(edge.target);
      const handles: any = {};
      if (source?.type === 'table' || target?.type === 'table') {
        if (
          source?.data?.datasetId !== relation.source_dataset_id ||
          target?.data?.datasetId !== relation.target_dataset_id
        ) {
          edges.delete(id);
          continue;
        }
        handles.sourceHandle = `source:${relation.source_column_id}`;
        handles.targetHandle = `target:${relation.target_column_id}`;
      }
      const label = `${relation.properties?.name || relation.relation_type} ${relation.cardinality ?? ''}`;
      if (
        edge.label !== label ||
        Object.entries(handles).some(([key, value]) => edge[key] !== value)
      )
        edges.set(id, {
          ...edge,
          ...handles,
          label,
          data: {
            ...edge.data,
            relationType: relation.relation_type,
            cardinality: relation.cardinality,
          },
        });
    }
  }, 'relation-metadata');
}

async function projectBoardStateToPostgres(boardId: string, state: Uint8Array) {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, state);
    cleanBoardResources(doc, deletedDatasets, deletedRelations);

    const objects = Array.from(doc.getMap<any>('nodes').values()).map(
      (stored: any) => {
        const node = stored instanceof Y.Map ? stored.toJSON() : stored;
        const data =
          node?.data && typeof node.data === 'object' ? node.data : {};
        const binding =
          data?.binding && typeof data.binding === 'object'
            ? data.binding
            : null;

        return {
          objectId: String(node.id),
          objectType: String(node.type ?? 'unknown'),
          datasetId: data.datasetId ?? binding?.datasetId ?? null,
          rowId: binding?.rowId ?? null,
          columnId: binding?.columnId ?? null,
          properties: {
            ...(typeof data.text === 'string' ? { text: data.text } : {}),
            ...(typeof data.label === 'string' ? { label: data.label } : {}),
            ...(typeof data.deviceKind === 'string'
              ? { deviceKind: data.deviceKind }
              : {}),
            ...(typeof data.templateId === 'string'
              ? { templateId: data.templateId }
              : {}),
            ...(typeof data.relationId === 'string'
              ? { relationId: data.relationId }
              : {}),
          },
        };
      },
    );

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM board_object_index WHERE board_id = $1', [
        boardId,
      ]);

      if (objects.length > 0) {
        await client.query(
          `INSERT INTO board_object_index (
             board_id,
             object_id,
             object_type,
             dataset_id,
             row_id,
             column_id,
             properties,
             updated_at
           )
           SELECT
             $1,
             source.object_id,
             source.object_type,
             source.dataset_id,
             source.row_id,
             source.column_id,
             source.properties,
             now()
           FROM jsonb_to_recordset($2::jsonb) AS source(
             object_id text,
             object_type text,
             dataset_id uuid,
             row_id uuid,
             column_id uuid,
             properties jsonb
           )`,
          [
            boardId,
            JSON.stringify(
              objects.map((object) => ({
                object_id: object.objectId,
                object_type: object.objectType,
                dataset_id: object.datasetId,
                row_id: object.rowId,
                column_id: object.columnId,
                properties: object.properties,
              })),
            ),
          ],
        );
      }

      const bindings = Array.from(doc.getMap<any>('nodes').values())
        .map((stored) => (stored instanceof Y.Map ? stored.toJSON() : stored))
        .flatMap((node) => {
          const binding = node.data?.binding;
          return binding &&
            ['ROW', 'CELL', 'COLUMN', 'DATASET', 'RELATION_VIEW'].includes(
              binding.type,
            )
            ? [
                {
                  object_id: node.id,
                  binding_type: binding.type,
                  dataset_id: binding.datasetId,
                  row_id: binding.rowId ?? null,
                  column_id: binding.columnId ?? null,
                  relation_path: binding.relationPath ?? null,
                  presentation: binding.presentation ?? {},
                },
              ]
            : [];
        });
      await client.query(
        'DELETE FROM object_bindings WHERE board_id=$1 AND NOT(board_object_id=ANY($2::text[]))',
        [boardId, bindings.map((binding) => binding.object_id)],
      );
      if (bindings.length)
        await client.query(
          `INSERT INTO object_bindings(board_id,board_object_id,binding_type,dataset_id,row_id,column_id,relation_path,presentation)
        SELECT $1,source.object_id,source.binding_type::object_binding_type,source.dataset_id,source.row_id,source.column_id,NULLIF(source.relation_path,'null'::jsonb),source.presentation
        FROM jsonb_to_recordset($2::jsonb) AS source(object_id text,binding_type text,dataset_id uuid,row_id uuid,column_id uuid,relation_path jsonb,presentation jsonb)
        JOIN datasets d ON d.id=source.dataset_id AND d.deleted_at IS NULL AND d.workspace_id=(SELECT workspace_id FROM boards WHERE id=$1)
        WHERE (source.row_id IS NULL OR EXISTS(SELECT 1 FROM dataset_rows r WHERE r.id=source.row_id AND r.dataset_id=d.id)) AND (source.column_id IS NULL OR EXISTS(SELECT 1 FROM dataset_columns c WHERE c.id=source.column_id AND c.dataset_id=d.id))
        ON CONFLICT(board_id,board_object_id) DO UPDATE SET binding_type=EXCLUDED.binding_type,dataset_id=EXCLUDED.dataset_id,row_id=EXCLUDED.row_id,column_id=EXCLUDED.column_id,relation_path=EXCLUDED.relation_path,presentation=EXCLUDED.presentation,updated_at=now()`,
          [boardId, JSON.stringify(bindings)],
        );
      await client.query(
        `INSERT INTO collab_documents(document_name,state,updated_at) VALUES($1,$2,now()) ON CONFLICT(document_name) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,
        [`board:${boardId}`, Buffer.from(Y.encodeStateAsUpdate(doc))],
      );
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

async function projectDatasetStateToPostgres(
  datasetId: string,
  state: Uint8Array,
) {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, state);

    const columns = Array.from(doc.getMap<any>('columns').values()).map(
      (stored: any) => {
        const column = stored instanceof Y.Map ? stored.toJSON() : stored;
        return {
          id: String(column.id),
          name: String(column.name),
          dataType: String(column.dataType),
          ordinal: Number(column.ordinal ?? 0),
          properties: column.key ? { key: String(column.key) } : {},
        };
      },
    );

    const rows = Array.from(doc.getMap<any>('rows').values()).map(
      (stored: any) => {
        const row = stored instanceof Y.Map ? stored.toJSON() : stored;
        return {
          id: String(row.id),
          ordinal: Number(row.ordinal ?? 0),
          values:
            row.values && typeof row.values === 'object' ? row.values : {},
        };
      },
    );

    const formulas = Array.from(doc.getMap<any>('formulas').values()).map(
      (formula: any) => ({
        rowId: String(formula.rowId),
        columnId: String(formula.columnId),
        expression: String(formula.expression ?? ''),
      }),
    );

    const formats = Array.from(doc.getMap<any>('formats').values()).map(
      (stored: any) => {
        const format = stored instanceof Y.Map ? stored.toJSON() : stored;
        return {
          color: format.color,
          wrap: Boolean(format.wrap),
          underline: Boolean(format.underline),
          rowId: String(format.rowId),
          columnId: String(format.columnId),
          bold: Boolean(format.bold),
          italic: Boolean(format.italic),
          align:
            format.align === 'LEFT' ||
            format.align === 'CENTER' ||
            format.align === 'RIGHT'
              ? format.align
              : null,
          background:
            typeof format.background === 'string' ? format.background : null,
          numberFormat: [
            'GENERAL',
            'NUMBER',
            'PERCENT',
            'RUB',
            'USD',
            'EUR',
          ].includes(format.numberFormat)
            ? format.numberFormat
            : null,
          decimalPlaces:
            Number.isInteger(format.decimalPlaces) &&
            format.decimalPlaces >= 0 &&
            format.decimalPlaces <= 6
              ? format.decimalPlaces
              : null,
        };
      },
    );

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const workspace = (
        await client.query(
          'SELECT workspace_id FROM datasets WHERE id=$1 AND deleted_at IS NULL',
          [datasetId],
        )
      ).rows[0]?.workspace_id;
      if (!workspace) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspace],
      );
      await client.query(
        'SELECT id FROM datasets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [datasetId],
      );
      const orderedColumns = columns.sort(
        (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
      );
      const orderedRows = rows.sort(
        (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
      );
      const columnIds = orderedColumns.map((column) => column.id),
        rowIds = orderedRows.map((row) => row.id);
      const protectedRows = await client.query(
        'SELECT id FROM object_bindings WHERE dataset_id=$1 AND row_id IS NOT NULL AND NOT (row_id=ANY($2::uuid[])) LIMIT 1',
        [datasetId, rowIds],
      );
      const protectedColumns = await client.query(
        `SELECT id FROM object_bindings WHERE dataset_id=$1 AND ((column_id IS NOT NULL AND NOT (column_id=ANY($2::uuid[]))) OR (presentation->>'titleColumnId' IS NOT NULL AND NOT((presentation->>'titleColumnId')::uuid=ANY($2::uuid[]))) OR (presentation->>'subtitleColumnId' IS NOT NULL AND NOT((presentation->>'subtitleColumnId')::uuid=ANY($2::uuid[]))) OR (presentation->>'statusColumnId' IS NOT NULL AND NOT((presentation->>'statusColumnId')::uuid=ANY($2::uuid[]))) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(presentation->'fieldColumnIds','[]'::jsonb)) field WHERE NOT(field.value::uuid=ANY($2::uuid[]))))
        UNION ALL SELECT id FROM dataset_relations WHERE deleted_at IS NULL AND ((source_dataset_id=$1 AND NOT(source_column_id=ANY($2::uuid[]))) OR (target_dataset_id=$1 AND NOT(target_column_id=ANY($2::uuid[])))) LIMIT 1`,
        [datasetId, columnIds],
      );
      if (protectedRows.rows.length || protectedColumns.rows.length)
        throw new Error(
          'Dataset structure is referenced by bindings or relations',
        );
      if (orderedColumns.length)
        await client.query(
          `INSERT INTO dataset_columns(id,dataset_id,name,data_type,ordinal,properties)
         SELECT id,$1,name,data_type,ordinal,properties FROM jsonb_to_recordset($2::jsonb) AS source(id uuid,name text,data_type text,ordinal integer,properties jsonb)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,data_type=EXCLUDED.data_type,ordinal=EXCLUDED.ordinal,properties=EXCLUDED.properties WHERE dataset_columns.dataset_id=EXCLUDED.dataset_id`,
          [
            datasetId,
            JSON.stringify(
              orderedColumns.map((column, ordinal) => ({
                id: column.id,
                name: column.name,
                data_type: column.dataType,
                ordinal,
                properties: column.properties,
              })),
            ),
          ],
        );
      const calculated = evaluateDatasetFormulas(
        orderedRows as any,
        orderedColumns as any,
        formulas,
      );
      const projected = orderedRows.map((row, ordinal) => {
        const values = { ...row.values };
        for (const column of orderedColumns)
          if (calculated.has(`${row.id}:${column.id}`))
            values[column.id] =
              calculated.get(`${row.id}:${column.id}`) ?? null;
        return { id: row.id, ordinal, values };
      });
      await assertDatasetRelations(client, datasetId, projected as any);
      if (projected.length)
        await client.query(
          `INSERT INTO dataset_rows(id,dataset_id,ordinal,values)
        SELECT id,$1,ordinal,values FROM jsonb_to_recordset($2::jsonb) AS source(id uuid,ordinal integer,values jsonb)
        ON CONFLICT(id) DO UPDATE SET ordinal=EXCLUDED.ordinal,values=EXCLUDED.values WHERE dataset_rows.dataset_id=EXCLUDED.dataset_id`,
          [datasetId, JSON.stringify(projected)],
        );
      await client.query(
        'DELETE FROM dataset_rows WHERE dataset_id=$1 AND NOT(id=ANY($2::uuid[]))',
        [datasetId, rowIds],
      );
      await client.query(
        'DELETE FROM dataset_columns WHERE dataset_id=$1 AND NOT(id=ANY($2::uuid[]))',
        [datasetId, columnIds],
      );
      const settings = {
        views: Array.from(doc.getMap('views').values()).map((value: any) =>
          value instanceof Y.Map ? value.toJSON() : value,
        ),
        rules: Array.from(doc.getMap('rules').values()).map((value: any) =>
          value instanceof Y.Map ? value.toJSON() : value,
        ),
      };
      await client.query(
        `INSERT INTO dataset_sheet_settings(dataset_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(dataset_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`,
        [datasetId, JSON.stringify(settings)],
      );

      await client.query('DELETE FROM dataset_formulas WHERE dataset_id = $1', [
        datasetId,
      ]);

      if (formulas.length > 0) {
        await client.query(
          `INSERT INTO dataset_formulas (
             dataset_id, row_id, column_id, expression
           )
           SELECT
             $1,
             source.row_id,
             source.column_id,
             source.expression
           FROM jsonb_to_recordset($2::jsonb) AS source(
             row_id uuid,
             column_id uuid,
             expression text
           )`,
          [
            datasetId,
            JSON.stringify(
              formulas.map((formula) => ({
                row_id: formula.rowId,
                column_id: formula.columnId,
                expression: formula.expression,
              })),
            ),
          ],
        );
      }

      await client.query(
        'DELETE FROM dataset_cell_formats WHERE dataset_id = $1',
        [datasetId],
      );

      if (formats.length > 0) {
        await client.query(
          `INSERT INTO dataset_cell_formats (
             dataset_id, row_id, column_id, format
           )
           SELECT
             $1,
             source.row_id,
             source.column_id,
             source.format
           FROM jsonb_to_recordset($2::jsonb) AS source(
             row_id uuid,
             column_id uuid,
             format jsonb
           )`,
          [
            datasetId,
            JSON.stringify(
              formats.map((format) => ({
                row_id: format.rowId,
                column_id: format.columnId,
                format: {
                  color: format.color,
                  wrap: format.wrap,
                  underline: format.underline,
                  bold: format.bold,
                  italic: format.italic,
                  align: format.align,
                  background: format.background,
                  numberFormat: format.numberFormat,
                  decimalPlaces: format.decimalPlaces,
                },
              })),
            ),
          ],
        );
      }

      await client.query(
        `INSERT INTO collab_documents(document_name,state,updated_at) VALUES($1,$2,now()) ON CONFLICT(document_name) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,
        [`dataset:${datasetId}`, Buffer.from(state)],
      );
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
  }>('SELECT id, workspace_id, name, kind FROM datasets WHERE id = $1', [
    datasetId,
  ]);

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

  const formulasResult = await query<{
    row_id: string;
    column_id: string;
    expression: string;
  }>(
    `SELECT row_id, column_id, expression
     FROM dataset_formulas
     WHERE dataset_id = $1
     ORDER BY row_id, column_id`,
    [datasetId],
  );

  const formatsResult = await query<{
    row_id: string;
    column_id: string;
    format: {
      bold?: boolean;
      italic?: boolean;
      align?: 'LEFT' | 'CENTER' | 'RIGHT' | null;
      background?: string | null;
      numberFormat?:
        | 'GENERAL'
        | 'NUMBER'
        | 'PERCENT'
        | 'RUB'
        | 'USD'
        | 'EUR'
        | null;
      decimalPlaces?: number | null;
    };
  }>(
    `SELECT row_id, column_id, format
     FROM dataset_cell_formats
     WHERE dataset_id = $1
     ORDER BY row_id, column_id`,
    [datasetId],
  );

  const savedSettings = await query<{ settings: any }>(
    'SELECT settings FROM dataset_sheet_settings WHERE dataset_id=$1',
    [datasetId],
  );
  const doc = new Y.Doc();
  for (const name of ['views', 'rules'])
    for (const item of savedSettings.rows[0]?.settings?.[name] ?? [])
      doc.getMap(name).set(item.id, item);
  const meta = doc.getMap<any>('meta');
  const columns = doc.getMap<any>('columns');
  const rows = doc.getMap<any>('rows');
  const formulas = doc.getMap<any>('formulas');
  const formats = doc.getMap<any>('formats');

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

  for (const formula of formulasResult.rows) {
    formulas.set(`${formula.row_id}:${formula.column_id}`, {
      rowId: formula.row_id,
      columnId: formula.column_id,
      expression: formula.expression,
    });
  }

  for (const item of formatsResult.rows) {
    formats.set(`${item.row_id}:${item.column_id}`, {
      rowId: item.row_id,
      columnId: item.column_id,
      ...item.format,
    });
  }

  return Y.encodeStateAsUpdate(doc);
}

async function startCollaborationServer() {
  await runMigrations();
  await refreshTombstones();

  const server = new Server({
    name: 'modelboard-collab',
    port,
    debounce: 1000,
    maxDebounce: 5000,

    async afterLoadDocument({ documentName, document }) {
      const kind = parseDocumentName(documentName)?.kind;
      if (kind === 'board') {
        normalizeCanvasNodes(document);
        cleanBoardResources(document, deletedDatasets, deletedRelations);
        await refreshBoardRelationLabels(document);
      } else if (kind === 'dataset')
        normalizeCanvasNodes(document, [
          'rows',
          'columns',
          'formats',
          'views',
          'rules',
        ]);
    },

    async onChange({ documentName, document }) {
      if (parseDocumentName(documentName)?.kind === 'board')
        cleanBoardResources(document, deletedDatasets, deletedRelations);
    },

    async onAuthenticate(data) {
      const { token, documentName } = data;
      const connection = data.connectionConfig;
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
         WHERE d.id = $1 AND d.deleted_at IS NULL AND wm.user_id = $2`,
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
            const ref = parseDocumentName(documentName);

            if (ref?.kind === 'board') {
              await projectBoardStateToPostgres(ref.id, result.rows[0].state);
            }

            if (
              ref?.kind === 'dataset' &&
              !datasetStateHasColumns(result.rows[0].state)
            ) {
              const relational = await query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
               FROM dataset_columns
               WHERE dataset_id = $1`,
                [ref.id],
              );

              if (Number(relational.rows[0]?.count ?? 0) > 0) {
                const repaired = await bootstrapDataset(ref.id);

                if (repaired) {
                  await query(
                    `UPDATE collab_documents
                   SET state = $2, updated_at = now()
                   WHERE document_name = $1`,
                    [documentName, Buffer.from(repaired)],
                  );
                  console.warn(
                    `Repaired empty dataset collaboration state: ${ref.id}`,
                  );
                  return repaired;
                }
              }
            }

            return result.rows[0].state;
          }

          const ref = parseDocumentName(documentName);
          if (ref?.kind === 'dataset') {
            return bootstrapDataset(ref.id);
          }

          return null;
        },
        store: async ({ documentName, state, document }) => {
          const ref = parseDocumentName(documentName);
          if (!ref) return;

          const exists =
            ref.kind === 'board'
              ? await query<{ id: string }>(
                  'SELECT id FROM boards WHERE id = $1',
                  [ref.id],
                )
              : await query<{ id: string }>(
                  'SELECT id FROM datasets WHERE id = $1 AND deleted_at IS NULL',
                  [ref.id],
                );

          if (!exists.rows[0]) {
            await query(
              'DELETE FROM collab_documents WHERE document_name = $1',
              [documentName],
            );
            return;
          }

          if (ref.kind === 'dataset') {
            try {
              await projectDatasetStateToPostgres(ref.id, state);
              document.broadcastStateless(
                JSON.stringify({ type: 'dataset-storage', saved: true }),
              );
            } catch (error) {
              document.broadcastStateless(
                JSON.stringify({
                  type: 'dataset-storage',
                  saved: false,
                  message:
                    (error instanceof Error &&
                    error.message.startsWith('Связь «')
                      ? error.message + ' — '
                      : '') +
                    'Не удалось сохранить изменения таблицы. Проверьте конфликт структуры/привязок и отмените последнее действие; не закрывайте вкладку до устранения ошибки.',
                }),
              );
              throw error;
            }
          } else {
            await projectBoardStateToPostgres(ref.id, state);
          }
          // Both document kinds commit their snapshot together with the SQL projection.
        },
      }),
      new Logger({
        onChange: false,
        onLoadDocument: false,
      }),
    ],
  });

  const listenResources = async () => {
    const listener = await pool.connect();
    listener.on('error', () => {
      listener.release(true);
      setTimeout(() => void listenResources().catch(console.error), 2000);
    });
    listener.on('notification', async (notification) => {
      try {
        const event = JSON.parse(notification.payload ?? '{}');
        if (!event.workspaceId) return;
        if (event.datasetId && event.kind === 'dataset-deleted') {
          deletedDatasets.add(event.datasetId);
          await refreshTombstones();
        }
        for (const id of event.relationIds ?? []) deletedRelations.add(id);
        const names = new Set([
          ...(
            await query('SELECT id FROM boards WHERE workspace_id=$1', [
              event.workspaceId,
            ])
          ).rows.map((row) => `board:${row.id}`),
          ...(
            await query('SELECT id FROM datasets WHERE workspace_id=$1', [
              event.workspaceId,
            ])
          ).rows.map((row) => `dataset:${row.id}`),
        ]);
        const message = JSON.stringify({
          type: 'resources',
          eventId: randomUUID(),
          ...event,
        });
        for (const [name, document] of server.hocuspocus.documents) {
          if (!names.has(name)) continue;
          if (name.startsWith('board:')) {
            cleanBoardResources(document, deletedDatasets, deletedRelations);
            if (event.kind === 'relation-changed')
              await refreshBoardRelationLabels(document);
          }
          document.broadcastStateless(message);
        }
      } catch (error) {
        console.error('Resource notification failed', error);
      }
    });
    await listener.query('LISTEN modelboard_resources');
    await refreshTombstones();
  };
  await listenResources();
  server.listen();
  console.log(
    `ModelBoard collaboration server listening on ws://localhost:${port}`,
  );
}

void startCollaborationServer();
