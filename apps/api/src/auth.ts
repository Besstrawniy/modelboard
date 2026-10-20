import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { serverJwtSecret } from '@modelboard/shared/server-auth';
import { query } from '@modelboard/db';
import type { WorkspaceRole } from '@modelboard/shared';

export type JwtUser = {
  sub: string;
  email: string;
  displayName: string;
};

export type AuthedRequest = Request & { user: JwtUser };

const secret = () => serverJwtSecret();

export function signUser(user: JwtUser) {
  return jwt.sign(user, secret(), { expiresIn: '12h' });
}

export function verifyUser(token: string): JwtUser {
  return jwt.verify(token, secret()) as JwtUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<any>();
    const auth = request.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    try {
      request.user = verifyUser(auth.slice('Bearer '.length));
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

export async function getWorkspaceAccess(workspaceId: string, userId: string) {
  const result = await query<{
    workspace_id: string;
    workspace_name: string;
    role: WorkspaceRole;
  }>(
    `SELECT w.id AS workspace_id, w.name AS workspace_name, wm.role
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE w.id = $1 AND wm.user_id = $2`,
    [workspaceId, userId],
  );

  return result.rows[0] ?? null;
}

export async function getBoardAccess(boardId: string, userId: string) {
  const result = await query<{
    board_id: string;
    board_name: string;
    workspace_id: string;
    workspace_name: string;
    role: WorkspaceRole;
  }>(
    `SELECT
       b.id AS board_id,
       b.name AS board_name,
       w.id AS workspace_id,
       w.name AS workspace_name,
       wm.role
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE b.id = $1 AND wm.user_id = $2`,
    [boardId, userId],
  );

  return result.rows[0] ?? null;
}

export async function getDatasetAccess(datasetId: string, userId: string) {
  const result = await query<{
    dataset_id: string;
    dataset_name: string;
    dataset_kind: string;
    workspace_id: string;
    workspace_name: string;
    role: WorkspaceRole;
  }>(
    `SELECT
       d.id AS dataset_id,
       d.name AS dataset_name,
       d.kind AS dataset_kind,
       w.id AS workspace_id,
       w.name AS workspace_name,
       wm.role
     FROM datasets d
     JOIN workspaces w ON w.id = d.workspace_id
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE d.id = $1 AND d.deleted_at IS NULL AND wm.user_id = $2`,
    [datasetId, userId],
  );

  return result.rows[0] ?? null;
}
