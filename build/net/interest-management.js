export function createInterestManagement() {
    return {
        near(origin, entities, radius) {
            const result = [];
            const r2 = radius * radius;
            for (const entity of entities) {
                const dx = entity.x - origin.x;
                const dy = entity.y - origin.y;
                if (dx * dx + dy * dy <= r2)
                    result.push(entity);
            }
            return result;
        },
        inRect(entities, rect) {
            const result = [];
            for (const entity of entities) {
                if (entity.x >= rect.x &&
                    entity.y >= rect.y &&
                    entity.x <= rect.x + rect.w &&
                    entity.y <= rect.y + rect.h)
                    result.push(entity);
            }
            return result;
        },
    };
}
