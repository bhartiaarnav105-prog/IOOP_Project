// Base API URL configuration
// In production (Vercel), VITE_API_URL is set to the Render backend URL (e.g. https://resq-backend.onrender.com).
// In local development, if VITE_API_URL is empty, it falls back to empty string,
// which causes fetch to use relative paths (e.g. /api/cities) supported by Vite's dev server plugin or proxy.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export function apiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
}
