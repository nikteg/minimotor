import type { Body2D } from "minimotor/physics2d";
import { roadsX, roadsY } from "./config.ts";

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
export interface Prop {
  x: number;
  y: number;
  radius: number;
  mass: number;
  color: string;
  body?: Body2D;
}

export function createRoadWorld() {
  const intersections: Point[] = [];
  for (const y of roadsY) {
    for (const x of roadsX) intersections.push({ x, y });
  }

  const props: Prop[] = intersections.slice(2, 18).map((point, index) => ({
    x: point.x + (index % 2 ? 82 : -82),
    y: point.y + (index % 3 ? 55 : -55),
    radius: index % 3 === 0 ? 18 : 14,
    mass: index % 3 === 0 ? 0.7 : 0.45,
    color: index % 3 === 0 ? "#d88b45" : "#a5b4b8",
  }));

  const buildings: RectShape[] = [];
  for (let gy = 0; gy < roadsY.length - 1; gy++) {
    for (let gx = 0; gx < roadsX.length - 1; gx++) {
      buildings.push({
        x: roadsX[gx] + 245,
        y: roadsY[gy] + 205,
        w: 470,
        h: 335,
      });
    }
  }

  const cover: RectShape[] = intersections.slice(4, 14).map((point, index) => ({
    x: point.x + (index % 2 ? 130 : -210),
    y: point.y + (index % 3 ? 115 : -150),
    w: index % 2 ? 90 : 130,
    h: 34,
  }));

  return {
    buildings,
    cover,
    intersections,
    props,
    solids: [...buildings, ...cover],
  };
}
