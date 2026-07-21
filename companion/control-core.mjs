export const CONTROL_ACTIONS = new Set(["vibrate", "low", "high", "extreme"]);

export function boundedInteger(value, minimum, maximum, fallback = null) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }

  return parsed;
}

export function calculateCappedIntensity(localMaximum, tierPercent) {
  const maximum = boundedInteger(localMaximum, 1, 100);
  const percent = boundedInteger(tierPercent, 1, 200);

  if (maximum === null || percent === null) {
    throw new Error("A valid local maximum and tier percentage are required.");
  }

  return Math.max(1, Math.min(maximum, Math.round(maximum * percent / 200)));
}

export function validateControlCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("The server returned an invalid command object.");
  }

  const requestId = String(command.request_id || "").trim();
  const action = String(command.action || "").trim().toLowerCase();
  const tierPercent = boundedInteger(command.tier_percent_of_local_cap, 1, 200);
  const durationMs = boundedInteger(command.duration_ms, 100, 1000);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("The server returned an invalid request ID.");
  }

  if (!CONTROL_ACTIONS.has(action) || tierPercent === null || durationMs === null) {
    throw new Error("The server returned an out-of-range control command.");
  }

  return {
    requestId,
    action,
    tierPercent,
    durationMs
  };
}

export function reconnectDelay(attempt, minimumMs = 2000, maximumMs = 30000) {
  const safeAttempt = Math.max(0, Math.min(10, Number(attempt) || 0));
  return Math.min(maximumMs, minimumMs * (2 ** safeAttempt));
}

export function pulsoidReading(message, receivedAt = Date.now()) {
  let payload;

  try {
    payload = typeof message === "string" ? JSON.parse(message) : message;
  } catch {
    return null;
  }

  const heartRate = boundedInteger(payload?.data?.heart_rate, 20, 260);
  const measuredAt = Number(payload?.measured_at);

  if (heartRate === null || !Number.isFinite(measuredAt)) {
    return null;
  }

  const earliest = receivedAt - 5 * 60 * 1000;
  const latest = receivedAt + 60 * 1000;

  if (measuredAt < earliest || measuredAt > latest) {
    return null;
  }

  return {
    heartRate,
    measuredAt: new Date(measuredAt).toISOString(),
    receivedAt
  };
}

function readOscString(packet, startOffset) {
  if (!Buffer.isBuffer(packet) || !Number.isInteger(startOffset) || startOffset < 0) {
    return null;
  }

  const endOffset = packet.indexOf(0, startOffset);

  if (endOffset < startOffset || endOffset - startOffset > 256) {
    return null;
  }

  const value = packet.toString("utf8", startOffset, endOffset);
  const nextOffset = (endOffset + 4) & ~3;

  return nextOffset <= packet.length ? { value, nextOffset } : null;
}

export function parseOscHeartRatePacket(
  packet,
  expectedAddress = "/avatar/parameters/HeartRateInt"
) {
  if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.length > 1024) {
    return null;
  }

  const address = readOscString(packet, 0);

  if (!address || address.value !== expectedAddress) {
    return null;
  }

  const typeTags = readOscString(packet, address.nextOffset);

  if (!typeTags || typeTags.value !== ",i" || typeTags.nextOffset + 4 > packet.length) {
    return null;
  }

  return boundedInteger(packet.readInt32BE(typeTags.nextOffset), 20, 260);
}

export function safeBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}
