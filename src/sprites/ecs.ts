// Optional one-way adapter from sprite-shaped rendering data to the ECS.
import { component, type Component, type Ecs } from "@src/ecs/index.js";
import type { DrawSprite } from "@src/engine/index.js";

/** Data accepted by both the standard component and `Draw.sprites`. */
export type SpriteData = DrawSprite;

/** A conventional sprite component. The ECS itself knows nothing about it. */
export const Sprite: Component<SpriteData> = component<SpriteData>("Sprite");

/** Snapshot sprite positions before movement for interpolated rendering. */
export function interpolate(ecs: Ecs): void {
  ecs.system("sprite-interpolate", (world) => {
    for (const sprite of world.dense(Sprite)) {
      sprite.px = sprite.x;
      sprite.py = sprite.y;
    }
  });
}
