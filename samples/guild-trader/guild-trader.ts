// GUILD TRADER: RPG inventory drag/drop, stack merging, dialogue and loot recipes.
import { Draw, Gizmos, Goodies, Loop, Perf, Pointer, Stage, UI } from "minimotor";
import type { Flow } from "minimotor";

interface Item {
  name: string;
  color: string;
  max: number;
}
interface Slot {
  item: Item;
  count: number;
  max: number;
}
interface DragPayload {
  index: number;
}

// Live viewport; the engine owns the background clear.
const vp = Stage.init("game", {
  background: "#101722",
  plugins: [Perf.plugin()],
  preventNavigation: true,
});

const items: Record<string, Item> = {
  potion: { name: "POTION", color: "#ff6b6b", max: 5 },
  bomb: { name: "BOMB", color: "#ffad3d", max: 3 },
  rune: { name: "RUNE", color: "#b197fc", max: 2 },
  sword: { name: "SWORD", color: "#9ad1d4", max: 1 },
};
const loot = [
  { value: items.potion, weight: 5 },
  { value: items.bomb, weight: 3 },
  { value: items.rune, weight: 1 },
];
const encounterBag = Gizmos.shuffleBag(["SLIME", "BAT", "MIMIC", "WISP"]);
const slots: Array<Slot | null> = [
  { item: items.potion, count: 3, max: 5 },
  { item: items.bomb, count: 2, max: 3 },
  null,
  { item: items.sword, count: 1, max: 1 },
  { item: items.rune, count: 1, max: 2 },
  null,
  null,
  null,
];
let dialogue = true;
let message = "Drag matching stacks together, or swap different items.";
let encounter = "—";

function addItem(item: Item) {
  const leftover = Goodies.addToInventory(slots, item, { max: item.max });
  message = leftover > 0 ? "Inventory full." : `Received ${item.name}.`;
}

// Roll a weighted loot drop into the inventory — shared by the button and the
// merchant dialogue so the pick + collect stays in one place.
function rollLoot() {
  const item = Goodies.weightedPick(loot);
  if (item) addItem(item);
}

// A 2×4 slot grid. UI.grid hands each cell its rect, so the slot code drops
// the nested row/column loops and the slot-width arithmetic. `region` is a
// full-width block reserved in the panel's column (two 48px rows + an 8px gap).
function drawInventory(ctx: CanvasRenderingContext2D, layout: Flow) {
  const region = layout.next(undefined, 104);
  UI.grid({ ...region, cols: 4, rows: 2, gap: 8 }, (rect, i) => {
    Draw.rect(rect, "#182536");
    ctx.strokeStyle = "#3a5568";
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    const stack = slots[i];
    if (stack) UI.dragSource({ id: `slot:${i}`, ...rect, payload: { index: i } });
    const target = UI.dropTarget<DragPayload>({ id: `slot:${i}`, ...rect });
    if (target.canDrop) {
      ctx.strokeStyle = "#4ecdc4";
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    }
    if (target.dropped) {
      const from = target.dropped.payload.index;
      if (Goodies.transferStack(slots, from, i)) message = "Inventory reorganized.";
    }
    if (stack && UI.draggedItem<DragPayload>()?.sourceId !== `slot:${i}`) {
      const icon = Math.min(22, rect.h - 20);
      Draw.rect(rect.x + (rect.w - icon) / 2, rect.y + 5, icon, icon, stack.item.color);
      UI.text(stack.item.name, {
        x: rect.x + 3,
        y: rect.y + rect.h - 18,
        w: rect.w - 6,
        h: 14,
        size: 9,
        align: "center",
      });
      UI.text(`×${stack.count}`, {
        x: rect.x + rect.w - 22,
        y: rect.y + 3,
        w: 18,
        h: 14,
        size: 9,
        align: "right",
      });
    }
  });
}

Loop.run({
  update() {},
  draw(ctx) {
    const frame = { x: Math.max(12, (vp.w - 640) / 2), y: 12, w: Math.min(640, vp.w - 24), h: 292 };
    const half = (frame.w - 12) / 2;

    // Callback containers are the layout tree: widgets flow through the
    // ambient row/column cursor and still return clicks inline.
    UI.col({ ...frame, gap: 12 }, () => {
      UI.panel({ h: 66, title: "GUILD TRADER", pad: 4 }, () => {
        UI.text("RPG recipes: typed drag/drop · stack transfer · weighted loot · shuffle bags", {
          h: 18,
          size: 11,
          padX: 8,
          color: "dim",
        });
      });

      UI.row({ h: 166, gap: 12 }, () => {
        UI.panel({ w: half, h: 166, title: "ADVENTURER INVENTORY", gap: 8 }, (body) => {
          drawInventory(ctx, body);
        });
        UI.panel({ w: half, h: 166, title: "MARA'S COUNTER", gap: 7 }, () => {
          UI.row({ h: 32, gap: 10 }, (actions) => {
            if (UI.button({ at: actions, w: (half - 26) / 2, label: "ROLL LOOT" })) rollLoot();
            if (UI.button({ at: actions, w: (half - 26) / 2, label: "NEXT ENCOUNTER" }))
              encounter = encounterBag.next() ?? "—";
          });
          UI.text(`Next: ${encounter}`, { h: 20, align: "center", color: "accent" });
          // Wrap instead of squeezing: the message is wider than the counter panel.
          UI.text(message, { h: 44, align: "center", color: "dim", wrap: true, padX: 6 });
        });
      });

      UI.row({ h: 36 }, () => {
        UI.spacer((frame.w - 150) / 2);
        if (UI.button({ w: 150, h: 36, label: "TALK TO MARA", variant: "primary" }))
          dialogue = true;
      });
    });

    const drag = UI.draggedItem<DragPayload>();
    if (drag) {
      const stack = slots[drag.payload.index];
      if (stack) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = stack.item.color;
        ctx.fillRect(Pointer.x - 14, Pointer.y - 14, 28, 28);
        ctx.restore();
      }
    }

    if (dialogue) {
      const answer = UI.dialog({
        speaker: "MARA THE MERCHANT",
        lines: ["Welcome to the guild. Need supplies for your next run?"],
        choices: ["GIVE ME LOOT", "GOODBYE"],
      });
      if (answer === "GIVE ME LOOT") {
        rollLoot();
        dialogue = false;
      }
      if (answer === "GOODBYE") dialogue = false;
    }
  },
});
