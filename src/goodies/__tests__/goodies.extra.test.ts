import { describe, expect, it } from "vitest";
import { distanceField } from "@src/goodies/index.js";

describe("Goodies.distanceField", () => {
  // A 5-wide corridor with a wall at x=2 (row 0 open, everything else wall).
  const open = (x: number, y: number) => y === 0 && x >= 0 && x < 5 && x !== 2;

  it("measures BFS steps from the source and marks unreachable as Infinity", () => {
    const field = distanceField({ x: 0, y: 0 }, open);
    expect(field.at(0, 0)).toBe(0);
    expect(field.at(1, 0)).toBe(1);
    expect(field.at(2, 0)).toBe(Infinity); // the wall
    expect(field.at(3, 0)).toBe(Infinity); // cut off behind the wall
    expect(field.at(0, 1)).toBe(Infinity); // off the corridor
  });

  it("takes multiple sources (nearest wins)", () => {
    const flat = (x: number, y: number) => y === 0 && x >= 0 && x < 5;
    const field = distanceField(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      flat,
    );
    expect(field.at(0, 0)).toBe(0);
    expect(field.at(4, 0)).toBe(0);
    expect(field.at(2, 0)).toBe(2); // two steps from either end
    expect(field.cells.length).toBe(5);
  });
});
