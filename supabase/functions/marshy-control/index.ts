import { createClient } from "jsr:@supabase/supabase-js@2.110.7";

const MAX_BODY_BYTES = 16 * 1024;
const AUTH_FAILURE_LIMIT = 12;
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 10 * 1000;

type Counter = { count: number; resetAt: number };

const failedAuth = new Map<string, Counter>();
const requestCounts = new Map<string, Counter>();

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

function requestAddress(request: Request) {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();

  if (cloudflareAddress) {
    return cloudflareAddress.slice(0, 80);
  }

  const forwardedAddress = request.headers.get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();

  return forwardedAddress ? forwardedAddress.slice(0, 80) : "unknown";
}

function retryAfter(counter: Map<string, Counter>, key: string, limit: number) {
  const now = Date.now();
  const entry = counter.get(key);

  if (!entry || entry.resetAt <= now) {
    counter.delete(key);
    return 0;
  }

  return entry.count >= limit
    ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    : 0;
}

function incrementCounter(
  counter: Map<string, Counter>,
  key: string,
  windowMs: number
) {
  const now = Date.now();
  const entry = counter.get(key);

  if (!entry || entry.resetAt <= now) {
    counter.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  entry.count += 1;
}

function cleanSessionId(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const sessionId = value.trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(sessionId) ? sessionId : "";
}

function cleanError(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const error = value.trim().replace(/\s+/g, " ").slice(0, 200);
  return error || null;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function heartRateValue(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 20 && Number(value) <= 260
    ? Number(value)
    : null;
}

function measuredAtValue(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return jsonResponse({ error: "Content-Type must be application/json" }, 415);
  }

  const address = requestAddress(request);
  const authDelay = retryAfter(failedAuth, address, AUTH_FAILURE_LIMIT);
  const requestDelay = retryAfter(requestCounts, address, REQUEST_LIMIT);

  if (authDelay || requestDelay) {
    return jsonResponse(
      { error: "Too many requests" },
      429,
      { "Retry-After": String(Math.max(authDelay, requestDelay)) }
    );
  }

  incrementCounter(requestCounts, address, REQUEST_WINDOW_MS);

  const expectedSecret = Deno.env.get("MARSHY_CONTROL_COMPANION_SECRET") || "";
  const suppliedSecret = request.headers.get("Authorization")
    ?.replace(/^Bearer\s+/i, "") || "";

  if (!expectedSecret || !secureEqual(suppliedSecret, expectedSecret)) {
    incrementCounter(failedAuth, address, AUTH_FAILURE_WINDOW_MS);
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  failedAuth.delete(address);

  const declaredLength = Number(request.headers.get("Content-Length") || 0);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large" }, 413);
  }

  let body: Record<string, unknown>;

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Request body is too large" }, 413);
    }

    const parsed = JSON.parse(rawBody);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Invalid JSON object" }, 400);
    }

    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Function environment is incomplete" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const action = typeof body.action === "string" ? body.action.trim() : "";
  let result;

  if (action === "heartbeat") {
    const sessionId = cleanSessionId(body.session_id);

    if (!sessionId) {
      return jsonResponse({ error: "Invalid companion session" }, 400);
    }

    const stopGeneration = Number.isSafeInteger(body.stop_ack_generation)
      && Number(body.stop_ack_generation) >= 0
      ? Number(body.stop_ack_generation)
      : null;

    const { data, error } = await supabase.rpc(
      "companion_marshy_control_heartbeat",
      {
        reported_session_id: sessionId,
        reported_pishock_connected: booleanValue(body.pishock_connected, false),
        reported_pishock_paused: booleanValue(body.pishock_paused, true),
        reported_locally_armed: booleanValue(body.locally_armed, false),
        reported_local_cap_configured: booleanValue(
          body.local_cap_configured,
          false
        ),
        reported_pulsoid_connected: booleanValue(body.pulsoid_connected, false),
        reported_pulsoid_live: booleanValue(body.pulsoid_live, false),
        reported_heart_rate: heartRateValue(body.heart_rate),
        reported_heart_rate_measured_at: measuredAtValue(body.heart_rate_measured_at),
        reported_stop_ack_generation: stopGeneration,
        reported_error: cleanError(body.error)
      }
    );

    if (error) {
      console.error("Control heartbeat RPC failed", error.code);
      return jsonResponse({ error: "Could not update companion state" }, 500);
    }

    result = data;
  } else if (action === "complete") {
    const requestId = typeof body.request_id === "string"
      ? body.request_id.trim()
      : "";
    const completion = typeof body.result === "string"
      ? body.result.trim().toLowerCase()
      : "";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      || !["executed", "failed", "uncertain", "stopped"].includes(completion)
    ) {
      return jsonResponse({ error: "Invalid completion payload" }, 400);
    }

    const { data, error } = await supabase.rpc(
      "companion_complete_marshy_control_request",
      {
        target_request_id: requestId,
        completion_result: completion,
        completion_reason: cleanError(body.reason)
      }
    );

    if (error) {
      console.error("Control completion RPC failed", error.code);
      return jsonResponse({ error: "Could not complete request" }, 500);
    }

    result = data;
  } else {
    return jsonResponse({ error: "Unknown action" }, 400);
  }

  return jsonResponse({ ok: true, data: result });
});
