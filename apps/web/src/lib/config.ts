import { resolveServiceUrls } from './serviceUrls';

const urls = resolveServiceUrls(window.location.href, {
  api: import.meta.env.VITE_API_URL,
  collab: import.meta.env.VITE_COLLAB_URL,
});
export const API_URL = urls.apiUrl;
export const COLLAB_URL = urls.collabUrl;
