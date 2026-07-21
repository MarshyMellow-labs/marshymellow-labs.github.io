import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedInteger,
  calculateCappedIntensity,
  parseOscHeartRatePacket,
  pulsoidReading,
  reconnectDelay,
  safeBoolean,
  validateControlCommand
} from "../control-core.mjs";

test("boundedInteger rejects decimals and out-of-range values", () => {
  assert.equal(boundedInteger("100", 1, 100), 100);
  assert.equal(boundedInteger(0, 1, 100), null);
  assert.equal(boundedInteger(101, 1, 100), null);
  assert.equal(boundedInteger(3.5, 1, 100), null);
});

test("tier percentages are fractions of the local cap, never raw intensity", () => {
  assert.equal(calculateCappedIntensity(30, 33), 5);
  assert.equal(calculateCappedIntensity(30, 66), 10);
  assert.equal(calculateCappedIntensity(30, 100), 15);
  assert.equal(calculateCappedIntensity(30, 200), 30);
  assert.equal(calculateCappedIntensity(100, 33), 17);
  assert.equal(calculateCappedIntensity(100, 66), 33);
  assert.equal(calculateCappedIntensity(100, 100), 50);
  assert.equal(calculateCappedIntensity(100, 200), 100);
  assert.equal(calculateCappedIntensity(1, 33), 1);
  assert.throws(() => calculateCappedIntensity(0, 100));
  assert.throws(() => calculateCappedIntensity(30, 201));
});

test("server commands require a UUID, known action, percentage, and <=1s duration", () => {
  const command = validateControlCommand({
    request_id: "019f7766-4480-72b0-95c5-d885b9193ac6",
    action: "high",
    tier_percent_of_local_cap: 66,
    duration_ms: 1000
  });

  assert.deepEqual(command, {
    requestId: "019f7766-4480-72b0-95c5-d885b9193ac6",
    action: "high",
    tierPercent: 66,
    durationMs: 1000
  });

  assert.throws(() => validateControlCommand({ ...command, request_id: "bad" }));
  assert.throws(() => validateControlCommand({
    request_id: "019f7766-4480-72b0-95c5-d885b9193ac6",
    action: "continuous",
    tier_percent_of_local_cap: 50,
    duration_ms: 1000
  }));
  assert.throws(() => validateControlCommand({
    request_id: "019f7766-4480-72b0-95c5-d885b9193ac6",
    action: "low",
    tier_percent_of_local_cap: 33,
    duration_ms: 1001
  }));
  assert.throws(() => validateControlCommand({
    request_id: "019f7766-4480-72b0-95c5-d885b9193ac6",
    action: "extreme",
    tier_percent_of_local_cap: 201,
    duration_ms: 1000
  }));
});

test("Pulsoid readings are validated and freshness-bounded", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    pulsoidReading(JSON.stringify({ measured_at: now - 500, data: { heart_rate: 87 } }), now),
    {
      heartRate: 87,
      measuredAt: new Date(now - 500).toISOString(),
      receivedAt: now
    }
  );
  assert.equal(pulsoidReading("not json", now), null);
  assert.equal(pulsoidReading({ measured_at: now, data: { heart_rate: 261 } }, now), null);
  assert.equal(
    pulsoidReading({ measured_at: now - 6 * 60 * 1000, data: { heart_rate: 80 } }, now),
    null
  );
});

function oscString(value) {
  const bytes = Buffer.from(`${value}\0`, "utf8");
  const padding = Buffer.alloc((4 - bytes.length % 4) % 4);
  return Buffer.concat([bytes, padding]);
}

function oscIntegerPacket(address, value) {
  const integer = Buffer.alloc(4);
  integer.writeInt32BE(value);
  return Buffer.concat([oscString(address), oscString(",i"), integer]);
}

test("PulsoidToOSC integer packets are address, type, and range validated", () => {
  const address = "/avatar/parameters/HeartRateInt";
  assert.equal(parseOscHeartRatePacket(oscIntegerPacket(address, 87)), 87);
  assert.equal(parseOscHeartRatePacket(oscIntegerPacket(address, 19)), null);
  assert.equal(parseOscHeartRatePacket(oscIntegerPacket(address, 261)), null);
  assert.equal(parseOscHeartRatePacket(oscIntegerPacket("/wrong/path", 87)), null);
  assert.equal(parseOscHeartRatePacket(Buffer.from("invalid")), null);
});

test("reconnect delay is capped and booleans are explicit", () => {
  assert.equal(reconnectDelay(0), 2000);
  assert.equal(reconnectDelay(4), 30_000);
  assert.equal(reconnectDelay(100), 30_000);
  assert.equal(safeBoolean("true"), true);
  assert.equal(safeBoolean("TRUE"), true);
  assert.equal(safeBoolean("1"), false);
  assert.equal(safeBoolean(undefined), false);
});
