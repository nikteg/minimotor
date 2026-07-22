// SOLITAIRE: classic Klondike built with a broad sweep of Minimotor primitives.
// Demonstrates: Stage / Loop / Pointer / Draw, Scenes.create + Transitions,
// UI immediate-mode widgets + drag/drop, Input.map, Audio.Sfx, Storage,
// Timers, Clock.game timers, Anim motions (the AI's card glide + win cascade),
// Signals, Fsm, Particles.create, Collision, Mathf, Game.letterbox,
// Goodies.shuffle & gridFormation, Perf.plugin, Sprites.getSprite, and
// Anim.sheet for a win sparkle.
import {
  Anim, Audio, Clock, Collision, Draw, Fsm, Game, Goodies, Input, Loop,
  Mathf, Particles, Perf, Pointer, Scenes, Signals, Sprites, Stage, Storage,
  Timers, Transitions, UI,
} from "minimotor";

// ---- Constants & helpers ----
const SUITS = ["♠", "♥", "♣", "♦"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_COLOR = { "♠": "#111", "♣": "#111", "♥": "#c21", "♦": "#c21" };
const FOUNDATION_SUITS = ["♠", "♥", "♣", "♦"];

const CARD_W = 54;
const CARD_H = 76;
const CARD_GAP_V = 18;
const PILE_GAP_H = 10;
const MARGIN = 14;
const HUD_H = 24;

const LOGICAL_W = MARGIN * 2 + CARD_W * 7 + PILE_GAP_H * 6;
const LOGICAL_H = HUD_H + MARGIN * 2 + CARD_H + 20 + CARD_H + CARD_GAP_V * 12 + 80;

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

function isRed(suit) {
  return suit === "♥" || suit === "♦";
}

// ---- Game state ----
// The viewport is LIVE (mutated in place on resize); the resize handler only
// re-layouts and re-bakes DPR-dependent sprites.
const vp = Stage.init("game", { fullscreen: true, background: "#062", plugins: [Perf.plugin()] });
Stage.onResize(() => {
  layoutBoard();
  Sprites.clearSpriteCache();
  buildCardBackSprite();
});

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let deck = [];
let stock = [];
let waste = [];
let foundations = [[], [], [], []];
let tableau = [[], [], [], [], [], [], []];
let history = [];
let gameTime = 0;
let moves = 0;
let score = 0;
let aiPlaying = false;
let cancelAi = null;
let aiMotion = null;
let aiLastMove = null;
let aiStockPasses = 0;
let aiVisited = new Set();
let gameStartedAt = 0;
let stats = { wins: 0, games: 0, bestTime: 0 };

const fx = Particles.create();

const statsKey = "solitaire_stats_v1";

function loadStats() {
  stats = Storage.load(statsKey, { wins: 0, games: 0, bestTime: 0 });
}

function saveStats() {
  Storage.save(statsKey, stats);
}

// ---- Layout (logical coordinates, scaled to screen in draw) ----
let layout = {
  stock: { x: 0, y: 0, w: CARD_W, h: CARD_H },
  waste: { x: 0, y: 0, w: CARD_W, h: CARD_H },
  foundations: [],
  tableau: [],
};

function layoutBoard() {
  const lb = Game.letterbox(LOGICAL_W, LOGICAL_H, vp.w, vp.h);
  scale = lb.scale;
  offsetX = lb.ox;
  offsetY = lb.oy;

  const topY = HUD_H + MARGIN;
  layout.stock = { x: MARGIN, y: topY, w: CARD_W, h: CARD_H };
  layout.waste = { x: MARGIN + CARD_W + 10, y: topY, w: CARD_W, h: CARD_H };

  const foundStart = LOGICAL_W - MARGIN - CARD_W * 4 - PILE_GAP_H * 3;
  layout.foundations = FOUNDATION_SUITS.map((_, i) => ({
    x: foundStart + i * (CARD_W + PILE_GAP_H),
    y: topY,
    w: CARD_W,
    h: CARD_H,
  }));

  const tabY = topY + CARD_H + 20;
  layout.tableau = Array.from({ length: 7 }, (_, i) => ({
    x: MARGIN + i * (CARD_W + PILE_GAP_H),
    y: tabY,
    w: CARD_W,
    h: CARD_H,
  }));
}

function toScreen(rect) {
  return {
    x: rect.x * scale + offsetX,
    y: rect.y * scale + offsetY,
    w: rect.w * scale,
    h: rect.h * scale,
  };
}

function screenPoint(x, y) {
  return { x: x * scale + offsetX, y: y * scale + offsetY };
}

function pointInLogicalRect(px, py, rect) {
  const sr = toScreen(rect);
  return Collision.pointInRect(px, py, sr);
}

// ---- Sprite assets (card back + sparkle animation) ----
let cardBackSprite = null;

function buildCardBackSprite() {
  cardBackSprite = Sprites.getSprite("card-back", CARD_W, vp.dpr, (ctx) => {
    ctx.fillStyle = "#1a4a3a";
    ctx.fillRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
    ctx.strokeStyle = "#2f7a62";
    ctx.lineWidth = 2;
    ctx.strokeRect(-CARD_W / 2 + 3, -CARD_H / 2 + 3, CARD_W - 6, CARD_H - 6);
    ctx.fillStyle = "#2f7a62";
    for (let y = -CARD_H / 2 + 10; y < CARD_H / 2; y += 12) {
      for (let x = -CARD_W / 2 + 6; x < CARD_W / 2; x += 12) {
        ctx.beginPath();
        ctx.arc(x + (Math.floor((y + CARD_H / 2) / 12) % 2) * 6, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// An 8-frame rotating sparkle, baked once into a 1:1 atlas and played as a
// clock-derived sheet cursor (nothing ticks it).
const SPARKLE_SIZE = 64;
const sparkleAtlas = Sprites.atlas(
  SPARKLE_SIZE,
  SPARKLE_SIZE,
  8,
  (ctx, i) => {
    const size = SPARKLE_SIZE;
    ctx.rotate((i / 8) * Math.PI);
    ctx.fillStyle = `rgba(255, 223, 100, ${1 - i / 9})`;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.4);
    ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size * 0.38, 0);
    ctx.quadraticCurveTo(size * 0.12, size * 0.12, 0, size * 0.4);
    ctx.quadraticCurveTo(-size * 0.12, size * 0.12, -size * 0.38, 0);
    ctx.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size * 0.4);
    ctx.fill();
  },
  { origin: "center" },
);
const sparkleAnim = Anim.sheet(sparkleAtlas, {
  frame: { w: SPARKLE_SIZE, h: SPARKLE_SIZE },
  states: { spin: { row: 0, frames: 8, fps: 16 } },
}).play("spin");

// ---- Deck & deal ----
function freshDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank, faceUp: false, id: `${suit}${rank}` });
    }
  }
  return Goodies.shuffle(cards);
}

