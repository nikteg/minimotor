import { Component, ComponentInit, SpriteData } from "./types.js";

let nextComponentId = 0;

/** Define a component type. Call once per component (module scope), then attach
 *  instances to entities. Identity is the object itself; the optional label is
 *  for debug tooling only. */
export function component<T>(label?: string): Component<T> {
  const id = nextComponentId++;
  const self: Component<T> = {
    id,
    name: label ?? `component${id}`,
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
