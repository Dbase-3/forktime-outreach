// Talking to the API (apps/api) through /api/v1 on this site. Errors arrive as
// { error: { code, message, details } } and are thrown as ApiError, whose
// message can be shown as it is.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function request<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      keepalive: init.keepalive,
    });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check your connection.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
    window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? "Something went wrong. Try again.", e?.details);
  }
  return body as T;
}

let workspaceId: string | null = null;
export function setWorkspace(id: string | null): void {
  workspaceId = id;
}
export function currentWorkspace(): string | null {
  return workspaceId;
}

/** A request inside the current workspace: ws("/agents") → /api/v1/w/<id>/agents. */
export function ws<T>(path: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  if (!workspaceId) throw new ApiError(0, "no_workspace", "Pick a workspace first.");
  return request<T>(`/w/${workspaceId}${path}`, init);
}
