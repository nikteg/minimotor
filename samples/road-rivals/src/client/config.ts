import { Gizmos } from "minimotor";

export type CarTypeId = "compact" | "muscle" | "drift";

export interface Point {
  x: number;
  y: number;
}

export interface RectShape {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CarConfig {
  label: string;
  w: number;
  h: number;
  acceleration: number;
  grip: number;
  steer: number;
  mass: number;
  color: string;
}

export interface Weapon {
  id: string;
  label: string;
  cooldown: number;
  damage: number;
  pellets: number;
  spread: number;
  speed: number;
  life: number;
}

export interface FleetPoint {
  x: number;
  y: number;
  type: CarTypeId;
}

export interface PickupData {
  id: string;
  kind: string;
  x: number;
  y: number;
  weapon?: string;
}

export const WORLD = { w: 4800, h: 3000 };
export const roadsX = [480, 1440, 2400, 3360, 4320];
export const roadsY = [375, 1125, 1875, 2625];

// Driving physics (acceleration/grip/steer) come from the engine's arcade-car
// presets; the sample adds only its own visual + mass fields on top.
export const CAR_TYPES: Record<string, CarConfig> = {
  compact: {
    ...Gizmos.carPresets.compact,
    label: "COMPACT",
    w: 54,
    h: 29,
    mass: 1.35,
    color: "#52e0c4",
  },
  muscle: {
    ...Gizmos.carPresets.muscle,
    label: "MUSCLE",
    w: 66,
    h: 34,
    mass: 2.15,
    color: "#ff9d4d",
  },
  drift: { ...Gizmos.carPresets.drift, label: "DRIFT", w: 61, h: 31, mass: 1.6, color: "#a78cff" },
};

export const WEAPONS: Weapon[] = [
  {
    id: "pistol",
    label: "PISTOL",
    cooldown: 0.22,
    damage: 25,
    pellets: 1,
    spread: 0,
    speed: 760,
    life: 1.25,
  },
  {
    id: "shotgun",
    label: "SHOTGUN",
    cooldown: 0.68,
    damage: 13,
    pellets: 7,
    spread: 0.2,
    speed: 680,
    life: 0.72,
  },
  {
    id: "smg",
    label: "SMG",
    cooldown: 0.075,
    damage: 10,
    pellets: 1,
    spread: 0.055,
    speed: 860,
    life: 1.05,
  },
];

export function fleetPoints(clientNo: number): FleetPoint[] {
  return clientNo % 2
    ? [
        { x: 660, y: 375, type: "compact" },
        { x: 1440, y: 1125, type: "muscle" },
        { x: 2400, y: 1875, type: "drift" },
      ]
    : [
        { x: 4140, y: 2625, type: "compact" },
        { x: 3360, y: 1875, type: "muscle" },
        { x: 2400, y: 1125, type: "drift" },
      ];
}
