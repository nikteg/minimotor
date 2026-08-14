const EVENT_KEY = "__mm_event";
/** A typed event channel over a Room for one-shot gameplay facts: shots,
 * damage, pickups, chat, emotes. Tagged envelopes coexist with state sync. */
export function events(room) {
    const handlers = new Map();
    const requestHandlers = new Map();
    const dispatch = (target, type, data, from) => {
        for (const handler of target.get(type) ?? [])
            handler(data, from);
    };
    const off = room.onMessage((from, message) => {
        if (typeof message !== "object" ||
            message === null ||
            message[EVENT_KEY] !== 1)
            return;
        const event = message;
        if (event.request) {
            if (room.hosting)
                dispatch(requestHandlers, event.type, event.data, from);
        }
        else
            dispatch(handlers, event.type, event.data, from);
    });
    const add = (target, type, handler) => {
        let set = target.get(type);
        if (!set)
            target.set(type, (set = new Set()));
        set.add(handler);
        return () => set.delete(handler);
    };
    const on = (type, handler) => add(handlers, type, handler);
    return {
        emit(type, data) {
            room.send({ [EVENT_KEY]: 1, type, data });
        },
        request(type, data) {
            if (room.hosting)
                dispatch(requestHandlers, type, data, room.id);
            else
                room.send({ [EVENT_KEY]: 1, type, data, request: true });
        },
        on,
        onRequest(type, handler) {
            return add(requestHandlers, type, handler);
        },
        once(type, handler) {
            let unsubscribe = () => { };
            unsubscribe = on(type, (data, from) => {
                unsubscribe();
                handler(data, from);
            });
            return unsubscribe;
        },
        stop() {
            off();
            handlers.clear();
            requestHandlers.clear();
        },
    };
}
