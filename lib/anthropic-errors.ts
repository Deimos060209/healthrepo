/**
 * One place to turn an Anthropic SDK failure into a stable, non-leaky error
 * contract for the browser.
 *
 * Every route that calls the Anthropic API (`/api/analyze`, `/api/extract-text`,
 * `/api/extract-text-advanced`) used to collapse *all* SDK failures into a
 * single generic "the service failed to respond" / "check your connection"
 * message. That is actively misleading: a user who is really looking at an
 * out-of-credits account blames their wifi and retries a call that can never
 * succeed.
 *
 * The API returns distinct, actionable failures. We classify them into a small
 * closed set of codes and hand the browser `{ error, retryable,
 * retry_after_seconds? }` — never the raw Anthropic message, which can carry
 * account and billing detail.
 *
 *   out_of_credits  400 invalid_request_error, message names the credit balance
 *   rate_limited    429 rate_limit_error            (retry after a short wait)
 *   overloaded      529 overloaded_error / 5xx      (retry automatically)
 *   auth_error      401 authentication_error        (key is broken — operator)
 *   network_error   connection failure to Anthropic
 *   timeout         connection timeout to Anthropic
 *
 * A 4xx we have no slot for (403, 404, a non-credit 400/422 such as an
 * unreadable image) is deliberately returned as `null` so the calling route
 * keeps its own domain handling for it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

/** The SDK exports its error classes as values; this is their instance type. */
type AnthropicAPIError = InstanceType<typeof Anthropic.APIError>;

export type AnthropicErrorCode =
  | "out_of_credits"
  | "rate_limited"
  | "overloaded"
  | "auth_error"
  | "network_error"
  | "timeout";

export interface ClassifiedAnthropicError {
  code: AnthropicErrorCode;
  /** Whether retrying the same call could plausibly succeed soon. */
  retryable: boolean;
  /** Present for rate_limited — seconds the client should wait first. */
  retry_after_seconds?: number;
  /** HTTP status to send back to the browser. */
  httpStatus: number;
  /** Server-log line. NEVER sent to the client. */
  detail: string;
  /** Page this in the server logs — the operator needs to know. */
  critical: boolean;
}

// --- credit / body-shape probes -------------------------------------------

const CREDIT_HINTS = [
  "credit balance is too low",
  "too low to access the anthropic api",
  "plans & billing",
  "purchase credits",
];

/** The body of an Anthropic error: `{ type, error: { type, message } }`. */
type AnthropicErrorBody = {
  type?: unknown;
  message?: unknown;
  error?: { type?: unknown; message?: unknown };
};

function errorBody(err: AnthropicAPIError): AnthropicErrorBody {
  return (err.error ?? {}) as unknown as AnthropicErrorBody;
}

/** True when the failure is really "your account is out of money". */
function mentionsCredit(err: AnthropicAPIError): boolean {
  const body = errorBody(err);
  const haystack = [
    typeof err.message === "string" ? err.message : "",
    typeof body.message === "string" ? body.message : "",
    typeof body.error?.message === "string" ? body.error.message : "",
  ]
    .join(" ")
    .toLowerCase();
  return CREDIT_HINTS.some((hint) => haystack.includes(hint));
}

/** The `error.type` string from the body, e.g. "rate_limit_error". */
function bodyErrorType(err: AnthropicAPIError): string {
  const body = errorBody(err);
  const t = body.error?.type ?? body.type;
  return typeof t === "string" ? t : "";
}

/** `Retry-After` header, seconds or HTTP-date, clamped to [1, 120]. */
function retryAfterSeconds(err: AnthropicAPIError, fallback: number): number {
  try {
    const raw = err.headers?.get?.("retry-after");
    if (raw) {
      const asNumber = Number(raw);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return Math.min(Math.ceil(asNumber), 120);
      }
      const asDate = Date.parse(raw);
      if (Number.isFinite(asDate)) {
        const secs = Math.ceil((asDate - Date.now()) / 1000);
        if (secs > 0) return Math.min(secs, 120);
      }
    }
  } catch {
    /* no header bag on this error kind */
  }
  return fallback;
}

// --- classification ------------------------------------------------------

/**
 * Map an unknown thrown value to one of the six codes, or `null` when it is
 * something the caller should handle itself (a bad-image 400, a 404, a plain
 * bug). Never throws.
 */
