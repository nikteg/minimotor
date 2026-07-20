export const WORLD = { w: 4800, h: 3000 };
export const roadsX = [480, 1440, 2400, 3360, 4320];
export const roadsY = [375, 1125, 1875, 2625];

export const CAR_TYPES = {
  compact: {
    label: "COMPACT",
    w: 54,
    h: 29,
    acceleration: 920,
    grip: 8.4,
    steer: 0.78,
    mass: 1.35,
    color: "#52e0c4",
  },
  muscle: {
    label: "MUSCLE",
    w: 66,
    h: 34,
    acceleration: 1120,
    grip: 6.1,
    steer: 0.62,
    mass: 2.15,
    color: "#ff9d4d",
  },
  drift: {
    label: "DRIFT",
    w: 61,
    h: 31,
    acceleration: 850,
    grip: 3.8,
    steer: 0.9,
    mass: 1.6,
    color: "#a78cff",
  },
};

export const WEAPONS = [
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

export function fleetPoints(clientNo) {
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
