// Scenes: menu -> play -> game over, with a pause overlay pushed on top.
// Demonstrates: Scenes.create typed map + Loop.run(scenes), go/push/pop,
// enter/exit lifecycle, stacked draw, transitions — fade into play, wipe down
// into game over — and the UI helpers: immediate-mode buttons (menu / game
// over), floating score text, a time bar. A push holds Clock.game, so the
// world beneath the pause overlay freezes for free.
import { Audio, Collision, Draw, Game, Keys, Loop, Mathf, Perf, Scenes, Stage, Transitions, UI } from "minimotor";

const view = Stage.init("game", { background: "#12141c", plugins: [Perf.plugin()] }); // live viewport — every scene lays out from it

const center = (text, y, opts) => Draw.text(text, { x: view.w / 2, y, align: "center", ...opts });
const clear = (bg) => Draw.rect(0, 0, view.w, view.h, bg);

// ---- shared play state (reset by play.enter) ----
const player = { x: 0, y: 0, size: 34 };
let target = { x: 0, y: 0, r: 16 };
const scores = Game.createScoreTracker("scenes_best");
let timeLeft = 0; // in update steps (60/s)

function placeTarget() {
  target.x = 40 + Math.random() * (view.w - 80);
  target.y = 40 + Math.random() * (view.h - 80);
}

// Buttons are immediate-mode: drawn AND hit-tested by the same call, every
// frame, in draw. Acting on a click right here is safe because these gos all
// use transitions — the actual scene swap happens later, behind coverage.
function startClicked() {
  Audio.Sfx.blip(660, 0.08);
  scenes.go("play", { transition: Transitions.fade(500) });
}

const scenes = Scenes.create({
  // ---------- Menu ----------
  menu: {
    draw() {
      clear("#12141c");
      center("◆ SCENE DEMO ◆", view.h / 2 - 60, { font: "bold 34px monospace", color: "#4ecdc4" });
      center("Arrow keys to catch the dot", view.h / 2 - 16, { color: "#aaa" });
      if (UI.button({ x: view.w / 2 - 80, y: view.h / 2 + 12, w: 160, h: 44, label: "PLAY" })) {
        startClicked();
      }
      center("(or press SPACE)", view.h / 2 + 78, { color: "#667" });
      center(`Best: ${scores.best}`, view.h / 2 + 106, { color: "#888" });
    },
    update() {
      if (Keys.pressed("Space")) startClicked();
    },
  },

  // ---------- Play ----------
  play: {
    enter() {
      player.x = view.w / 2;
      player.y = view.h / 2;
      scores.reset();
      timeLeft = 15 * 60; // 15 seconds
      UI.clearFloatText(); // no leftover "+1"s from the last round
      placeTarget();
    },
    update() {
      if (Keys.pressed("KeyP")) {
        Audio.Sfx.blip(440, 0.06);
        return scenes.push("pause");
      }

      const speed = 6;
      if (Keys.down("ArrowLeft")) player.x -= speed;
      if (Keys.down("ArrowRight")) player.x += speed;
      if (Keys.down("ArrowUp")) player.y -= speed;
      if (Keys.down("ArrowDown")) player.y += speed;
      player.x = Mathf.clamp(player.x, 0, view.w - player.size);
      player.y = Mathf.clamp(player.y, 0, view.h - player.size);

      const px = player.x + player.size / 2;
      const py = player.y + player.size / 2;
      if (Collision.circleHit(px, py, player.size / 2, target.x, target.y, target.r)) {
        scores.add(1);
        Audio.Sfx.coin();
        UI.floatText("+1", target.x, target.y - 20, { color: "#ffd43b" });
        placeTarget();
      }

      if (--timeLeft <= 0) {
        scores.save();
        Audio.Sfx.blip(140, 0.35);
        scenes.go("over", { transition: Transitions.wipe(600, "down") });
      }
    },
    draw() {
      clear("#0e1420");

      // target (pulsing)
      const r = target.r * (1 + Mathf.wave(performance.now() / 150, 0.12));
      Draw.circle(target, r, "#ffd43b");

      // player
      Draw.rect(player.x, player.y, player.size, player.size, "#4ecdc4");

      // HUD — the bar drains with the clock.
      UI.text(`Score: ${scores.score}`, { x: 12, y: 8, size: 16, color: "#fff" });
      UI.text(`Time: ${Math.ceil(timeLeft / 60)}s`, { x: 12, y: 30, size: 16, color: "#fff" });
      UI.bar(12, 54, 140, 8, timeLeft / (15 * 60), { fill: "#ffd43b" });
      UI.text("P to pause", { x: 12, y: view.h - 28, size: 16, color: "#fff" });

      UI.drawFloatText(); // score pops, on top of everything
    },
  },

  // ---------- Pause (overlay: play stays drawn underneath, frozen) ----------
  pause: {
    update() {
      if (Keys.pressed("KeyP") || Keys.pressed("Space")) {
        Audio.Sfx.blip(440, 0.06);
        scenes.pop();
      }
    },
    draw() {
      clear("rgba(0,0,0,0.55)");
      center("PAUSED", view.h / 2 - 10, { font: "bold 30px monospace", color: "#fff" });
      center("Press P to resume", view.h / 2 + 26, { color: "#aaa" });
    },
  },

  // ---------- Game over ----------
  over: {
    draw() {
      clear("#1a1220");
      center("GAME OVER", view.h / 2 - 60, { font: "bold 32px monospace", color: "#ff6b6b" });
      center(`Score: ${scores.score}   Best: ${scores.best}`, view.h / 2 - 20, { font: "18px monospace" });
      if (
        UI.button({ x: view.w / 2 - 170, y: view.h / 2 + 16, w: 160, h: 44, label: "PLAY AGAIN" })
      ) {
        startClicked();
      }
      if (UI.button({ x: view.w / 2 + 10, y: view.h / 2 + 16, w: 160, h: 44, label: "MENU" })) {
        scenes.go("menu", { transition: Transitions.fade(400) });
      }
      center("SPACE to play again · M for menu", view.h / 2 + 88, { color: "#667" });
    },
    update() {
      if (Keys.pressed("Space")) startClicked();
      if (Keys.pressed("KeyM")) scenes.go("menu", { transition: Transitions.fade(400) });
    },
  },
});

Loop.run(scenes); // the first key ("menu") opens
