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
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { pool, query } from '@modelboard/db';
import {
  canComment,
  canEditBoard,
  type CreateDatasetInput,
  type DatasetColumn,
  type DatasetRow,
  type WorkspaceRole,
} from '@modelboard/shared';
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

  @Get('auth/dev-users')
  async devUsers() {
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
    const result = await query<{
      id: string;
      email: string;
      display_name: string;
    }>('SELECT id, email, display_name FROM users WHERE id = $1', [body.userId]);

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
       WHERE workspace_id = $1
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
  @Post('workspaces/:id/datasets')
  async createDataset(
    @Param('id') workspaceId: string,
    @Req() req: any,
    @Body() body: CreateDatasetInput,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) throw new ForbiddenException('Edit permission required');

    const datasetId = randomUUID();
    const name = body.name?.trim() || 'untitled_dataset';
    const kind = body.kind ?? 'MANUAL';

    if (name.length > 120) {
      throw new BadRequestException('Dataset name is limited to 120 characters');
    }

    if (!['MANUAL', 'CSV', 'SQL', 'API'].includes(kind)) {
      throw new BadRequestException('Unsupported dataset kind');
    }

    if ((body.columns?.length ?? 0) > 100) {
      throw new BadRequestException('Dataset is limited to 100 columns in this MVP');
    }

    if ((body.rows?.length ?? 0) > 2000) {
      throw new BadRequestException('Dataset is limited to 2000 rows in this MVP');
    }

    const suppliedColumns = body.columns?.length
      ? body.columns
      : [
          { name: 'id', dataType: 'INTEGER' as const, key: 'PK' as const },
          { name: 'name', dataType: 'TEXT' as const },
          { name: 'ref_id', dataType: 'INTEGER' as const, key: 'FK' as const },
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
          [columns[0].id]: 1,
          [columns[1]?.id ?? columns[0].id]: 'First row',
          ...(columns[2] ? { [columns[2].id]: 1 } : {}),
        },
      },
      {
        id: randomUUID(),
        ordinal: 1,
        values: {
          [columns[0].id]: 2,
          [columns[1]?.id ?? columns[0].id]: 'Second row',
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
    if (!canComment(access.role)) throw new ForbiddenException('Comment permission required');
    if (!body.body?.trim()) throw new ForbiddenException('Comment text is required');

    const result = await query(
      `INSERT INTO comments (board_id, object_id, author_id, body, x, y)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, body.objectId ?? null, req.user.sub, body.body.trim(), body.x ?? null, body.y ?? null],
    );
    return result.rows[0];
  }
}
