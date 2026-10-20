export type ServiceOverrides = { api?: string; collab?: string };

/** Resolve services from the address opened by this participant, never their localhost. */
export function resolveServiceUrls(pageUrl: string, overrides: ServiceOverrides = {}) {
  const api = new URL(overrides.api?.trim() || '/api', pageUrl);
  const collab = new URL(overrides.collab?.trim() || '/collab', pageUrl);
  if (collab.protocol === 'http:') collab.protocol = 'ws:';
  if (collab.protocol === 'https:') collab.protocol = 'wss:';
  if (!['http:', 'https:'].includes(api.protocol) || !['ws:', 'wss:'].includes(collab.protocol)) {
    throw new Error('API requires HTTP(S), collaboration requires WS(S).');
  }
  return { apiUrl: api.href.replace(/\/$/, ''), collabUrl: collab.href };
}
