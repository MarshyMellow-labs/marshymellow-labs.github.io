import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import process from "node:process";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import {
  boundedInteger,
  calculateCappedIntensity,
  parseOscHeartRatePacket,
  pulsoidReading,
  reconnectDelay,
  safeBoolean,
  validateControlCommand
} from "./control-core.mjs";

const HARD_LOCAL_CAP_LIMIT = 100;
const HEARTBEAT_INTERVAL_MS = 1000;
const BACKEND_LOSS_LIMIT_MS = 30_000;
const CONTROL_ACK_TIMEOUT_MS = 4000;
const HEART_RATE_LIVE_MS = 30_000;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function requiredText(value, name, minimumLength = 1, maximumLength = 500) {
  const text = String(value || "").trim();

  if (text.length < minimumLength || text.length > maximumLength) {
    throw new Error(`${name} is missing or invalid.`);
  }

  return text;
}

function optionalIdentifier(value, name, pattern, maximumLength = 128) {
  const text = String(value || "").trim();

  if (text && (text.length > maximumLength || !pattern.test(text))) {
    throw new Error(`${name} is invalid.`);
  }

  return text;
}

function requiredNumericIdentifier(value, name) {
  const text = String(value || "").trim();
  const parsed = Number(text);

  if (!/^\d{1,15}$/.test(text) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} is missing or invalid.`);
  }

  return parsed;
}
function readConfiguration() {
  const endpointText = requiredText(
    process.env.MARSHY_CONTROL_ENDPOINT,
    "MARSHY_CONTROL_ENDPOINT",
    12,
    500
  );
  let endpoint;

  try {
    endpoint = new URL(endpointText);
  } catch {
    throw new Error("MARSHY_CONTROL_ENDPOINT must be a valid URL.");
  }

  const isLocalDevelopment = endpoint.protocol === "http:"
    && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);

  if (endpoint.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("MARSHY_CONTROL_ENDPOINT must use HTTPS outside local development.");
  }

  const companionSecret = requiredText(
    process.env.MARSHY_CONTROL_SECRET,
    "MARSHY_CONTROL_SECRET",
    32,
    1000
  );
  const liveEnabled = safeBoolean(process.env.PISHOCK_LIVE_ENABLED);
  const simulationEnabled = safeBoolean(process.env.PISHOCK_SIMULATE);

  if (liveEnabled && simulationEnabled) {
    throw new Error("Live PiShock mode and simulation mode cannot both be enabled.");
  }


  const localMaximumText = String(process.env.PISHOCK_LOCAL_MAX || "0").trim();
  const localMaximum = localMaximumText === "0"
    ? null
    : boundedInteger(localMaximumText, 1, HARD_LOCAL_CAP_LIMIT);

  if (localMaximumText !== "0" && localMaximum === null) {
    throw new Error(
      `PISHOCK_LOCAL_MAX must be 0 (disabled) or 1-${HARD_LOCAL_CAP_LIMIT}.`
    );
  }

  let pishock = null;

  if (liveEnabled) {
    const username = requiredText(process.env.PISHOCK_USERNAME, "PISHOCK_USERNAME", 1, 100);
    const apiKey = requiredText(process.env.PISHOCK_API_KEY, "PISHOCK_API_KEY", 16, 500);
    const userId = requiredNumericIdentifier(process.env.PISHOCK_USER_ID, "PISHOCK_USER_ID");
    const clientId = requiredNumericIdentifier(process.env.PISHOCK_CLIENT_ID, "PISHOCK_CLIENT_ID");
    const shockerId = requiredNumericIdentifier(process.env.PISHOCK_SHOCKER_ID, "PISHOCK_SHOCKER_ID");
    const shareCode = optionalIdentifier(
      process.env.PISHOCK_SHARE_CODE,
      "PISHOCK_SHARE_CODE",
      /^[a-zA-Z0-9-]{4,128}$/
    );


    pishock = { username, apiKey, userId, clientId, shockerId, shareCode };
  }

  const pulsoidToken = String(process.env.PULSOID_ACCESS_TOKEN || "").trim();

  if (pulsoidToken && (pulsoidToken.length < 16 || pulsoidToken.length > 2000)) {
    throw new Error("PULSOID_ACCESS_TOKEN is invalid.");
  }

  const pulsoidOscEnabled = safeBoolean(process.env.PULSOID_OSC_ENABLED);
  const pulsoidOscPortText = String(process.env.PULSOID_OSC_PORT || "9002").trim();
  const pulsoidOscPort = boundedInteger(pulsoidOscPortText, 1024, 65535);
  const pulsoidOscAddress = String(
    process.env.PULSOID_OSC_ADDRESS || "/avatar/parameters/HeartRateInt"
  ).trim();

  if (pulsoidOscEnabled && pulsoidOscPort === null) {
    throw new Error("PULSOID_OSC_PORT must be an integer from 1024 to 65535.");
  }

  if (pulsoidOscEnabled && !/^\/[a-zA-Z0-9_/-]{1,200}$/.test(pulsoidOscAddress)) {
    throw new Error("PULSOID_OSC_ADDRESS is invalid.");
  }

  if (pulsoidToken && pulsoidOscEnabled) {
    throw new Error("Direct Pulsoid and local OSC heart-rate sources cannot both be enabled.");
  }

  return {
    endpoint: endpoint.toString(),
    companionSecret,
    liveEnabled,
    simulationEnabled,
    localMaximum,
    pishock,
    pulsoidToken,
    pulsoidOscEnabled,
    pulsoidOscPort,
    pulsoidOscAddress,
    secrets: [companionSecret, pishock?.apiKey, pulsoidToken].filter(Boolean)
  };
}

function scrubMessage(error, secrets) {
  let message = error instanceof Error ? error.message : String(error || "Unknown error");

  for (const secret of secrets) {
    message = message.split(secret).join("[redacted]");
  }

  message = message
    .replace(/([?&](?:access_token|apikey|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  return (message || "Unknown error").slice(0, 200);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function eventDataText(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }

  if (data && typeof data.text === "function") {
    return data.text();
  }

  return String(data || "");
}

class CompanionBackend {
  constructor(config) {
    this.endpoint = config.endpoint;
    this.secret = config.companionSecret;
  }

  async request(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secret}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Control backend rejected the request (HTTP ${response.status}).`);
      }

      let body;

      try {
        body = await response.json();
      } catch {
        throw new Error("Control backend returned invalid JSON.");
      }

      if (!isObject(body) || body.ok !== true || !isObject(body.data)) {
        throw new Error("Control backend returned an invalid response.");
      }

      return body.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  heartbeat(payload) {
    return this.request({ action: "heartbeat", ...payload });
  }

  complete(requestId, result, reason) {
    return this.request({
      action: "complete",
      request_id: requestId,
      result,
      reason: reason || null
    });
  }
}

