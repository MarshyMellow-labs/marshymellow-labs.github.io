(function () {
  "use strict";

  const gameRoot = document.querySelector('[data-game-root="snake"]');

  if (!gameRoot) {
    return;
  }
const SUPABASE_URL = "https://hnqrptrfxxtuxhawyvge.supabase.co";
    const SUPABASE_KEY = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const SCORE_FINGERPRINT_KEY = "marshymellowScoreFingerprint";
    const canvas = gameRoot.querySelector("#snake-snake-board");
    const ctx = canvas.getContext("2d");
    const scoreElement = gameRoot.querySelector("#snake-score");
    const bestScoreElement = gameRoot.querySelector("#snake-best-score");
    const statusLabel = gameRoot.querySelector("#snake-status-label");
    const gameStatus = gameRoot.querySelector("#snake-game-status");
    const startButton = gameRoot.querySelector("#snake-start-button");
    const pauseButton = gameRoot.querySelector("#snake-pause-button");
    const restartButton = gameRoot.querySelector("#snake-restart-button");
    const scoreSubmit = gameRoot.querySelector("#snake-score-submit");
    const playerName = gameRoot.querySelector("#snake-player-name");
    const finalScoreElement = gameRoot.querySelector("#snake-final-score");
    const submitStatus = gameRoot.querySelector("#snake-submit-status");
    const leaderboardList = gameRoot.querySelector("#snake-leaderboard-list");
    const leaderboardEmpty = gameRoot.querySelector("#snake-leaderboard-empty");
    const cells = 20;
    const boardSize = 560;
    const cellSize = boardSize / cells;
    const speed = 150;
    let snake;
    let food;
    let direction;
    let nextDirection;
    let score;
    let timer = null;
    let running = false;
    let paused = false;
    let lastScore = 0;
    let bestScore = Number(localStorage.getItem("marshymellowSnakeBest")) || 0;

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

    function setStatus(value) {
      statusLabel.textContent = value;
      gameStatus.textContent = value;
    }

    function setScore(value) {
      score = value;
      scoreElement.textContent = score;

      if (score > bestScore) {
        bestScore = score;
        bestScoreElement.textContent = bestScore;
        localStorage.setItem("marshymellowSnakeBest", String(bestScore));
      }
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
      playerName.value = localStorage.getItem("marshymellowSnakeName") || "";
    }

    function renderLeaderboard(scores) {
      leaderboardList.replaceChildren();
      leaderboardEmpty.hidden = scores.length > 0;

      scores.forEach((entry, index) => {
        const item = document.createElement("li");
        const rank = document.createElement("span");
        const name = document.createElement("span");
        const scoreText = document.createElement("span");

        rank.className = "leaderboard-rank";
        name.className = "leaderboard-name";
        scoreText.className = "leaderboard-score";
        rank.textContent = `#${index + 1}`;
        name.textContent = entry.name;
        scoreText.textContent = entry.score;

        item.append(rank, name, scoreText);
        leaderboardList.append(item);
      });
    }

    async function loadLeaderboard() {
      const { data, error } = await db
        .from("snake_scores")
        .select("name, score, created_at")
        .order("score", { ascending: false })
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

    function sameCell(a, b) {
      return a.x === b.x && a.y === b.y;
    }

    function randomFood() {
      let position;

      do {
        position = {
          x: Math.floor(Math.random() * cells),
          y: Math.floor(Math.random() * cells)
        };
      } while (snake.some((part) => sameCell(part, position)));

      return position;
    }

    function resetSnakePosition() {
      snake = [
        { x: 9, y: 10 },
        { x: 8, y: 10 },
        { x: 7, y: 10 }
      ];
      direction = { x: 1, y: 0 };
      nextDirection = { x: 1, y: 0 };
    }

    function resetGame() {
      clearInterval(timer);
      timer = null;
      resetSnakePosition();
      setScore(0);
      lastScore = 0;
      hideScoreSubmit();
      food = randomFood();
      running = false;
      paused = false;
      setStatus("Ready");
      draw();
    }

    function startGame() {
      if (running && !paused) {
        return;
      }

      running = true;
      paused = false;
      hideScoreSubmit();
      setStatus("Playing");
      clearInterval(timer);
      timer = setInterval(step, speed);
    }

    function pauseGame() {
      if (!running) {
        return;
      }

      paused = !paused;

      if (paused) {
        clearInterval(timer);
        timer = null;
        setStatus("Paused");
        return;
      }

      startGame();
    }

    function endGame() {
      clearInterval(timer);
      timer = null;
      running = false;
      paused = false;
      lastScore = score;
      resetSnakePosition();
      setScore(0);
      food = randomFood();
      setStatus("Bonked");
      showScoreSubmit(lastScore);
      draw();
    }

    function setDirection(name) {
      const directions = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 }
      };
      const requested = directions[name];

      if (!requested) {
        return;
      }

      if (requested.x + direction.x === 0 && requested.y + direction.y === 0) {
        return;
      }

      nextDirection = requested;
    }

    function step() {
      direction = nextDirection;

      const head = {
        x: snake[0].x + direction.x,
        y: snake[0].y + direction.y
      };

      const hitWall = head.x < 0 || head.x >= cells || head.y < 0 || head.y >= cells;
      const hitSelf = snake.some((part) => sameCell(part, head));

      if (hitWall || hitSelf) {
        endGame();
        return;
      }

      snake.unshift(head);

      if (sameCell(head, food)) {
        setScore(score + 1);
        food = randomFood();
      } else {
        snake.pop();
      }

      draw();
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

    function drawBackground() {
      const darkMode = document.documentElement.dataset.theme === "dark";
      const gradient = ctx.createLinearGradient(0, 0, boardSize, boardSize);
      gradient.addColorStop(0, darkMode ? "#153447" : "#d9f5ff");
      gradient.addColorStop(0.58, darkMode ? "#1a2030" : "#fffaf0");
      gradient.addColorStop(1, darkMode ? "#43243a" : "#ffe1f0");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, boardSize, boardSize);

      ctx.strokeStyle = darkMode ? "rgba(191, 233, 255, 0.08)" : "rgba(109, 90, 168, 0.08)";
      ctx.lineWidth = 1;

      for (let i = 1; i < cells; i += 1) {
        const line = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(line, 0);
        ctx.lineTo(line, boardSize);
        ctx.moveTo(0, line);
        ctx.lineTo(boardSize, line);
        ctx.stroke();
      }
    }

    function drawFood() {
      const centerX = food.x * cellSize + cellSize / 2;
      const centerY = food.y * cellSize + cellSize / 2;

      ctx.fillStyle = "#fff2ad";
      ctx.beginPath();
      ctx.arc(centerX, centerY, cellSize * 0.38, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ff6fae";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    function drawSnake() {
      snake.forEach((part, index) => {
        const inset = index === 0 ? 3 : 4;
        const x = part.x * cellSize + inset;
        const y = part.y * cellSize + inset;
        const size = cellSize - inset * 2;

        ctx.fillStyle = index === 0 ? "#ff6fae" : index % 2 ? "#72cdf8" : "#bfe9ff";
        roundedRect(x, y, size, size, 8);
        ctx.fill();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.74)";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    function drawOverlay() {
      if (running && !paused) {
        return;
      }

      const darkMode = document.documentElement.dataset.theme === "dark";
      ctx.fillStyle = darkMode ? "rgba(7, 10, 18, 0.62)" : "rgba(255, 255, 255, 0.38)";
      ctx.fillRect(0, 0, boardSize, boardSize);
      ctx.fillStyle = darkMode ? "#d7c9ff" : "#6d5aa8";
      ctx.font = "900 46px 'gg sans', system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(statusLabel.textContent, boardSize / 2, boardSize / 2);
    }

    function draw() {
      drawBackground();
      drawFood();
      drawSnake();
      drawOverlay();
    }

    window.addEventListener("marshy-theme-change", draw);

    document.addEventListener("keydown", (event) => {
      if (gameRoot.hidden) {
        return;
      }
      if (event.target.matches("input, textarea")) {
        return;
      }

      const keys = {
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

      if (keys[event.key]) {
        event.preventDefault();
        setDirection(keys[event.key]);
        startGame();
      }

      if (event.key === " ") {
        event.preventDefault();
        pauseGame();
      }
    });

    gameRoot.querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("click", () => {
        setDirection(button.dataset.direction);
        startGame();
      });
    });

    startButton.addEventListener("click", startGame);
    pauseButton.addEventListener("click", pauseGame);
    restartButton.addEventListener("click", () => {
      resetGame();
      startGame();
    });

    scoreSubmit.addEventListener("submit", async (event) => {
      event.preventDefault();

      const name = normalizePlayerName(playerName.value);
      const nameError = getPlayerNameError(name);
      const submitButton = scoreSubmit.querySelector("button");

      if (lastScore < 1) {
        submitStatus.textContent = "Play a round first.";
        return;
      }

      if (nameError) {
        submitStatus.textContent = nameError;
        return;
      }

      submitButton.disabled = true;
      submitStatus.textContent = "Submitting score...";

      const { error } = await db
        .rpc("submit_snake_score", {
          player_name: name,
          player_score: lastScore,
          visitor_fingerprint: getScoreFingerprint()
        });

      submitButton.disabled = false;

      if (error) {
        submitStatus.textContent = error.message.includes("too_many_snake_scores")
          ? "Too many score submissions. Please wait and try again."
          : "Could not submit score. Check the leaderboard table setup.";
        return;
      }

      localStorage.setItem("marshymellowSnakeName", name);
      submitStatus.textContent = "Score submitted.";
      lastScore = 0;
      await loadLeaderboard();
    });

    db
      .channel("snake-score-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "snake_scores" },
        loadLeaderboard
      )
      .subscribe();

    loadLeaderboard();
    resetGame();
    document.addEventListener("marshy-game-selected", (event) => {
      if (event.detail !== "snake" && running && !paused) {
        pauseGame();
      }
    });
}());