function snapshot() {
  return {
    stock: stock.map((c) => ({ ...c })),
    waste: waste.map((c) => ({ ...c })),
    foundations: foundations.map((p) => p.map((c) => ({ ...c }))),
    tableau: tableau.map((p) => p.map((c) => ({ ...c }))),
    score,
    moves,
  };
}

function restore(snap) {
  stock = snap.stock;
  waste = snap.waste;
  foundations = snap.foundations;
  tableau = snap.tableau;
  score = snap.score;
  moves = snap.moves;
}

function pushHistory() {
  if (history.length > 30) history.shift();
  history.push(snapshot());
}

function canMoveToFoundation(card, pileIndex) {
  const pile = foundations[pileIndex];
  if (!pile.length) return card.rank === "A" && card.suit === FOUNDATION_SUITS[pileIndex];
  const top = pile[pile.length - 1];
  return top.suit === card.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
}

function canMoveToTableau(card, columnIndex) {
  const pile = tableau[columnIndex];
  if (!pile.length) return card.rank === "K";
  const top = pile[pile.length - 1];
  return isRed(top.suit) !== isRed(card.suit) && rankValue(card.rank) === rankValue(top.rank) - 1;
}

function flipTopFaceDown() {
  for (const pile of tableau) {
    const top = pile[pile.length - 1];
    if (top && !top.faceUp) {
      top.faceUp = true;
      Audio.Sfx.blip(520, 0.04);
      score += 5;
    }
  }
}

