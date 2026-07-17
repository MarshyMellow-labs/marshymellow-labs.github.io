import { createClient } from "jsr:@supabase/supabase-js@2.110.7";

const AUTH_FAILURE_LIMIT = 20;
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const failedAuth = new Map<string, { count: number; resetAt: number }>();

const allowedStates = new Set([
  "unknown",
  "offline",
  "online",
  "traveling",
  "private",
  "public"
]);

const instanceTypes = new Map([
  ["public", "Public"],
  ["friends+", "Friends+"],
  ["friends", "Friends"],
  ["group+", "Group+"],
  ["group public", "Group Public"],
  ["group", "Group"],
  ["invite+", "Invite+"],
  ["invite", "Invite"]
]);

const fullDetailsTypes = new Set(["Public", "Friends+", "Group+", "Group Public"]);
const mapOnlyTypes = new Set(["Friends", "Group", "Invite+", "Invite"]);

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

  return forwardedAddress ? forwardedAddress.slice(0, 80) : "";
}

function authRetryAfter(address: string) {
  if (!address) {
    return 0;
  }

  const now = Date.now();
  const entry = failedAuth.get(address);

  if (!entry || entry.resetAt <= now) {
    failedAuth.delete(address);
    return 0;
  }

  return entry.count >= AUTH_FAILURE_LIMIT
    ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    : 0;
}

function recordAuthFailure(address: string) {
  if (!address) {
    return;
  }

  const now = Date.now();
  const entry = failedAuth.get(address);

  if (!entry || entry.resetAt <= now) {
    failedAuth.set(address, {
      count: 1,
      resetAt: now + AUTH_FAILURE_WINDOW_MS
    });
    return;
  }

  entry.count += 1;
}

function clearAuthFailures(address: string) {
  if (address) {
    failedAuth.delete(address);
  }
}

function cleanPlayerNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const name = item.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = name.toLocaleLowerCase();

    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }

    if (names.length >= 200) {
      break;
    }
  }

  return names.sort((left, right) => left.localeCompare(right));
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
  const retryAfter = authRetryAfter(address);

  if (retryAfter) {
    return jsonResponse(
      { error: "Too many failed authorization attempts" },
      429,
      { "Retry-After": String(retryAfter) }
    );
  }

  const expectedSecret = Deno.env.get("MARSHY_STATUS_SECRET") || "";
  const suppliedSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";

  if (!expectedSecret || !secureEqual(suppliedSecret, expectedSecret)) {
    recordAuthFailure(address);
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  clearAuthFailures(address);

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

    const parsedBody = JSON.parse(rawBody);

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return jsonResponse({ error: "Invalid JSON object" }, 400);
    }

    body = parsedBody as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const state = String(body.state || "").toLowerCase();

  if (!allowedStates.has(state)) {
    return jsonResponse({ error: "Invalid status state" }, 400);
  }

  const rawWorldName = typeof body.world_name === "string"
    ? body.world_name.trim().replace(/\s+/g, " ")
    : "";
  const rawMessage = typeof body.message === "string"
    ? body.message.trim().replace(/\s+/g, " ")
    : "";
  const suppliedType = typeof body.instance_type === "string"
    ? body.instance_type.trim().toLocaleLowerCase()
    : "";
  const instanceType = instanceTypes.get(suppliedType)
    || (state === "public" ? "Public" : null);
  const isInWorld = state === "public" || state === "private";

  if (isInWorld && !rawWorldName) {
    return jsonResponse({ error: "An in-world status requires a world name" }, 400);
  }

  if (isInWorld && !instanceType) {
    return jsonResponse({ error: "An in-world status requires a valid instance type" }, 400);
  }

  if (state === "public" && instanceType && !fullDetailsTypes.has(instanceType)) {
    return jsonResponse({ error: "That instance type must use map-only privacy" }, 400);
  }

  if (state === "private" && instanceType && !mapOnlyTypes.has(instanceType)) {
    return jsonResponse({ error: "That instance type is not map-only" }, 400);
  }

  const playerNames = state === "public" ? cleanPlayerNames(body.player_names) : null;

  const payload = {
    id: "marshy",
    state,
    world_name: isInWorld ? rawWorldName.slice(0, 160) : null,
    instance_type: isInWorld ? instanceType : null,
    player_count: playerNames?.length ?? null,
    player_names: playerNames,
    message: rawMessage ? rawMessage.slice(0, 200) : null,
    source: "vrchat-log-updater",
    updated_at: new Date().toISOString()
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Function environment is incomplete" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data, error } = await supabase
    .from("marshy_status")
    .upsert(payload, { onConflict: "id" })
    .select("state, world_name, instance_type, player_count, updated_at, force_hidden")
    .single();

  if (error) {
    console.error(error);
    return jsonResponse({ error: "Could not update status" }, 500);
  }

  return jsonResponse({ ok: true, status: data });
});
