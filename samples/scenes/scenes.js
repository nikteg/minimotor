// Scenes: menu -> play -> game over, with a pause overlay pushed on top.
// Demonstrates: Scenes.define/go/push/pop, enter/exit lifecycle, stacked draw,
// transitions — fade into play, wipe down into game over — and the UI helpers:
// immediate-mode buttons (menu / game over), floating score text, a time bar.
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // every scene lays out from vp
const { Scenes, Transitions, Keys, Draw, Text, Mathf, Audio, UI } = Minimotor;

const center = (text, y, opts) => Text.drawCentered(Draw.ctx, text, vp.w / 2, y, opts);
const clear = (bg) => {
  const { ctx } = Draw;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, vp.w, vp.h);
};

// ---- shared play state (reset by play.enter) ----
const player = { x: 0, y: 0, size: 34 };
let target = { x: 0, y: 0, r: 16 };
let score = 0;
let timeLeft = 0; // in update steps (60/s)
let best = Minimotor.Storage.load("scenes_best", 0);

function placeTarget() {
  target.x = 40 + Math.random() * (vp.w - 80);
  target.y = 40 + Math.random() * (vp.h - 80);
}

// Buttons are immediate-mode: drawn AND hit-tested by the same call, every
// frame, in draw. Acting on a click right here is safe because these gos all
// use transitions — the actual scene swap happens later, behind coverage.
function startClicked() {
  Audio.Sfx.blip(660, 0.08);
  Scenes.go("play", Transitions.fade(500));
}

// ---------- Menu ----------
Scenes.define("menu", {
  draw() {
    const { ctx } = Draw;
    clear("#12141c");
    center("◆ SCENE DEMO ◆", vp.h / 2 - 60, { font: "bold 34px monospace", color: "#4ecdc4" });
    center("Arrow keys to catch the dot", vp.h / 2 - 16, { color: "#aaa" });
    if (UI.button(ctx, { x: vp.w / 2 - 80, y: vp.h / 2 + 12, w: 160, h: 44, label: "PLAY" })) {
      startClicked();
    }
    center("(or press SPACE)", vp.h / 2 + 78, { color: "#667" });
    center(`Best: ${best}`, vp.h / 2 + 106, { color: "#888" });
  },
  update() {
    if (Keys.pressed("Space")) startClicked();
  },
});

// ---------- Play ----------
Scenes.define("play", {
  enter() {
    player.x = vp.w / 2;
    player.y = vp.h / 2;
    score = 0;
    timeLeft = 15 * 60; // 15 seconds
    UI.clearFloats(); // no leftover "+1"s from the last round
    placeTarget();
  },
  update() {
    if (Keys.pressed("KeyP")) {
      Audio.Sfx.blip(440, 0.06);
      return Scenes.push("pause");
    }

    const speed = 6;
    if (Keys.down("ArrowLeft")) player.x -= speed;
    if (Keys.down("ArrowRight")) player.x += speed;
    if (Keys.down("ArrowUp")) player.y -= speed;
    if (Keys.down("ArrowDown")) player.y += speed;
    player.x = Mathf.clamp(player.x, 0, vp.w - player.size);
    player.y = Mathf.clamp(player.y, 0, vp.h - player.size);

    const px = player.x + player.size / 2;
    const py = player.y + player.size / 2;
    if (Minimotor.Collision.circleHit(px, py, player.size / 2, target.x, target.y, target.r)) {
      score++;
      Audio.Sfx.coin();
      UI.float("+1", target.x, target.y - 20, { color: "#ffd43b" });
      placeTarget();
    }

    if (--timeLeft <= 0) {
      best = Math.max(best, score);
      Minimotor.Storage.save("scenes_best", best);
      Audio.Sfx.blip(140, 0.35);
      Scenes.go("over", Transitions.wipe(600, "down"));
    }
  },
  draw() {
    const { ctx } = Draw;
    clear("#0e1420");

    // target (pulsing)
    const r = target.r * (1 + Mathf.wave(performance.now() / 150, 0.12));
    ctx.fillStyle = "#ffd43b";
    ctx.beginPath();
    ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
    ctx.fill();

    // player
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(player.x, player.y, player.size, player.size);

    // HUD — the bar drains with the clock.
    ctx.fillStyle = "#fff";
    ctx.font = "16px monospace";
    ctx.fillText(`Score: ${score}`, 12, 24);
    ctx.fillText(`Time: ${Math.ceil(timeLeft / 60)}s`, 12, 46);
    UI.bar(ctx, 12, 54, 140, 8, timeLeft / (15 * 60), { fill: "#ffd43b" });
    ctx.fillText("P to pause", 12, vp.h - 12);

    UI.drawFloats(ctx); // score pops, on top of everything
  },
});

// ---------- Pause (overlay: play stays drawn underneath) ----------
Scenes.define("pause", {
  update() {
    if (Keys.pressed("KeyP") || Keys.pressed("Space")) {
      Audio.Sfx.blip(440, 0.06);
      Scenes.pop();
    }
  },
  draw() {
    clear("rgba(0,0,0,0.55)");
    center("PAUSED", vp.h / 2 - 10, { font: "bold 30px monospace", color: "#fff" });
    center("Press P to resume", vp.h / 2 + 26, { color: "#aaa" });
  },
});

// ---------- Game over ----------
Scenes.define("over", {
  draw() {
    const { ctx } = Draw;
    clear("#1a1220");
    center("GAME OVER", vp.h / 2 - 60, { font: "bold 32px monospace", color: "#ff6b6b" });
    center(`Score: ${score}   Best: ${best}`, vp.h / 2 - 20, { font: "18px monospace" });
    if (
      UI.button(ctx, { x: vp.w / 2 - 170, y: vp.h / 2 + 16, w: 160, h: 44, label: "PLAY AGAIN" })
    ) {
      startClicked();
    }
    if (UI.button(ctx, { x: vp.w / 2 + 10, y: vp.h / 2 + 16, w: 160, h: 44, label: "MENU" })) {
      Scenes.go("menu", Transitions.fade(400));
    }
    center("SPACE to play again · M for menu", vp.h / 2 + 88, { color: "#667" });
  },
  update() {
    if (Keys.pressed("Space")) startClicked();
    if (Keys.pressed("KeyM")) Scenes.go("menu", Transitions.fade(400));
  },
});

Scenes.go("menu");