function deal() {
  deck = freshDeck();
  stock = deck;
  waste = [];
  foundations = [[], [], [], []];
  tableau = [[], [], [], [], [], [], []];
  history = [];
  score = 0;
  moves = 0;
  gameTime = 0;
  gameStartedAt = performance.now();

  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = stock.pop();
      card.faceUp = row === col;
      tableau[col].push(card);
    }
  }
  flipTopFaceDown();
  pushHistory();
  Signals.emit("deal");
}

function recycleWaste() {
  if (stock.length) return;
  while (waste.length) {
    const card = waste.pop();
    card.faceUp = false;
    stock.push(card);
  }
  Audio.Sfx.blip(300, 0.05);
  pushHistory();
}

function drawFromStock() {
  if (!stock.length) {
    recycleWaste();
    return;
  }
  const count = Math.min(3, stock.length);
  for (let i = 0; i < count; i++) {
    const card = stock.pop();
    card.faceUp = true;
    waste.push(card);
  }
  Audio.Sfx.blip(660, 0.05);
  pushHistory();
}

function tryAutoMoveAny() {
  if (waste.length && tryAutoMoveToFoundation(waste, waste.length - 1)) return true;
  for (const pile of tableau) {
    if (pile.length && pile[pile.length - 1].faceUp && tryAutoMoveToFoundation(pile, pile.length - 1)) return true;
  }
  return false;
}

function aiQueueMove(source, index, target, targetType, targetIndex) {
  if (aiMotion) return;
  aiLastMove = { source, target };
  aiStockPasses = 0;
  const cards = source.slice(index);
  const sourceCol = tableau.indexOf(source);
  const sourceRect = source === waste
    ? layout.waste
    : { ...layout.tableau[sourceCol], y: layout.tableau[sourceCol].y + index * CARD_GAP_V };
  const destination = targetType === "foundation"
    ? layout.foundations[targetIndex]
    : { ...layout.tableau[targetIndex], y: layout.tableau[targetIndex].y + target.length * CARD_GAP_V };
  // A clock-derived motion glides the cards; the move lands when it's done
  // (polled in the playing state's update).
  aiMotion = {
    cards,
    from: { x: sourceRect.x, y: sourceRect.y },
    to: { x: destination.x, y: destination.y },
    t: Anim.animate({ ms: 360, ease: Mathf.easeInOut }),
    source, index, target, targetType,
  };
}

function aiMotionPos() {
  const t = aiMotion.t.value;
  return {
    x: Mathf.lerp(aiMotion.from.x, aiMotion.to.x, t),
    y: Mathf.lerp(aiMotion.from.y, aiMotion.to.y, t),
  };
}

function finishAiMotion() {
  const motion = aiMotion;
  aiMotion = null;
  moveCards(motion.source, motion.index, motion.target);
  if (motion.targetType === "foundation") checkWin();
}

function aiSignature() {
  const pile = (cards) => cards.map((card) => `${card.id}${card.faceUp ? "+" : "-"}`).join(",");
  return `${stock.length}|${pile(waste)}|${tableau.map(pile).join("/")}|${foundations.map(pile).join("/")}`;
}

