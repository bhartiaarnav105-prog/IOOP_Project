// Base API URL configuration
// Reads from Vite environment variable VITE_API_URL, defaulting directly to the deployed production Render backend.
export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || 'https://resq-backend-70kg.onrender.com'
).replace(/\/+$/, '');

// Alias matching ${API_URL} convention
export const API_URL = API_BASE_URL;

export function apiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
}
