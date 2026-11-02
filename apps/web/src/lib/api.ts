export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'STUDENT' | 'LECTURER';
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: { field: string; message: string }[] = []) {
    super(message);
  }
}

let refreshRequest: Promise<boolean> | null = null;

async function send(path: string, init: RequestInit = {}) {
  return fetch(`/api/v1${path}`, {
    ...init, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1', ...init.headers }
  });
}

export async function api<T>(path: string, init: RequestInit = {}, refresh = true): Promise<T> {
  let response: Response;
  try {
    response = await send(path, init);
    if (response.status === 401 && refresh) {
      // Coalesce expiry across components; mutation retry occurs only after a 401 rejection.
      refreshRequest ??= send('/auth/refresh', { method: 'POST', body: '{}' })
        .then(result => result.ok).finally(() => { refreshRequest = null; });
      if (await refreshRequest) response = await send(path, init);
    }
  } catch {
    throw new ApiError(0, 'Unable to connect. Check your connection and try again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.message ?? 'The request failed. Please try again.', data?.error?.fields ?? []);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
