import type { FastifyInstance, FastifyReply } from "fastify";
import type { TranslationAnswer, TranslationService } from "./translationService.js";
import { DEFAULT_TRANSLATION_LANGUAGE, MAX_TRANSLATION_TEXT_CHARS, TranslationUnavailableError } from "./translationService.js";
import { errorMessage } from "../../../shared/unknownValues.js";

/**
 * `POST /api/translate`: translate one piece of transcript text, for the reading toolbar.
 *
 * A reader double-clicks a word or holds a sentence and the page asks for that text in another
 * language. The web process answers it (the session daemon must not reach outside the machine for a
 * reading aid) and the answer is a sentence, not a document: `text` is capped at
 * {@link MAX_TRANSLATION_TEXT_CHARS}.
 *
 * Served at the plain prefix only: the PI WEB the browser is talking to answers, which is the one
 * whose config says where text may leave.
 */
export function registerTranslationRoutes(app: FastifyInstance, service: TranslationService, options: TranslationRouteOptions = {}): void {
  const defaultLanguage = options.defaultLanguage ?? DEFAULT_TRANSLATION_LANGUAGE;
  const base = (options.prefix ?? "/api").replace(/\/+$/u, "") === "" ? "/api" : (options.prefix ?? "/api").replace(/\/+$/u, "");

  app.get(`${base}/translate/language`, () => ({ language: options.language?.() ?? defaultLanguage }));

  app.post<{ Body: unknown }>(`${base}/translate`, async (request, reply) => {
    let translated: TranslationAnswer;
    try {
      translated = await service.translate(parseTranslationBody(request.body));
    } catch (error: unknown) {
      return refused(reply, error);
    }
    return { text: translated.text, ...(translated.source === undefined ? {} : { source: translated.source }), provider: translated.provider };
  });
}

export interface TranslationRouteOptions {
  /** The prefix the route is mounted under; `/api` for the browser's own PI WEB. */
  prefix?: string;
  /** The language asked for when the browser's request does not name one. */
  defaultLanguage?: string;
  /** The deployment's reading language, read when the browser asks, so a config edit is answered without a restart. */
  language?: () => string;
}

/** `{ text, to? }`; `to` defaults to the deployment's reading language. */
function parseTranslationBody(body: unknown): { text: string; to: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new TranslationUnavailableError("A translation needs a body with text.");
  const text: unknown = Reflect.get(body, "text");
  const to: unknown = Reflect.get(body, "to");
  if (typeof text !== "string" || text.trim() === "") throw new TranslationUnavailableError("A translation needs text.");
  if (typeof to !== "string" || to.trim() === "" || to.length > 20) throw new TranslationUnavailableError("A translation needs a target language.");
  if (text.length > MAX_TRANSLATION_TEXT_CHARS) throw new TranslationUnavailableError(`A translation asks for at most ${String(MAX_TRANSLATION_TEXT_CHARS)} characters.`);
  return { text: text.trim(), to: to.trim() };
}

function refused(reply: FastifyReply, error: unknown) {
  const status = error instanceof TranslationUnavailableError ? 400 : 502;
  return reply.code(status).send({ error: errorMessage(error) });
}
