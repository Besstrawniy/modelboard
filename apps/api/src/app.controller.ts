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
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { pool, query } from '@modelboard/db';
import {
  canComment,
  canEditBoard,
  type CreateDatasetInput,
  type CreateDatasetRelationInput,
  type DatasetColumn,
  type DatasetRelationCardinality,
  type DatasetRelationType,
  type DatasetRow,
  type CreateWorkspaceObjectTemplateInput,
  type UpsertObjectBindingInput,
  type WorkspaceRole,
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
  @Post('datasets/:id/columns')
  async createDatasetColumn(
    @Param('id') datasetId: string,
    @Req() req: any,
    @Body()
    body: {
      name?: string;
      dataType?: DatasetColumn['dataType'];
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
    if (!['TEXT', 'INTEGER', 'BOOLEAN', 'DATE', 'UUID'].includes(dataType)) {
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
      await client.query(
        'SELECT id FROM datasets WHERE id = $1 FOR UPDATE',
        [datasetId],
      );

      const ordinalResult = await client.query<{ ordinal: number }>(
        `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
         FROM dataset_columns
         WHERE dataset_id = $1`,
        [datasetId],
      );

      const column: DatasetColumn = {
        id: randomUUID(),
        name,
        dataType,
        ordinal: ordinalResult.rows[0]?.ordinal ?? 0,
      };

      await client.query(
        `INSERT INTO dataset_columns (
           id, dataset_id, name, data_type, ordinal, properties
         )
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
        [
          column.id,
          datasetId,
          column.name,
          column.dataType,
          column.ordinal,
        ],
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
  @Post('datasets/:id/rows')
  async createDatasetRow(
    @Param('id') datasetId: string,
    @Req() req: any,
    @Body() body: { values?: DatasetRow['values'] },
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
        'SELECT id FROM datasets WHERE id = $1 FOR UPDATE',
        [datasetId],
      );

      const ordinalResult = await client.query<{ ordinal: number }>(
        `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
         FROM dataset_rows
         WHERE dataset_id = $1`,
        [datasetId],
      );

      const row: DatasetRow = {
        id: randomUUID(),
        ordinal: ordinalResult.rows[0]?.ordinal ?? 0,
        values,
      };

      await client.query(
        `INSERT INTO dataset_rows (id, dataset_id, ordinal, values)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [row.id, datasetId, row.ordinal, JSON.stringify(row.values)],
      );

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

    const result = await query<{ id: string }>(
      `DELETE FROM dataset_rows
       WHERE id = $1 AND dataset_id = $2
       RETURNING id`,
      [rowId, datasetId],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('Dataset row not found');
    }

    return { ok: true as const };
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
  @Get('workspaces/:id/templates')
  async objectTemplates(
    @Param('id') workspaceId: string,
    @Req() req: any,
  ) {
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
      throw new BadRequestException('Template name is limited to 120 characters');
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
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();

    const result = await query<{
      id: string;
      workspace_id: string;
      source_dataset_id: string;
      source_column_id: string;
      target_dataset_id: string;
      target_column_id: string;
      relation_type: DatasetRelationType;
      cardinality: DatasetRelationCardinality | null;
    }>(
      `SELECT id, workspace_id, source_dataset_id, source_column_id,
              target_dataset_id, target_column_id, relation_type, cardinality
       FROM dataset_relations
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      sourceDatasetId: row.source_dataset_id,
      sourceColumnId: row.source_column_id,
      targetDatasetId: row.target_dataset_id,
      targetColumnId: row.target_column_id,
      relationType: row.relation_type,
      cardinality: row.cardinality,
    }));
  }

  @UseGuards(AuthGuard)
  @Post('workspaces/:id/relations')
  async createRelation(
    @Param('id') workspaceId: string,
    @Req() req: any,
    @Body() body: CreateDatasetRelationInput,
  ) {
    const access = await getWorkspaceAccess(workspaceId, req.user.sub);
    if (!access) throw new ForbiddenException();
    if (!canEditBoard(access.role)) {
      throw new ForbiddenException('Edit permission required');
    }

    const allowedTypes: DatasetRelationType[] = [
      'REFERENCE',
      'FOREIGN_KEY',
      'DEPENDENCY',
      'MAP',
      'FLOW',
    ];
    const allowedCardinality: DatasetRelationCardinality[] = [
      '1:1',
      '1:N',
      'N:1',
      'N:M',
    ];

    if (!allowedTypes.includes(body.relationType)) {
      throw new BadRequestException('Unsupported relation type');
    }

    if (
      body.cardinality != null &&
      !allowedCardinality.includes(body.cardinality)
    ) {
      throw new BadRequestException('Unsupported cardinality');
    }

    const endpoints = await query<{
      source_dataset_id: string;
      source_column_id: string;
      target_dataset_id: string;
      target_column_id: string;
    }>(
      `SELECT
         sd.id AS source_dataset_id,
         sc.id AS source_column_id,
         td.id AS target_dataset_id,
         tc.id AS target_column_id
       FROM datasets sd
       JOIN dataset_columns sc
         ON sc.dataset_id = sd.id AND sc.id = $2
       JOIN datasets td
         ON td.id = $3 AND td.workspace_id = $1
       JOIN dataset_columns tc
         ON tc.dataset_id = td.id AND tc.id = $4
       WHERE sd.id = $5 AND sd.workspace_id = $1`,
      [
        workspaceId,
        body.sourceColumnId,
        body.targetDatasetId,
        body.targetColumnId,
        body.sourceDatasetId,
      ],
    );

    if (!endpoints.rows[0]) {
      throw new BadRequestException(
        'Datasets/columns must exist and belong to this workspace',
      );
    }

    const existing = await query<{
      id: string;
      workspace_id: string;
      source_dataset_id: string;
      source_column_id: string;
      target_dataset_id: string;
      target_column_id: string;
      relation_type: DatasetRelationType;
      cardinality: DatasetRelationCardinality | null;
    }>(
      `SELECT id, workspace_id, source_dataset_id, source_column_id,
              target_dataset_id, target_column_id, relation_type, cardinality
       FROM dataset_relations
       WHERE workspace_id = $1
         AND source_dataset_id = $2
         AND source_column_id = $3
         AND target_dataset_id = $4
         AND target_column_id = $5
         AND relation_type = $6
         AND cardinality IS NOT DISTINCT FROM $7
       LIMIT 1`,
      [
        workspaceId,
        body.sourceDatasetId,
        body.sourceColumnId,
        body.targetDatasetId,
        body.targetColumnId,
        body.relationType,
        body.cardinality ?? null,
      ],
    );

    let row = existing.rows[0];

    if (!row) {
      const relationId = randomUUID();
      const inserted = await query<typeof existing.rows[number]>(
        `INSERT INTO dataset_relations (
           id, workspace_id,
           source_dataset_id, source_column_id,
           target_dataset_id, target_column_id,
           relation_type, cardinality
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, workspace_id, source_dataset_id, source_column_id,
                   target_dataset_id, target_column_id, relation_type, cardinality`,
        [
          relationId,
          workspaceId,
          body.sourceDatasetId,
          body.sourceColumnId,
          body.targetDatasetId,
          body.targetColumnId,
          body.relationType,
          body.cardinality ?? null,
        ],
      );
      row = inserted.rows[0];
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      sourceDatasetId: row.source_dataset_id,
      sourceColumnId: row.source_column_id,
      targetDatasetId: row.target_dataset_id,
      targetColumnId: row.target_column_id,
      relationType: row.relation_type,
      cardinality: row.cardinality,
    };
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

    if (!['DATASET', 'ROW', 'COLUMN', 'CELL', 'RELATION_VIEW'].includes(body.type)) {
      throw new BadRequestException('Unsupported binding type');
    }

    const dataset = await query<{ id: string }>(
      'SELECT id FROM datasets WHERE id = $1 AND workspace_id = $2',
      [body.datasetId, access.workspace_id],
    );
    if (!dataset.rows[0]) {
      throw new BadRequestException('Dataset does not belong to this workspace');
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

    const presentationColumnIds = [
      body.presentation?.titleColumnId,
      body.presentation?.subtitleColumnId,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const columnId of presentationColumnIds) {
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
