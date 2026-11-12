import type { PiWebTranslationConfig, PiWebTranslationProvider } from "../../../shared/apiTypes.js";
import { errorMessage } from "../../../shared/unknownValues.js";

/** What a reader asked the page to translate, and into what. */
export interface TranslationRequest {
  readonly text: string;
  readonly to: string;
}

/** What came back: the translated text, and the language it was read as when the provider says. */
export interface TranslationAnswer {
  readonly text: string;
  readonly source?: string;
  readonly provider: PiWebTranslationProvider;
}

export interface TranslationService {
  translate(request: TranslationRequest): Promise<TranslationAnswer>;
}

/** Refused because the operator turned the provider off, or because the request cannot be answered. */
export class TranslationUnavailableError extends Error {
  override name = "TranslationUnavailableError";
}

export const DEFAULT_TRANSLATION_BASE_URL = "https://translate.googleapis.com/translate_a/single";
/** Simplified Chinese: what the reading toolbar's readers asked for, and what a deployment changes with `translation.language`. */
export const DEFAULT_TRANSLATION_LANGUAGE = "zh-CN";
export const DEFAULT_TRANSLATION_TIMEOUT_MS = 8_000;
/** One sentence of a transcript, not a document: the free endpoint is asked for reading-sized text. */
export const MAX_TRANSLATION_TEXT_CHARS = 1_500;

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 200;

/**
 * The translation the reading toolbar asks for, answered through the configured provider.
 *
 * The web process answers it, not the session daemon, because the daemon must never reach outside
 * the machine for a reading aid a browser asked for. The default provider is Google's free
 * endpoint: no account, no key, and it answers a sentence. `translation.baseUrl` points the same
 * request at a self-hosted mirror, and `translation.provider: "off"` refuses it for a machine that
 * must not send its transcript outward at all.
 *
 * A sentence asked twice is answered from the cache: holding a paragraph again while re-reading it
 * is the common case, and the free endpoint rate-limits a page that translates on every hold.
 */
export function createTranslationService(
  readConfig: () => PiWebTranslationConfig | undefined,
  fetchImpl: typeof fetch = fetch,
): TranslationService {
  const cache = new Map<string, { readonly answer: TranslationAnswer; readonly atMs: number }>();
  return {
    translate: async (request) => {
      const config = readConfig() ?? {};
      const provider = config.provider ?? "google";
      if (provider === "off") throw new TranslationUnavailableError("Translation is turned off on this PI WEB (config translation.provider: \"off\").");
      const baseUrl = config.baseUrl ?? DEFAULT_TRANSLATION_BASE_URL;
      const key = `${baseUrl}\u0000${request.to}\u0000${request.text}`;
      const cached = cache.get(key);
      if (cached !== undefined && Date.now() - cached.atMs < CACHE_TTL_MS) return cached.answer;
      const answer = await translateWithGoogle(fetchImpl, request, config, baseUrl);
      cache.set(key, { answer, atMs: Date.now() });
      evictOldestTranslations(cache);
      return answer;
    },
  };
}

async function translateWithGoogle(fetchImpl: typeof fetch, request: TranslationRequest, config: PiWebTranslationConfig, baseUrl: string): Promise<TranslationAnswer> {
  const controller = new AbortController();
  const timer = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TRANSLATION_TIMEOUT_MS);
  timer.addEventListener("abort", () => { controller.abort(); });
  return translateWithGoogleUrl(fetchImpl, request, url(baseUrl, request), controller.signal);
}

function url(baseUrl: string, request: TranslationRequest): string {
  const url = new URL(baseUrl);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", request.to);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", request.text);
  return url.toString();
}

/**
 * The request, and the reading of its answer, are bounded by one abort. A fetch signal alone covers
 * the response start; an endpoint that answers headers and then stalls on the body would otherwise
 * hold the reader's gesture open past the timeout they configured.
 */
async function translateWithGoogleUrl(fetchImpl: typeof fetch, request: TranslationRequest, url: string, signal: AbortSignal): Promise<TranslationAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
  } catch (error: unknown) {
    throw new TranslationUnavailableError(`The translation endpoint did not answer: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new TranslationUnavailableError(`The translation endpoint answered ${String(response.status)}.`);
  const body = await response.text().catch(() => {
    throw new TranslationUnavailableError("The translation endpoint stopped answering mid-answer.");
  });
  return parseGoogleTranslation(body);
}

/**
 * Google's `translate_a/single` answer with `dt=t`: `[[[translated, original, ...], ...], null,
 * detected-language, ...]`. A sentence arrives as several segments, so they are joined. An answer
 * that is not that shape is refused - the free endpoint answers an HTML page when it rate-limits,
 * and handing that to a reader as a translation would be worse than saying nothing.
 */
export function parseGoogleTranslation(body: string): TranslationAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TranslationUnavailableError("The translation endpoint answered something that is not a translation.");
  }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) throw new TranslationUnavailableError("The translation endpoint answered without any translated text.");
  const segments = parsed[0].flatMap((segment: unknown) => (Array.isArray(segment) && typeof segment[0] === "string" ? [segment[0]] : []));
  const text = segments.join("").trim();
  if (text === "") throw new TranslationUnavailableError("The translation endpoint returned no text.");
  const source = typeof parsed[2] === "string" && parsed[2] !== "" ? parsed[2] : undefined;
  return { text, ...(source === undefined ? {} : { source }), provider: "google" };
}

function evictOldestTranslations(cache: Map<string, { readonly answer: TranslationAnswer; readonly atMs: number }>): void {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) return;
    cache.delete(oldest.value);
  }
}
