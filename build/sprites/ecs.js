// Optional one-way adapter from sprite-shaped rendering data to the ECS.
import { component } from "../ecs/index.js";
/** A conventional sprite component. The ECS itself knows nothing about it. */
export const Sprite = component("Sprite");
/** Snapshot sprite positions before movement for interpolated rendering. */
export function interpolate(ecs) {
    ecs.system("sprite-interpolate", (world) => {
        for (const sprite of world.dense(Sprite)) {
            sprite.px = sprite.x;
            sprite.py = sprite.y;
        }
    });
}
