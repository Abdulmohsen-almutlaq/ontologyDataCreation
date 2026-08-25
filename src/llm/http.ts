import { LLMError } from './LLMClient';

export interface HttpJsonOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  provider: string;
}

export interface HttpJsonResult {
  status: number;
  ok: boolean;
  json: any;
  text: string;
}

/** POST JSON with an abort-based timeout. Non-2xx is returned, not thrown, so
 *  callers can degrade (e.g. drop an unsupported schema constraint). */
export async function postJson(opts: HttpJsonOptions): Promise<HttpJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new LLMError(
        `Request to ${opts.url} timed out after ${opts.timeoutMs}ms`,
        opts.provider,
        err
      );
    }
    throw new LLMError(
      `Request to ${opts.url} failed: ${(err as Error).message}`,
      opts.provider,
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

export function joinUrl(base: string, suffix: string): string {
  return base.replace(/\/+$/, '') + '/' + suffix.replace(/^\/+/, '');
}
