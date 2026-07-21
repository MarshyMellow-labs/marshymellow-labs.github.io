(function () {
  "use strict";

  const SUPABASE_URL = "https://hnqrptrfxxtuxhawyvge.supabase.co";
  const SUPABASE_KEY = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";
  const HEARTBEAT_INTERVAL_MS = 5000;
  const TOKEN_CAP = 300;
  const ROULETTE_COST = 100;
  const ROULETTE_LANDING_MS = 3600;
  const ROULETTE_SLOTS = [
    "Vibey!",
    "50% Zappy!",
    "Vibey!",
    "75% Zappy!!",
    "Vibey!",
    "50% Zappy!",
    "Vibey!",
    "100% Zappy!!!",
    "Vibey!",
    "50% Zappy!",
    "Vibey!",
    "75% Zappy!!",
    "Vibey!",
    "50% Zappy!",
    "Vibey!",
    "200% MEGA ZAPPY!!!!",
    "Vibey!", "75% Zappy!!", "Vibey!", "50% Zappy!", "Vibey!", "100% Zappy!!!"
  ];
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const elements = {
    login: document.querySelector("#discord-login"),
    logout: document.querySelector("#discord-logout"),
    accountName: document.querySelector("#account-name"),
    accountCopy: document.querySelector("#account-copy"),
    tokenCount: document.querySelector("#token-count"),
    tokenMeter: document.querySelector("#token-meter"),
    tokenMeterFill: document.querySelector("#token-meter-fill"),
    tokenEarning: document.querySelector("#token-earning"),
    queueCount: document.querySelector("#queue-count"),
    queueCopy: document.querySelector("#queue-copy"),
    queueBadge: document.querySelector("#queue-badge"),
    deviceStatus: document.querySelector("#device-status"),
    deviceStatusDot: document.querySelector("#device-status-dot"),
    cooldownStatus: document.querySelector("#cooldown-status"),
    heartCard: document.querySelector(".heart-card"),
    heartRate: document.querySelector("#heart-rate"),
    heartRateStatus: document.querySelector("#heart-rate-status"),
    requestPanel: document.querySelector("#request-panel"),
    requestTitle: document.querySelector("#request-title"),
    requestCopy: document.querySelector("#request-copy"),
    cancelRequest: document.querySelector("#cancel-request"),
    message: document.querySelector("#control-message"),
    rouletteWheel: document.querySelector("#roulette-wheel"),
    rouletteResult: document.querySelector("#roulette-result"),
    rouletteSpin: document.querySelector("#roulette-spin"),
    rouletteUse: document.querySelector("#roulette-use"),
    actionButtons: Array.from(document.querySelectorAll("[data-control-action]"))
  };

  const sessionId = getSessionId();
  let authSession = null;
  let currentState = null;
  let requestInFlight = false;
  let refreshInFlight = false;
  let lastServerBalance = 0;
  let lastBalanceReceivedAt = Date.now();
  let heartbeatTimer = null;
  let earningConnectionError = "";
  let rouletteRotation = 0;
  let roulettePrize = null;
  let rouletteReady = false;
  let rouletteLandingTimer = null;

  const deviceLabels = {
    ready: "Marshy's controller is ready",
    cooldown: "Marshy is cooling down",
    stopped: "Marshy pressed the emergency stop",
    offline: "Marshy's companion app is offline",
    pishock_disconnected: "The companion app cannot reach PiShock",
    paused: "The PiShock connection is paused",
    local_cap_required: "A local safety maximum must be configured",
    disarmed: "Marshy has not armed controls locally",
    disabled: "Public controls are disabled"
  };

  const errorMessages = {
    discord_login_required: "Please sign in with Discord first.",
    discord_account_too_new: "This Discord account is too new to use Marshy Zappy Zaps yet.",
    discord_identity_invalid: "Discord could not be verified for this account.",
    control_access_blocked: "This Discord account cannot use Marshy Zappy Zaps.",
    earning_session_active_elsewhere: "Tokens are already being earned in another tab or browser.",
    controller_not_ready: "Marshy's controller is not ready right now.",
    earning_session_required: "Keep this page visible for a moment, then try again.",
    request_already_pending: "You already have one request in the queue.",
    control_queue_full: "The queue is full right now. Please try again shortly.",
    not_enough_marshy_tokens: "You do not have enough Marshy Tokens for that request.",
    roulette_prize_already_waiting: "Use your existing roulette result before spinning again.",
    roulette_prize_not_found: "That roulette result is no longer available.",
    roulette_still_spinning: "Wait for the wheel to finish before using the result.",
    request_cannot_be_cancelled: "That request has already started and can no longer be cancelled."
  };

  function getSessionId() {
    try {
      const existing = window.sessionStorage.getItem("marshy-control-session-id");

      if (existing) {
        return existing;
      }

      const created = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomUuid();
      window.sessionStorage.setItem("marshy-control-session-id", created);
      return created;
    } catch {
      return typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomUuid();
    }
  }

  function randomUuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  function redirectUrl() {
    const url = new URL("control-marshy.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function accountDisplayName(session) {
    const metadata = session?.user?.user_metadata || {};
    return String(
      metadata.full_name
      || metadata.global_name
      || metadata.name
      || metadata.preferred_username
      || "Discord visitor"
    ).trim().slice(0, 80);
  }

  function messageForError(error) {
    const source = String(error?.message || error || "unknown_error").toLowerCase();

    if (source.includes("pgrst202") || source.includes("could not find the function")) {
      return "The roulette database update has not been deployed yet.";
    }
    const key = Object.keys(errorMessages).find((candidate) => source.includes(candidate));
    return key ? errorMessages[key] : "Something went wrong. Please wait a moment and try again.";
  }

  function setMessage(text, tone) {
    elements.message.textContent = text || "";

    if (tone) {
      elements.message.dataset.tone = tone;
    } else {
      delete elements.message.dataset.tone;
    }
  }

  function formatAction(action) {
    return {
      vibrate: "Vibrate",
      low: "Low Zap",
      high: "High Zap",
      extreme: "Extreme Zap"
    }[action] || "Request";
  }

  function drawRouletteWheel() {
    const canvas = elements.rouletteWheel;

    if (!canvas) {
      return;
    }

    const size = 360;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.scale(ratio, ratio);
    const center = size / 2;
    const radius = center - 8;
    const slice = (Math.PI * 2) / ROULETTE_SLOTS.length;
    const colors = ["#ff6fae", "#80d9ff", "#ffe36e", "#a98cff", "#8ce5c4"];

    ROULETTE_SLOTS.forEach((label, index) => {
      const centerAngle = -Math.PI / 2 + index * slice;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, centerAngle - slice / 2, centerAngle + slice / 2);
      context.closePath();
      context.fillStyle = colors[index % colors.length];
      context.fill();
      context.strokeStyle = "rgba(55, 40, 64, 0.45)";
      context.lineWidth = 1;
      context.stroke();

      context.save();
      context.translate(center, center);
      context.rotate(centerAngle);
      context.translate(radius * 0.64, 0);
      context.rotate(Math.PI / 2);
      context.fillStyle = "#372840";
      context.font = "900 11px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const marker = label.startsWith("Vib") ? "V" : label.match(/^\d+/)?.[0] || "?";
      context.font = `900 ${marker.length > 2 ? 12 : 15}px Arial, sans-serif`;
      context.fillText(marker, 0, 0, 28);
      context.restore();
    });
  }

  function positionRoulette(slot, animate) {
    const sliceDegrees = 360 / ROULETTE_SLOTS.length;
    const desired = (360 - (slot - 1) * sliceDegrees) % 360;

    if (animate) {
      const startRotation = rouletteRotation;
      const current = ((rouletteRotation % 360) + 360) % 360;
      rouletteRotation += ((desired - current + 360) % 360) + 5 * 360;

      if (typeof elements.rouletteWheel.animate === "function") {
        elements.rouletteWheel.getAnimations().forEach((animation) => animation.cancel());
        const spin = elements.rouletteWheel.animate(
          [
            { transform: `rotate(${startRotation}deg)` },
            { transform: `rotate(${rouletteRotation}deg)` }
          ],
          {
            duration: ROULETTE_LANDING_MS,
            easing: "cubic-bezier(0.12, 0.72, 0.12, 1)",
            fill: "forwards"
          }
        );

        spin.addEventListener("finish", () => {
          elements.rouletteWheel.style.transform = `rotate(${rouletteRotation}deg)`;
          spin.cancel();
        }, { once: true });
        return;
      }
    } else {
      rouletteRotation = desired;
    }

    elements.rouletteWheel.style.transform = `rotate(${rouletteRotation}deg)`;
  }

  function revealRoulettePrize() {
    if (!roulettePrize) {
      return;
    }

    rouletteReady = true;
    elements.rouletteUse.hidden = false;
    elements.rouletteResult.textContent = `You got: ${ROULETTE_SLOTS[roulettePrize.slot - 1]} Click Send my zappies! when you are ready.`;
    updateButtons(currentState);
  }

  function showRoulettePrize(prize, animate) {
    const slot = Number(prize?.slot);
    const id = typeof prize?.id === "string" ? prize.id : "";

    if (!id || !Number.isInteger(slot) || slot < 1 || slot > ROULETTE_SLOTS.length) {
      elements.rouletteResult.textContent = "The server returned an invalid roulette result.";
      return;
    }

    window.clearTimeout(rouletteLandingTimer);
    roulettePrize = { ...prize, id, slot };
    rouletteReady = !animate;
    elements.rouletteSpin.hidden = true;
    elements.rouletteUse.hidden = animate;
    positionRoulette(slot, animate);

    if (animate) {
      elements.rouletteResult.textContent = "The wheel is spinning...";
      rouletteLandingTimer = window.setTimeout(revealRoulettePrize, ROULETTE_LANDING_MS);
    } else {
      revealRoulettePrize();
    }
  }

  function clearRoulettePrize() {
    window.clearTimeout(rouletteLandingTimer);
    roulettePrize = null;
    rouletteReady = false;
    elements.rouletteSpin.hidden = false;
    elements.rouletteUse.hidden = true;
    elements.rouletteResult.textContent = "The result is selected securely when you spin.";
  }

  function updateAccount() {
    const loggedIn = Boolean(authSession?.user);
    elements.login.hidden = loggedIn;
    elements.logout.hidden = !loggedIn;

    if (!loggedIn) {
      elements.accountName.textContent = "Sign in to earn tokens";
      elements.accountCopy.textContent = "Discord gives each visitor one identity, one wallet, and one place in the queue.";
      return;
    }

    elements.accountName.textContent = accountDisplayName(authSession);
    elements.accountCopy.textContent = currentState?.active_session_elsewhere
      ? "This account is already earning tokens in another active page."
      : "Signed in with Discord. Keep this page visible to earn one token each second.";
  }

  function displayedBalance() {
    if (!authSession || !currentState?.earning_here || document.hidden) {
      return lastServerBalance;
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - lastBalanceReceivedAt) / 1000)
    );
    return Math.min(TOKEN_CAP, lastServerBalance + elapsedSeconds);
  }

  function updateTokenDisplay() {
    const balance = displayedBalance();
    elements.tokenCount.textContent = String(balance);
    elements.tokenMeter.setAttribute("aria-valuenow", String(balance));
    elements.tokenMeterFill.style.width = `${(balance / TOKEN_CAP) * 100}%`;

    if (!authSession) {
      elements.tokenEarning.textContent = "Sign in with Discord to begin earning.";
    } else if (earningConnectionError) {
      elements.tokenEarning.textContent = earningConnectionError;
    } else if (currentState?.active_session_elsewhere) {
      elements.tokenEarning.textContent = "Earning is active in another tab or browser.";
    } else if (document.hidden) {
      elements.tokenEarning.textContent = "Earning paused while this page is hidden.";
    } else if (balance >= TOKEN_CAP) {
      elements.tokenEarning.textContent = "Wallet full — spend tokens before earning more.";
    } else if (currentState?.earning_here) {
      elements.tokenEarning.textContent = "+1 token each second while this page stays active.";
    } else {
      elements.tokenEarning.textContent = "Connecting your earning session…";
    }
  }

  function updateHeartRate(state) {
    const live = state?.heart_rate_status === "live" && Number.isInteger(state?.heart_rate);
    elements.heartCard.dataset.live = String(live);
    elements.heartRate.dataset.hasValue = String(live);
    elements.heartRate.textContent = live ? String(state.heart_rate) : "—";

    const label = {
      live: "Live through Pulsoid",
      hidden: "Hidden by Marshy",
      pulsoid_offline: "Pulsoid is disconnected",
      watch_offline: "Waiting for the watch"
    }[state?.heart_rate_status] || "Heart rate unavailable";
    elements.heartRateStatus.textContent = label;
  }

  function updateDeviceState(state) {
    const deviceState = state?.device_state || "offline";
    elements.deviceStatus.textContent = deviceLabels[deviceState] || "Controller unavailable";
    elements.deviceStatusDot.dataset.state = deviceState;
    elements.cooldownStatus.textContent = Number(state?.cooldown_remaining) > 0
      ? `${state.cooldown_remaining}s remaining`
      : "";
  }

  function updateQueue(state) {
    const length = Number(state?.queue_length) || 0;
    const limit = Number(state?.queue_limit) || 0;
    elements.queueCount.textContent = String(length);
    elements.queueCopy.textContent = Number(state?.cooldown_remaining) > 0
      ? `The next operation can run in ${state.cooldown_remaining} seconds.`
      : "The global queue cooldown can be as short as 1 second.";

    if (limit && length >= limit) {
      elements.queueBadge.textContent = "Queue full";
    } else if (!state?.accepting_requests) {
      elements.queueBadge.textContent = "Queue paused";
    } else {
      elements.queueBadge.textContent = "Queue open";
    }
  }

  function updateRequest(state) {
    const request = state?.request;
    elements.requestPanel.hidden = !request;

    if (!request) {
      return;
    }

    const action = formatAction(request.resolved_action);
    const position = Number(request.queue_position);
    elements.requestTitle.textContent = request.status === "executing"
      ? `${action} is running now`
      : `${action} is queued`;

    if (request.status === "executing") {
      elements.requestCopy.textContent = "The companion has claimed this request. It cannot be submitted twice or automatically retried.";
    } else {
      elements.requestCopy.textContent = request.requested_action === "roulette"
        ? `Queue position: ${Math.max(1, position)}. Your roulette result is reserved.`
        : `Queue position: ${Math.max(1, position)}. ${request.token_cost} tokens are reserved.`;
    }

    elements.cancelRequest.hidden = request.status !== "queued";
  }

  function updateTierLabels(state) {
    const tiers = state?.tiers || {};

    for (const action of ["vibrate", "low", "high", "extreme"]) {
      const tier = tiers[action];

      if (!tier) {
        continue;
      }

      const costElement = document.querySelector(`[data-cost-for="${action}"]`);
      const percentElement = document.querySelector(`[data-percent-for="${action}"]`);

      if (costElement) {
        costElement.textContent = action === "vibrate" ? "Free" : String(tier.cost);
      }

      if (percentElement) {
        percentElement.textContent = String(tier.percent);
      }
    }
  }

  function updateButtons(state) {
    const balance = displayedBalance();
    const commonReason = !authSession
      ? "Sign in with Discord first."
      : document.hidden
      ? "Return to this page to use a control."
      : state?.active_session_elsewhere
      ? "This account is active in another tab or browser."
      : state?.request
      ? "You already have one request in the queue."
      : !state?.accepting_requests
      ? deviceLabels[state?.device_state] || "Marshy's controller is unavailable."
      : "";

    for (const button of elements.actionButtons) {
      const action = button.dataset.controlAction;
      const cost = Number(state?.tiers?.[action]?.cost) || 0;
      const lacksTokens = balance < cost;
      const disabled = requestInFlight || Boolean(commonReason) || lacksTokens;
      button.disabled = disabled;
      button.title = requestInFlight
        ? "Submitting your request…"
        : commonReason
        || (lacksTokens ? `You need ${cost - balance} more Marshy Tokens.` : "");
    }

    const rouletteLacksTokens = balance < ROULETTE_COST;
    elements.rouletteSpin.disabled = requestInFlight
      || Boolean(commonReason)
      || Boolean(roulettePrize)
      || rouletteLacksTokens;
    elements.rouletteSpin.title = commonReason
      || (roulettePrize ? "Use your current roulette result first." : "")
      || (rouletteLacksTokens ? `You need ${ROULETTE_COST - balance} more Marshy Tokens.` : "");

    elements.rouletteUse.disabled = requestInFlight
      || Boolean(commonReason)
      || !roulettePrize
      || !rouletteReady;
    elements.rouletteUse.title = commonReason
      || (!rouletteReady ? "Wait for the wheel to finish." : "");
  }

  function renderState(state) {
    currentState = state || {};
    lastServerBalance = Math.max(0, Math.min(TOKEN_CAP, Number(state?.token_balance) || 0));
    lastBalanceReceivedAt = Date.now();
    updateAccount();
    updateTokenDisplay();
    updateHeartRate(state);
    updateDeviceState(state);
    updateQueue(state);
    updateRequest(state);
    updateTierLabels(state);
    updateButtons(state);
  }

  async function fetchPublicState() {
    return db.rpc("get_marshy_control_state", {
      control_session_id: authSession ? sessionId : null
    });
  }

  async function refreshState() {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;

    try {
      let response;

      if (authSession) {
        if (document.hidden) {
          response = await db.rpc("release_marshy_control_session", {
            control_session_id: sessionId
          });
        } else {
          response = await db.rpc("heartbeat_marshy_control_session", {
            control_session_id: sessionId
          });
        }

        if (response.error
          && String(response.error.message).includes("earning_session_active_elsewhere")
        ) {
          const publicResponse = await fetchPublicState();

          if (!publicResponse.error) {
            renderState(publicResponse.data);
          }

          setMessage(errorMessages.earning_session_active_elsewhere, "error");
          return;
        }
      } else {
        response = await fetchPublicState();
      }

      if (response.error) {
        throw response.error;
      }

      earningConnectionError = "";
      renderState(response.data);
    } catch (error) {
      earningConnectionError = messageForError(error);
      setMessage(earningConnectionError, "error");
      updateTokenDisplay();
    } finally {
      refreshInFlight = false;
    }
  }

  async function signInWithDiscord() {
    elements.login.disabled = true;
    setMessage("Opening Discord…");

    const { error } = await db.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: redirectUrl()
      }
    });

    if (error) {
      elements.login.disabled = false;
      setMessage(messageForError(error), "error");
    }
  }

  async function signOut() {
    elements.logout.disabled = true;

    try {
      if (authSession) {
        await db.rpc("release_marshy_control_session", {
          control_session_id: sessionId
        });
      }

      const { error } = await db.auth.signOut();

      if (error) {
        throw error;
      }

      authSession = null;
      setMessage("Signed out.", "success");
      await refreshState();
    } catch (error) {
      setMessage(messageForError(error), "error");
    } finally {
      elements.logout.disabled = false;
    }
  }

  async function enqueue(action) {
    if (requestInFlight || !authSession) {
      return;
    }


    requestInFlight = true;
    updateButtons(currentState);
    setMessage("Adding your request to the queue…");

    try {
      const { data, error } = await db.rpc("enqueue_marshy_control_request", {
        control_session_id: sessionId,
        requested_control: action
      });

      if (error) {
        throw error;
      }

      if (data?.state) {
        renderState(data.state);
      } else {
        await refreshState();
      }

      setMessage(`${formatAction(data?.resolved_action || action)} was added to the queue.`, "success");
    } catch (error) {
      setMessage(messageForError(error), "error");
      await refreshState();
    } finally {
      requestInFlight = false;
      updateButtons(currentState);
    }
  }

  async function refreshRoulettePrize() {
    if (!authSession) {
      clearRoulettePrize();
      return;
    }

    const { data, error } = await db.rpc("get_my_marshy_roulette_prize");

    if (error) {
      const message = messageForError(error);
      elements.rouletteResult.textContent = message;
      setMessage(message, "error");
      return;
    }

    if (data) {
      showRoulettePrize(data, false);
    } else {
      clearRoulettePrize();
    }
  }

  async function spinRouletteRequest() {
    if (requestInFlight || !authSession || roulettePrize) {
      return;
    }

    requestInFlight = true;
    updateButtons(currentState);
    elements.rouletteSpin.textContent = "Choosing your result...";
    elements.rouletteSpin.setAttribute("aria-busy", "true");
    elements.rouletteResult.textContent = "Choosing your zappy result...";
    setMessage("The server is choosing your roulette slot...");

    try {
      const { data, error } = await db.rpc("spin_marshy_roulette", {
        control_session_id: sessionId
      });

      if (error) {
        throw error;
      }

      if (data?.state) {
        renderState(data.state);
      }

      showRoulettePrize(data, true);
      setMessage("The wheel is spinning. It will reveal your stored result when it lands.", "success");
    } catch (error) {
      const message = messageForError(error);
      elements.rouletteResult.textContent = message;
      setMessage(message, "error");
      await refreshState();
      await refreshRoulettePrize();
    } finally {
      requestInFlight = false;
      elements.rouletteSpin.textContent = "Spin for 100 tokens";
      elements.rouletteSpin.removeAttribute("aria-busy");
      updateButtons(currentState);
    }
  }

  async function redeemRoulettePrize() {
    if (requestInFlight || !roulettePrize || !rouletteReady) {
      return;
    }

    const prize = roulettePrize;
    const prizeLabel = ROULETTE_SLOTS[prize.slot - 1];
    requestInFlight = true;
    updateButtons(currentState);
    elements.rouletteUse.textContent = "Sending zappies...";
    elements.rouletteUse.setAttribute("aria-busy", "true");
    elements.rouletteResult.textContent = `You got: ${prizeLabel} Sending zappies...`;
    setMessage(`You got: ${prizeLabel} Sending zappies...`);

    try {
      const { data, error } = await db.rpc("redeem_marshy_roulette_prize", {
        control_session_id: sessionId,
        target_prize_id: prize.id
      });

      if (error) {
        throw error;
      }

      clearRoulettePrize();
      if (data?.state) {
        renderState(data.state);
      }
      elements.rouletteResult.textContent = `You got: ${prizeLabel} Your zappies are on the way!`;
      setMessage(`You got: ${prizeLabel} Your zappies are on the way!`, "success");
    } catch (error) {
      setMessage(messageForError(error), "error");
      await refreshState();
      await refreshRoulettePrize();
    } finally {
      elements.rouletteUse.textContent = "Send my zappies!";
      elements.rouletteUse.removeAttribute("aria-busy");
      requestInFlight = false;
      updateButtons(currentState);
    }
  }

  async function cancelRequest() {
    const requestId = currentState?.request?.id;

    if (!requestId || requestInFlight) {
      return;
    }

    requestInFlight = true;
    elements.cancelRequest.disabled = true;

    try {
      const { data, error } = await db.rpc("cancel_my_marshy_control_request", {
        control_session_id: sessionId,
        target_request_id: requestId
      });

      if (error) {
        throw error;
      }

      renderState(data);
      setMessage("Request cancelled and tokens refunded.", "success");
    } catch (error) {
      setMessage(messageForError(error), "error");
    } finally {
      requestInFlight = false;
      elements.cancelRequest.disabled = false;
      updateButtons(currentState);
    }
  }

  function startHeartbeat() {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => {
      if (!document.hidden) {
        refreshState();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  elements.login.addEventListener("click", signInWithDiscord);
  elements.logout.addEventListener("click", signOut);
  elements.cancelRequest.addEventListener("click", cancelRequest);
  elements.rouletteSpin.addEventListener("click", spinRouletteRequest);
  elements.rouletteUse.addEventListener("click", redeemRoulettePrize);
  drawRouletteWheel();

  for (const button of elements.actionButtons) {
    button.addEventListener("click", () => enqueue(button.dataset.controlAction));
  }

  document.addEventListener("visibilitychange", () => {
    refreshState();
    updateTokenDisplay();
    updateButtons(currentState);
  });

  window.setInterval(() => {
    updateTokenDisplay();
    updateButtons(currentState);
  }, 1000);

  db.auth.onAuthStateChange((_event, session) => {
    authSession = session;
    updateAccount();
    window.setTimeout(refreshState, 0);
    window.setTimeout(refreshRoulettePrize, 0);
  });

  db.auth.getSession().then(({ data, error }) => {
    if (error) {
      setMessage(messageForError(error), "error");
    }

    authSession = data?.session || null;
    updateAccount();
    refreshState();
    refreshRoulettePrize();
    startHeartbeat();
  });
})();