function aiStep() {
  if (scenes.active !== "play" || fsm.current !== "playing" || aiMotion) return;
  const signature = aiSignature();
  if (aiVisited.has(signature)) {
    // Never give up: reset the search frontier and inspect the stock again.
    aiVisited.clear();
    aiLastMove = null;
    drawFromStock();
    return;
  }
  aiVisited.add(signature);
  if (waste.length) {
    const card = waste[waste.length - 1];
    const foundation = FOUNDATION_SUITS.findIndex((_, i) => canMoveToFoundation(card, i));
    if (foundation >= 0) {
      aiQueueMove(waste, waste.length - 1, foundations[foundation], "foundation", foundation);
      return;
    }
    const target = tableau.findIndex((_, i) => canMoveToTableau(card, i));
    if (target >= 0) {
      aiQueueMove(waste, waste.length - 1, tableau[target], "tableau", target);
      return;
    }
  }
  for (let col = 0; col < tableau.length; col++) {
    const pile = tableau[col];
    for (let index = 0; index < pile.length; index++) {
      if (!pile[index].faceUp || !pile.slice(index).every((card) => card.faceUp)) continue;
      if (index === pile.length - 1) {
        const foundation = FOUNDATION_SUITS.findIndex((_, i) => canMoveToFoundation(pile[index], i));
        if (foundation >= 0) {
          aiQueueMove(pile, index, foundations[foundation], "foundation", foundation);
          return;
        }
      }
      const target = tableau.findIndex((_, i) =>
        i !== col && canMoveToTableau(pile[index], i) &&
        !(aiLastMove?.source === tableau[i] && aiLastMove?.target === pile),
      );
      if (target >= 0) {
        aiQueueMove(pile, index, tableau[target], "tableau", target);
        return;
      }
    }
  }
  // Explore the stock before conceding. Allow one complete recycle pass.
  if (!stock.length) {
    aiStockPasses++;
    if (aiStockPasses > 1000) aiStockPasses = 0;
  }
  drawFromStock();
}

function toggleAi() {
  aiPlaying = !aiPlaying;
  cancelAi?.();
  cancelAi = aiPlaying ? Clock.game.every(520, aiStep) : null;
  UI.floatText(aiPlaying ? "AI playing" : "AI paused", Pointer.x, Pointer.y, { color: "#ffd43b" });
}

function tryAutoMoveToFoundation(sourcePile, sourceIndex) {
  const card = sourcePile[sourceIndex];
  if (!card || sourceIndex !== sourcePile.length - 1) return false;
  for (let i = 0; i < 4; i++) {
    if (canMoveToFoundation(card, i)) {
      foundations[i].push(sourcePile.pop());
      flipTopFaceDown();
      moves++;
      score += 10;
      Audio.Sfx.coin();
      Signals.emit("move", { to: "foundation" });
      pushHistory();
      checkWin();
      return true;
    }
  }
  return false;
}

function moveCards(sourcePile, sourceIndex, targetPile) {
  const cards = sourcePile.slice(sourceIndex);
  targetPile.push(...sourcePile.splice(sourceIndex));
  flipTopFaceDown();
  moves++;
  Audio.Sfx.blip(760, 0.04);
  Signals.emit("move", { count: cards.length });
  pushHistory();
}

function checkWin() {
  const allHome = foundations.every((p) => p.length === 13);
  if (allHome) {
    stats.wins++;
    const timeSec = Math.floor(gameTime / 1000);
    if (!stats.bestTime || timeSec < stats.bestTime) stats.bestTime = timeSec;
    saveStats();
    aiPlaying = false;
    cancelAi?.();
    cancelAi = null;
    Signals.emit("win", { time: timeSec });
    fsm.go("won");
    scenes.push("won");
  }
}

function tryUndo() {
  if (history.length <= 1) return;
  if (!undoCd.ready()) return;
  undoCd.use();
  history.pop();
  restore(history[history.length - 1]);
  Audio.Sfx.blip(440, 0.05);
  UI.floatText("Undo", Pointer.x, Pointer.y, { color: "#fff" });
}

