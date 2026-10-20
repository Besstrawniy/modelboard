import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { usesPasswordAuth, configuredAccount } from '@modelboard/shared/server-auth';
import {
  pool,
  query,
  relationFromSql,
  validateSqlRelation,
  assertDatasetRelations,
} from '@modelboard/db';
import {
  sameRelationEndpoints,
  canComment,
  canEditBoard,
  type BoardDatasetLocation,
  type ConvertDatasetColumnInput,
  type ConvertDatasetColumnResult,
  type CreateDatasetInput,
  type CreateDatasetRelationInput,
  type DatasetColumn,
  type DatasetRelationCardinality,
  type DatasetRelationType,
  type DatasetRow,
  type CreateWorkspaceObjectTemplateInput,
  type UpsertObjectBindingInput,
  type WorkspaceRole,
  type WorkspaceSearchResult,
} from '@modelboard/shared';
import { validateWorkspaceSvg } from './svg.js';
import {
  AuthGuard,
  getBoardAccess,
  getDatasetAccess,
  getWorkspaceAccess,
  signUser,
} from './auth.js';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { ok: true, service: 'modelboard-api' };
  }

  @Get('auth/config')
  authConfiguration() {
    return { mode: usesPasswordAuth() ? 'password' : 'demo' };
  }

  @Post('auth/login')
  async passwordLogin(@Body() body: { email?: unknown; password?: unknown }) {
    const account = configuredAccount(body?.email, body?.password);
    if (!account) throw new UnauthorizedException('Неверный email или пароль');
    const result = await query<{ id: string; email: string; display_name: string }>(
      'SELECT id, email, display_name FROM users WHERE id = $1', [account.id],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException('Неверный email или пароль');
    return {
      token: signUser({ sub: user.id, email: user.email, displayName: user.display_name }),
      user: { id: user.id, email: user.email, displayName: user.display_name },
    };
  }

  @Get('auth/dev-users')
  async devUsers() {
    if (usesPasswordAuth()) throw new NotFoundException();
    const result = await query<{
      id: string;
      email: string;
      display_name: string;
      role: WorkspaceRole;
    }>(
      `SELECT u.id, u.email, u.display_name, wm.role
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE wm.workspace_id = '20000000-0000-0000-0000-000000000001'
       ORDER BY CASE wm.role
         WHEN 'OWNER' THEN 1 WHEN 'EDITOR' THEN 2 WHEN 'COMMENTER' THEN 3 ELSE 4 END`,
    );

    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    }));
  }

  @Post('auth/dev-login')
  async devLogin(@Body() body: { userId?: string }) {
    if (usesPasswordAuth()) throw new NotFoundException();
    const result = await query<{
      id: string;
      email: string;
      display_name: string;
    }>('SELECT id, email, display_name FROM users WHERE id = $1', [
      body.userId,
    ]);

    const user = result.rows[0];
    if (!user) throw new NotFoundException('Demo user not found');

    const payload = {
      sub: user.id,
      email: user.email,
      displayName: user.display_name,
    };

    return {
      token: signUser(payload),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    };
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/boards')
  async boards(@Param('id') workspaceId: string, @Req() req: any) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query<{
      id: string;
      name: string;
    }>(
      `SELECT id, name
       FROM boards
       WHERE workspace_id = $1
       ORDER BY created_at, lower(name), id`,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      workspaceId,
      workspaceName: access.workspace_name,
      role: access.role,
    }));
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/boards')
  async createBoard(
    @Param('id') workspaceId: string,
    @Req() req: any,
    @Body() body: { name?: string },
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new BadRequestException('Board name is required');
    }
    if (name.length > 120) {
      throw new BadRequestException('Board name is limited to 120 characters');
    }

    const boardId = randomUUID();
    await query(
      `INSERT INTO boards (
         id, workspace_id, name, created_by
       )
       VALUES ($1, $2, $3, $4)`,
      [boardId, workspaceId, name, req.user.sub],
    );

    return {
      id: boardId,
      name,
      workspaceId,
      workspaceName: access.workspace_name,
      role: access.role,
    };
  }

  @UseGuards(AuthGuard)
  @Put('boards/:id')
  async renameBoard(
    @Param('id') boardId: string,
    @Req() req: any,
    @Body() body: { name?: string },
  ) {
    const access = await getBoardAccess(boardId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('Board name is required');
    }
    if (name.length > 120) {
      throw new BadRequestException('Board name is limited to 120 characters');
    }

    await query(
      `UPDATE boards
       SET name = $1, updated_at = now()
       WHERE id = $2`,
      [name, boardId],
    );

    return {
      id: boardId,
      name,
      workspaceId: access.workspace_id,
      workspaceName: access.workspace_name,
      role: access.role,
    };
  }

  @UseGuards(AuthGuard)
  @Delete('boards/:id')
  async deleteBoard(@Param('id') boardId: string, @Req() req: any) {
    const access = await getBoardAccess(boardId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (access.role !== 'OWNER') {
      throw new ForbiddenException('Only workspace OWNER can delete boards');
    }

    const count = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM boards
       WHERE workspace_id = $1`,
      [access.workspace_id],
    );

    if (Number(count.rows[0]?.count ?? 0) <= 1) {
      throw new ConflictException(
        'The last board in a workspace cannot be deleted',
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM collab_documents WHERE document_name = $1',
        [`board:${boardId}`],
      );
      await client.query('DELETE FROM boards WHERE id = $1', [boardId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { ok: true as const };
  }

  @UseGuards(AuthGuard)
  @Get('boards/:id')
  async board(@Param('id') id: string, @Req() req: any) {
    const access = await getBoardAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();

    return {
      id: access.board_id,
      name: access.board_name,
      workspaceId: access.workspace_id,
      workspaceName: access.workspace_name,
      role: access.role,
    };
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/datasets')
  async datasets(@Param('id') id: string, @Req() req: any) {
    const access = await getWorkspaceAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query<{
      id: string;
      workspace_id: string;
      name: string;
      kind: 'MANUAL' | 'CSV' | 'SQL' | 'API';
    }>(
      `SELECT id, workspace_id, name, kind
       FROM datasets
       WHERE deleted_at IS NULL AND workspace_id = $1
       ORDER BY created_at, name`,
      [id],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      kind: row.kind,
      role: access.role,
    }));
  }

  @UseGuards(AuthGuard)
  @Get('datasets/:id/deletion-preview')
  async datasetDeletionPreview(@Param('id') id: string, @Req() req: any) {
    const access = await getDatasetAccess(id, req.user.sub);
    if (!access) throw new NotFoundException('Dataset не найден');
    if (!canEditBoard(access.role)) throw new ForbiddenException();
    const count = async (sql: string) =>
      Number((await query(sql, [id])).rows[0].count);
    return {
      name: access.dataset_name,
      rows: await count(
        'SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',
      ),
      bindings: await count(
        'SELECT count(*) FROM object_bindings WHERE dataset_id=$1',
      ),
      relations: await count(
        'SELECT count(*) FROM dataset_relations WHERE deleted_at IS NULL AND (source_dataset_id=$1 OR target_dataset_id=$1)',
      ),
      views: await count(
        'SELECT count(*) FROM board_object_index WHERE dataset_id=$1',
      ),
    };
  }

  @UseGuards(AuthGuard)
  @Delete('datasets/:id')
  async deleteDataset(@Param('id') id: string, @Req() req: any) {
    const access = await getDatasetAccess(id, req.user.sub);
    if (!access) throw new NotFoundException('Dataset не найден');
    if (!canEditBoard(access.role)) throw new ForbiddenException();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      const deleted = await client.query(
        'UPDATE datasets SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',
        [id],
      );
      if (!deleted.rowCount) throw new NotFoundException('Dataset уже удалён');
      const relations = await client.query(
        'UPDATE dataset_relations SET deleted_at=now() WHERE deleted_at IS NULL AND (source_dataset_id=$1 OR target_dataset_id=$1) RETURNING id',
        [id],
      );
      const relationIds = relations.rows.map((row) => row.id);
      await client.query(
        "DELETE FROM object_bindings WHERE dataset_id=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(relation_path,'null'::jsonb),'[]'::jsonb)) path WHERE path.value=ANY($2::text[]))",
        [id, relationIds],
      );
      await client.query('DELETE FROM board_object_index WHERE dataset_id=$1', [
        id,
      ]);
      await client.query(
        'DELETE FROM collab_documents WHERE document_name=$1',
        [`dataset:${id}`],
      );
      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({
          kind: 'dataset-deleted',
          workspaceId: access.workspace_id,
          datasetId: id,
        }),
      ]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/datasets/:datasetId/locations')
  async datasetLocations(
    @Param('id') workspaceId: string,
    @Param('datasetId') datasetId: string,
    @Req() req: any,
  ): Promise<BoardDatasetLocation[]> {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const dataset = await query<{ id: string }>(
      `SELECT id
       FROM datasets
       WHERE deleted_at IS NULL AND id = $1 AND workspace_id = $2`,
      [datasetId, workspaceId],
    );

    if (!dataset.rows[0]) {
      throw new NotFoundException('Dataset not found in this workspace');
    }

    const result = await query<{
      board_id: string;
      board_name: string;
      object_id: string;
      object_type: string;
      dataset_id: string;
      row_id: string | null;
      column_id: string | null;
      properties: Record<string, unknown> | null;
    }>(
      `SELECT
         index.board_id,
         board.name AS board_name,
         index.object_id,
         index.object_type,
         index.dataset_id,
         index.row_id,
         index.column_id,
         index.properties
       FROM board_object_index AS index
       JOIN boards AS board
         ON board.id = index.board_id
       WHERE board.workspace_id = $1
         AND index.dataset_id = $2
       ORDER BY
         board.created_at,
         lower(board.name),
         index.object_type,
         index.object_id`,
      [workspaceId, datasetId],
    );

    return result.rows.map((row) => ({
      boardId: row.board_id,
      boardName: row.board_name,
      objectId: row.object_id,
      objectType: row.object_type,
      datasetId: row.dataset_id,
      rowId: row.row_id,
      columnId: row.column_id,
      properties: row.properties ?? undefined,
    }));
  }

  @UseGuards(AuthGuard)
  @Get('datasets/:id')
  async dataset(@Param('id') id: string, @Req() req: any) {
    const access = await getDatasetAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();

    return {
      id: access.dataset_id,
      workspaceId: access.workspace_id,
      name: access.dataset_name,
      kind: access.dataset_kind,
      role: access.role,
    };
  }

  @UseGuards(AuthGuard)
  @Put('datasets/:id')
  async renameDataset(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { name?: string },
  ) {
    const access = await getDatasetAccess(id, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    const name = body.name?.trim();
    if (!name || name.length > 120)
      throw new BadRequestException('Введите название от 1 до 120 символов');
    await query(
      'UPDATE datasets SET name=$2 WHERE id=$1 AND deleted_at IS NULL',
      [id, name],
    );
    await query("SELECT pg_notify('modelboard_resources',$1)", [
      JSON.stringify({
        kind: 'dataset-renamed',
        workspaceId: access.workspace_id,
        datasetId: id,
        name,
      }),
    ]);
    return { id, name };
  }

  @UseGuards(AuthGuard)
  @Get('datasets/:id/columns')
  async datasetColumns(@Param('id') id: string, @Req() req: any) {
    if (!(await getDatasetAccess(id, req.user.sub)))
      throw new ForbiddenException();
    return (
      await query(
        'SELECT id,name,data_type,ordinal,properties FROM dataset_columns WHERE dataset_id=$1 ORDER BY ordinal,id',
        [id],
      )
    ).rows.map((row) => ({
      id: row.id,
      name: row.name,
      dataType: row.data_type,
      ordinal: row.ordinal,
      ...(row.properties?.key ? { key: row.properties.key } : {}),
    }));
  }

  @UseGuards(AuthGuard)
  @Post('datasets/:id/columns')
  async createDatasetColumn(
    @Param('id') datasetId: string,
    @Req() req: any,
    @Body()
    body: {
      name?: string;
      dataType?: DatasetColumn['dataType'];
      afterColumnId?: string;
    },
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('Column name is required');
    }
    if (name.length > 120) {
      throw new BadRequestException('Column name is limited to 120 characters');
    }

    const dataType = body.dataType ?? 'TEXT';
    if (
      !['TEXT', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'UUID'].includes(
        dataType,
      )
    ) {
      throw new BadRequestException('Unsupported column data type');
    }

    const duplicate = await query<{ id: string }>(
      `SELECT id
       FROM dataset_columns
       WHERE dataset_id = $1 AND lower(name) = lower($2)
       LIMIT 1`,
      [datasetId, name],
    );
    if (duplicate.rows[0]) {
      throw new ConflictException('A column with this name already exists');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM datasets WHERE id = $1 FOR UPDATE', [
        datasetId,
      ]);

      let ordinal: number;

      if (body.afterColumnId) {
        const anchor = await client.query<{ ordinal: number }>(
          `SELECT ordinal
           FROM dataset_columns
           WHERE id = $1 AND dataset_id = $2`,
          [body.afterColumnId, datasetId],
        );

        if (!anchor.rows[0]) {
          throw new BadRequestException(
            'Anchor column does not belong to this dataset',
          );
        }

        ordinal = anchor.rows[0].ordinal + 1;

        await client.query(
          `UPDATE dataset_columns
           SET ordinal = -ordinal - 1000000
           WHERE dataset_id = $1 AND ordinal >= $2`,
          [datasetId, ordinal],
        );
        await client.query(
          `UPDATE dataset_columns
           SET ordinal = -ordinal - 999999
           WHERE dataset_id = $1 AND ordinal <= -1000000`,
          [datasetId],
        );
      } else {
        const ordinalResult = await client.query<{ ordinal: number }>(
          `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
           FROM dataset_columns
           WHERE dataset_id = $1`,
          [datasetId],
        );
        ordinal = ordinalResult.rows[0]?.ordinal ?? 0;
      }

      const column: DatasetColumn = {
        id: randomUUID(),
        name,
        dataType,
        ordinal,
      };

      await client.query(
        `INSERT INTO dataset_columns (
           id, dataset_id, name, data_type, ordinal, properties
         )
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
        [column.id, datasetId, column.name, column.dataType, column.ordinal],
      );

      await client.query('COMMIT');
      return column;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Put('datasets/:id/columns/:columnId')
  async renameDatasetColumn(
    @Param('id') datasetId: string,
    @Param('columnId') columnId: string,
    @Req() req: any,
    @Body() body: { name?: string },
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('Column name is required');
    }
    if (name.length > 120) {
      throw new BadRequestException('Column name is limited to 120 characters');
    }

    const duplicate = await query<{ id: string }>(
      `SELECT id
       FROM dataset_columns
       WHERE dataset_id = $1
         AND lower(name) = lower($2)
         AND id <> $3
       LIMIT 1`,
      [datasetId, name, columnId],
    );
    if (duplicate.rows[0]) {
      throw new ConflictException('A column with this name already exists');
    }

    const result = await query<{
      id: string;
      name: string;
      data_type: DatasetColumn['dataType'];
      ordinal: number;
      properties: { key?: 'PK' | 'FK' } | null;
    }>(
      `UPDATE dataset_columns
       SET name = $1
       WHERE id = $2 AND dataset_id = $3
       RETURNING id, name, data_type, ordinal, properties`,
      [name, columnId, datasetId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('Dataset column not found');
    }

    return {
      id: row.id,
      name: row.name,
      dataType: row.data_type,
      ordinal: row.ordinal,
      ...(row.properties?.key ? { key: row.properties.key } : {}),
    } satisfies DatasetColumn;
  }

  @UseGuards(AuthGuard)
  @Put('datasets/:id/columns/:columnId/type')
  async convertDatasetColumn(
    @Param('id') datasetId: string,
    @Param('columnId') columnId: string,
    @Req() req: any,
    @Body() body: ConvertDatasetColumnInput,
  ): Promise<ConvertDatasetColumnResult> {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const allowedTypes: DatasetColumn['dataType'][] = [
      'TEXT',
      'INTEGER',
      'NUMBER',
      'BOOLEAN',
      'DATE',
      'UUID',
    ];
    if (!allowedTypes.includes(body.dataType)) {
      throw new BadRequestException('Unsupported column data type');
    }

    const columnResult = await query<{
      id: string;
      name: string;
      data_type: DatasetColumn['dataType'];
      ordinal: number;
      properties: { key?: 'PK' | 'FK' } | null;
    }>(
      `SELECT id, name, data_type, ordinal, properties
       FROM dataset_columns
       WHERE id = $1 AND dataset_id = $2`,
      [columnId, datasetId],
    );

    const currentColumn = columnResult.rows[0];
    if (!currentColumn) {
      throw new NotFoundException('Dataset column not found');
    }

    if (currentColumn.data_type !== body.dataType) {
      const relation = await query<{ id: string }>(
        `SELECT id
         FROM dataset_relations
         WHERE deleted_at IS NULL AND (source_column_id = $1 OR target_column_id = $1)
         LIMIT 1`,
        [columnId],
      );

      if (relation.rows[0]) {
        throw new ConflictException(
          'Column participates in a dataset relation. Remove the relation before changing its type.',
        );
      }
    }

    const rows = await query<{ id: string }>(
      `SELECT id
       FROM dataset_rows
       WHERE dataset_id = $1
       ORDER BY ordinal, id`,
      [datasetId],
    );

    const rowIds = rows.rows.map((row) => row.id);
    const suppliedIds = Object.keys(body.values ?? {});

    if (
      suppliedIds.length !== rowIds.length ||
      suppliedIds.some((rowId) => !rowIds.includes(rowId))
    ) {
      throw new BadRequestException(
        'Conversion values must contain exactly all rows of the dataset',
      );
    }

    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );

    const isIsoDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    };

    for (const [rowId, value] of Object.entries(body.values ?? {})) {
      if (value === null) continue;

      const valid =
        body.dataType === 'TEXT'
          ? typeof value === 'string'
          : body.dataType === 'INTEGER'
            ? typeof value === 'number' && Number.isSafeInteger(value)
            : body.dataType === 'NUMBER'
              ? typeof value === 'number' && Number.isFinite(value)
              : body.dataType === 'BOOLEAN'
                ? typeof value === 'boolean'
                : body.dataType === 'DATE'
                  ? typeof value === 'string' && isIsoDate(value)
                  : typeof value === 'string' && isUuid(value);

      if (!valid) {
        throw new BadRequestException(
          `Converted value for row ${rowId} is invalid for ${body.dataType}`,
        );
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      await client.query('SELECT id FROM datasets WHERE id = $1 FOR UPDATE', [
        datasetId,
      ]);

      const updated = await client.query<{
        id: string;
        name: string;
        data_type: DatasetColumn['dataType'];
        ordinal: number;
        properties: { key?: 'PK' | 'FK' } | null;
      }>(
        `UPDATE dataset_columns
         SET data_type = $1
         WHERE id = $2 AND dataset_id = $3
         RETURNING id, name, data_type, ordinal, properties`,
        [body.dataType, columnId, datasetId],
      );

      for (const rowId of rowIds) {
        await client.query(
          `UPDATE dataset_rows
           SET values = jsonb_set(
             values,
             ARRAY[$2]::text[],
             $3::jsonb,
             true
           )
           WHERE id = $1 AND dataset_id = $4`,
          [
            rowId,
            columnId,
            JSON.stringify(body.values[rowId] ?? null),
            datasetId,
          ],
        );
      }

      try {
        await assertDatasetRelations(
          client,
          datasetId,
          (
            await client.query(
              'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1',
              [datasetId],
            )
          ).rows,
        );
      } catch (error) {
        throw new ConflictException((error as Error).message);
      }
      await client.query('COMMIT');

      const row = updated.rows[0];
      return {
        column: {
          id: row.id,
          name: row.name,
          dataType: row.data_type,
          ordinal: row.ordinal,
          ...(row.properties?.key ? { key: row.properties.key } : {}),
        },
        values: body.values,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Delete('datasets/:id/columns/:columnId')
  async deleteDatasetColumn(
    @Param('id') datasetId: string,
    @Param('columnId') columnId: string,
    @Req() req: any,
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const columnCount = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM dataset_columns WHERE dataset_id = $1',
      [datasetId],
    );
    if (Number(columnCount.rows[0]?.count ?? 0) <= 1) {
      throw new ConflictException(
        'В Dataset должна остаться хотя бы одна колонка',
      );
    }

    const relation = await query<{ id: string }>(
      `SELECT id
       FROM dataset_relations
       WHERE deleted_at IS NULL AND (source_column_id = $1 OR target_column_id = $1)
       LIMIT 1`,
      [columnId],
    );
    if (relation.rows[0]) {
      throw new ConflictException(
        'Колонка используется в связи данных. Сначала измените или удалите связь.',
      );
    }

    const formula = await query<{ row_id: string }>(
      `SELECT row_id
       FROM dataset_formulas
       WHERE dataset_id = $1
         AND (
           column_id = $2 OR
           position('@{' || $2::text || '}' in expression) > 0
         )
       LIMIT 1`,
      [datasetId, columnId],
    );
    if (formula.rows[0]) {
      throw new ConflictException(
        'Колонка используется в формуле. Сначала измените или удалите формулу.',
      );
    }

    const binding = await query<{ id: string }>(
      `SELECT id
       FROM object_bindings
       WHERE column_id = $1
          OR presentation ->> 'titleColumnId' = $1::text
          OR presentation ->> 'subtitleColumnId' = $1::text
          OR presentation ->> 'statusColumnId' = $1::text
          OR presentation -> 'fieldColumnIds' ? $1::text
       LIMIT 1`,
      [columnId],
    );
    if (binding.rows[0]) {
      throw new ConflictException(
        'Колонка используется в привязке объекта. Измените или удалите привязку.',
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      if (
        (
          await client.query(
            'SELECT id FROM dataset_relations WHERE deleted_at IS NULL AND (source_column_id=$1 OR target_column_id=$1)',
            [columnId],
          )
        ).rowCount
      )
        throw new ConflictException('Колонка используется активной связью');

      const deleted = await client.query<{ id: string }>(
        `DELETE FROM dataset_columns
         WHERE id = $1 AND dataset_id = $2
         RETURNING id`,
        [columnId, datasetId],
      );

      if (!deleted.rows[0]) {
        throw new NotFoundException('Dataset column not found');
      }

      await client.query(
        `UPDATE dataset_rows
         SET values = values - $2
         WHERE dataset_id = $1`,
        [datasetId, columnId],
      );

      await client.query('COMMIT');
      return { ok: true as const };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Post('datasets/:id/rows/batch')
  async createDatasetRows(
    @Param('id') datasetId: string,
    @Req() req: any,
    @Body()
    body: { rows: Array<{ id: string; values?: DatasetRow['values'] }> },
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    if (
      !Array.isArray(body.rows) ||
      body.rows.length < 1 ||
      body.rows.length > 10000
    )
      throw new BadRequestException('Expected 1–10000 rows');
    const ids = new Set<string>();
    for (const row of body.rows) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          row.id,
        ) ||
        ids.has(row.id)
      )
        throw new BadRequestException('Row IDs must be unique UUIDs');
      ids.add(row.id);
    }
    const columns = await query<{ id: string }>(
      'SELECT id FROM dataset_columns WHERE dataset_id=$1',
      [datasetId],
    );
    const columnIds = new Set(columns.rows.map((column) => column.id));
    for (const row of body.rows)
      if (Object.keys(row.values ?? {}).some((id) => !columnIds.has(id)))
        throw new BadRequestException('Unknown column');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      await client.query('SELECT id FROM datasets WHERE id=$1 FOR UPDATE', [
        datasetId,
      ]);
      const first = Number(
        (
          await client.query(
            'SELECT COALESCE(MAX(ordinal),-1)+1 AS ordinal FROM dataset_rows WHERE dataset_id=$1',
            [datasetId],
          )
        ).rows[0].ordinal,
      );
      const rows = body.rows.map((row, index) => ({
        id: row.id,
        ordinal: first + index,
        values: row.values ?? {},
      }));
      try {
        await assertDatasetRelations(client, datasetId, [
          ...(
            await client.query(
              'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1',
              [datasetId],
            )
          ).rows,
          ...rows,
        ]);
      } catch (error) {
        throw new ConflictException((error as Error).message);
      }
      await client.query(
        `INSERT INTO dataset_rows(id,dataset_id,ordinal,values) SELECT id,$1,ordinal,values FROM jsonb_to_recordset($2::jsonb) AS data(id uuid,ordinal integer,values jsonb)`,
        [datasetId, JSON.stringify(rows)],
      );
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Post('datasets/:id/rows')
  async createDatasetRow(
    @Param('id') datasetId: string,
    @Req() req: any,
    @Body()
    body: {
      values?: DatasetRow['values'];
      afterRowId?: string;
    },
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const values = body.values ?? {};
    const columns = await query<{ id: string }>(
      'SELECT id FROM dataset_columns WHERE dataset_id = $1',
      [datasetId],
    );
    const columnIds = new Set(columns.rows.map((column) => column.id));

    const unknownColumn = Object.keys(values).find(
      (columnId) => !columnIds.has(columnId),
    );
    if (unknownColumn) {
      throw new BadRequestException(
        `Row references an unknown column: ${unknownColumn}`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      await client.query('SELECT id FROM datasets WHERE id = $1 FOR UPDATE', [
        datasetId,
      ]);

      let ordinal: number;

      if (body.afterRowId) {
        const anchor = await client.query<{ ordinal: number }>(
          `SELECT ordinal
           FROM dataset_rows
           WHERE id = $1 AND dataset_id = $2`,
          [body.afterRowId, datasetId],
        );

        if (!anchor.rows[0]) {
          throw new BadRequestException(
            'Anchor row does not belong to this dataset',
          );
        }

        ordinal = anchor.rows[0].ordinal + 1;

        await client.query(
          `UPDATE dataset_rows
           SET ordinal = -ordinal - 1000000
           WHERE dataset_id = $1 AND ordinal >= $2`,
          [datasetId, ordinal],
        );
        await client.query(
          `UPDATE dataset_rows
           SET ordinal = -ordinal - 999999
           WHERE dataset_id = $1 AND ordinal <= -1000000`,
          [datasetId],
        );
      } else {
        const ordinalResult = await client.query<{ ordinal: number }>(
          `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
           FROM dataset_rows
           WHERE dataset_id = $1`,
          [datasetId],
        );
        ordinal = ordinalResult.rows[0]?.ordinal ?? 0;
      }

      const row: DatasetRow = {
        id: randomUUID(),
        ordinal,
        values,
      };

      await client.query(
        `INSERT INTO dataset_rows (id, dataset_id, ordinal, values)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [row.id, datasetId, row.ordinal, JSON.stringify(row.values)],
      );

      try {
        await assertDatasetRelations(
          client,
          datasetId,
          (
            await client.query(
              'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1',
              [datasetId],
            )
          ).rows,
        );
      } catch (error) {
        throw new ConflictException((error as Error).message);
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Delete('datasets/:id/rows/:rowId')
  async deleteDatasetRow(
    @Param('id') datasetId: string,
    @Param('rowId') rowId: string,
    @Req() req: any,
  ) {
    const access = await getDatasetAccess(datasetId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const binding = await query<{ id: string }>(
      `SELECT id
       FROM object_bindings
       WHERE row_id = $1
       LIMIT 1`,
      [rowId],
    );

    if (binding.rows[0]) {
      throw new ConflictException(
        'Row is used by an object binding. Unbind the canvas object first.',
      );
    }

    const formulaReference = await query<{ row_id: string }>(
      `SELECT row_id
       FROM dataset_formulas
       WHERE dataset_id = $1
         AND row_id <> $2
         AND position('#{' || $2::text || '}' in expression) > 0
       LIMIT 1`,
      [datasetId, rowId],
    );

    if (formulaReference.rows[0]) {
      throw new ConflictException(
        'Row is referenced by another formula. Change the formula before deleting this row.',
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [access.workspace_id],
      );
      const remaining = (
        await client.query(
          'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1 AND id<>$2',
          [datasetId, rowId],
        )
      ).rows;
      try {
        await assertDatasetRelations(client, datasetId, remaining);
      } catch (error) {
        throw new ConflictException(
          error instanceof Error
            ? error.message
            : 'Нарушение целостности связи',
        );
      }
      const result = await client.query(
        'DELETE FROM dataset_rows WHERE id=$1 AND dataset_id=$2 RETURNING id',
        [rowId, datasetId],
      );
      if (!result.rowCount) throw new NotFoundException('Строка не найдена');
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/datasets')
  async createDataset(
    @Param('id') workspaceId: string,
    @Req() req: any,
    @Body() body: CreateDatasetInput,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role))
      throw new ForbiddenException('Edit permission required');

    const datasetId = randomUUID();
    const name = body.name?.trim() || 'untitled_dataset';
    const kind = body.kind ?? 'MANUAL';

    if (name.length > 120) {
      throw new BadRequestException(
        'Dataset name is limited to 120 characters',
      );
    }

    if (!['MANUAL', 'CSV', 'SQL', 'API'].includes(kind)) {
      throw new BadRequestException('Unsupported dataset kind');
    }

    if ((body.columns?.length ?? 0) > 100) {
      throw new BadRequestException(
        'Dataset is limited to 100 columns in this MVP',
      );
    }

    if ((body.rows?.length ?? 0) > 2000) {
      throw new BadRequestException(
        'Dataset is limited to 2000 rows in this MVP',
      );
    }

    const suppliedColumns = body.columns?.length
      ? body.columns
      : [
          { name: 'name', dataType: 'TEXT' as const },
          { name: 'description', dataType: 'TEXT' as const },
        ];

    const columns: DatasetColumn[] = suppliedColumns.map((column, index) => ({
      id: column.id ?? randomUUID(),
      name: column.name,
      dataType: column.dataType ?? 'TEXT',
      key: column.key,
      ordinal: column.ordinal ?? index,
    }));

    const defaultRows: DatasetRow[] = [
      {
        id: randomUUID(),
        ordinal: 0,
        values: {
          [columns[0].id]: body.columns?.length ? 1 : 'Первая запись',
          ...(columns[1]
            ? { [columns[1].id]: body.columns?.length ? 'First row' : '' }
            : {}),
          ...(columns[2] ? { [columns[2].id]: 1 } : {}),
        },
      },
      {
        id: randomUUID(),
        ordinal: 1,
        values: {
          [columns[0].id]: body.columns?.length ? 2 : 'Вторая запись',
          ...(columns[1]
            ? { [columns[1].id]: body.columns?.length ? 'Second row' : '' }
            : {}),
          ...(columns[2] ? { [columns[2].id]: 2 } : {}),
        },
      },
    ];

    const rows: DatasetRow[] = body.rows?.length
      ? body.rows.map((row, index) => ({
          id: row.id ?? randomUUID(),
          ordinal: row.ordinal ?? index,
          values: row.values,
        }))
      : defaultRows;

    const columnIds = new Set(columns.map((column) => column.id));
    for (const row of rows) {
      const unknownColumn = Object.keys(row.values).find(
        (columnId) => !columnIds.has(columnId),
      );
      if (unknownColumn) {
        throw new BadRequestException(
          `Row references an unknown column: ${unknownColumn}`,
        );
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO datasets (id, workspace_id, name, kind, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [datasetId, workspaceId, name, kind, req.user.sub],
      );

      for (const column of columns) {
        await client.query(
          `INSERT INTO dataset_columns (id, dataset_id, name, data_type, ordinal, properties)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            column.id,
            datasetId,
            column.name,
            column.dataType,
            column.ordinal,
            JSON.stringify(column.key ? { key: column.key } : {}),
          ],
        );
      }

      for (const row of rows) {
        await client.query(
          `INSERT INTO dataset_rows (id, dataset_id, ordinal, values)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [row.id, datasetId, row.ordinal, JSON.stringify(row.values)],
        );
      }

      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({ kind: 'dataset-created', workspaceId, datasetId }),
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      id: datasetId,
      workspaceId,
      name,
      kind,
      role: access.role,
    };
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/search')
  async searchWorkspace(
    @Param('id') workspaceId: string,
    @Query('q') queryText: string | undefined,
    @Req() req: any,
  ): Promise<WorkspaceSearchResult[]> {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const term = queryText?.trim();
    if (!term || term.length < 2) {
      return [];
    }

    const result = await query<{
      kind: 'BOARD' | 'DATASET' | 'OBJECT';
      id: string;
      title: string;
      subtitle: string;
      board_id: string | null;
      board_name: string | null;
      object_id: string | null;
      object_type: string | null;
      dataset_id: string | null;
      row_id: string | null;
      column_id: string | null;
      rank: number;
    }>(
      `
      SELECT *
      FROM (
        SELECT
          'BOARD'::text AS kind,
          board.id::text AS id,
          board.name AS title,
          'Board'::text AS subtitle,
          board.id AS board_id,
          board.name AS board_name,
          NULL::text AS object_id,
          NULL::text AS object_type,
          NULL::uuid AS dataset_id,
          NULL::uuid AS row_id,
          NULL::uuid AS column_id,
          1 AS rank
        FROM boards AS board
        WHERE board.workspace_id = $1
          AND position(lower($2) in lower(board.name)) > 0

        UNION ALL

        SELECT
          'DATASET'::text AS kind,
          dataset.id::text AS id,
          dataset.name AS title,
          ('Dataset · ' || dataset.kind)::text AS subtitle,
          NULL::uuid AS board_id,
          NULL::text AS board_name,
          NULL::text AS object_id,
          NULL::text AS object_type,
          dataset.id AS dataset_id,
          NULL::uuid AS row_id,
          NULL::uuid AS column_id,
          2 AS rank
        FROM datasets AS dataset
        WHERE dataset.deleted_at IS NULL AND dataset.workspace_id = $1
          AND position(lower($2) in lower(dataset.name)) > 0

        UNION ALL

        SELECT
          'OBJECT'::text AS kind,
          (
            object_index.board_id::text ||
            ':' ||
            object_index.object_id
          ) AS id,
          COALESCE(
            NULLIF(object_index.properties ->> 'label', ''),
            NULLIF(object_index.properties ->> 'text', ''),
            dataset.name,
            object_index.object_type
          ) AS title,
          (
            board.name ||
            ' · ' ||
            object_index.object_type ||
            CASE
              WHEN dataset.name IS NOT NULL
                THEN ' · ' || dataset.name
              ELSE ''
            END
          )::text AS subtitle,
          object_index.board_id,
          board.name AS board_name,
          object_index.object_id,
          object_index.object_type,
          object_index.dataset_id,
          object_index.row_id,
          object_index.column_id,
          3 AS rank
        FROM board_object_index AS object_index
        JOIN boards AS board
          ON board.id = object_index.board_id
        LEFT JOIN datasets AS dataset
          ON dataset.id = object_index.dataset_id
        LEFT JOIN dataset_rows AS row
          ON row.id = object_index.row_id
        WHERE board.workspace_id = $1
          AND (
            position(
              lower($2)
              in lower(object_index.properties::text)
            ) > 0
            OR position(
              lower($2)
              in lower(COALESCE(dataset.name, ''))
            ) > 0
            OR position(
              lower($2)
              in lower(COALESCE(row.values::text, ''))
            ) > 0
            OR position(
              lower($2)
              in lower(object_index.object_type)
            ) > 0
          )
      ) AS matches
      ORDER BY rank, lower(title), id
      LIMIT 50
      `,
      [workspaceId, term],
    );

    return result.rows.map((row) => {
      if (row.kind === 'BOARD') {
        return {
          kind: 'BOARD' as const,
          id: row.id,
          title: row.title,
          subtitle: row.subtitle,
          boardId: row.board_id!,
        };
      }

      if (row.kind === 'DATASET') {
        return {
          kind: 'DATASET' as const,
          id: row.id,
          title: row.title,
          subtitle: row.subtitle,
          datasetId: row.dataset_id!,
        };
      }

      return {
        kind: 'OBJECT' as const,
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        boardId: row.board_id!,
        boardName: row.board_name!,
        objectId: row.object_id!,
        objectType: row.object_type!,
        datasetId: row.dataset_id,
        rowId: row.row_id,
        columnId: row.column_id,
      };
    });
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/templates')
  async objectTemplates(@Param('id') workspaceId: string, @Req() req: any) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query<{
      id: string;
      workspace_id: string;
      name: string;
      template_kind: 'SVG';
      svg: string;
      default_width: number;
      default_height: number;
      properties: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT id, workspace_id, name, template_kind, svg,
              default_width, default_height, properties, created_at
       FROM object_templates
       WHERE workspace_id = $1
       ORDER BY lower(name), created_at`,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      kind: row.template_kind,
      svg: row.svg,
      defaultWidth: row.default_width,
      defaultHeight: row.default_height,
      properties: row.properties ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/templates')
  async createObjectTemplate(
    @Param('id') workspaceId: string,
    @Req() req: any,
    @Body() body: CreateWorkspaceObjectTemplateInput,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('Template name is required');
    }
    if (name.length > 120) {
      throw new BadRequestException(
        'Template name is limited to 120 characters',
      );
    }

    let svg: string;
    try {
      svg = validateWorkspaceSvg(body.svg);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }

    const defaultWidth = Math.round(body.defaultWidth ?? 220);
    const defaultHeight = Math.round(body.defaultHeight ?? 130);

    if (
      defaultWidth < 48 ||
      defaultWidth > 1600 ||
      defaultHeight < 48 ||
      defaultHeight > 1200
    ) {
      throw new BadRequestException(
        'Template dimensions must be between 48 and 1600x1200',
      );
    }

    const templateId = randomUUID();

    try {
      const result = await query<{
        id: string;
        workspace_id: string;
        name: string;
        template_kind: 'SVG';
        svg: string;
        default_width: number;
        default_height: number;
        properties: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `INSERT INTO object_templates (
           id, workspace_id, name, template_kind, svg,
           default_width, default_height, properties, created_by
         )
         VALUES ($1,$2,$3,'SVG',$4,$5,$6,$7::jsonb,$8)
         RETURNING id, workspace_id, name, template_kind, svg,
                   default_width, default_height, properties, created_at`,
        [
          templateId,
          workspaceId,
          name,
          svg,
          defaultWidth,
          defaultHeight,
          JSON.stringify(body.properties ?? {}),
          req.user.sub,
        ],
      );

      const row = result.rows[0];
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        kind: row.template_kind,
        svg: row.svg,
        defaultWidth: row.default_width,
        defaultHeight: row.default_height,
        properties: row.properties ?? undefined,
        createdAt: row.created_at.toISOString(),
      };
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new BadRequestException(
          'A template with this name already exists in the workspace',
        );
      }
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Delete('workspaces/:id/templates/:templateId')
  async deleteObjectTemplate(
    @Param('id') workspaceId: string,
    @Param('templateId') templateId: string,
    @Req() req: any,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const result = await query(
      'DELETE FROM object_templates WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [templateId, workspaceId],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('Template not found');
    }

    return { ok: true as const };
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/relations')
  async relations(@Param('id') workspaceId: string, @Req() req: any) {
    if (!(await getWorkspaceAccess(workspaceId, req.user.sub)))
      throw new ForbiddenException();
    return (
      await query(
        `SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceRowId',source_row_id,'targetRowId',target_row_id)) FROM dataset_relation_links WHERE relation_id=r.id),'[]'::jsonb) AS links FROM dataset_relations r WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,
        [workspaceId],
      )
    ).rows.map(relationFromSql);
  }

  private async saveRelation(
    workspaceId: string,
    userId: string,
    body: CreateDatasetRelationInput,
    relationId?: string,
  ) {
    const access = await getWorkspaceAccess(workspaceId, userId);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    if (
      body.matchMode !== undefined &&
      !['FIELDS', 'ROW_LINKS'].includes(body.matchMode)
    )
      throw new BadRequestException('Выберите способ связи');
    if (
      !['REFERENCE', 'FOREIGN_KEY', 'DEPENDENCY', 'MAP', 'FLOW'].includes(
        body.relationType,
      ) ||
      (body.cardinality != null &&
        !['1:1', '1:N', 'N:1', 'N:M'].includes(body.cardinality))
    )
      throw new BadRequestException(
        'Некорректный тип связи или кардинальность',
      );
    if (
      [
        body.sourceDatasetId,
        ...(body.matchMode === 'ROW_LINKS'
          ? []
          : [body.sourceColumnId, body.targetColumnId]),
        body.targetDatasetId,
      ].some(
        (id) =>
          !id ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      throw new BadRequestException('Выберите таблицы и поля связи');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspaceId],
      );
      if (
        relationId &&
        !(
          await client.query(
            'SELECT id FROM dataset_relations WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL',
            [relationId, workspaceId],
          )
        ).rowCount
      )
        throw new NotFoundException('Связь не найдена');
      if (body.matchMode === 'ROW_LINKS') {
        if (
          (
            await client.query(
              'SELECT id FROM datasets WHERE id=ANY($1::uuid[]) AND workspace_id=$2 AND deleted_at IS NULL',
              [
                [...new Set([body.sourceDatasetId, body.targetDatasetId])],
                workspaceId,
              ],
            )
          ).rowCount !==
          new Set([body.sourceDatasetId, body.targetDatasetId]).size
        )
          throw new BadRequestException('Выберите доступные таблицы');
        body.sourceColumnId = '__row__';
        body.targetColumnId = '__row__';
        if (
          (!relationId && body.links === undefined) ||
          (body.links !== undefined &&
            (!Array.isArray(body.links) ||
              body.links.length > 10000 ||
              body.links.some(
                (link) =>
                  !link ||
                  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    link.sourceRowId,
                  ) ||
                  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    link.targetRowId,
                  ),
              )))
        )
          throw new BadRequestException('Выберите записи для связи');
        if (body.links)
          body.links = Array.from(
            new Map(
              body.links.map((link) => [
                link.sourceRowId + link.targetRowId,
                link,
              ]),
            ).values(),
          );
      } else {
        const endpoints = await client.query(
          `SELECT sc.data_type AS source_type,tc.data_type AS target_type FROM datasets sd JOIN dataset_columns sc ON sc.dataset_id=sd.id AND sc.id=$2 JOIN datasets td ON td.id=$3 JOIN dataset_columns tc ON tc.dataset_id=td.id AND tc.id=$4 WHERE sd.id=$5 AND sd.workspace_id=$1 AND td.workspace_id=$1 AND sd.deleted_at IS NULL AND td.deleted_at IS NULL`,
          [
            workspaceId,
            body.sourceColumnId,
            body.targetDatasetId,
            body.targetColumnId,
            body.sourceDatasetId,
          ],
        );
        if (!endpoints.rows[0])
          throw new BadRequestException(
            'Таблицы и поля должны принадлежать этому Workspace',
          );
        const types = endpoints.rows[0];
        const numeric = (type: string) => ['NUMBER', 'INTEGER'].includes(type);
        if (
          types.source_type !== types.target_type &&
          !(numeric(types.source_type) && numeric(types.target_type))
        )
          throw new ConflictException('Типы ключевых полей несовместимы');
      }
      if (
        relationId &&
        (
          await client.query(
            'SELECT id FROM object_bindings WHERE relation_path @> $1::jsonb AND NOT(dataset_id=ANY($2::uuid[])) LIMIT 1',
            [
              JSON.stringify([relationId]),
              [body.sourceDatasetId, body.targetDatasetId],
            ],
          )
        ).rowCount
      )
        throw new ConflictException(
          'Relation View использует прежний Dataset. Удалите его представление перед сменой конца связи.',
        );
      const existingRelations = await client.query(
        'SELECT * FROM dataset_relations WHERE workspace_id=$1 AND deleted_at IS NULL AND id<>$2',
        [workspaceId, relationId ?? '00000000-0000-0000-0000-000000000000'],
      );
      if (
        existingRelations.rows.some((row) =>
          sameRelationEndpoints(body, relationFromSql(row)),
        )
      )
        throw new ConflictException(
          'Такая связь уже существует, в том числе в обратном направлении. Откройте «Связи таблицы» для её настройки или выберите «Использовать связь», чтобы добавить пары записей.',
        );
      const relation = {
        ...body,
        id: relationId ?? randomUUID(),
        workspaceId,
        name: String(body.name ?? '')
          .trim()
          .slice(0, 120),
        enforceIntegrity:
          body.matchMode === 'ROW_LINKS' ||
          body.relationType === 'FOREIGN_KEY' ||
          Boolean(body.enforceIntegrity),
      };
      const report = await validateSqlRelation(client, relation);
      if (relation.enforceIntegrity && !report.valid)
        throw new ConflictException(report.issues.join('; '));
      await client.query(
        `INSERT INTO dataset_relations(id,workspace_id,source_dataset_id,source_column_id,target_dataset_id,target_column_id,relation_type,cardinality,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(id) DO UPDATE SET source_dataset_id=EXCLUDED.source_dataset_id,source_column_id=EXCLUDED.source_column_id,target_dataset_id=EXCLUDED.target_dataset_id,target_column_id=EXCLUDED.target_column_id,relation_type=EXCLUDED.relation_type,cardinality=EXCLUDED.cardinality,properties=EXCLUDED.properties`,
        [
          relation.id,
          workspaceId,
          relation.sourceDatasetId,
          relation.matchMode === 'ROW_LINKS' ? null : relation.sourceColumnId,
          relation.targetDatasetId,
          relation.matchMode === 'ROW_LINKS' ? null : relation.targetColumnId,
          relation.relationType,
          relation.cardinality ?? null,
          JSON.stringify({
            name: relation.name,
            matchMode: relation.matchMode ?? 'FIELDS',
            enforceIntegrity: relation.enforceIntegrity,
          }),
        ],
      );
      await client.query(
        'DELETE FROM dataset_relation_links WHERE relation_id=$1',
        [relation.id],
      );
      if (relation.matchMode === 'ROW_LINKS' && relation.links?.length)
        await client.query(
          `INSERT INTO dataset_relation_links(relation_id,source_row_id,target_row_id) SELECT $1,source_row_id,target_row_id FROM jsonb_to_recordset($2::jsonb) AS links(source_row_id uuid,target_row_id uuid)`,
          [
            relation.id,
            JSON.stringify(
              relation.links.map((link) => ({
                source_row_id: link.sourceRowId,
                target_row_id: link.targetRowId,
              })),
            ),
          ],
        );
      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({
          kind: 'relation-changed',
          workspaceId,
          relationId: relation.id,
        }),
      ]);
      await client.query('COMMIT');
      return relation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/relations')
  async createRelation(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: CreateDatasetRelationInput,
  ) {
    return this.saveRelation(id, req.user.sub, body);
  }

  @UseGuards(AuthGuard)
  @Put('workspaces/:id/relations/:relationId')
  async updateRelation(
    @Param('id') id: string,
    @Param('relationId') relationId: string,
    @Req() req: any,
    @Body() body: CreateDatasetRelationInput,
  ) {
    return this.saveRelation(id, req.user.sub, body, relationId);
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/relations/:relationId/links')
  async changeRecordLink(
    @Param('id') workspaceId: string,
    @Param('relationId') relationId: string,
    @Req() req: any,
    @Body()
    body: {
      sourceRowId?: string;
      targetRowId?: string;
      links?: Array<{ sourceRowId: string; targetRowId: string }>;
      remove?: boolean;
    },
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    const pairs = body.links ?? [
      { sourceRowId: body.sourceRowId!, targetRowId: body.targetRowId! },
    ];
    if (
      !Array.isArray(pairs) ||
      !pairs.length ||
      pairs.length > 10000 ||
      pairs.some(
        (pair) =>
          !pair ||
          [pair.sourceRowId, pair.targetRowId].some(
            (id) =>
              typeof id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                id,
              ),
          ),
      )
    )
      throw new BadRequestException('Выберите две записи');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspaceId],
      );
      const result = await client.query(
        'SELECT * FROM dataset_relations WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL',
        [relationId, workspaceId],
      );
      if (!result.rows[0]) throw new NotFoundException();
      const relation = relationFromSql(result.rows[0]);
      if (relation.matchMode !== 'ROW_LINKS')
        throw new BadRequestException(
          'Эта связь сопоставляет поля автоматически',
        );
      relation.links = (
        await client.query(
          'SELECT source_row_id AS "sourceRowId",target_row_id AS "targetRowId" FROM dataset_relation_links WHERE relation_id=$1',
          [relationId],
        )
      ).rows;
      relation.links = relation.links!.filter(
        (pair) =>
          !pairs.some(
            (change) =>
              pair.sourceRowId === change.sourceRowId &&
              pair.targetRowId === change.targetRowId,
          ),
      );
      if (!body.remove)
        relation.links = Array.from(
          new Map(
            [...relation.links, ...pairs].map((pair) => [
              pair.sourceRowId + pair.targetRowId,
              pair,
            ]),
          ).values(),
        );
      const report = await validateSqlRelation(client, relation);
      if (!report.valid) throw new ConflictException(report.issues.join('; '));
      for (const pair of pairs) {
        if (body.remove)
          await client.query(
            'DELETE FROM dataset_relation_links WHERE relation_id=$1 AND source_row_id=$2 AND target_row_id=$3',
            [relationId, pair.sourceRowId, pair.targetRowId],
          );
        else
          await client.query(
            'INSERT INTO dataset_relation_links(relation_id,source_row_id,target_row_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [relationId, pair.sourceRowId, pair.targetRowId],
          );
      }
      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({ kind: 'relation-changed', workspaceId, relationId }),
      ]);
      await client.query('COMMIT');
      return relation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Get('workspaces/:id/relations/:relationId/validation')
  async validateRelation(
    @Param('id') id: string,
    @Param('relationId') relationId: string,
    @Req() req: any,
  ) {
    if (!(await getWorkspaceAccess(id, req.user.sub)))
      throw new ForbiddenException();
    const result = await query(
      'SELECT * FROM dataset_relations WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL',
      [relationId, id],
    );
    if (!result.rows[0]) throw new NotFoundException();
    return validateSqlRelation(pool, relationFromSql(result.rows[0]));
  }

  @UseGuards(AuthGuard)
  @Delete('workspaces/:id/relations/:relationId')
  async deleteRelation(
    @Param('id') workspaceId: string,
    @Param('relationId') relationId: string,
    @Req() req: any,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access || !canEditBoard(access.role)) throw new ForbiddenException();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [workspaceId],
      );
      const result = await client.query(
        'UPDATE dataset_relations SET deleted_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING id',
        [relationId, workspaceId],
      );
      if (!result.rowCount) throw new NotFoundException();
      await client.query(
        'DELETE FROM object_bindings WHERE relation_path @> $1::jsonb',
        [JSON.stringify([relationId])],
      );
      await client.query("SELECT pg_notify('modelboard_resources',$1)", [
        JSON.stringify({
          kind: 'relation-deleted',
          workspaceId,
          relationIds: [relationId],
        }),
      ]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @UseGuards(AuthGuard)
  @Get('boards/:id/objects/:objectId/binding')
  async objectBinding(
    @Param('id') boardId: string,
    @Param('objectId') objectId: string,
    @Req() req: any,
  ) {
    const access = await getBoardAccess(boardId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query<{
      id: string;
      board_id: string;
      board_object_id: string;
      binding_type: 'DATASET' | 'ROW' | 'COLUMN' | 'CELL' | 'RELATION_VIEW';
      dataset_id: string;
      row_id: string | null;
      column_id: string | null;
      relation_path: string[] | null;
      presentation: Record<string, unknown> | null;
    }>(
      `SELECT id, board_id, board_object_id, binding_type, dataset_id,
              row_id, column_id, relation_path, presentation
       FROM object_bindings
       WHERE board_id = $1 AND board_object_id = $2
       LIMIT 1`,
      [boardId, objectId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      boardId: row.board_id,
      boardObjectId: row.board_object_id,
      type: row.binding_type,
      datasetId: row.dataset_id,
      rowId: row.row_id ?? undefined,
      columnId: row.column_id ?? undefined,
      relationPath: row.relation_path ?? undefined,
      presentation: row.presentation ?? undefined,
    };
  }

  @UseGuards(AuthGuard)
  @Put('boards/:id/objects/:objectId/binding')
  async upsertObjectBinding(
    @Param('id') boardId: string,
    @Param('objectId') objectId: string,
    @Req() req: any,
    @Body() body: UpsertObjectBindingInput,
  ) {
    const access = await getBoardAccess(boardId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    if (
      !['DATASET', 'ROW', 'COLUMN', 'CELL', 'RELATION_VIEW'].includes(body.type)
    ) {
      throw new BadRequestException('Unsupported binding type');
    }

    if (['ROW', 'CELL', 'RELATION_VIEW'].includes(body.type) && !body.rowId)
      throw new BadRequestException('Выберите строку');
    if (['COLUMN', 'CELL'].includes(body.type) && !body.columnId)
      throw new BadRequestException('Выберите поле');
    const isId = (value: unknown) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      );
    if (
      !isId(body.datasetId) ||
      (body.rowId && !isId(body.rowId)) ||
      (body.columnId && !isId(body.columnId)) ||
      (body.relationPath &&
        (!Array.isArray(body.relationPath) ||
          body.relationPath.some((id) => !isId(id))))
    )
      throw new BadRequestException('Некорректный ID источника');
    if (
      body.presentation?.fieldColumnIds &&
      (!Array.isArray(body.presentation.fieldColumnIds) ||
        body.presentation.fieldColumnIds.length > 12)
    )
      throw new BadRequestException('Можно показать до 12 полей');
    if (
      body.presentation?.aggregation &&
      !['FIRST', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(
        body.presentation.aggregation,
      )
    )
      throw new BadRequestException('Неизвестный агрегат');
    if (
      body.presentation?.statusColors &&
      (typeof body.presentation.statusColors !== 'object' ||
        Object.entries(body.presentation.statusColors).length > 40 ||
        Object.values(body.presentation.statusColors).some(
          (color) =>
            typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color),
        ))
    )
      throw new BadRequestException('Цвет статуса задаётся как #RRGGBB');
    if (body.type === 'DATASET') {
      delete body.rowId;
      delete body.columnId;
    }
    if (body.type === 'COLUMN') delete body.rowId;
    if (body.type === 'ROW') delete body.columnId;
    const dataset = await query<{ id: string }>(
      'SELECT id FROM datasets WHERE deleted_at IS NULL AND id = $1 AND workspace_id = $2',
      [body.datasetId, access.workspace_id],
    );
    if (!dataset.rows[0]) {
      throw new BadRequestException(
        'Dataset does not belong to this workspace',
      );
    }

    if (body.rowId) {
      const row = await query<{ id: string }>(
        'SELECT id FROM dataset_rows WHERE id = $1 AND dataset_id = $2',
        [body.rowId, body.datasetId],
      );
      if (!row.rows[0]) {
        throw new BadRequestException('Row does not belong to this dataset');
      }
    }

    if (body.columnId) {
      const column = await query<{ id: string }>(
        'SELECT id FROM dataset_columns WHERE id = $1 AND dataset_id = $2',
        [body.columnId, body.datasetId],
      );
      if (!column.rows[0]) {
        throw new BadRequestException('Column does not belong to this dataset');
      }
    }

    if (body.type === 'RELATION_VIEW') {
      if (!body.rowId) {
        throw new BadRequestException('RELATION_VIEW requires an anchor row');
      }

      if (!body.relationPath || body.relationPath.length !== 1) {
        throw new BadRequestException(
          'RELATION_VIEW currently requires exactly one relation',
        );
      }

      const relation = await query<{ id: string }>(
        `SELECT id
         FROM dataset_relations
         WHERE id = $1
           AND deleted_at IS NULL
           AND workspace_id = $2
           AND (
             source_dataset_id = $3 OR
             target_dataset_id = $3
           )
         LIMIT 1`,
        [body.relationPath[0], access.workspace_id, body.datasetId],
      );

      if (!relation.rows[0]) {
        throw new BadRequestException(
          'Relation does not belong to the workspace or anchor dataset',
        );
      }
    }

    const presentationColumnIds = [
      body.presentation?.titleColumnId,
      body.presentation?.subtitleColumnId,
      body.presentation?.statusColumnId,
      ...(body.presentation?.fieldColumnIds ?? []),
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    for (const columnId of presentationColumnIds) {
      if (!isId(columnId))
        throw new BadRequestException('Некорректное поле представления');
      const column = await query<{ id: string }>(
        'SELECT id FROM dataset_columns WHERE id = $1 AND dataset_id = $2',
        [columnId, body.datasetId],
      );
      if (!column.rows[0]) {
        throw new BadRequestException(
          'Presentation column does not belong to this dataset',
        );
      }
    }

    if (!['ROW', 'RELATION_VIEW'].includes(body.type) && body.presentation) {
      for (const key of [
        'titleColumnId',
        'subtitleColumnId',
        'fieldColumnIds',
        'statusColumnId',
        'statusColors',
      ])
        delete body.presentation[key];
    }
    const bindingId = randomUUID();
    const result = await query<{
      id: string;
      board_id: string;
      board_object_id: string;
      binding_type: 'DATASET' | 'ROW' | 'COLUMN' | 'CELL' | 'RELATION_VIEW';
      dataset_id: string;
      row_id: string | null;
      column_id: string | null;
      relation_path: string[] | null;
      presentation: Record<string, unknown> | null;
    }>(
      `INSERT INTO object_bindings (
         id, board_id, board_object_id, binding_type, dataset_id,
         row_id, column_id, relation_path, presentation, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())
       ON CONFLICT (board_id, board_object_id)
       DO UPDATE SET
         binding_type = EXCLUDED.binding_type,
         dataset_id = EXCLUDED.dataset_id,
         row_id = EXCLUDED.row_id,
         column_id = EXCLUDED.column_id,
         relation_path = EXCLUDED.relation_path,
         presentation = EXCLUDED.presentation,
         updated_at = now()
       RETURNING id, board_id, board_object_id, binding_type, dataset_id,
                 row_id, column_id, relation_path, presentation`,
      [
        bindingId,
        boardId,
        objectId,
        body.type,
        body.datasetId,
        body.rowId ?? null,
        body.columnId ?? null,
        JSON.stringify(body.relationPath ?? null),
        JSON.stringify(body.presentation ?? {}),
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      boardId: row.board_id,
      boardObjectId: row.board_object_id,
      type: row.binding_type,
      datasetId: row.dataset_id,
      rowId: row.row_id ?? undefined,
      columnId: row.column_id ?? undefined,
      relationPath: row.relation_path ?? undefined,
      presentation: row.presentation ?? undefined,
    };
  }

  @UseGuards(AuthGuard)
  @Delete('boards/:id/objects/:objectId/binding')
  async deleteObjectBinding(
    @Param('id') boardId: string,
    @Param('objectId') objectId: string,
    @Req() req: any,
  ) {
    const access = await getBoardAccess(boardId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    await query(
      'DELETE FROM object_bindings WHERE board_id = $1 AND board_object_id = $2',
      [boardId, objectId],
    );

    return { ok: true as const };
  }

  @UseGuards(AuthGuard)
  @Get('boards/:id/comments')
  async comments(@Param('id') id: string, @Req() req: any) {
    const access = await getBoardAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query(
      `SELECT c.id, c.object_id, c.body, c.x, c.y, c.resolved, c.created_at,
              u.id AS author_id, u.display_name AS author_name
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.board_id = $1
       ORDER BY c.created_at ASC`,
      [id],
    );
    return result.rows;
  }

  @UseGuards(AuthGuard)
  @Post('boards/:id/comments')
  async addComment(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { body?: string; objectId?: string; x?: number; y?: number },
  ) {
    const access = await getBoardAccess(id, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canComment(access.role))
      throw new ForbiddenException('Comment permission required');
    if (!body.body?.trim())
      throw new ForbiddenException('Comment text is required');

    const result = await query(
      `INSERT INTO comments (board_id, object_id, author_id, body, x, y)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        body.objectId ?? null,
        req.user.sub,
        body.body.trim(),
        body.x ?? null,
        body.y ?? null,
      ],
    );
    return result.rows[0];
  }
}