function parseOriginalCommand(value) {
  if (isObject(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function responseMatchesPublish(response, origin, mode) {
  const original = parseOriginalCommand(response?.OriginalCommand);
  const commands = original?.PublishCommands;

  if (!Array.isArray(commands)) {
    return false;
  }

  return commands.some((command) => {
    const body = command?.Body;
    return body?.m === mode && body?.l?.o === origin;
  });
}

class PiShockClient {
  constructor(config, handlers) {
    this.config = config;
    this.handlers = handlers;
    this.socket = null;
    this.connected = false;
    this.rawOpen = false;
    this.lastPongAt = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pendingControl = null;
    this.closing = false;
    this.lossHandled = false;
  }

  get available() {
    return this.config.simulationEnabled || this.connected;
  }

  start() {
    if (this.config.simulationEnabled) {
      log("PiShock simulation is enabled. No physical device commands will be sent.");
      this.handlers.onStateChange();
      return;
    }

    if (this.config.liveEnabled) {
      this.connect();
      return;
    }

    log("PiShock physical output is disabled. Set PISHOCK_LIVE_ENABLED=true to opt in.");
  }

  connect() {
    if (this.closing || !this.config.liveEnabled || this.socket) {
      return;
    }

    const credentials = this.config.pishock;
    const brokerUrl = new URL("wss://broker.pishock.com/v2");
    brokerUrl.searchParams.set("Username", credentials.username);
    brokerUrl.searchParams.set("ApiKey", credentials.apiKey);

    let socket;

    try {
      socket = new WebSocket(brokerUrl);
    } catch {
      this.scheduleReconnect("PiShock broker connection could not be created.");
      return;
    }

    this.socket = socket;
    this.lossHandled = false;

    socket.addEventListener("open", () => {
      if (socket !== this.socket) {
        return;
      }

      this.rawOpen = true;
      this.lastPongAt = 0;
      this.sendPing();
      this.pingTimer = setInterval(() => void this.checkBrokerHealth(), 10_000);
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) {
        return;
      }

      this.socket = null;
      this.rawOpen = false;
      this.connected = false;
      this.clearPingTimer();
      this.failPendingForTransportLoss();
      this.handlers.onStateChange();

      if (!this.lossHandled) {
        this.lossHandled = true;
        void this.handlers.onTransportLoss("PiShock broker disconnected.", false);
      }

      if (!this.closing) {
        this.scheduleReconnect("PiShock broker disconnected.");
      }
    });

    socket.addEventListener("error", () => {
      // The close event is the authoritative state transition. Never print the URL,
      // because it contains the API key.
    });
  }

  scheduleReconnect(message) {
    if (this.closing || this.reconnectTimer) {
      return;
    }

    const waitMs = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    log(`${message} Reconnecting in ${Math.round(waitMs / 1000)}s.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, waitMs);
  }

  clearPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  sendPing() {
    if (!this.rawOpen || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify({ Operation: "PING" }));
    } catch {
      this.socket.close();
    }
  }

  async checkBrokerHealth() {
    if (!this.rawOpen || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.lastPongAt && Date.now() - this.lastPongAt > 25_000) {
      if (!this.lossHandled) {
        this.lossHandled = true;
        await this.handlers.onTransportLoss("PiShock broker heartbeat timed out.", true);
      }

      this.socket?.close();
      return;
    }

    this.sendPing();
  }

  async handleMessage(data) {
    let response;

    try {
      response = JSON.parse(await eventDataText(data));
    } catch {
      return;
    }

    if (!isObject(response)) {
      return;
    }

    if (
      response.IsError === false
      && response.OriginalCommand === "PING"
      && String(response.Message || "").toUpperCase() === "PONG"
    ) {
      const firstPong = !this.connected;
      this.connected = true;
      this.lastPongAt = Date.now();
      this.reconnectAttempt = 0;

      if (firstPong) {
        log("PiShock broker connection verified.");
        this.handlers.onStateChange();
      }

      return;
    }

    const pending = this.pendingControl;

    if (!pending || !responseMatchesPublish(response, pending.origin, pending.mode)) {
      return;
    }

    if (response.IsError === true) {
      pending.finish({ result: "failed", reason: "PiShock rejected the command before publication." });
      return;
    }

    if (
      response.IsError === false
      && String(response.Message || "").toLowerCase().includes("publish successful")
    ) {
      pending.finish({ result: "executed", reason: null });
    }
  }

  commandTarget() {
    const device = this.config.pishock;
    return device.shareCode
      ? `c${device.clientId}-sops-${device.shareCode}`
      : `c${device.clientId}-ops`;
  }

  commandBody(mode, intensity, durationMs, origin) {
    const device = this.config.pishock;
    return {
      id: device.shockerId,
      m: mode,
      i: intensity,
      d: durationMs,
      r: true,
      l: {
        u: device.userId,
        ty: device.shareCode ? "sc" : "api",
        w: false,
        h: false,
        o: origin
      }
    };
  }

  publishPayload(mode, intensity, durationMs, origin) {
    return {
      Operation: "PUBLISH",
      PublishCommands: [
        {
          Target: this.commandTarget(),
          Body: this.commandBody(mode, intensity, durationMs, origin)
        }
      ]
    };
  }

  async execute(command, intensity, signal) {
    if (this.config.simulationEnabled) {
      log(
        `SIMULATION: ${command.action} at ${intensity}/${this.config.localMaximum} for ${command.durationMs}ms.`
      );

      try {
        await delay(command.durationMs, undefined, { signal });
        return { result: "executed", reason: null };
      } catch {
        return { result: "stopped", reason: "Simulation was stopped locally." };
      }
    }

    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      return { result: "failed", reason: "PiShock broker is not connected." };
    }

    if (this.pendingControl) {
      return { result: "failed", reason: "The local device command slot is busy." };
    }

    const mode = command.action === "vibrate" ? "v" : "s";
    const origin = `Marshy Control ${command.requestId.slice(0, 8)}`;
    const payload = this.publishPayload(mode, intensity, command.durationMs, origin);

    return new Promise((resolve) => {
      let settled = false;
      let sent = false;
      let timeout;

      const onAbort = () => {
        const reason = String(signal.reason || "");
        const wasStopped = ["server_stop", "local_stop", "shutdown"].includes(reason);
        finish({
          result: wasStopped ? "stopped" : sent ? "uncertain" : "failed",
          reason: wasStopped
            ? "The command was interrupted by a safety stop."
            : "PiShock connectivity was lost after the command may have been sent."
        });
      };

      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);

        if (this.pendingControl?.origin === origin) {
          this.pendingControl = null;
        }

        resolve(result);
      };

      this.pendingControl = {
        origin,
        mode,
        get sent() {
          return sent;
        },
        finish
      };

      signal.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => {
        finish({
          result: sent ? "uncertain" : "failed",
          reason: sent
            ? "PiShock publication acknowledgement timed out; the command was not retried."
            : "PiShock command could not be sent."
        });
      }, CONTROL_ACK_TIMEOUT_MS);

      if (signal.aborted) {
        onAbort();
        return;
      }

      try {
        this.socket.send(JSON.stringify(payload));
        sent = true;
      } catch {
        finish({ result: "failed", reason: "PiShock command could not be sent." });
      }
    });
  }

  failPendingForTransportLoss() {
    const pending = this.pendingControl;

    if (!pending) {
      return;
    }

    pending.finish({
      result: pending.sent ? "uncertain" : "failed",
      reason: pending.sent
        ? "PiShock disconnected after the command may have been sent; it was not retried."
        : "PiShock disconnected before the command was sent."
    });
  }

  async sendSafetyStop() {
    if (this.config.simulationEnabled) {
      log("SIMULATION: safety stop applied.");
      return true;
    }

    if (!this.rawOpen || this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    const payload = this.publishPayload("e", 0, 0, "Marshy Safety Stop");
    let attempted = false;

    // Stop is the only physical command that may be retried.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.socket.send(JSON.stringify(payload));
        attempted = true;
      } catch {
        break;
      }

      if (attempt < 2) {
        await delay(150);
      }
    }

    return attempted;
  }

  async stop() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearPingTimer();
    this.connected = false;
    this.rawOpen = false;
    this.failPendingForTransportLoss();

    const socket = this.socket;
    this.socket = null;

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Companion shutting down");
    }

    this.handlers.onStateChange();
  }
}

class PulsoidClient {
  constructor(token, handlers) {
    this.token = token;
    this.handlers = handlers;
    this.socket = null;
    this.connected = false;
    this.reading = null;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.closing = false;
  }

  start() {
    if (!this.token) {
      log("Pulsoid heart-rate display is disabled (no token configured).");
      return;
    }

    this.connect();
  }

  connect() {
    if (this.closing || !this.token || this.socket) {
      return;
    }

    const url = new URL("wss://dev.pulsoid.net/api/v1/data/real_time");
    url.searchParams.set("access_token", this.token);
    let socket;

    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket) {
        return;
      }

      this.connected = true;
      this.reconnectAttempt = 0;
      log("Pulsoid connection opened. Heart rate is display-only.");
      this.handlers.onStateChange();
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) {
        return;
      }

      this.socket = null;
      this.connected = false;
      this.reading = null;
      this.handlers.onStateChange();

      if (!this.closing) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", () => {
      // The close event handles state and reconnection. Do not print a URL that
      // contains the Pulsoid access token.
    });
  }

  async handleMessage(data) {
    const reading = pulsoidReading(await eventDataText(data));

    if (!reading) {
      return;
    }

    this.reading = reading;
    this.handlers.onStateChange();
  }

  scheduleReconnect() {
    if (this.closing || this.reconnectTimer) {
      return;
    }

    const waitMs = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    log(`Pulsoid disconnected. Reconnecting in ${Math.round(waitMs / 1000)}s.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, waitMs);
  }

  currentReading() {
    if (!this.connected || !this.reading || Date.now() - this.reading.receivedAt > HEART_RATE_LIVE_MS) {
      return null;
    }

    return this.reading;
  }

  stop() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connected = false;
    this.reading = null;

    const socket = this.socket;
    this.socket = null;

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Companion shutting down");
    }

    this.handlers.onStateChange();
  }
}