function findHint() {
  if (waste.length) {
    const card = waste[waste.length - 1];
    for (let i = 0; i < 4; i++) if (canMoveToFoundation(card, i)) return { from: "waste", to: "foundation", index: i };
    for (let i = 0; i < 7; i++) if (canMoveToTableau(card, i)) return { from: "waste", to: "tableau", index: i };
  }
  for (let col = 0; col < 7; col++) {
    const pile = tableau[col];
    for (let idx = 0; idx < pile.length; idx++) {
      if (!pile[idx].faceUp) continue;
      const card = pile[idx];
      const isSequence = pile.slice(idx).every((c) => c.faceUp);
      if (!isSequence) continue;
      for (let i = 0; i < 4; i++) if (idx === pile.length - 1 && canMoveToFoundation(card, i)) return { from: "tableau", col, to: "foundation", index: i };
      for (let i = 0; i < 7; i++) if (i !== col && canMoveToTableau(card, i)) return { from: "tableau", col, to: "tableau", index: i };
    }
  }
  return null;
}

// ---- Input ----
const input = Input.map({
  newGame: ["KeyN"],
  undo: ["KeyU"],
  hint: ["KeyH"],
  autoMove: ["KeyA"],
  fullscreen: ["KeyF"],
});

// ---- Timers ----
const undoCd = Timers.cooldown(250);
const hintFlash = Timers.window(600);

// ---- FSM ----
const fsm = Fsm.create(
  {
    ready: {
      update: () => null,
    },
    playing: {
      update: () => {
        gameTime = performance.now() - gameStartedAt;
        undoCd.tick(Loop.step);
        hintFlash.tick(Loop.step);
        if (aiMotion?.t.done) finishAiMotion();
        if (input.newGame.pressed) {
          scenes.go("play", { transition: Transitions.fade(300) });
          return null;
        }
        if (input.undo.pressed) tryUndo();
        if (input.hint.pressed) hintFlash.charge();
        if (input.fullscreen.pressed) toggleFullscreen();
        if (input.autoMove.pressed && !tryAutoMoveAny()) {
          UI.floatText("No auto move", Pointer.x, Pointer.y, { color: "#ff6b6b" });
        }
        return null;
      },
    },
    won: {
      update: () => {
        undoCd.tick(Loop.step);
        return null;
      },
    },
  },
  "ready",
);

