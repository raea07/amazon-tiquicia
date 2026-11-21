/** A provider call with a deadline. A timeout is reported as a network failure. */
export interface HttpAnswer {
  status: number;
  headers: Headers;
  text: string;
}

export async function post(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<HttpAnswer | { networkError: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    return {
      networkError: controller.signal.aborted
        ? "timeout"
        : error instanceof Error
          ? error.name
          : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Seconds from a Retry-After header (seconds form only), or undefined. */
export function retryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  return Math.min(Number(value), 3600);
}

/**
 * Provider error text can quote the recipient back. Before it is stored or
 * logged, anything that looks like an e-mail address or a phone number goes.
 */
export function scrub(text: string, max = 300): string {
  return text
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, "[dirección]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[número]")
    .slice(0, max);
}
