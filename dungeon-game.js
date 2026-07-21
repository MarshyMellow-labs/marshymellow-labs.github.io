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
    let bestScore = Number(localStorage.getItem("marshymellowDungeonBest")) || 0;

    bestScoreElement.textContent = bestScore;

    function getScoreFingerprint() {
      let fingerprint = localStorage.getItem(SCORE_FINGERPRINT_KEY);

      if (!fingerprint) {
        fingerprint = crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
        localStorage.setItem(SCORE_FINGERPRINT_KEY, fingerprint);
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
      playerName.value = localStorage.getItem("marshymellowDungeonName") || "";
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
      hpElement.textContent = hp;

      if (score > bestScore) {
        bestScore = score;
        bestScoreElement.textContent = bestScore;
        localStorage.setItem("marshymellowDungeonBest", String(bestScore));
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

    function findEmptyCell() {
      let cell;
      do {
        cell = { x: 1 + randomInt(cells - 2), y: 1 + randomInt(cells - 2) };
      } while (isOccupied(cell));

      return cell;
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

      const wallGoal = Math.min(18 + floor * 2, 38);
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

    function generateFloor(message = "Find the exit door.") {
      player = { x: 1, y: 1 };
      exit = { x: cells - 2, y: cells - 2 };
      walls = createWalls();
      snacks = [];
      drinks = [];
      enemies = [];

      const snackCount = Math.min(4 + floor, 9);
      const drinkCount = floor % 2 === 0 ? 2 : 1;
      const enemyCount = Math.min(2 + Math.floor(floor / 2), 7);

      for (let i = 0; i < snackCount; i += 1) {
        snacks.push(findEmptyCell());
      }

      for (let i = 0; i < drinkCount; i += 1) {
        drinks.push(findEmptyCell());
      }

      for (let i = 0; i < enemyCount; i += 1) {
        enemies.push(findEmptyCell());
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
      generateFloor("A suspiciously pastel dungeon appears.");
    }

    function nextFloor() {
      floor += 1;
      score += 25;
      hp = Math.min(6, hp + 1);
      generateFloor("Deeper into the snack paperwork zone.");
    }

    function losePatience(message) {
      hp -= 1;

      if (hp <= 0) {
        hp = 0;
        gameOver = true;
        lastScore = score;
        lastFloor = floor;
        setStatus(`${message} Marshy is out of patience.`);
        showScoreSubmit(lastScore);
      } else {
        setStatus(message);
      }

      updateStats();
    }

    function movePlayer(directionName) {
      if (gameOver) {
        setStatus("Start a new run to continue.");
        return;
      }

      const direction = directions[directionName];
      const next = { x: player.x + direction.x, y: player.y + direction.y };

      if (!inBounds(next) || isWall(next)) {
        setStatus("Bonk. Wall.");
        return;
      }

      const enemyIndex = enemies.findIndex((enemy) => sameCell(enemy, next));

      if (enemyIndex >= 0) {
        enemies.splice(enemyIndex, 1);
        score += 5;
        player = next;
        losePatience("Paperwork blob bonked.");
        if (!gameOver) {
          moveEnemies();
        }
        draw();
        return;
      }

      player = next;

      const snackIndex = snacks.findIndex((snack) => sameCell(snack, player));
      if (snackIndex >= 0) {
        snacks.splice(snackIndex, 1);
        score += 10;
        setStatus("Snack acquired.");
      }

      const drinkIndex = drinks.findIndex((drink) => sameCell(drink, player));
      if (drinkIndex >= 0) {
        drinks.splice(drinkIndex, 1);
        hp = Math.min(6, hp + 1);
        score += 4;
        setStatus("Patience restored.");
      }

      if (sameCell(player, exit)) {
        nextFloor();
        return;
      }

      moveEnemies();
      updateStats();
      draw();
    }

    function moveEnemies() {
      if (gameOver) {
        return;
      }

      enemies.forEach((enemy, index) => {
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
          losePatience("A paperwork blob caught Marshy.");
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
      ctx.fillStyle = varColor("--ink");
      ctx.font = "900 18px 'gg sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, centerX, centerY + 1);
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
      ctx.fillText("Dungeon nap", canvas.width / 2, canvas.height / 2 - 12);
      ctx.font = "800 20px 'gg sans', sans-serif";
      ctx.fillText("New run?", canvas.width / 2, canvas.height / 2 + 34);
    }

    function draw() {
      drawBackground();

      walls.forEach((wallKey) => {
        const [x, y] = wallKey.split(",").map(Number);
        drawTile({ x, y }, "rgba(109, 90, 168, 0.42)", "rgba(55, 40, 64, 0.18)", 3, 7);
      });

      drawTile(exit, "rgba(255, 111, 174, 0.22)", "rgba(255, 111, 174, 0.72)", 7, 12);

      snacks.forEach((snack) => drawCircle(snack, "#fff2ad", "#ffb703", "S"));
      drinks.forEach((drink) => drawCircle(drink, "#bfe9ff", "#4db8ed", "D"));
      enemies.forEach((enemy) => drawCircle(enemy, "#d4b6ff", "#6d5aa8", "P"));
      drawCircle(player, "#ff6fae", "#fff2ad", "M");
      drawOverlay();
    }

    window.addEventListener("marshy-theme-change", draw);

    document.addEventListener("keydown", (event) => {
      if (gameRoot.hidden) {
        return;
      }
      if (event.target.matches("input, textarea, button")) {
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
    newFloorButton.addEventListener("click", () => generateFloor("The dungeon reshuffles itself."));

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

      localStorage.setItem("marshymellowDungeonName", name);
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
