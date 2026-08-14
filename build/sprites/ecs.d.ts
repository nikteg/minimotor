import { type Component, type Ecs } from "../ecs/index.js";
import type { DrawSprite } from "../engine/index.js";
/** Data accepted by both the standard component and `Draw.sprites`. */
export type SpriteData = DrawSprite;
/** A conventional sprite component. The ECS itself knows nothing about it. */
export declare const Sprite: Component<SpriteData>;
/** Snapshot sprite positions before movement for interpolated rendering. */
export declare function interpolate(ecs: Ecs): void;
