import { describe, expect, it } from "vitest";
import { parseObj } from "../obj.js";

describe("parseObj", () => {
  it("triangulates polygons and preserves UVs and supplied normals", () => {
    const mesh = parseObj(`
      v -1 0 0
      v 1 0 0
      v 1 1 0
      v -1 1 0
      vt 0 0
      vt 1 0
      vt 1 1
      vt 0 1
      vn 0 0 1
      f 1/1/1 2/2/1 3/3/1 4/4/1
    `);

    expect(mesh.positions).toHaveLength(12);
    expect(mesh.indices).toEqual(new Uint16Array([0, 1, 2, 0, 2, 3]));
    // OBJ V=0 is conventionally the bottom; MeshData V=0 is the top.
    expect(Array.from(mesh.uvs ?? [])).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect(Array.from(mesh.normals ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("supports negative indices and computes missing normals", () => {
    const mesh = parseObj(`
      v 0 0 0
      v 1 0 0
      v 0 1 0
      f -3 -2 -1
    `);

    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(Array.from(mesh.normals ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
});