// ---- Drawing ----
function drawCard(ctx, card, x, y, w, h, ghost = false) {
  ctx.save();
  ctx.globalAlpha = ghost ? 0.6 : 1;
  if (!card.faceUp) {
    if (cardBackSprite) {
      ctx.drawImage(cardBackSprite, x, y, w, h);
    } else {
      ctx.fillStyle = "#1a4a3a";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#2f7a62";
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    }
  } else {
    ctx.fillStyle = "#f8f8f8";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#bbb";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const color = SUIT_COLOR[card.suit];
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(8, Math.floor(w * 0.24))}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(card.rank, x + 4, y + 3);
    ctx.font = `${Math.max(10, Math.floor(w * 0.34))}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(card.suit, x + w / 2, y + h / 2 + 2);
  }
  ctx.restore();
}

function drawEmptySlot(ctx, rect, label = "") {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.font = `${Math.max(12, rect.w * 0.3)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  ctx.restore();
}

function drawPiles(ctx) {
  // Stock
  const stockRect = toScreen(layout.stock);
  if (stock.length) {
    drawCard(ctx, { faceUp: false }, stockRect.x, stockRect.y, stockRect.w, stockRect.h);
    const stockSource = UI.dragSource({ id: "stock", ...stockRect, payload: { type: "stock" }, disabled: true });
    if (stockSource.hovered) Loop.setCursor("pointer");
  } else {
    drawEmptySlot(ctx, stockRect, "↺");
  }
  if (pointInLogicalRect(Pointer.x, Pointer.y, layout.stock)) {
    Loop.setCursor("pointer");
    if (Pointer.frameReleased) drawFromStock();
  }

  // Waste
  const wasteRect = toScreen(layout.waste);
  if (waste.length) {
    const card = waste[waste.length - 1];
    if (!(aiMotion?.source === waste)) drawCard(ctx, card, wasteRect.x, wasteRect.y, wasteRect.w, wasteRect.h);
    const src = UI.dragSource({ id: "waste-top", ...wasteRect, payload: { type: "waste", cards: [card], source: waste, from: { type: "waste", index: waste.length - 1 } } });
    if (src.hovered) Loop.setCursor("grab");
  } else {
    drawEmptySlot(ctx, wasteRect);
  }

  // Foundations
  layout.foundations.forEach((logical, i) => {
    const rect = toScreen(logical);
    const pile = foundations[i];
    if (pile.length) {
      const card = pile[pile.length - 1];
      drawCard(ctx, card, rect.x, rect.y, rect.w, rect.h);
      const src = UI.dragSource({ id: `foundation:${i}`, ...rect, payload: { type: "foundation", col: i, cards: [card], source: pile, from: { type: "foundation", col: i, index: pile.length - 1 } } });
      if (src.hovered) Loop.setCursor("grab");
    } else {
      drawEmptySlot(ctx, rect, FOUNDATION_SUITS[i]);
    }
    const tgt = UI.dropTarget({
      id: `foundation:${i}`,
      ...rect,
      accepts: (payload) => payload.cards.length === 1 && canMoveToFoundation(payload.cards[0], i),
    });
    if (tgt.canDrop) {
      ctx.strokeStyle = "#ffd43b";
      ctx.lineWidth = 3 * scale;
      ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    }
    if (tgt.dropped) {
      const payload = tgt.dropped.payload;
      moveCards(payload.source, payload.from.index, foundations[i]);
      checkWin();
    }
  });

  // Tableau
  layout.tableau.forEach((logical, col) => {
    const rect = toScreen(logical);
    const pile = tableau[col];
    if (!pile.length) drawEmptySlot(ctx, rect);

    const emptyTarget = UI.dropTarget({
      id: `tableau:${col}`,
      ...rect,
      accepts: (payload) => payload.cards[0].rank === "K",
    });
    if (emptyTarget.canDrop) {
      ctx.strokeStyle = "#4ecdc4";
      ctx.lineWidth = 3 * scale;
      ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    }
    if (emptyTarget.dropped) {
      const payload = emptyTarget.dropped.payload;
      moveCards(payload.source, payload.from.index, tableau[col]);
    }

    pile.forEach((card, idx) => {
      const cy = logical.y + idx * CARD_GAP_V;
      const cardRect = toScreen({ x: logical.x, y: cy, w: CARD_W, h: CARD_H });
      const hiddenByAi = aiMotion?.source === pile && idx >= aiMotion.index;
      if (!hiddenByAi) drawCard(ctx, card, cardRect.x, cardRect.y, cardRect.w, cardRect.h);

      if (card.faceUp && !hiddenByAi) {
        const isBottom = idx === pile.length - 1;
        const canDrag = isBottom || pile.slice(idx + 1).every((c) => c.faceUp);
        if (canDrag) {
          const src = UI.dragSource({
            id: `tableau:${col}:${idx}`,
            ...cardRect,
            payload: { type: "tableau", col, index: idx, cards: pile.slice(idx), source: tableau[col], from: { type: "tableau", col, index: idx } },
          });
          if (src.hovered) Loop.setCursor("grab");
        }
      }

      if (card.faceUp) {
        const tgt = UI.dropTarget({
          id: `tableau:${col}:card:${idx}`,
          ...cardRect,
          accepts: (payload) => canMoveToTableau(payload.cards[0], col),
        });
        if (tgt.canDrop) {
          ctx.strokeStyle = "#4ecdc4";
          ctx.lineWidth = 3 * scale;
          ctx.strokeRect(cardRect.x + 2, cardRect.y + 2, cardRect.w - 4, cardRect.h - 4);
        }
        if (tgt.dropped) {
          const payload = tgt.dropped.payload;
          moveCards(payload.source, payload.from.index, tableau[col]);
        }
      }
    });
  });

  // AI's animated drag preview (a clock-derived glide between the piles)
  if (aiMotion) {
    const at = aiMotionPos();
    aiMotion.cards.forEach((card, i) => {
      const pos = screenPoint(at.x, at.y + i * CARD_GAP_V);
      drawCard(ctx, card, pos.x, pos.y, CARD_W * scale, CARD_H * scale, true);
    });
  }

  // Drag preview
  const drag = UI.draggedItem();
  if (drag) {
    const payload = drag.payload;
    payload.cards.forEach((card, i) => {
      drawCard(ctx, card, drag.x, drag.y + i * CARD_GAP_V * scale, CARD_W * scale, CARD_H * scale, false);
    });
  }
}

function drawHud(ctx) {
  UI.group(
    {
      x: Math.max(12, (vp.w - 306) / 2),
      y: 4,
      w: 306,
      h: 48,
      dir: "row",
      gap: 8,
      pad: 8,
    },
    (bar) => {
      UI.text(`TIME ${formatTime(gameTime)}`, { at: bar, w: 92, h: 32, size: 11, align: "center", color: "#fff" });
      UI.text(`SCORE ${score}`, { at: bar, w: 92, h: 32, size: 11, align: "center", color: "#fff" });
      UI.text(`MOVES ${moves}`, { at: bar, w: 92, h: 32, size: 11, align: "center", color: "#fff" });
    },
  );

  if (hintFlash.active) {
    const hint = findHint();
    if (hint) {
      const rect = toScreen(hint.to === "foundation" ? layout.foundations[hint.index] : hint.from === "waste" ? layout.waste : layout.tableau[hint.index]);
      ctx.save();
      ctx.strokeStyle = "#ffd43b";
      ctx.lineWidth = 3 * scale;
      ctx.strokeRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
      ctx.restore();
    }
  }

  const toolbarY = (LOGICAL_H - 42) * scale + offsetY;
  const toolbar = UI.stack({ x: MARGIN * scale + offsetX, y: toolbarY, gap: 10 * scale });
  if (UI.button({ at: toolbar, label: "NEW (N)", variant: "primary", h: 32 * scale })) scenes.go("play", { transition: Transitions.fade(300) });
  if (UI.button({ at: toolbar, label: "UNDO (U)", h: 32 * scale })) tryUndo();
  if (UI.button({ at: toolbar, label: "HINT (H)", h: 32 * scale })) hintFlash.charge();
  if (UI.button({ at: toolbar, label: aiPlaying ? "PAUSE AI" : "AI PLAY", h: 32 * scale })) toggleAi();
  if (UI.button({ at: toolbar, label: "FULL (F)", h: 32 * scale })) toggleFullscreen();
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
}

// ---- Scenes ----
const scenes = Scenes.create({
  play: {
    opaque: true,
    enter: () => {
      loadStats();
      stats.games++;
      saveStats();
      deal();
      fsm.go("playing");
      gameStartedAt = performance.now();
      UI.clearFloatText();
      fx.clear();
      aiPlaying = false;
      cancelAi?.();
      cancelAi = null;
      aiMotion = null;
      aiLastMove = null;
      aiStockPasses = 0;
      aiVisited = new Set();
      Clock.game.after(400, () => {
        const pos = screenPoint(LOGICAL_W / 2, LOGICAL_H / 2);
        UI.floatText("Good luck!", pos.x, pos.y, { color: "#4ecdc4" });
      });
    },
    update: () => {
      fsm.update();
    },
    draw: () => {
      const ctx = Draw.ctx;
      Game.drawLetterbox(ctx, vp.w, vp.h, LOGICAL_W, LOGICAL_H, "#062", "#0b3d2e");

      drawPiles(ctx);
      drawHud(ctx);

      UI.drawFloatText();
      UI.drawTips();
    },
  },

  won: {
    // Pushed as an overlay over `play`; the win cascade, sparkle and confetti
    // all live on Clock.game, so keep world time flowing under the modal.
    holdsTime: false,
    enter: () => {
      fsm.go("won");
      Audio.Sfx.coin();
      const cx = LOGICAL_W / 2;
      const cy = LOGICAL_H / 2;
      const centerScreen = screenPoint(cx, cy);
      fx.burst({
        at: centerScreen,
        count: 80,
        speed: [60 / 60, 260 / 60], // old px/s ÷ 60 → px/step
        color: ["#ffd43b", "#4ecdc4", "#ff6b6b", "#fff"],
        gravity: 120 / 3600, // old px/s² → px/step²
        life: [600, 1400],
      });
      const positions = Goodies.gridFormation(52, 13, CARD_W + 2, CARD_H + 2, cx, cy + 40);
      foundations.forEach((pile, si) => {
        pile.forEach((card, ri) => {
          const pos = positions[si * 13 + ri];
          card.fly = {
            from: { x: layout.foundations[si].x, y: layout.foundations[si].y },
            to: { x: pos.x - CARD_W / 2, y: pos.y - CARD_H / 2 },
            t: Anim.animate({ ms: 600, ease: Mathf.easeInOut }),
          };
        });
      });
    },
    update: () => {
      fsm.update();
      if (input.newGame.pressed) scenes.go("play", { transition: Transitions.fade(300) });
    },
    draw: () => {
      const ctx = Draw.ctx;

      // `play` re-draws beneath us (non-opaque push); dim the board.
      Game.drawLetterbox(ctx, vp.w, vp.h, LOGICAL_W, LOGICAL_H, "#062", "rgba(11,61,46,0.7)");

      foundations.forEach((pile) => {
        pile.forEach((card) => {
          if (card.fly) {
            const t = card.fly.t.value;
            const pos = screenPoint(
              Mathf.lerp(card.fly.from.x, card.fly.to.x, t),
              Mathf.lerp(card.fly.from.y, card.fly.to.y, t),
            );
            drawCard(ctx, card, pos.x, pos.y, CARD_W * scale, CARD_H * scale);
          }
        });
      });

      Draw.particles(fx);
      const sparkleSize = 64 * scale;
      const sparklePos = screenPoint(LOGICAL_W / 2, LOGICAL_H / 2 - 60);
      Draw.sprite(sparkleAnim, {
        x: sparklePos.x - sparkleSize / 2,
        y: sparklePos.y - sparkleSize / 2,
        w: sparkleSize,
        h: sparkleSize,
      });

      const titlePos = screenPoint(LOGICAL_W / 2, LOGICAL_H / 2 - 60);
      const subPos = screenPoint(LOGICAL_W / 2, LOGICAL_H / 2 - 12);
      Draw.text("YOU WON!", { x: titlePos.x, y: titlePos.y, font: "bold 38px monospace", color: "#ffd43b", align: "center", baseline: "middle" });
      Draw.text(`Time ${formatTime(gameTime)}   Moves ${moves}`, { x: subPos.x, y: subPos.y, font: "16px monospace", color: "#fff", align: "center", baseline: "middle" });

      const btnY = (LOGICAL_H / 2 + 30) * scale + offsetY;
      if (UI.button({ x: vp.w / 2 - 170, y: btnY, w: 160, h: 42, label: "PLAY AGAIN" })) scenes.go("play", { transition: Transitions.fade(300) });
    },
  },
});

// ---- Signal wiring ----
Signals.on("move", () => {});
Signals.on("win", ({ time }) => {
  const pos = screenPoint(LOGICAL_W / 2, LOGICAL_H / 2 - 100);
  UI.floatText(`Win in ${time}s!`, pos.x, pos.y, { color: "#ffd43b", font: "bold 18px monospace" });
});

// ---- Bootstrap ----
layoutBoard();
buildCardBackSprite();
Loop.run(scenes); // "play" (the first key) opens
