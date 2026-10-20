// Server-only: do not export from the browser entry point.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

type Environment = Record<string, string | undefined>;
export function usesPasswordAuth(env: Environment = process.env) {
  return env.NODE_ENV === 'production' || env.AUTH_MODE === 'password';
}
const accounts = [
  { email: 'owner@example.local', variable: 'OWNER_PASSWORD', id: '10000000-0000-0000-0000-000000000001' },
  { email: 'editor@example.local', variable: 'EDITOR_PASSWORD', id: '10000000-0000-0000-0000-000000000002' },
  { email: 'commenter@example.local', variable: 'COMMENTER_PASSWORD', id: '10000000-0000-0000-0000-000000000003' },
  { email: 'viewer@example.local', variable: 'VIEWER_PASSWORD', id: '10000000-0000-0000-0000-000000000004' },
] as const;
export function validateAuthConfiguration(env: Environment = process.env) {
  if (!usesPasswordAuth(env)) return;
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET === 'change-me-in-production')
    throw new Error('Password authentication requires JWT_SECRET with at least 32 characters');
  if (!env.OWNER_PASSWORD) throw new Error('Set OWNER_PASSWORD to enable server login');
  for (const account of accounts) {
    if (env[account.variable] && env[account.variable]!.length < 12)
      throw new Error(account.variable + ' must contain at least 12 characters');
  }
}
export function serverJwtSecret(env: Environment = process.env) {
  if (!usesPasswordAuth(env)) return env.JWT_SECRET ?? 'change-me-in-production';
  validateAuthConfiguration(env);
  // Different key from demo mode. Changing credentials also invalidates old sessions.
  return createHmac('sha256', env.JWT_SECRET!)
    .update(JSON.stringify(['modelboard-password-v1', ...accounts.map(account => env[account.variable] ?? '')]))
    .digest('hex');
}
export function configuredAccount(email: unknown, password: unknown, env: Environment = process.env) {
  if (!usesPasswordAuth(env) || typeof email !== 'string' || typeof password !== 'string' ||
      email.length > 254 || password.length > 1024) return null;
  const account = accounts.find(item => item.email === email.trim().toLowerCase());
  const expected = account ? env[account.variable] : undefined;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const matches = timingSafeEqual(hash(password), hash(expected ?? ''));
  return matches && expected && account ? account : null;
}
