import axios, { AxiosError, type AxiosRequestConfig } from "axios";

/**
 * The API answers errors in two shapes, both of which reach the client:
 *
 *   - `AppError` subclasses go through the handler in `app/main.py` → `{code, message}`
 *   - raw `HTTPException` (orgs.py, clinicians.py, credentials.py) → `{detail}`
 *
 * Everything downstream reads `.message`, so both collapse here rather than at
 * each call site.
 */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export function normalizeError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;

    if (axios.isAxiosError(error)) {
        const { response } = error as AxiosError<{
            code?: string;
            message?: string;
            detail?: unknown;
        }>;
        if (!response) {
            return new ApiError(
                "Cannot reach the server. Is the API running on port 8000?",
                0,
            );
        }
        const body = response.data;
        // `detail` is a string for HTTPException, but FastAPI's own validation
        // errors put a list of objects there. Only the string form is a message.
        const detail =
            typeof body?.detail === "string" ? body.detail : undefined;
        const message =
            body?.message ?? detail ?? response.statusText ?? "Request failed";
        return new ApiError(message, response.status, body?.code);
    }

    return new ApiError(
        error instanceof Error ? error.message : "Request failed",
        0,
    );
}

// Relative on purpose. `/api` is a dev-proxy prefix that vite.config.ts strips
// before forwarding to the API — pointing this at http://localhost:8000
// directly makes every request cross-origin, which the backend has no CORS
// middleware to allow, and doubles the prefix onto routes that never had one.
export const api = axios.create({
    baseURL: "/api",
    withCredentials: true,
});

/** Set by AuthProvider so a dead session can clear app state, not just redirect. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: () => void) {
    onSessionLost = fn;
}

let refreshing: Promise<unknown> | null = null;

api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const original = error.config as
            | (AxiosRequestConfig & { _retried?: boolean })
            | undefined;
        const url = original?.url ?? "";

        const recoverable =
            error.response?.status === 401 &&
            original &&
            !original._retried &&
            // Refreshing a refresh, or retrying a failed login, both loop.
            !url.includes("/auth/refresh") &&
            !url.includes("/auth/login");

        if (!recoverable) return Promise.reject(normalizeError(error));

        original._retried = true;
        try {
            // One refresh in flight for however many requests raced into 401.
            refreshing ??= api.post("/auth/refresh").finally(() => {
                refreshing = null;
            });
            await refreshing;
            return await api.request(original);
        } catch {
            onSessionLost?.();
            return Promise.reject(
                new ApiError("Your session has expired. Sign in again.", 401),
            );
        }
    },
);