class OscHeartRateClient {
  constructor(enabled, port, address, handlers) {
    this.enabled = enabled;
    this.port = port;
    this.address = address;
    this.handlers = handlers;
    this.socket = null;
    this.reading = null;
    this.hasReceivedReading = false;
  }

  get connected() {
    return Boolean(this.currentReading());
  }

  start() {
    if (!this.enabled) {
      log("Pulsoid heart-rate display is disabled (no source configured).");
      return;
    }

    const socket = createSocket("udp4");
    this.socket = socket;

    socket.on("message", (packet) => {
      const heartRate = parseOscHeartRatePacket(packet, this.address);

      if (heartRate === null) {
        return;
      }

      const receivedAt = Date.now();
      this.reading = {
        heartRate,
        measuredAt: new Date(receivedAt).toISOString(),
        receivedAt
      };

      if (!this.hasReceivedReading) {
        this.hasReceivedReading = true;
        log("PulsoidToOSC heart-rate feed received. Heart rate is display-only.");
      }

      this.handlers.onStateChange();
    });

    socket.on("error", () => {
      this.reading = null;
      this.handlers.onStateChange();
      log("PulsoidToOSC listener stopped after a local UDP error.");
      try {
        socket.close();
      } catch {
        // It may already be closed or may have failed before binding.
      }
    });

    socket.bind(this.port, "127.0.0.1", () => {
      log(`Listening for PulsoidToOSC on 127.0.0.1:${this.port}${this.address}.`);
    });
  }

