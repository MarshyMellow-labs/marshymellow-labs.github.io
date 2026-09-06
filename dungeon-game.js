(function () {
  "use strict";

  const gameRoot = document.querySelector('[data-game-root="dungeon"]');

  if (!gameRoot) {
    return;
  }
const SUPABASE_URL = "https://hnqrptrfxxtuxhawyvge.supabase.co";
    const SUPABASE_KEY = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const SCORE_FINGERPRINT_KEY = "marshymellowScoreFingerprint";
    const canvas = gameRoot.querySelector("#dungeon-dungeon-board");
    const ctx = canvas.getContext("2d");
    const scoreElement = gameRoot.querySelector("#dungeon-score");
    const bestScoreElement = gameRoot.querySelector("#dungeon-best-score");
    const floorElement = gameRoot.querySelector("#dungeon-floor");
    const hpElement = gameRoot.querySelector("#dungeon-hp");
    const statusElement = gameRoot.querySelector("#dungeon-game-status");
    const newRunButton = gameRoot.querySelector("#dungeon-new-run-button");
    const newFloorButton = gameRoot.querySelector("#dungeon-new-floor-button");
    const scoreSubmit = gameRoot.querySelector("#dungeon-score-submit");
    const playerName = gameRoot.querySelector("#dungeon-player-name");
    const finalScoreElement = gameRoot.querySelector("#dungeon-final-score");
    const submitStatus = gameRoot.querySelector("#dungeon-submit-status");
    const leaderboardList = gameRoot.querySelector("#dungeon-leaderboard-list");
    const leaderboardEmpty = gameRoot.querySelector("#dungeon-leaderboard-empty");
    const objective = gameRoot.querySelector("#dungeon-objective");
    const turnLabel = gameRoot.querySelector("#dungeon-turn");
    let turns = 0;
    let showRoute = false;
    let hitFeedback = null;
    let hitFrame = 0;
    const cells = 12;
    const cellSize = canvas.width / cells;
    const directions = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };

    let player;
    let exit;
    let walls;
    let snacks;
    let drinks;
    let enemies;
    let score = 0;
    let hp = 5;
    let floor = 1;
    let gameOver = false;
    let lastScore = 0;
    let lastFloor = 1;
    let bestScore = Number((window.MarshyStorage || localStorage).getItem("marshymellowDungeonBest")) || 0;

    const artwork = {};
    for (const [name, source] of Object.entries({
      exit: "assets/dungeon-exit.png", snack: "assets/dungeon-snack.png",
      drink: "assets/dungeon-drink.png", blob: "assets/dungeon-blob.png",
      marshy: "assets/codex-marshy-pet.webp"
    })) {
      const image = new Image();
      image.onload = () => { if (walls && player) draw(); };
      image.src = source;
      artwork[name] = image;
    }

    bestScoreElement.textContent = bestScore;

    function getScoreFingerprint() {
      let fingerprint = (window.MarshyStorage || localStorage).getItem(SCORE_FINGERPRINT_KEY);

      if (!fingerprint) {
        fingerprint = crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
        (window.MarshyStorage || localStorage).setItem(SCORE_FINGERPRINT_KEY, fingerprint);
      }

      return fingerprint;
    }

    function key(cell) {
      return `${cell.x},${cell.y}`;
    }

    function sameCell(a, b) {
      return a.x === b.x && a.y === b.y;
    }

    function randomInt(max) {
      return Math.floor(Math.random() * max);
    }

    function setStatus(message) {
      statusElement.textContent = message;
    }

    function normalizePlayerName(value) {
      return value.trim().replace(/\s+/g, " ");
    }

    function getPlayerNameError(name) {
      if (name.length < 2) {
        return "Name must be at least 2 characters.";
      }

      if (name.length > 32) {
        return "Name must be 32 characters or fewer.";
      }

      if (/https?:\/\/|www\.|\.com|\.gg|discord\.gg/i.test(name)) {
        return "Links are not allowed in names.";
      }

      if (/[\u0000-\u001f\u007f]/.test(name)) {
        return "Control characters are not allowed.";
      }

      if (/[<>()[\]{}|\\]/.test(name)) {
        return "That name uses symbols that are not allowed.";
      }

      if (/(.)\1{5,}/iu.test(name.replace(/\s/g, ""))) {
        return "Name has too many repeated characters.";
      }

      return "";
    }

    function hideScoreSubmit() {
      scoreSubmit.hidden = true;
      submitStatus.textContent = "";
    }

    function showScoreSubmit(value) {
      if (value < 1) {
        hideScoreSubmit();
        return;
      }

      finalScoreElement.textContent = value;
      scoreSubmit.hidden = false;
      submitStatus.textContent = "";
      playerName.value = (window.MarshyStorage || localStorage).getItem("marshymellowDungeonName") || "";
    }

    function renderLeaderboard(scores) {
      leaderboardList.replaceChildren();
      leaderboardEmpty.hidden = scores.length > 0;

      scores.forEach((entry, index) => {
        const item = document.createElement("li");
        const rank = document.createElement("span");
        const name = document.createElement("span");
        const scoreText = document.createElement("span");
        const floorText = document.createElement("span");

        rank.className = "leaderboard-rank";
        name.className = "leaderboard-name";
        scoreText.className = "leaderboard-score";
        floorText.className = "leaderboard-floor";
        rank.textContent = `#${index + 1}`;
        name.textContent = entry.name;
        scoreText.textContent = entry.score;
        floorText.textContent = `Floor ${entry.floor_reached || 1}`;

        item.append(rank, name, scoreText, floorText);
        leaderboardList.append(item);
      });
    }

    async function loadLeaderboard() {
      const { data, error } = await db
        .from("dungeon_scores")
        .select("name, score, floor_reached, created_at")
        .order("score", { ascending: false })
        .order("floor_reached", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(10);

      if (error) {
        leaderboardEmpty.hidden = false;
        leaderboardEmpty.textContent = "Leaderboard is not set up yet.";
        return;
      }

      leaderboardEmpty.textContent = "No scores yet.";
      renderLeaderboard(data || []);
    }

    function updateStats() {
      scoreElement.textContent = score;
      floorElement.textContent = floor;
      hpElement.textContent = "♥".repeat(hp) + "♡".repeat(6 - hp);
      hpElement.setAttribute("aria-label", `${hp} of 6 hearts`);
      turnLabel.textContent = gameOver ? "Run finished" : turns % 2 ? "Blobs move after this step" : "Your move · blobs wait";
      objective.textContent = gameOver ? `Reached floor ${floor} · ${score} points` : `Floor ${floor} · reach the green EXIT`;

      if (score > bestScore) {
        bestScore = score;
        bestScoreElement.textContent = bestScore;
        (window.MarshyStorage || localStorage).setItem("marshymellowDungeonBest", String(bestScore));
      }
    }

    function inBounds(cell) {
      return cell.x >= 0 && cell.x < cells && cell.y >= 0 && cell.y < cells;
    }

    function isWall(cell) {
      return walls.has(key(cell));
    }

    function isOccupied(cell) {
      return sameCell(cell, player)
        || sameCell(cell, exit)
        || isWall(cell)
        || snacks.some((item) => sameCell(item, cell))
        || drinks.some((item) => sameCell(item, cell))
        || enemies.some((item) => sameCell(item, cell));
    }

    function routeFrom(start, goal) {
      const queue = [[start]];
      const seen = new Set([key(start)]);
      while (queue.length) {
        const path = queue.shift(), current = path[path.length - 1];
        if (sameCell(current, goal)) return path;
        for (const direction of Object.values(directions)) {
          const next = { x: current.x + direction.x, y: current.y + direction.y };
          if (inBounds(next) && !isWall(next) && !seen.has(key(next))) {
            seen.add(key(next)); queue.push([...path, next]);
          }
        }
      }
      return [];
    }

    function findEmptyCell() {
      const candidates = [];
      for (let y = 1; y < cells - 1; y++) for (let x = 1; x < cells - 1; x++) {
        const cell = { x, y };
        if (!isOccupied(cell) && Math.abs(x - 1) + Math.abs(y - 1) > 3 && routeFrom(player, cell).length) candidates.push(cell);
      }
      return candidates[randomInt(candidates.length)];
    }

    function canReachGoal(testWalls) {
      const start = { x: 1, y: 1 };
      const goal = { x: cells - 2, y: cells - 2 };
      const queue = [start];
      const seen = new Set([key(start)]);

      while (queue.length) {
        const current = queue.shift();

        if (sameCell(current, goal)) {
          return true;
        }

        Object.values(directions).forEach((direction) => {
          const next = { x: current.x + direction.x, y: current.y + direction.y };
          const nextKey = key(next);

          if (inBounds(next) && !testWalls.has(nextKey) && !seen.has(nextKey)) {
            seen.add(nextKey);
            queue.push(next);
          }
        });
      }

      return false;
    }

    function createWalls() {
      const nextWalls = new Set();

      for (let i = 0; i < cells; i += 1) {
        nextWalls.add(key({ x: i, y: 0 }));
        nextWalls.add(key({ x: i, y: cells - 1 }));
        nextWalls.add(key({ x: 0, y: i }));
        nextWalls.add(key({ x: cells - 1, y: i }));
      }

      const wallGoal = floor === 1 ? 8 : Math.min(12 + floor * 2, 30);
      let attempts = 0;

      while (nextWalls.size < wallGoal + cells * 4 - 4 && attempts < 300) {
        attempts += 1;
        const cell = { x: 1 + randomInt(cells - 2), y: 1 + randomInt(cells - 2) };

        if ((cell.x === 1 && cell.y === 1) || (cell.x === cells - 2 && cell.y === cells - 2)) {
          continue;
        }

        const cellKey = key(cell);
        nextWalls.add(cellKey);

        if (!canReachGoal(nextWalls)) {
          nextWalls.delete(cellKey);
        }
      }

      return nextWalls;
    }

    function generateFloor(message = "Reach the green EXIT. Snacks are optional.") {
      cancelAnimationFrame(hitFrame);
      hitFeedback = null;
      turns = 0;
      player = { x: 1, y: 1 };
      exit = { x: cells - 2, y: cells - 2 };
      walls = createWalls();
      snacks = [];
      drinks = [];
      enemies = [];

      const snackCount = Math.min(4 + floor, 9);
      const drinkCount = floor % 2 === 0 ? 2 : 1;
      const enemyCount = Math.min(1 + Math.floor(floor / 2), 5);

      for (let i = 0; i < snackCount; i += 1) {
        const cell = findEmptyCell();
        if (cell) snacks.push(cell);
      }

      for (let i = 0; i < drinkCount; i += 1) {
        const cell = findEmptyCell();
        if (cell) drinks.push(cell);
      }

      for (let i = 0; i < enemyCount; i += 1) {
        const cell = findEmptyCell();
        if (cell) enemies.push(cell);
      }

      gameOver = false;
      setStatus(message);
      updateStats();
      draw();
    }

    function newRun() {
      score = 0;
      hp = 5;
      floor = 1;
      lastScore = 0;
      lastFloor = 1;
      hideScoreSubmit();
      generateFloor("You’re pet Marshy at the top left. Move toward the green EXIT.");
    }

    function nextFloor() {
      floor += 1;
      score += 25;
      hp = Math.min(6, hp + 1);
      generateFloor(`Floor ${floor}! +25 points and +1 heart. Find the next green EXIT.`);
    }

    function losePatience(message, attacker) {
      hitFeedback = { from: { ...attacker }, to: { ...player }, start: performance.now() };
      cancelAnimationFrame(hitFrame);
      hitFrame = requestAnimationFrame(animateHit);
      hp -= 1;

      if (hp <= 0) {
        hp = 0;
        gameOver = true;
        lastScore = score;
        lastFloor = floor;
        setStatus(`${message} Run over — ${score} points on floor ${floor}. Start a new run below.`);
        showScoreSubmit(lastScore);
      } else {
        setStatus(message);
      }

      updateStats();
    }

    function movePlayer(directionName) {
      if (hitFeedback) return;
      if (gameOver) {
        setStatus("Start a new run to continue.");
        return;
      }

      const direction = directions[directionName];
      if (!direction) return;
      const next = { x: player.x + direction.x, y: player.y + direction.y };

      if (!inBounds(next) || isWall(next)) {
        setStatus("That’s a wall. Try another direction — no turn or heart lost.");
        return;
      }

      turns += 1;
      setStatus("Keep heading for the green EXIT. Snacks are optional.");
      const enemyIndex = enemies.findIndex((enemy) => sameCell(enemy, next));

      if (enemyIndex >= 0) {
        enemies.splice(enemyIndex, 1);
        score += 5;
        player = next;
        losePatience("You bumped into a blob: −1 heart, +5 points. Blob cleared.", next);
        if (!gameOver && turns % 2 === 0) {
          moveEnemies(true);
        }
        draw();
        return;
      }

      player = next;

      const snackIndex = snacks.findIndex((snack) => sameCell(snack, player));
      if (snackIndex >= 0) {
        snacks.splice(snackIndex, 1);
        score += 10;
        setStatus("Snack collected! +10 points. You can still head straight to the EXIT.");
      }

      const drinkIndex = drinks.findIndex((drink) => sameCell(drink, player));
      if (drinkIndex >= 0) {
        drinks.splice(drinkIndex, 1);
        hp = Math.min(6, hp + 1);
        score += 4;
        setStatus("Drink collected! +1 heart (up to 6) and +4 points.");
      }

      if (sameCell(player, exit)) {
        nextFloor();
        return;
      }

      if (turns % 2 === 0) moveEnemies();
      updateStats();
      draw();
    }

    function moveEnemies(damagedThisTurn = false) {
      if (gameOver) {
        return;
      }

      enemies.forEach((enemy, index) => {
        if (gameOver) return;
        const options = Object.values(directions)
          .map((direction) => ({ x: enemy.x + direction.x, y: enemy.y + direction.y }))
          .filter((cell) => inBounds(cell) && !isWall(cell) && !sameCell(cell, exit))
          .filter((cell) => !enemies.some((other, otherIndex) => otherIndex !== index && sameCell(other, cell)));

        options.sort((a, b) => {
          const aDistance = Math.abs(a.x - player.x) + Math.abs(a.y - player.y);
          const bDistance = Math.abs(b.x - player.x) + Math.abs(b.y - player.y);
          return aDistance - bDistance;
        });

        const chase = Math.random() < 0.68;
        const next = chase ? options[0] : options[randomInt(options.length)];

        if (!next) {
          return;
        }

        if (sameCell(next, player)) {
          if (!damagedThisTurn) {
            losePatience("A neighbouring blob lunged into you: −1 heart. Move away to dodge its next attack.", enemy);
            damagedThisTurn = true;
          }
          return;
        }

        enemy.x = next.x;
        enemy.y = next.y;
      });
    }

    function roundedRect(x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + width, y, x + width, y + height, radius);
      ctx.arcTo(x + width, y + height, x, y + height, radius);
      ctx.arcTo(x, y + height, x, y, radius);
      ctx.arcTo(x, y, x + width, y, radius);
      ctx.closePath();
    }

    function animateHit(now) {
      if (!hitFeedback) return;
      if (now - hitFeedback.start >= 650) hitFeedback = null;
      draw();
      if (hitFeedback) hitFrame = requestAnimationFrame(animateHit);
    }

    function drawTile(cell, fill, stroke = "rgba(255, 255, 255, 0.72)", inset = 5, radius = 9) {
      const x = cell.x * cellSize + inset;
      const y = cell.y * cellSize + inset;
      const size = cellSize - inset * 2;
      ctx.fillStyle = fill;
      roundedRect(x, y, size, size, radius);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    function varColor(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function drawCircle(cell, fill, stroke, label) {
      const centerX = cell.x * cellSize + cellSize / 2;
      const centerY = cell.y * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, cellSize * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = "#243047";
      ctx.font = "900 18px 'gg sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, centerX, centerY + 1);
    }

    function drawSprite(cell, name) {
      const image = artwork[name];
      if (!image.complete || !image.naturalWidth) return false;
      ctx.save();
      ctx.imageSmoothingEnabled = name === "marshy";
      if (name === "marshy") {
        // Reuse the pet sheet's first 192 x 208 idle frame without changing its art.
        const height = cellSize, width = height * 192 / 208;
        ctx.drawImage(image, 0, 0, 192, 208,
          cell.x * cellSize + (cellSize - width) / 2, cell.y * cellSize, width, height);
      } else {
        ctx.drawImage(image, cell.x * cellSize + 1, cell.y * cellSize + 1, cellSize - 2, cellSize - 2);
      }
      ctx.restore();
      return true;
    }

    function drawBackground() {
      const darkMode = document.documentElement.dataset.theme === "dark";
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, darkMode ? "#153447" : "#dff5ff");
      gradient.addColorStop(0.55, darkMode ? "#1a2030" : "#fffdf4");
      gradient.addColorStop(1, darkMode ? "#43243a" : "#ffe0f1");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = darkMode ? "rgba(191, 233, 255, 0.08)" : "rgba(109, 90, 168, 0.08)";
      ctx.lineWidth = 1;

      for (let i = 0; i <= cells; i += 1) {
        const position = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(position, 0);
        ctx.lineTo(position, canvas.height);
        ctx.moveTo(0, position);
        ctx.lineTo(canvas.width, position);
        ctx.stroke();
      }
    }

    function drawOverlay() {
      if (!gameOver) {
        return;
      }

      const darkMode = document.documentElement.dataset.theme === "dark";
      ctx.fillStyle = darkMode ? "rgba(7, 10, 18, 0.76)" : "rgba(255, 255, 255, 0.72)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = varColor("--cocoa");
      ctx.font = "900 46px 'gg sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Out of hearts", canvas.width / 2, canvas.height / 2 - 12);
      ctx.font = "800 20px 'gg sans', sans-serif";
      ctx.fillText("Start a new run below", canvas.width / 2, canvas.height / 2 + 34);
    }

    function draw() {
      drawBackground();

      walls.forEach((wallKey) => {
        const [x, y] = wallKey.split(",").map(Number);
        drawTile({ x, y }, "rgba(109, 90, 168, 0.42)", "rgba(55, 40, 64, 0.18)", 3, 7);
      });

      if (showRoute && !gameOver) {
        ctx.strokeStyle = "#68dcb2"; ctx.lineWidth = 4; ctx.setLineDash([5, 7]); ctx.beginPath();
        routeFrom(player, exit).forEach((cell, i) => {
          const x = (cell.x + .5) * cellSize, y = (cell.y + .5) * cellSize;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (!drawSprite(exit, "exit")) drawTile(exit, "#75e1b2", "#ddfff0", 3, 8);
      // Retain an explicit label so the doorway's purpose stays clear at tile size.
      ctx.fillStyle = "#b7ffdc";
      ctx.fillRect(exit.x * cellSize + 6, exit.y * cellSize + cellSize - 13, cellSize - 12, 12);
      ctx.fillStyle = "#133f32"; ctx.font = "900 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("EXIT", (exit.x + .5) * cellSize, exit.y * cellSize + cellSize - 7);

      snacks.forEach((snack) => { if (!drawSprite(snack, "snack")) drawCircle(snack, "#fff2ad", "#ffb703", "★"); });
      drinks.forEach((drink) => { if (!drawSprite(drink, "drink")) drawCircle(drink, "#bfe9ff", "#4db8ed", "+"); });
      enemies.forEach((enemy) => {
        let position = enemy;
        if (hitFeedback && sameCell(enemy, hitFeedback.from) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const progress = Math.min(1, (performance.now() - hitFeedback.start) / 650);
          const lunge = Math.sin(progress * Math.PI);
          position = { x: enemy.x + (hitFeedback.to.x - enemy.x) * lunge,
            y: enemy.y + (hitFeedback.to.y - enemy.y) * lunge };
        }
        if (!drawSprite(position, "blob")) drawCircle(position, "#d4b6ff", "#6d5aa8", "!");
      });
      if (!drawSprite(player, "marshy")) drawCircle(player, "#ff6fae", "#fff2ad", "☺");
      if (hitFeedback) {
        drawTile(hitFeedback.to, "rgba(255, 70, 110, 0.25)", "#ff527e", 2, 8);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#881539";
        ctx.lineWidth = 4;
        ctx.font = "900 17px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const x = (hitFeedback.to.x + .5) * cellSize, y = hitFeedback.to.y * cellSize + 9;
        ctx.strokeText("−1 ♥", x, y);
        ctx.fillText("−1 ♥", x, y);
      }
      drawOverlay();
    }

    window.addEventListener("marshy-theme-change", draw);

    document.addEventListener("keydown", (event) => {
      if (gameRoot.hidden || event.repeat) {
        return;
      }
      if (event.target.matches("input, textarea, select") || event.target.closest("[role=tab]")) {
        return;
      }

      const keyMap = {
        ArrowUp: "up",
        w: "up",
        W: "up",
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right"
      };

      const direction = keyMap[event.key];

      if (direction) {
        event.preventDefault();
        movePlayer(direction);
      }
    });

    gameRoot.querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("click", () => movePlayer(button.dataset.direction));
    });

    newRunButton.addEventListener("click", newRun);
    newFloorButton.addEventListener("click", () => {
      showRoute = !showRoute;
      newFloorButton.textContent = showRoute ? "Hide route" : "Show route";
      newFloorButton.setAttribute("aria-pressed", String(showRoute));
      setStatus(showRoute ? "Follow the dotted line to EXIT, but watch for moving blobs." : "Route hidden. Take your time.");
      draw();
    });
    canvas.addEventListener("arcade-swipe", event => movePlayer(event.detail));

    scoreSubmit.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = normalizePlayerName(playerName.value);
      const nameError = getPlayerNameError(name);
      const submitButton = scoreSubmit.querySelector("button[type='submit']");

      if (lastScore < 1) {
        submitStatus.textContent = "Play a dungeon run first.";
        return;
      }

      if (nameError) {
        submitStatus.textContent = nameError;
        return;
      }

      submitButton.disabled = true;
      submitStatus.textContent = "Submitting score...";

      const { error } = await db
        .rpc("submit_dungeon_score", {
          player_name: name,
          player_score: lastScore,
          floor_reached: lastFloor,
          visitor_fingerprint: getScoreFingerprint()
        });

      submitButton.disabled = false;

      if (error) {
        submitStatus.textContent = error.message.includes("too_many_dungeon_scores")
          ? "Too many score submissions. Please wait and try again."
          : "Could not submit score. Check the dungeon leaderboard table setup.";
        return;
      }

      (window.MarshyStorage || localStorage).setItem("marshymellowDungeonName", name);
      submitStatus.textContent = "Score submitted.";
      lastScore = 0;
      await loadLeaderboard();
    });

    db
      .channel("dungeon-score-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dungeon_scores" },
        loadLeaderboard
      )
      .subscribe();

    loadLeaderboard();
    newRun();
}());
