import { API_URL, APP_TOKEN } from "./config";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

/** Sends ONE prepared image (base64 JPEG) to the proxy and returns its chicken count. */
export async function countImage(base64: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "X-App-Token": APP_TOKEN, "Content-Type": "text/plain" },
      body: base64,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new ApiError(`Server error ${res.status}: ${text}`, res.status);
    }

    const data = await res.json();
    if (typeof data.count !== "number") {
      throw new ApiError("Unexpected response from server");
    }
    return data.count;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw new Error("Network error. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries network failures and 5xx errors with backoff. Client errors
 * (bad token, image too large) are not retried since they'd fail again.
 */
export async function countImageWithRetry(base64: string, attempts = 3): Promise<number> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await countImage(base64);
    } catch (e) {
      lastError = e;
      const status = e instanceof ApiError ? e.status : undefined;
      const retryable = status === undefined || status >= 500;
      if (!retryable || i === attempts - 1) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw lastError;
}