export function classifyAnthropicError(
  err: unknown,
): ClassifiedAnthropicError | null {
  // Our server could not reach Anthropic at all.
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      code: "timeout",
      retryable: true,
      httpStatus: 504,
      detail: "timed out contacting Anthropic",
      critical: false,
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      code: "network_error",
      retryable: true,
      httpStatus: 502,
      detail: `connection error contacting Anthropic: ${err.message}`,
      critical: false,
    };
  }

  if (!(err instanceof Anthropic.APIError)) return null;

  const status = typeof err.status === "number" ? err.status : 0;
  const type = bodyErrorType(err);

  // Out of credits — check first: it arrives as a 400 invalid_request_error and
  // must not be mistaken for a malformed-request bug.
  if (mentionsCredit(err)) {
    return {
      code: "out_of_credits",
      retryable: false,
      httpStatus: 402,
      detail: `credit balance exhausted (HTTP ${status || "?"} ${type || "invalid_request_error"})`,
      critical: true,
    };
  }

  if (
    err instanceof Anthropic.RateLimitError ||
    status === 429 ||
    type === "rate_limit_error"
  ) {
    return {
      code: "rate_limited",
      retryable: true,
      retry_after_seconds: retryAfterSeconds(err, 15),
      httpStatus: 429,
      detail: "rate limited by Anthropic (429)",
      critical: false,
    };
  }

  if (
    err instanceof Anthropic.AuthenticationError ||
    status === 401 ||
    type === "authentication_error"
  ) {
    return {
      code: "auth_error",
      retryable: false,
      httpStatus: 503,
      detail: "Anthropic rejected the API key (401 authentication_error)",
      critical: true,
    };
  }

  if (status === 529 || type === "overloaded_error") {
    return {
      code: "overloaded",
      retryable: true,
      httpStatus: 503,
      detail: "Anthropic overloaded (529)",
      critical: false,
    };
  }

  // Any other 5xx from Anthropic is transient — treat it like an overload so the
  // client retries a couple of times before giving up.
  if (err instanceof Anthropic.InternalServerError || status >= 500) {
    return {
      code: "overloaded",
      retryable: true,
      httpStatus: 503,
      detail: `Anthropic server error (HTTP ${status || "5xx"})`,
      critical: false,
    };
  }

  // A 4xx with no taxonomy slot (403, 404, a non-credit 400/422). The route
  // knows what that means in its own context — let it decide.
  return null;
}

// --- fail-early short circuit ------------------------------------------------

/**
 * Process-local "the account is out of credit" latch. Once any call classifies
 * as out_of_credits we stop hammering the API from the same warm serverless
 * instance for a short window — the user should not sit through OCR + Haiku
 * extraction only to hit the same wall on the analyse call.
 *
 * Deliberately in-memory and short-lived: it self-heals when the window lapses
 * (so topping the account up does not require a redeploy), and a cold instance
 * simply starts clear.
 */
const CREDIT_LATCH_MS = 60_000;
let creditLatchUntil = 0;

function noteOutage(cls: ClassifiedAnthropicError): void {
  if (cls.code === "out_of_credits") {
    creditLatchUntil = Date.now() + CREDIT_LATCH_MS;
  }
}

/**
 * Call at the top of a route BEFORE any Anthropic work. Returns a ready
 * response when the credit latch is set, otherwise `null`.
 */
export function anthropicPreflight(routeTag: string): NextResponse | null {
  if (Date.now() >= creditLatchUntil) return null;
  const cls: ClassifiedAnthropicError = {
    code: "out_of_credits",
    retryable: false,
    httpStatus: 402,
    detail: "short-circuited — a recent call reported out_of_credits",
    critical: false,
  };
  logAnthropicOutage(routeTag, cls);
  return anthropicErrorJson(cls);
}

// --- responses & logging --------------------------------------------------

export function logAnthropicOutage(
  routeTag: string,
  cls: ClassifiedAnthropicError,
): void {
  const line = `[${routeTag}] anthropic unavailable: ${cls.code} — ${cls.detail}`;
  if (cls.critical) {
    // Surfaces in Vercel logs at error level for alerting.
    console.error(`CRITICAL: ${line}`);
  } else {
    console.warn(line);
  }
}

export function anthropicErrorJson(cls: ClassifiedAnthropicError): NextResponse {
  const body: {
    error: AnthropicErrorCode;
    retryable: boolean;
    retry_after_seconds?: number;
  } = { error: cls.code, retryable: cls.retryable };
  if (cls.retry_after_seconds != null) {
    body.retry_after_seconds = cls.retry_after_seconds;
  }
  return NextResponse.json(body, { status: cls.httpStatus });
}

/**
 * The one call a route's `catch` block makes. Returns a client response when
 * the error is a recognised Anthropic infrastructure failure (and logs it +
 * trips the credit latch), or `null` to let the route handle a domain error
 * (e.g. an unreadable image) itself.
 */
export function handleAnthropicError(
  err: unknown,
  routeTag: string,
): NextResponse | null {
  const cls = classifyAnthropicError(err);
  if (!cls) return null;
  noteOutage(cls);
  logAnthropicOutage(routeTag, cls);
  return anthropicErrorJson(cls);
}

/**
 * True when `err` is a hard Anthropic outage that will not fix itself on the
 * very next call — used by `/api/analyze` to abort before the expensive Sonnet
 * step when the cheap Haiku router already hit the wall.
 */
export function isHardAnthropicOutage(err: unknown): boolean {
  const cls = classifyAnthropicError(err);
  return cls?.code === "out_of_credits" || cls?.code === "auth_error";
}
