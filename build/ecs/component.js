let nextComponentId = 0;
/** Define a component type. Call once per component (module scope), then attach
 *  instances to entities. Identity is the object itself; the optional label is
 *  for debug tooling only. */
export function component(label) {
    const id = nextComponentId++;
    const self = {
        id,
        name: label ?? `component${id}`,
        with(data) {
            return { component: self, data };
        },
    };
    return self;
}
