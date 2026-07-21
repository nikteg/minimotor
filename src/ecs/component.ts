import { Component, ComponentInit, SpriteData } from "./types.js";

let nextComponentId = 0;

/** Define a component type. Call once per component (module scope), then attach
 *  instances to entities. The name is for debugging only; identity is the id. */
export function component<T>(name: string): Component<T> {
  const id = nextComponentId++;
  const self: Component<T> = {
    id,
    name,
    with(data: T): ComponentInit<T> {
      return { component: self, data };
    },
  };
  return self;
}

/** The engine-standard sprite component. Bake a texture with `Sprites.getSprite`
 *  (or load an image), attach `Sprite.with({ x, y, img })`, then let
 *  `world.drawSprites(ctx)` draw it. */
export const Sprite = component<SpriteData>("Sprite");
