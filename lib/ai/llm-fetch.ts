/**
 * Long-timeout fetch for LLM provider calls.
 *
 * Node's global fetch is undici with a default `headersTimeout` of 300s.
 * Thinking models behind the local gateway can take longer than that to emit
 * the first response byte on heavy scene-generation prompts, which surfaced
 * as `Headers Timeout Error` retries and failed classroom jobs. This wrapper
 * pins LLM traffic to a dispatcher with a much longer header window.
 * `bodyTimeout` is disabled so long-lived SSE streams are never cut.
 *
 * Configurable via LLM_FETCH_HEADERS_TIMEOUT_MS (default 15 minutes).
 */

const DEFAULT_HEADERS_TIMEOUT_MS = 15 * 60 * 1000;

type Dispatcher = unknown;

let dispatcher: Dispatcher | null | undefined;

async function getLlmDispatcher(): Promise<Dispatcher | null> {
  if (dispatcher !== undefined) return dispatcher;
  try {
    const { Agent } = await import('undici');
    const raw = Number(process.env.LLM_FETCH_HEADERS_TIMEOUT_MS);
    const headersTimeout =
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HEADERS_TIMEOUT_MS;
    dispatcher = new Agent({ headersTimeout, bodyTimeout: 0 });
  } catch {
    // Non-Node runtime (edge/client): undici is unavailable; the default
    // global fetch applies.
    dispatcher = null;
  }
  return dispatcher;
}

export async function llmFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const agent = await getLlmDispatcher();
  if (!agent) return globalThis.fetch(input, init);
  return globalThis.fetch(input, {
    ...(init as Record<string, unknown> | undefined),
    dispatcher: agent,
  } as RequestInit);
}
