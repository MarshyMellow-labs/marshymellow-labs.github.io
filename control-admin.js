(function () {
  "use strict";

  const SUPABASE_URL = "https://hnqrptrfxxtuxhawyvge.supabase.co";
  const SUPABASE_KEY = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";
  const REFRESH_INTERVAL_MS = 5000;
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const elements = {
    discordLogin: document.querySelector("#admin-discord-login"),
    section: document.querySelector("#control-admin-section"),
    statusPill: document.querySelector("#control-admin-status-pill"),
    message: document.querySelector("#control-admin-message"),
    stop: document.querySelector("#control-stop-button"),
    resetStop: document.querySelector("#control-reset-stop-button"),
    form: document.querySelector("#control-settings-form"),
    queue: document.querySelector("#control-admin-queue"),
    blocks: document.querySelector("#control-admin-blocks"),
    audit: document.querySelector("#control-admin-audit"),
    refreshAudit: document.querySelector("#control-refresh-audit"),
    companionState: document.querySelector("#control-companion-state"),
    pishockState: document.querySelector("#control-pishock-state"),
    armState: document.querySelector("#control-arm-state"),
    pulsoidState: document.querySelector("#control-pulsoid-state"),
    heartRateState: document.querySelector("#control-heart-rate-state"),
    enabled: document.querySelector("#control-enabled"),
    shareHeartRate: document.querySelector("#control-share-heart-rate"),
    cooldown: document.querySelector("#control-cooldown"),
    queueLimit: document.querySelector("#control-queue-limit"),
    requestTtl: document.querySelector("#control-request-ttl"),
    discordAge: document.querySelector("#control-discord-age"),
    vibratePercent: document.querySelector("#control-vibrate-percent"),
    vibrateDuration: document.querySelector("#control-vibrate-duration"),
    lowPercent: document.querySelector("#control-low-percent"),
    lowCost: document.querySelector("#control-low-cost"),
    lowDuration: document.querySelector("#control-low-duration"),
    highPercent: document.querySelector("#control-high-percent"),
    highCost: document.querySelector("#control-high-cost"),
    highDuration: document.querySelector("#control-high-duration"),
    extremePercent: document.querySelector("#control-extreme-percent"),
    extremeCost: document.querySelector("#control-extreme-cost"),
    extremeDuration: document.querySelector("#control-extreme-duration"),
    rouletteCost: document.querySelector("#control-roulette-cost"),
    rouletteSlots: document.querySelector("#control-roulette-slots"),
    rouletteVibrateCount: document.querySelector("#control-roulette-vibrate-count"),
    rouletteLowCount: document.querySelector("#control-roulette-low-count"),
    rouletteLowPercent: document.querySelector("#control-roulette-low-percent"),
    rouletteHighCount: document.querySelector("#control-roulette-high-count"),
    rouletteHighPercent: document.querySelector("#control-roulette-high-percent"),
    rouletteExtremeCount: document.querySelector("#control-roulette-extreme-count"),
    rouletteExtremePercent: document.querySelector("#control-roulette-extreme-percent"),
    rouletteMegaCount: document.querySelector("#control-roulette-mega-count"),
    rouletteMegaPercent: document.querySelector("#control-roulette-mega-percent")
  };

  if (!elements.section || !elements.discordLogin) {
    return;
  }

  let currentSession = null;
  let authorized = false;
  let stateRefreshInFlight = false;
  let auditRefreshInFlight = false;
  let latestState = null;
  let refreshTimer = null;
  let formDirty = false;

  function redirectUrl() {
    const url = new URL("admin.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function setMessage(text, isError) {
    elements.message.textContent = text || "";
    elements.message.style.color = isError ? "#b72f48" : "";
  }

  function friendlyError(error) {
    const value = String(error?.message || error || "").toLowerCase();

    if (value.includes("site_admin_required")) {
      return "This Discord account is not on the site-admin allowlist.";
    }

    if (value.includes("marshy_control_tiers_in_order")) {
      return "Tier strengths must remain in Low ≤ High ≤ Extreme order.";
    }

    if (value.includes("marshy_control_costs_in_order")) {
      return "Token costs must remain in Low ≤ High ≤ Extreme order and cannot exceed 300.";
    }

    if (value.includes("cooldown")) {
      return "The global cooldown cannot be shorter than 1 second.";
    }

    if (value.includes("roulette_prize_counts_do_not_match_wheel_size")) {
      return "The roulette prize counts must add up to the wheel size.";
    }

    if (value.includes("invalid_roulette_settings")) {
      return "Check the roulette cost, wheel size, prize counts, and increasing strengths.";
    }

    return "The Marshy Zappy Zaps action could not be completed.";
  }

  function setInput(element, value) {
    if (element && value !== null && value !== undefined) {
      element.value = String(value);
    }
  }

  function inputNumber(element) {
    const value = Number(element.value);

    if (!Number.isInteger(value)) {
      throw new Error("Every numeric control setting must be a whole number.");
    }

    return value;
  }

  function formatTime(value) {
    if (!value) {
      return "Unknown time";
    }

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown time";
  }

  function displayDiscordName(value) {
    const cleaned = typeof value === "string" ? value.trim() : "";
    const withoutInternalId = cleaned.replace(
      /(?:\s*[([]\s*)?usr_[a-z0-9-]{8,}(?:\s*[)\]])?/gi,
      ""
    )
      .replace(/\s{2,}/g, " ")
      .replace(/[\u200b-\u200d\ufeff]/gi, "")
      .replace(/[()[\]\s]+$/g, "")
      .trim();

    if (!withoutInternalId) {
      return "Discord user";
    }

    return withoutInternalId;
  }

  function formatAction(value) {
    return {
      vibrate: "Vibrate",
      low: "Low Zap",
      high: "High Zap",
      extreme: "Extreme Zap"
    }[value] || "Request";
  }

  function formatRequestStatus(value) {
    return {
      queued: "Queued",
      executing: "Running",
      executed: "Completed",
      cancelled: "Cancelled",
      expired: "Expired",
      failed: "Failed",
      uncertain: "Delivery uncertain"
    }[value] || "Unknown status";
  }

  function hasActiveTimeout(entry) {
    const until = new Date(entry?.timeout_until).getTime();
    return Number.isFinite(until) && until > Date.now();
  }

  function isRecent(value, seconds) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && Date.now() - timestamp <= seconds * 1000;
  }

  function roulettePrize(settings, action, fallbackPercent, fallbackCount) {
    const prizes = Array.isArray(settings.roulette_prizes) ? settings.roulette_prizes : [];
    const found = prizes.find((prize) => prize?.action === action);
    return {
      count: found && Number.isInteger(Number(found.count)) ? Number(found.count) : fallbackCount,
      percent: found && Number.isInteger(Number(found.percent)) ? Number(found.percent) : fallbackPercent
    };
  }

  function fillSettings(settings) {
    elements.enabled.disabled = Boolean(settings.emergency_stopped);

    if (formDirty) {
      return;
    }

    elements.enabled.checked = Boolean(settings.controls_enabled);
    elements.shareHeartRate.checked = Boolean(settings.share_heart_rate);
    setInput(elements.cooldown, settings.cooldown_seconds);
    setInput(elements.queueLimit, settings.queue_limit);
    setInput(elements.requestTtl, settings.request_ttl_seconds);
    setInput(elements.discordAge, settings.minimum_discord_account_age_days);
    setInput(elements.vibratePercent, settings.vibration_percent);
    setInput(elements.vibrateDuration, settings.vibration_duration_ms);
    setInput(elements.lowPercent, settings.low_percent);
    setInput(elements.lowCost, settings.low_cost);
    setInput(elements.lowDuration, settings.low_duration_ms);
    setInput(elements.highPercent, settings.high_percent);
    setInput(elements.highCost, settings.high_cost);
    setInput(elements.highDuration, settings.high_duration_ms);
    setInput(elements.extremePercent, settings.extreme_percent);
    setInput(elements.extremeCost, settings.extreme_cost);
    setInput(elements.extremeDuration, settings.extreme_duration_ms);

    const vibrate = roulettePrize(settings, "vibrate", null, 11);
    const low = roulettePrize(settings, "low", 50, 5);
    const high = roulettePrize(settings, "high", 75, 3);
    const extreme = roulettePrize(settings, "extreme", 100, 2);
    const mega = roulettePrize(settings, "mega", 200, 1);
    const totalSlots = vibrate.count + low.count + high.count + extreme.count + mega.count;
    setInput(elements.rouletteCost, settings.roulette_cost ?? 100);
    setInput(elements.rouletteSlots, totalSlots);
    setInput(elements.rouletteVibrateCount, vibrate.count);
    setInput(elements.rouletteLowCount, low.count);
    setInput(elements.rouletteLowPercent, low.percent);
    setInput(elements.rouletteHighCount, high.count);
    setInput(elements.rouletteHighPercent, high.percent);
    setInput(elements.rouletteExtremeCount, extreme.count);
    setInput(elements.rouletteExtremePercent, extreme.percent);
    setInput(elements.rouletteMegaCount, mega.count);
    setInput(elements.rouletteMegaPercent, mega.percent);
  }

  function renderTelemetry(settings, runtime) {
    const companionOnline = isRecent(runtime.companion_last_seen, 20);
    const stopped = Boolean(settings.emergency_stopped);
    const ready = companionOnline
      && runtime.pishock_connected
      && !runtime.pishock_paused
      && runtime.locally_armed
      && runtime.local_cap_configured
      && settings.controls_enabled
      && !stopped;

    elements.statusPill.dataset.state = stopped ? "stopped" : ready ? "ready" : "offline";
    elements.statusPill.textContent = stopped
      ? "Emergency stopped"
      : ready
      ? "Ready for requests"
      : "Not ready";
    elements.companionState.textContent = companionOnline
      ? `Online · ${formatTime(runtime.companion_last_seen)}`
      : "Offline";
    elements.pishockState.textContent = runtime.pishock_connected
      ? runtime.pishock_paused ? "Connected, paused" : "Connected"
      : "Disconnected";
    elements.armState.textContent = !runtime.local_cap_configured
      ? "Local maximum missing"
      : runtime.locally_armed ? "Armed locally" : "Disarmed";
    elements.pulsoidState.textContent = runtime.pulsoid_connected
      ? runtime.pulsoid_live ? "Watch live" : "Connected, no live data"
      : "Disconnected";
    elements.heartRateState.textContent = settings.share_heart_rate
      ? runtime.pulsoid_live && runtime.heart_rate
        ? `${runtime.heart_rate} BPM public`
        : "Public, awaiting data"
      : "Hidden";
    elements.stop.disabled = stopped;
    elements.resetStop.disabled = !stopped;
  }

  function emptyState(text) {
    const paragraph = document.createElement("p");
    paragraph.className = "control-empty-state";
    paragraph.textContent = text;
    return paragraph;
  }

  function actionButton(text, handler, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;

    if (className) {
      button.className = className;
    }

    button.addEventListener("click", handler);
    return button;
  }

  function renderQueue(queue) {
    elements.queue.replaceChildren();

    if (!Array.isArray(queue) || queue.length === 0) {
      elements.queue.append(emptyState("The queue is empty."));
      return;
    }

    for (const request of queue) {
      const card = document.createElement("article");
      card.className = "control-queue-card";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${displayDiscordName(request.display_name)} · ${request.resolved_action}`;
      const details = document.createElement("p");
      details.textContent = `${request.status} · ${request.token_cost} tokens · ${formatTime(request.requested_at)}`;
      copy.append(title, details);

      const actions = document.createElement("div");
      actions.className = "control-queue-actions";
      const cancel = actionButton("Cancel & refund", () => cancelQueueRequest(request));
      cancel.disabled = request.status !== "queued";
      cancel.title = request.status === "executing"
        ? "Use the emergency stop for a request that has started."
        : "";
      const block = actionButton("Block user", () => blockUser(request));
      actions.append(cancel, block);
      card.append(copy, actions);
      elements.queue.append(card);
    }
  }

  function renderBlocks(blocks) {
    elements.blocks.replaceChildren();

    if (!Array.isArray(blocks) || blocks.length === 0) {
      elements.blocks.append(emptyState("No Discord users are blocked."));
      return;
    }

    for (const blocked of blocks) {
      const card = document.createElement("article");
      card.className = "control-block-card";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = displayDiscordName(blocked.display_name);
      const details = document.createElement("p");
      details.textContent = `${blocked.reason || "No reason recorded"} · ${formatTime(blocked.blocked_at)}`;
      copy.append(title, details);
      card.append(
        copy,
        actionButton("Unblock", () => setUserBlock(blocked.user_id, false, null))
      );
      elements.blocks.append(card);
    }
  }

  function renderAudit(entries) {
    elements.audit.replaceChildren();

    if (!Array.isArray(entries) || entries.length === 0) {
      elements.audit.append(emptyState("No Discord users have sent a Zappy request yet."));
      return;
    }

    for (const entry of entries) {
      const card = document.createElement("article");
      card.className = "control-user-card";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const username = displayDiscordName(entry.discord_username);
      title.textContent = username;
      const details = document.createElement("p");
      const requestCount = Math.max(1, Number(entry.request_count) || 1);
      details.textContent = [
        formatAction(entry.last_action),
        formatRequestStatus(entry.last_status),
        formatTime(entry.last_request_at),
        `${requestCount} request${requestCount === 1 ? "" : "s"}`
      ].join(" · ");
      copy.append(title, details);

      const timedOut = hasActiveTimeout(entry);

      if (entry.is_blocked || timedOut) {
        const restriction = document.createElement("p");
        restriction.className = "control-user-restriction";
        restriction.dataset.state = entry.is_blocked ? "blocked" : "timed-out";
        restriction.textContent = entry.is_blocked
          ? "Permanently blocked"
          : `Timed out until ${formatTime(entry.timeout_until)}`;
        copy.append(restriction);
      }

      const actions = document.createElement("div");
      actions.className = "control-user-actions";
      const timeoutControl = document.createElement("div");
      timeoutControl.className = "control-timeout-control";
      const timeoutSelect = document.createElement("select");
      timeoutSelect.setAttribute("aria-label", `Timeout length for ${username}`);

      for (const [minutes, label] of [
        [15, "15 minutes"],
        [60, "1 hour"],
        [360, "6 hours"],
        [1440, "24 hours"]
      ]) {
        const option = document.createElement("option");
        option.value = String(minutes);
        option.textContent = label;
        timeoutSelect.append(option);
      }

      const timeoutButton = actionButton(
        timedOut ? "Update timeout" : "Timeout",
        () => setUserTimeout(entry.user_id, Number(timeoutSelect.value), username)
      );
      timeoutSelect.disabled = Boolean(entry.is_blocked);
      timeoutButton.disabled = Boolean(entry.is_blocked);
      timeoutControl.append(timeoutSelect, timeoutButton);
      actions.append(timeoutControl);

      if (timedOut) {
        actions.append(
          actionButton(
            "Remove timeout",
            () => setUserTimeout(entry.user_id, 0, username)
          )
        );
      }

      const blockLabel = entry.is_blocked ? "Unblock" : "Block";
      actions.append(actionButton(blockLabel, () => {
        if (entry.is_blocked) {
          setUserBlock(entry.user_id, false, null);
          return;
        }

        if (window.confirm(`Permanently block ${username} from Marshy Zappy Zaps?`)) {
          setUserBlock(entry.user_id, true, "Blocked from recent request users");
        }
      }, entry.is_blocked ? "" : "control-block-button"));

      card.append(copy, actions);
      elements.audit.append(card);
    }
  }

  async function authorizeSession(session) {
    currentSession = session;

    if (!session) {
      authorized = false;
      return false;
    }

    const { data, error } = await db.rpc("is_site_admin");
    authorized = !error && data === true;
    return authorized;
  }

  async function refreshState() {
    if (!authorized || stateRefreshInFlight || document.hidden) {
      return;
    }

    stateRefreshInFlight = true;

    try {
      const { data, error } = await db.rpc("admin_get_marshy_control_state");

      if (error) {
        throw error;
      }

      latestState = data;
      fillSettings(data.settings || {});
      renderTelemetry(data.settings || {}, data.runtime || {});
      renderQueue(data.queue || []);
      renderBlocks(data.blocked_users || []);
    } catch (error) {
      setMessage(friendlyError(error), true);
    } finally {
      stateRefreshInFlight = false;
    }
  }

  async function refreshAudit() {
    if (!authorized || auditRefreshInFlight || document.hidden) {
      return;
    }

    auditRefreshInFlight = true;
    elements.refreshAudit.disabled = true;

    try {
      const { data, error } = await db.rpc("admin_get_marshy_control_request_users", {
        requested_limit: 100
      });

      if (error) {
        throw error;
      }

      renderAudit(data || []);
    } catch (error) {
      setMessage(friendlyError(error), true);
    } finally {
      auditRefreshInFlight = false;
      elements.refreshAudit.disabled = false;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const submitButton = elements.form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setMessage("Saving Marshy Zappy Zaps settings…");

    try {
      const rouletteSlotCount = inputNumber(elements.rouletteSlots);
      const roulettePrizes = [
        { action: "vibrate", percent: null, count: inputNumber(elements.rouletteVibrateCount) },
        { action: "low", percent: inputNumber(elements.rouletteLowPercent), count: inputNumber(elements.rouletteLowCount) },
        { action: "high", percent: inputNumber(elements.rouletteHighPercent), count: inputNumber(elements.rouletteHighCount) },
        { action: "extreme", percent: inputNumber(elements.rouletteExtremePercent), count: inputNumber(elements.rouletteExtremeCount) },
        { action: "mega", percent: inputNumber(elements.rouletteMegaPercent), count: inputNumber(elements.rouletteMegaCount) }
      ];
      const rouletteCountTotal = roulettePrizes.reduce((total, prize) => total + prize.count, 0);

      if (rouletteCountTotal !== rouletteSlotCount) {
        throw new Error("Roulette prize counts must add up to the wheel size.");
      }

      const roulettePercents = roulettePrizes.slice(1).map((prize) => prize.percent);

      if (rouletteSlotCount < 2
        || rouletteSlotCount > 60
        || roulettePercents.some((percent) => percent < 1 || percent > 200)
        || roulettePercents.some((percent, index) => index > 0 && percent < roulettePercents[index - 1])
      ) {
        throw new Error("Roulette must have 2 to 60 slices and increasing strengths from 1% to 200%.");
      }

      const settings = {
        controls_enabled: elements.enabled.checked,
        share_heart_rate: elements.shareHeartRate.checked,
        cooldown_seconds: inputNumber(elements.cooldown),
        queue_limit: inputNumber(elements.queueLimit),
        request_ttl_seconds: inputNumber(elements.requestTtl),
        minimum_discord_account_age_days: inputNumber(elements.discordAge),
        vibration_percent: inputNumber(elements.vibratePercent),
        vibration_duration_ms: inputNumber(elements.vibrateDuration),
        low_percent: inputNumber(elements.lowPercent),
        low_cost: inputNumber(elements.lowCost),
        low_duration_ms: inputNumber(elements.lowDuration),
        high_percent: inputNumber(elements.highPercent),
        high_cost: inputNumber(elements.highCost),
        high_duration_ms: inputNumber(elements.highDuration),
        extreme_percent: inputNumber(elements.extremePercent),
        extreme_cost: inputNumber(elements.extremeCost),
        extreme_duration_ms: inputNumber(elements.extremeDuration)
      };
      const { error } = await db.rpc("admin_update_marshy_control_settings", {
        new_settings: settings
      });

      if (error) {
        throw error;
      }

      const { error: rouletteError } = await db.rpc("admin_update_marshy_roulette_settings", {
        new_settings: {
          cost: inputNumber(elements.rouletteCost),
          slot_count: rouletteSlotCount,
          prizes: roulettePrizes
        }
      });

      if (rouletteError) {
        throw rouletteError;
      }

      formDirty = false;
      setMessage("Control settings saved.");
      await Promise.all([refreshState(), refreshAudit()]);
    } catch (error) {
      const localValidation = error.message?.startsWith("Every numeric")
        || error.message?.startsWith("Roulette");
      setMessage(localValidation ? error.message : friendlyError(error), true);
    } finally {
      submitButton.disabled = false;
    }
  }

  async function emergencyStop() {
    if (!window.confirm("Stop Marshy Zappy Zaps now, clear the queue, and refund every pending request?")) {
      return;
    }

    elements.stop.disabled = true;
    setMessage("Sending the emergency stop…");

    const { error } = await db.rpc("admin_emergency_stop_marshy_control");

    if (error) {
      setMessage(friendlyError(error), true);
    } else {
      formDirty = false;
      setMessage("Emergency stop active. Local re-arming will be required.");
      await Promise.all([refreshState(), refreshAudit()]);
    }
  }

  async function resetStop() {
    if (!window.confirm("Reset the website stop? Controls will remain disabled until you save them again, and the companion must still be armed locally.")) {
      return;
    }

    elements.resetStop.disabled = true;
    const { error } = await db.rpc("admin_reset_marshy_control_stop");

    if (error) {
      setMessage(friendlyError(error), true);
    } else {
      formDirty = false;
      setMessage("Stop reset. Controls remain disabled until explicitly enabled and locally armed.");
      await Promise.all([refreshState(), refreshAudit()]);
    }
  }

  async function cancelQueueRequest(request) {
    const username = displayDiscordName(request.display_name);
    if (!window.confirm(`Cancel ${username}'s queued request and refund it?`)) {
      return;
    }

    const { error } = await db.rpc("admin_cancel_marshy_control_request", {
      target_request_id: request.id
    });

    if (error) {
      setMessage(friendlyError(error), true);
    } else {
      setMessage("Request cancelled and refunded.");
      await Promise.all([refreshState(), refreshAudit()]);
    }
  }

  function blockUser(request) {
    const reason = window.prompt(
      `Reason for blocking ${displayDiscordName(request.display_name)}:`,
      "Control page abuse"
    );

    if (reason === null) {
      return;
    }

    setUserBlock(request.user_id, true, reason);
  }

  async function setUserBlock(userId, shouldBlock, reason) {
    const { error } = await db.rpc("admin_set_marshy_control_block", {
      target_user_id: userId,
      should_block: shouldBlock,
      block_reason: reason
    });

    if (error) {
      setMessage(friendlyError(error), true);
    } else {
      setMessage(shouldBlock ? "Discord user blocked." : "Discord user unblocked.");
      await Promise.all([refreshState(), refreshAudit()]);
    }
  }

  async function setUserTimeout(userId, minutes, username) {
    const { error } = await db.rpc("admin_set_marshy_control_timeout", {
      target_user_id: userId,
      timeout_minutes: minutes,
      timeout_reason: minutes > 0 ? "Timed out from recent request users" : null
    });

    if (error) {
      setMessage(friendlyError(error), true);
      return;
    }

    setMessage(
      minutes > 0
        ? `${username} timed out for ${minutes} minutes.`
        : `${username}'s timeout was removed.`
    );
    await Promise.all([refreshState(), refreshAudit()]);
  }

  async function signInWithDiscord() {
    elements.discordLogin.disabled = true;
    const { error } = await db.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: redirectUrl()
      }
    });

    if (error) {
      elements.discordLogin.disabled = false;
      const loginStatus = document.querySelector("#login-status");
      loginStatus.textContent = "Discord login could not be started.";
    }
  }

  function startRefreshTimer() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(refreshState, REFRESH_INTERVAL_MS);
  }

  elements.discordLogin.addEventListener("click", signInWithDiscord);
  elements.form.addEventListener("input", () => {
    formDirty = true;
  });
  elements.form.addEventListener("submit", saveSettings);
  elements.stop.addEventListener("click", emergencyStop);
  elements.resetStop.addEventListener("click", resetStop);
  elements.refreshAudit.addEventListener("click", refreshAudit);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshState();
      refreshAudit();
    }
  });

  db.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    window.setTimeout(async () => {
      if (await authorizeSession(session)) {
        await Promise.all([refreshState(), refreshAudit()]);
      }
    }, 0);
  });

  db.auth.getSession().then(async ({ data }) => {
    if (await authorizeSession(data?.session || null)) {
      await Promise.all([refreshState(), refreshAudit()]);
      startRefreshTimer();
    }
  });
})();
