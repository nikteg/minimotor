export interface Located {
  x: number;
  y: number;
}

export interface InterestManagementApi {
  near<T extends Located>(origin: Located, entities: Iterable<T>, radius: number): T[];
  inRect<T extends Located>(
    entities: Iterable<T>,
    rect: { x: number; y: number; w: number; h: number },
  ): T[];
}

export function createInterestManagement(): InterestManagementApi {
  return {
    near(origin, entities, radius) {
      const result = [];
      const r2 = radius * radius;
      for (const entity of entities) {
        const dx = entity.x - origin.x;
        const dy = entity.y - origin.y;
        if (dx * dx + dy * dy <= r2) result.push(entity);
      }
      return result;
    },
    inRect(entities, rect) {
      const result = [];
      for (const entity of entities) {
        if (
          entity.x >= rect.x &&
          entity.y >= rect.y &&
          entity.x <= rect.x + rect.w &&
          entity.y <= rect.y + rect.h
        )
          result.push(entity);
      }
      return result;
    },
  };
}
