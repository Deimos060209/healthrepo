/* eslint-disable no-console */
/**
 * Unit checks for lib/anthropic-errors.ts — the classification of every way an
 * Anthropic call can fail into the six-code contract the browser consumes.
 *
 * Pure and free: it constructs SDK error objects with APIError.generate and the
 * connection-error constructors, and asserts the classifier's verdict. No
 * network, no API key needed.
 *
 * Run: npx tsx scripts/test-anthropic-errors.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyAnthropicError,
  handleAnthropicError,
  anthropicPreflight,
  isHardAnthropicOutage,
} from "@/lib/anthropic-errors";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const H = () => new Headers();
const body = (type: string, message: string) => ({
  type: "error",
  error: { type, message },
});

const CREDIT_MSG =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

console.log("═".repeat(64));
console.log("ANTHROPIC ERROR CLASSIFICATION");
console.log("═".repeat(64));

// --- out_of_credits ------------------------------------------------------
{
  const err = Anthropic.APIError.generate(
    400,
    body("invalid_request_error", CREDIT_MSG),
    undefined,
    H(),
  );
  const c = classifyAnthropicError(err);
  check("400 + credit message -> out_of_credits", c?.code === "out_of_credits", c?.code);
  check("out_of_credits is not retryable", c?.retryable === false);
  check("out_of_credits is critical", c?.critical === true);
  check("out_of_credits HTTP 402", c?.httpStatus === 402, String(c?.httpStatus));
}

// A credit failure that arrives as a bare BadRequestError (message only).
{
  const err = Anthropic.APIError.generate(400, undefined, `400 ${CREDIT_MSG}`, H());
  const c = classifyAnthropicError(err);
  check("credit message with no JSON body still -> out_of_credits", c?.code === "out_of_credits", c?.code);
}

// --- rate_limited ------------------------------------------------------
{
  const headers = new Headers({ "retry-after": "12" });
  const err = Anthropic.APIError.generate(
    429,
    body("rate_limit_error", "Number of requests has exceeded your rate limit"),
    undefined,
    headers,
  );
  const c = classifyAnthropicError(err);
  check("429 -> rate_limited", c?.code === "rate_limited", c?.code);
  check("rate_limited is retryable", c?.retryable === true);
  check("retry_after_seconds parsed from header (12)", c?.retry_after_seconds === 12, String(c?.retry_after_seconds));
  check("rate_limited is not critical", c?.critical === false);
}
{
  // No Retry-After header -> falls back to a sane default, never undefined.
  const err = Anthropic.APIError.generate(429, body("rate_limit_error", "slow down"), undefined, H());
  const c = classifyAnthropicError(err);
  check("rate_limited without header still has a retry_after_seconds", typeof c?.retry_after_seconds === "number");
}

// --- overloaded ------------------------------------------------------
{
  const err = Anthropic.APIError.generate(529, body("overloaded_error", "Overloaded"), undefined, H());
  const c = classifyAnthropicError(err);
  check("529 -> overloaded", c?.code === "overloaded", c?.code);
  check("overloaded is retryable", c?.retryable === true);
}
{
  const err = Anthropic.APIError.generate(500, body("api_error", "internal"), undefined, H());
  const c = classifyAnthropicError(err);
  check("500 api_error -> overloaded (retryable)", c?.code === "overloaded", c?.code);
}
{
  const err = Anthropic.APIError.generate(503, body("api_error", "unavailable"), undefined, H());
  const c = classifyAnthropicError(err);
  check("503 -> overloaded", c?.code === "overloaded", c?.code);
}

// --- auth_error ------------------------------------------------------
{
  const err = Anthropic.APIError.generate(
    401,
    body("authentication_error", "invalid x-api-key"),
    undefined,
    H(),
  );
  const c = classifyAnthropicError(err);
  check("401 -> auth_error", c?.code === "auth_error", c?.code);
  check("auth_error is not retryable", c?.retryable === false);
  check("auth_error is critical", c?.critical === true);
}

// --- connectivity ------------------------------------------------------
{
  const err = new Anthropic.APIConnectionTimeoutError({});
  const c = classifyAnthropicError(err);
  check("connection timeout -> timeout", c?.code === "timeout", c?.code);
  check("timeout is retryable", c?.retryable === true);
  check("timeout is not critical", c?.critical === false);
}
{
  const err = new Anthropic.APIConnectionError({ message: "fetch failed" });
  const c = classifyAnthropicError(err);
  check("connection error -> network_error", c?.code === "network_error", c?.code);
}

// --- pass-through (route keeps its own handling) ----------------------
{
  const err = Anthropic.APIError.generate(
    400,
    body("invalid_request_error", "image exceeds 5 MB maximum"),
    undefined,
    H(),
  );
  const c = classifyAnthropicError(err);
  check("non-credit 400 (bad image) -> null (route handles it)", c === null, String(c?.code));
}
{
  const err = Anthropic.APIError.generate(404, body("not_found_error", "model not found"), undefined, H());
  check("404 -> null", classifyAnthropicError(err) === null);
}
{
  check("a plain Error -> null", classifyAnthropicError(new Error("boom")) === null);
  check("a string -> null", classifyAnthropicError("nope") === null);
  check("undefined -> null", classifyAnthropicError(undefined) === null);
}

// --- isHardAnthropicOutage (router -> Sonnet short-circuit) -----------
{
  const credit = Anthropic.APIError.generate(400, body("invalid_request_error", CREDIT_MSG), undefined, H());
  const auth = Anthropic.APIError.generate(401, body("authentication_error", "bad key"), undefined, H());
  const rate = Anthropic.APIError.generate(429, body("rate_limit_error", "slow"), undefined, H());
  check("isHardAnthropicOutage: credit -> true", isHardAnthropicOutage(credit) === true);
  check("isHardAnthropicOutage: auth -> true", isHardAnthropicOutage(auth) === true);
  check("isHardAnthropicOutage: rate limit -> false", isHardAnthropicOutage(rate) === false);
  check("isHardAnthropicOutage: random -> false", isHardAnthropicOutage(new Error("x")) === false);
}

// --- response shape + never leaks the raw message --------------------
async function responseChecks() {
  const err = Anthropic.APIError.generate(
    429,
    body("rate_limit_error", "SECRET account id 12345 in here"),
    undefined,
    new Headers({ "retry-after": "8" }),
  );
  const res = handleAnthropicError(err, "test");
  check("handleAnthropicError returns a response for a known outage", res !== null);
  const json = res ? await res.json() : {};
  check("body.error is the code", json.error === "rate_limited", JSON.stringify(json));
  check("body.retryable present", json.retryable === true);
  check("body.retry_after_seconds present", json.retry_after_seconds === 8);
  check(
    "raw Anthropic message never appears in the client body",
    !JSON.stringify(json).includes("SECRET"),
  );
  check(
    "handleAnthropicError returns null for a bad-image 400",
    handleAnthropicError(
      Anthropic.APIError.generate(400, body("invalid_request_error", "bad image"), undefined, H()),
      "test",
    ) === null,
  );

  // Preflight latch: after a credit failure is handled, the next preflight
  // short-circuits with the same code.
  handleAnthropicError(
    Anthropic.APIError.generate(400, body("invalid_request_error", CREDIT_MSG), undefined, H()),
    "test",
  );
  const pf = anthropicPreflight("test");
  check("preflight trips after an out_of_credits failure", pf !== null);
  const pfJson = pf ? await pf.json() : {};
  check("preflight body is out_of_credits", pfJson.error === "out_of_credits", JSON.stringify(pfJson));
}

responseChecks().then(() => {
  console.log("═".repeat(64));
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  console.log("═".repeat(64));
  process.exit(fail ? 1 : 0);
});
