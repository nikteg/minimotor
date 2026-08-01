export const listItems = [
  "Fireball",
  "Ice Shard",
  "Lightning",
  "Heal",
  "Shield",
  "Teleport",
  "Meteor",
];
export const tabPages = ["Overview", "Stats", "Log"];
export const invItems = ["⚔️", "🛡️", "🧪", "🔥", "❄️", "⚡", "💎", "🗝️"];
export const creditLines = [
  "MiniMotor UI",
  "Immediate mode",
  "Canvas primitives",
  "Theme propagation",
  "Tileset skins",
  "Pixel fonts",
  "Flow containers",
  "Windowed lists",
  "Accessible inputs",
  "Keyboard focus",
  "Pointer gestures",
  "Drag and drop",
  "Modal overlays",
  "Thanks for trying it",
];

export interface Player {
  name: string;
  score: number;
  kd: number;
}

export const players: Player[] = [
  { name: "Nova", score: 2480, kd: 2.4 },
  { name: "Pixel", score: 1930, kd: 1.8 },
  { name: "Ghost", score: 3110, kd: 3.1 },
  { name: "Ember", score: 870, kd: 0.9 },
  { name: "Quartz", score: 2050, kd: 1.5 },
  { name: "Vortex", score: 1420, kd: 1.2 },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