  currentReading() {
    if (!this.reading || Date.now() - this.reading.receivedAt > HEART_RATE_LIVE_MS) {
      return null;
    }

    return this.reading;
  }

  stop() {
    this.reading = null;
    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        socket.close();
      } catch {
        // It may already be closed or may have failed before binding.
      }
    }

    this.handlers.onStateChange();
  }
}

class MarshyCompanion {
  constructor(config) {
    this.config = config;
    this.backend = new CompanionBackend(config);
    this.sessionId = `companion-${randomUUID()}`;
    this.armed = false;
    this.armedAt = 0;
    this.serverStopActive = true;
    this.stopAckGeneration = 0;
    this.handledStopGeneration = -1;
    this.lastBackendSuccess = 0;
    this.lastError = null;
    this.lastLoggedBackendError = null;
    this.activeExecution = null;
    this.completions = new Map();
    this.completionFlushRunning = false;
    this.closing = false;
    this.input = null;

    const stateHandler = () => {};
    this.pishock = new PiShockClient(config, {
      onStateChange: stateHandler,
      onTransportLoss: (reason, canStop) => this.handleTransportLoss(reason, canStop)
    });
    this.pulsoid = config.pulsoidOscEnabled
      ? new OscHeartRateClient(
        true,
        config.pulsoidOscPort,
        config.pulsoidOscAddress,
        { onStateChange: stateHandler }
      )
      : new PulsoidClient(config.pulsoidToken, {
        onStateChange: stateHandler
      });
  }

