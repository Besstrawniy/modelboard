import {
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
import { query } from '@modelboard/db';
import { canComment, type WorkspaceRole } from '@modelboard/shared';
import { AuthGuard, getBoardAccess, signUser } from './auth.js';

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
