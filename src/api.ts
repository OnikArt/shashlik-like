const configuredApiOrigin = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

export const apiOrigin = configuredApiOrigin;

export function apiUrl(path: string) {
  if (!path.startsWith("/")) throw new Error("API path must start with /");
  return `${apiOrigin}${path}`;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}