  backendIsFresh() {
    return this.lastBackendSuccess > 0
      && Date.now() - this.lastBackendSuccess <= BACKEND_LOSS_LIMIT_MS;
  }

  heartbeatState() {
    const reading = this.pulsoid.currentReading();
    const locallyArmed = this.armed
      && this.backendIsFresh()
      && !this.serverStopActive
      && this.pishock.available;

    return {
      session_id: this.sessionId,
      pishock_connected: this.pishock.available,
      pishock_paused: !locallyArmed,
      locally_armed: locallyArmed,
      local_cap_configured: this.config.localMaximum !== null,
      pulsoid_connected: this.pulsoid.connected,
      pulsoid_live: Boolean(reading),
      heart_rate: reading?.heartRate ?? null,
      heart_rate_measured_at: reading?.measuredAt ?? null,
      stop_ack_generation: this.stopAckGeneration,
      error: this.lastError
    };
  }

  async start() {
    this.pishock.start();
    this.pulsoid.start();
    this.startConsole();

    log("Control Marshy companion started DISARMED.");
    log(`Compiled-in local intensity ceiling: ${HARD_LOCAL_CAP_LIMIT}/100.`);

    if (this.config.localMaximum === null) {
      log("No local maximum is configured, so control requests cannot execute.");
    } else {
      log(`Owner-set local maximum: ${this.config.localMaximum}/${HARD_LOCAL_CAP_LIMIT}.`);
    }

    log("Type 'help' for local safety commands.");

    while (!this.closing) {
      const startedAt = Date.now();
      await this.tick();
      const remaining = Math.max(0, HEARTBEAT_INTERVAL_MS - (Date.now() - startedAt));

      if (!this.closing) {
        await delay(remaining);
      }
    }
  }

