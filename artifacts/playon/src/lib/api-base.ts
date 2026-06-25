const _url = import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app";
export const API_BASE = _url.replace(/\/$/, "") + "/api";
