import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type pg from 'pg';
import * as Y from 'yjs';
import { pool, relationFromSql, validateSqlRelation } from '@modelboard/db';
import {
  canEditBoard,
  FILE_LIMITS,
  assertSafeJson,
  validateDatasetFile,
  validateBoardArchive,
  remapBoardArchive,
  SharedRecordStore,
  type BoardArchive,
  type DatasetSnapshot,
  type FileAssetInput,
} from '@modelboard/shared';
import { AuthGuard, getBoardAccess, getWorkspaceAccess } from './auth.js';
import { validateWorkspaceSvg } from './svg.js';

function bad(error: unknown): never {
  if (
    error instanceof ForbiddenException ||
    error instanceof BadRequestException ||
    error instanceof NotFoundException
  )
    throw error;
  throw new BadRequestException(
    error instanceof Error ? error.message : 'Не удалось прочитать файл',
  );
}
export function validateAsset(input: FileAssetInput) {
  if (
    !input ||
    typeof input.base64 !== 'string' ||
    input.base64.length > FILE_LIMITS.maxImageBytes * 1.4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw new Error('Некорректное содержимое изображения');
  const data = Buffer.from(input.base64, 'base64');
  if (!data.length || data.length > FILE_LIMITS.maxImageBytes)
    throw new Error('Изображение: до 3 МБ');
  const mime = input.mime;
  if (mime === 'image/svg+xml') validateWorkspaceSvg(data.toString('utf8'));
  else if (
    !(
      (mime === 'image/png' &&
        data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mime === 'image/jpeg' &&
        data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255) ||
      (mime === 'image/webp' &&
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP')
    )
  )
    throw new Error('Поддерживаются PNG, JPEG, WebP и безопасный SVG');
  if (mime === 'image/png') {
    if (data.length < 24) throw new Error('Повреждённый PNG');
    const width = data.readUInt32BE(16),
      height = data.readUInt32BE(20);
    if (!width || !height || width * height > 40000000)
      throw new Error('Изображение: максимум 40 млн пикселей');
  }
  return {
    data,
    mime,
    name:
      String(input.name ?? 'image')
        .replace(/[\r\n\0/\\]/g, '_')
        .slice(0, 120) || 'image',
  };
}
async function saveAsset(
  client: pg.PoolClient,
  workspace: string,
  user: string,
  input: FileAssetInput,
) {
  const file = validateAsset(input);
  const id = input.id ?? randomUUID();
  await client.query(
    'INSERT INTO workspace_files(id,workspace_id,name,mime,data,size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, workspace, file.name, file.mime, file.data, file.data.length, user],
  );
  return { id, name: file.name, mime: file.mime, size: file.data.length };
}
async function quota(client: pg.PoolClient, workspace: string, extra: number) {
  const used = Number(
    (
      await client.query(
        'SELECT COALESCE(sum(size),0) AS total FROM workspace_files WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].total,
  );
  if (used + extra > FILE_LIMITS.maxWorkspaceBytes)
    throw new Error('Лимит хранилища Workspace — 100 МБ');
}
async function saveDataset(
  client: pg.PoolClient,
  workspace: string,
  user: string,
  ds: DatasetSnapshot,
) {
  validateDatasetFile(ds);
  await client.query(
    'INSERT INTO datasets(id,workspace_id,name,kind,created_by) VALUES($1,$2,$3,$4,$5)',
    [
      ds.id,
      workspace,
      String(ds.name || 'Таблица').slice(0, 120),
      ['MANUAL', 'CSV', 'SQL', 'API'].includes(ds.kind) ? ds.kind : 'CSV',
      user,
    ],
  );
  await client.query(
    `INSERT INTO dataset_columns(id,dataset_id,name,data_type,ordinal,properties) SELECT id,$1,name,data_type,ordinal,properties FROM jsonb_to_recordset($2::jsonb) AS c(id uuid,name text,data_type text,ordinal int,properties jsonb)`,
    [
      ds.id,
      JSON.stringify(
        ds.columns.map((c, i) => ({
          id: c.id,
          name: c.name,
          data_type: c.dataType,
          ordinal: i,
          properties: { key: c.key },
        })),
      ),
    ],
  );
  if (ds.rows.length)
    await client.query(
      `INSERT INTO dataset_rows(id,dataset_id,ordinal,values) SELECT id,$1,ordinal,values FROM jsonb_to_recordset($2::jsonb) AS r(id uuid,ordinal int,values jsonb)`,
      [ds.id, JSON.stringify(ds.rows.map((r, i) => ({ ...r, ordinal: i })))],
    );
  if (ds.formulas?.length)
    await client.query(
      `INSERT INTO dataset_formulas(dataset_id,row_id,column_id,expression) SELECT $1,row_id,column_id,expression FROM jsonb_to_recordset($2::jsonb) AS f(row_id uuid,column_id uuid,expression text)`,
      [
        ds.id,
        JSON.stringify(
          ds.formulas.map((f) => ({
            row_id: f.rowId,
            column_id: f.columnId,
            expression: f.expression,
          })),
        ),
      ],
    );
  if (ds.formats?.length)
    await client.query(
      `INSERT INTO dataset_cell_formats(dataset_id,row_id,column_id,format) SELECT $1,row_id,column_id,format FROM jsonb_to_recordset($2::jsonb) AS f(row_id uuid,column_id uuid,format jsonb)`,
      [
        ds.id,
        JSON.stringify(
          ds.formats.map(({ rowId, columnId, ...format }) => ({
            row_id: rowId,
            column_id: columnId,
            format,
          })),
        ),
      ],
    );
  await client.query(
    'INSERT INTO dataset_sheet_settings(dataset_id,settings) VALUES($1,$2::jsonb)',
    [ds.id, JSON.stringify({ views: ds.views ?? [], rules: ds.rules ?? [] })],
  );
}
async function readDataset(client: pg.PoolClient, id: string) {
  const ds = (
    await client.query(
      'SELECT * FROM datasets WHERE id=$1 AND deleted_at IS NULL',
      [id],
    )
  ).rows[0];
  if (!ds) throw new Error('Не найдена таблица источника');
  const columns = (
    await client.query(
      'SELECT * FROM dataset_columns WHERE dataset_id=$1 ORDER BY ordinal,id',
      [id],
    )
  ).rows.map((c) => ({
    id: c.id,
    name: c.name,
    dataType: c.data_type,
    ordinal: c.ordinal,
    key: c.properties?.key,
  }));
  const rows = (
    await client.query(
      'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1 ORDER BY ordinal,id',
      [id],
    )
  ).rows;
  const formulas = (
    await client.query(
      'SELECT row_id AS "rowId",column_id AS "columnId",expression FROM dataset_formulas WHERE dataset_id=$1',
      [id],
    )
  ).rows;
  const formats = (
    await client.query(
      'SELECT row_id,column_id,format FROM dataset_cell_formats WHERE dataset_id=$1',
      [id],
    )
  ).rows.map((f) => ({ rowId: f.row_id, columnId: f.column_id, ...f.format }));
  const settings =
    (
      await client.query(
        'SELECT settings FROM dataset_sheet_settings WHERE dataset_id=$1',
        [id],
      )
    ).rows[0]?.settings ?? {};
  return {
    id,
    name: ds.name,
    workspaceId: ds.workspace_id,
    kind: ds.kind,
    columns,
    rows,
    formulas,
    formats,
    ...settings,
  } as DatasetSnapshot;
}
@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  @Get('workspaces/:id/files') async list(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    if (!(await getWorkspaceAccess(id, req.user.sub)))
      throw new ForbiddenException();
    return (
      await pool.query(
        'SELECT id,name,mime,size,created_at AS "createdAt" FROM workspace_files WHERE workspace_id=$1 ORDER BY created_at DESC',
        [id],
      )
    ).rows;
  }
  @Get('files/:id/content') async content(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const file = (
      await pool.query('SELECT * FROM workspace_files WHERE id=$1', [id])
    ).rows[0];
    if (!file || !(await getWorkspaceAccess(file.workspace_id, req.user.sub)))
      throw new ForbiddenException();
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=0');
    res.send(file.data);
  }
  @Post('workspaces/:id/files/import') async importFiles(
    @Param('id') workspace: string,
    @Req() req: any,
    @Body() body: { datasets: DatasetSnapshot[]; files: FileAssetInput[] },
  ) {
    const access = await getWorkspaceAccess(workspace, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    const client = await pool.connect();
    try {
      assertSafeJson(body);
      if (Buffer.byteLength(JSON.stringify(body)) > FILE_LIMITS.maxArchiveBytes)
        throw new Error('Пакет импорта превышает 30 МБ');
      if (
        !Array.isArray(body.datasets) ||
        !Array.isArray(body.files) ||
        body.datasets.length + body.files.length > 50 ||
        (!body.datasets.length && !body.files.length)
      )
        throw new Error('Выберите от 1 до 50 таблиц/файлов');
      for (const ds of body.datasets) validateDatasetFile(ds);
      const bytes = body.files.reduce(
        (n, f) => n + validateAsset(f).data.length,
        0,
      );
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspace],
      );
      await quota(client, workspace, bytes);
      const datasets = [];
      for (const source of body.datasets) {
        const archive: BoardArchive = {
          format: 'modelboard',
          version: 1,
          name: '',
          nodes: [],
          edges: [],
          strokes: [],
          datasets: [{ ...source, id: source.id ?? randomUUID() }],
          relations: [],
          templates: [],
          files: [],
        };
        const ds = remapBoardArchive(archive, randomUUID).datasets[0];
        await saveDataset(client, workspace, req.user.sub, ds);
        datasets.push({ id: ds.id, name: ds.name });
      }
      const files = [];
      for (const f of body.files)
        files.push(
          await saveAsset(client, workspace, req.user.sub, {
            ...f,
            id: undefined,
          }),
        );
      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({ kind: 'files-imported', workspaceId: workspace }),
      ]);
      await client.query('COMMIT');
      return { datasets, files };
    } catch (error) {
      await client.query('ROLLBACK');
      bad(error);
    } finally {
      client.release();
    }
  }
  @Post('boards/:id/export') async exportBoard(
    @Param('id') id: string,
    @Req() req: any,
    @Body() state: any,
  ) {
    const access = await getBoardAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();
    const client = await pool.connect();
    try {
      assertSafeJson(state);
      if (
        !Array.isArray(state.nodes) ||
        !Array.isArray(state.edges) ||
        !Array.isArray(state.strokes) ||
        state.nodes.length > FILE_LIMITS.maxNodes
      )
        throw new Error('Некорректное состояние доски');
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const relations = (
        await client.query(
          `SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceRowId',source_row_id,'targetRowId',target_row_id)) FROM dataset_relation_links WHERE relation_id=r.id),'[]'::jsonb) AS links FROM dataset_relations r WHERE workspace_id=$1 AND deleted_at IS NULL`,
          [access.workspace_id],
        )
      ).rows.map(relationFromSql);
      const ids = new Set<string>(
        state.nodes.flatMap((n: any) =>
          [n.data?.datasetId, n.data?.binding?.datasetId].filter(Boolean),
        ),
      );
      let previous = -1;
      while (previous !== ids.size) {
        previous = ids.size;
        for (const r of relations)
          if (ids.has(r.sourceDatasetId) || ids.has(r.targetDatasetId)) {
            ids.add(r.sourceDatasetId);
            ids.add(r.targetDatasetId);
          }
      }
      if (ids.size > FILE_LIMITS.maxDatasets)
        throw new Error('Архив: максимум 50 связанных таблиц');
      const datasets = [];
      for (const dsid of ids) {
        const ds = await readDataset(client, dsid);
        if (ds.workspaceId !== access.workspace_id)
          throw new ForbiddenException();
        datasets.push(ds);
      }
      const templateIds = [
          ...new Set(
            state.nodes.map((n: any) => n.data?.templateId).filter(Boolean),
          ),
        ],
        fileIds = [
          ...new Set(
            state.nodes.map((n: any) => n.data?.assetId).filter(Boolean),
          ),
        ];
      const templates = (
        await client.query(
          'SELECT id,name,svg,default_width AS "defaultWidth",default_height AS "defaultHeight",properties FROM object_templates WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
          [access.workspace_id, templateIds],
        )
      ).rows;
      const files = (
        await client.query(
          'SELECT id,name,mime,data FROM workspace_files WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
          [access.workspace_id, fileIds],
        )
      ).rows.map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mime,
        base64: f.data.toString('base64'),
      }));
      const archive = {
        format: 'modelboard',
        version: 1,
        name: access.board_name,
        nodes: state.nodes,
        edges: state.edges,
        strokes: state.strokes,
        datasets,
        relations: relations.filter(
          (r) => ids.has(r.sourceDatasetId) && ids.has(r.targetDatasetId),
        ),
        templates,
        files,
      };
      validateBoardArchive(archive);
      if (
        Buffer.byteLength(JSON.stringify(archive)) > FILE_LIMITS.maxArchiveBytes
      )
        throw new Error('Архив больше 30 МБ');
      await client.query('COMMIT');
      return archive;
    } catch (error) {
      await client.query('ROLLBACK');
      bad(error);
    } finally {
      client.release();
    }
  }
  @Post('workspaces/:id/boards/import') async importBoard(
    @Param('id') workspace: string,
    @Req() req: any,
    @Body() body: unknown,
  ) {
    const access = await getWorkspaceAccess(workspace, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    const client = await pool.connect();
    try {
      if (Buffer.byteLength(JSON.stringify(body)) > FILE_LIMITS.maxArchiveBytes)
        throw new Error('Архив превышает 30 МБ');
      validateBoardArchive(body);
      const a = remapBoardArchive(body, randomUUID),
        boardId = randomUUID();
      for (const t of a.templates) validateWorkspaceSvg(t.svg);
      const extra = a.files.reduce(
        (n, f) => n + validateAsset(f).data.length,
        0,
      );
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspace],
      );
      await quota(client, workspace, extra);
      await client.query(
        'INSERT INTO boards(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)',
        [
          boardId,
          workspace,
          String(a.name || 'Импортированная доска').slice(0, 120),
          req.user.sub,
        ],
      );
      for (const ds of a.datasets)
        await saveDataset(client, workspace, req.user.sub, ds);
      for (const r of a.relations) {
        const report = await validateSqlRelation(client, r);
        if (
          (r.enforceIntegrity ||
            r.matchMode === 'ROW_LINKS' ||
            r.relationType === 'FOREIGN_KEY') &&
          !report.valid
        )
          throw new Error(report.issues.join('; '));
        await client.query(
          'INSERT INTO dataset_relations(id,workspace_id,source_dataset_id,source_column_id,target_dataset_id,target_column_id,relation_type,cardinality,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
          [
            r.id,
            workspace,
            r.sourceDatasetId,
            r.matchMode === 'ROW_LINKS' ? null : r.sourceColumnId,
            r.targetDatasetId,
            r.matchMode === 'ROW_LINKS' ? null : r.targetColumnId,
            r.relationType,
            r.cardinality ?? null,
            JSON.stringify({
              name: r.name,
              matchMode: r.matchMode ?? 'FIELDS',
              enforceIntegrity: r.enforceIntegrity,
            }),
          ],
        );
        for (const pair of r.links ?? [])
          await client.query(
            'INSERT INTO dataset_relation_links VALUES($1,$2,$3)',
            [r.id, pair.sourceRowId, pair.targetRowId],
          );
      }
      for (const t of a.templates)
        await client.query(
          'INSERT INTO object_templates(id,workspace_id,name,svg,default_width,default_height,properties,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
          [
            t.id,
            workspace,
            `${t.name} (${t.id.slice(0, 8)})`.slice(0, 120),
            t.svg,
            t.defaultWidth ?? 220,
            t.defaultHeight ?? 130,
            JSON.stringify(t.properties ?? {}),
            req.user.sub,
          ],
        );
      for (const f of a.files)
        await saveAsset(client, workspace, req.user.sub, f);
      const doc = new Y.Doc();
      try {
        const nodes = new SharedRecordStore(doc, 'nodes');
        for (const n of a.nodes) {
          if (n.data?.binding) {
            n.data.binding.id = randomUUID();
            n.data.binding.boardId = boardId;
            n.data.binding.boardObjectId = n.id;
            const b = n.data.binding;
            await client.query(
              'INSERT INTO object_bindings(id,board_id,board_object_id,binding_type,dataset_id,row_id,column_id,relation_path,presentation) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',
              [
                b.id,
                boardId,
                n.id,
                b.type,
                b.datasetId,
                b.rowId ?? null,
                b.columnId ?? null,
                JSON.stringify(b.relationPath ?? null),
                JSON.stringify(b.presentation ?? {}),
              ],
            );
          }
          nodes.set(n.id, n);
          const b = n.data?.binding;
          await client.query(
            'INSERT INTO board_object_index(board_id,object_id,object_type,dataset_id,row_id,column_id,properties) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
            [
              boardId,
              n.id,
              n.type,
              n.data?.datasetId ?? b?.datasetId ?? null,
              b?.rowId ?? null,
              b?.columnId ?? null,
              JSON.stringify(n.data ?? {}),
            ],
          );
        }
        for (const e of a.edges) doc.getMap('edges').set(e.id, e);
        for (const s of a.strokes) doc.getMap('strokes').set(s.id, s);
        await client.query(
          'INSERT INTO collab_documents(document_name,state) VALUES($1,$2)',
          [`board:${boardId}`, Buffer.from(Y.encodeStateAsUpdate(doc))],
        );
      } finally {
        doc.destroy();
      }
      await client.query('COMMIT');
      return { id: boardId, name: a.name };
    } catch (error) {
      await client.query('ROLLBACK');
      bad(error);
    } finally {
      client.release();
    }
  }
}