  async tick() {
    void this.flushCompletions();

    try {
      const response = await this.backend.heartbeat(this.heartbeatState());
      this.lastBackendSuccess = Date.now();
      this.lastError = null;

      if (this.lastLoggedBackendError) {
        log("Control backend connection restored.");
        this.lastLoggedBackendError = null;
      }

      const stopRequired = response.stop_required === true;
      const generation = safeGeneration(response.stop_generation);
      this.serverStopActive = stopRequired;

      if (stopRequired) {
        if (generation > this.handledStopGeneration || this.armed) {
          await this.handleServerStop(generation);
        }
        return;
      }

      if (response.command !== null && response.command !== undefined) {
        this.beginCommand(response.command);
      }
    } catch (error) {
      this.lastError = scrubMessage(error, this.config.secrets);

      if (this.lastError !== this.lastLoggedBackendError) {
        log(`Control backend error: ${this.lastError}`);
        this.lastLoggedBackendError = this.lastError;
      }

      if (!this.backendIsFresh()) {
        await this.disarm("Control backend has been unavailable for over 30 seconds.", true, "transport_lost");
      }
    }
  }

  async handleServerStop(generation) {
    await this.disarm("Server emergency stop is active.", true, "server_stop");
    this.handledStopGeneration = Math.max(this.handledStopGeneration, generation);
    this.stopAckGeneration = Math.max(this.stopAckGeneration, generation);
  }

  async handleTransportLoss(reason, canStop) {
    await this.disarm(reason, canStop, "transport_lost");
  }

  async disarm(reason, sendStop, abortReason) {
    const wasArmed = this.armed;
    const hadActiveExecution = Boolean(this.activeExecution);
    this.armed = false;
    this.armedAt = 0;

    if (this.activeExecution) {
      this.activeExecution.abortController.abort(abortReason);
    }

    const forceStop = ["server_stop", "local_stop", "shutdown"].includes(abortReason);

    if (sendStop && (wasArmed || hadActiveExecution || forceStop)) {
      await this.pishock.sendSafetyStop();
    }

    if (wasArmed) {
      log(`DISARMED: ${reason}`);
    }
  }

  beginCommand(rawCommand) {
    let command;

    try {
      command = validateControlCommand(rawCommand);
    } catch (error) {
      this.lastError = scrubMessage(error, this.config.secrets);
      log(`Rejected an invalid server command: ${this.lastError}`);
      return;
    }

    if (this.activeExecution) {
      if (this.activeExecution.requestId !== command.requestId) {
        this.queueCompletion(command.requestId, "failed", "The local command slot is already busy.");
      }
      return;
    }

    const abortController = new AbortController();
    this.activeExecution = {
      requestId: command.requestId,
      abortController
    };
    void this.executeCommand(command, abortController);
  }

  async executeCommand(command, abortController) {
    let outcome;

    try {
      if (
        !this.armed
        || this.serverStopActive
        || !this.backendIsFresh()
        || !this.pishock.available
        || this.config.localMaximum === null
      ) {
        outcome = { result: "failed", reason: "The companion was not safely armed when execution began." };
      } else {
        const intensity = calculateCappedIntensity(
          this.config.localMaximum,
          command.tierPercent
        );
        outcome = await this.pishock.execute(command, intensity, abortController.signal);
      }
    } catch (error) {
      outcome = {
        result: "failed",
        reason: scrubMessage(error, this.config.secrets)
      };
    } finally {
      if (this.activeExecution?.requestId === command.requestId) {
        this.activeExecution = null;
      }
    }

    this.queueCompletion(command.requestId, outcome.result, outcome.reason);
    log(`Request ${command.requestId.slice(0, 8)} finished as ${outcome.result}.`);
    void this.flushCompletions();
  }

  queueCompletion(requestId, result, reason) {
    this.completions.set(requestId, { result, reason: String(reason || "").slice(0, 200) || null });
  }

  async flushCompletions() {
    if (this.completionFlushRunning || this.closing && this.completions.size === 0) {
      return;
    }

    const next = this.completions.entries().next();

    if (next.done) {
      return;
    }

    this.completionFlushRunning = true;
    const [requestId, completion] = next.value;

    try {
      await this.backend.complete(requestId, completion.result, completion.reason);
      this.completions.delete(requestId);
      this.lastBackendSuccess = Date.now();
    } catch (error) {
      this.lastError = scrubMessage(error, this.config.secrets);
      // Reporting a completion is idempotent and may be retried. Physical control
      // commands are never retried here.
    } finally {
      this.completionFlushRunning = false;
    }
  }

  arm() {
    if (this.closing) {
      return;
    }

    if (!this.config.liveEnabled && !this.config.simulationEnabled) {
      log("Cannot arm: physical output and simulation are both disabled.");
      return;
    }

    if (this.config.localMaximum === null) {
      log("Cannot arm: configure PISHOCK_LOCAL_MAX first.");
      return;
    }

    if (!this.backendIsFresh()) {
      log("Cannot arm: the control backend has not responded recently.");
      return;
    }

    if (this.serverStopActive) {
      log("Cannot arm: the server emergency stop is active.");
      return;
    }

    if (!this.pishock.available) {
      log("Cannot arm: the PiShock broker is not connected.");
      return;
    }

    if (this.activeExecution) {
      log("Cannot arm while a command is being resolved.");
      return;
    }

    this.armed = true;
    this.armedAt = Date.now();
    log("ARMED locally until stopped. Type 'stop' to disarm immediately.");
  }

  printStatus() {
    const reading = this.pulsoid.currentReading();
    const mode = this.config.simulationEnabled
      ? "simulation"
      : this.config.liveEnabled ? "live" : "disabled";
    console.log(JSON.stringify({
      mode,
      locallyArmed: this.armed,
      armedSince: this.armed && this.armedAt
        ? new Date(this.armedAt).toISOString()
        : null,
      serverEmergencyStop: this.serverStopActive,
      backendConnected: this.backendIsFresh(),
      pishockConnected: this.pishock.available,
      localMaximum: this.config.localMaximum,
      hardLocalCeiling: HARD_LOCAL_CAP_LIMIT,
      pulsoidConnected: this.pulsoid.connected,
      heartRateLive: Boolean(reading),
      heartRate: reading?.heartRate ?? null,
      pendingCompletionReports: this.completions.size,
      lastBackendError: this.lastError
    }, null, 2));
  }

  startConsole() {
    this.input = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.input.on("line", (line) => {
      const command = line.trim().toLowerCase();

      if (command === "arm") {
        this.arm();
      } else if (command === "disarm" || command === "stop") {
        void this.disarm("Local stop requested.", true, "local_stop");
      } else if (command === "status") {
        this.printStatus();
      } else if (command === "help") {
        console.log("Commands: arm, stop, disarm, status, quit");
      } else if (command === "quit" || command === "exit") {
        void this.shutdown();
      } else if (command) {
        console.log("Unknown command. Type 'help'.");
      }
    });
  }

  async shutdown() {
    if (this.closing) {
      return;
    }

    this.closing = true;
    log("Shutting down safely.");
    await this.disarm("Companion is shutting down.", true, "shutdown");

    for (let attempt = 0; attempt < 3 && this.completions.size; attempt += 1) {
      await this.flushCompletions();
    }

    try {
      await this.backend.heartbeat({
        ...this.heartbeatState(),
        pishock_paused: true,
        locally_armed: false
      });
    } catch {
      // The server will mark this companion offline after its normal stale timeout.
    }

    this.pulsoid.stop();
    await this.pishock.stop();
    this.input?.close();
  }
}

function assertRuntime() {
  const major = Number(process.versions.node.split(".", 1)[0]);

  if (!Number.isInteger(major) || major < 22 || typeof WebSocket !== "function") {
    throw new Error("Control Marshy requires Node.js 22 or newer.");
  }
}

let companion;

try {
  assertRuntime();
  const config = readConfiguration();
  companion = new MarshyCompanion(config);

  let signalHandled = false;
  const handleSignal = () => {
    if (!signalHandled) {
      signalHandled = true;
      void companion.shutdown();
    }
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  await companion.start();
} catch (error) {
  const secrets = companion?.config?.secrets || [
    process.env.MARSHY_CONTROL_SECRET,
    process.env.PISHOCK_API_KEY,
    process.env.PULSOID_ACCESS_TOKEN
  ].filter(Boolean);
  console.error(`Control Marshy did not start: ${scrubMessage(error, secrets)}`);
  process.exitCode = 1;
}
