import { WebSocketServer } from "ws";
import { leadTarget } from "../../../../src/goodies/index.js";
import { createPresence, serve, serverTick } from "../../../../src/net/server/index.js";

/** Create the self-contained authoritative server for the Road Rivals sample. */
export function createRoadRivalsServer(): WebSocketServer {
  const road = new WebSocketServer({ noServer: true });
  // Road Rivals has a tiny authoritative world server: players still own their
  // movement, while bots, bot damage and health pickups live here so every
  // client observes one shared simulation rather than spawning private AI.
  const players = createPresence<{ x: number; y: number; vx: number; vy: number; phase: string }>();
  const roadsX = [480, 1440, 2400, 3360, 4320];
  const roadsY = [375, 1125, 1875, 2625];
  const intersections = roadsY.flatMap((y) => roadsX.map((x) => ({ x, y })));
  const botSpawns = Array.from({ length: 6 }, (_, i) => ({
    x: 480 + (i % 4) * 960,
    y: 1125 + Math.floor(i / 4) * 750,
  }));
  const botSolids = [] as { x: number; y: number; w: number; h: number }[];
  for (let gy = 0; gy < roadsY.length - 1; gy++) {
    for (let gx = 0; gx < roadsX.length - 1; gx++) {
      botSolids.push({ x: roadsX[gx] + 245, y: roadsY[gy] + 205, w: 470, h: 335 });
    }
  }
  botSolids.push(
    ...intersections.slice(4, 14).map((point, index) => ({
      x: point.x + (index % 2 ? 130 : -210),
      y: point.y + (index % 3 ? 115 : -150),
      w: index % 2 ? 90 : 130,
      h: 34,
    })),
  );
  const botBlocked = (x: number, y: number) =>
    botSolids.some((rect) => {
      const nx = Math.max(rect.x, Math.min(rect.x + rect.w, x));
      const ny = Math.max(rect.y, Math.min(rect.y + rect.h, y));
      return (x - nx) ** 2 + (y - ny) ** 2 < 14 ** 2;
    });
  const bots = botSpawns.map((p, i) => ({
    id: `bot-${i}`,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    health: 100,
    deadUntil: 0,
    shotAt: 0,
  }));
  const pickups: {
    id: string;
    x: number;
    y: number;
    kind: "health" | "weapon";
    weapon?: "shotgun" | "smg";
    active: boolean;
    respawnAt: number;
  }[] = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `med-${i}`,
      x: 480 + (i % 5) * 960 + (i % 2 ? 95 : -95),
      y: 375 + (i % 4) * 750 + (i % 3 ? 80 : -80),
      kind: "health" as const,
      active: true,
      respawnAt: 0,
    })),
    {
      id: "weapon-shotgun",
      x: 2400,
      y: 1040,
      kind: "weapon",
      weapon: "shotgun",
      active: true,
      respawnAt: 0,
    },
    {
      id: "weapon-smg",
      x: 3360,
      y: 1960,
      kind: "weapon",
      weapon: "smg",
      active: true,
      respawnAt: 0,
    },
  ];
  // serve() owns the socket bookkeeping; the authoritative bot/pickup state
  // below broadcasts through the same room, and peer messages relay untouched.
  interface RoadMsg {
    game: string;
    type: string;
    id: string;
    px: number;
    py: number;
    vx?: number;
    vy?: number;
    phase: string;
    target?: string;
    damage?: number;
    ix?: number;
    iy?: number;
    pickupId?: string;
  }
  const room = serve<unknown, RoadMsg>(road, {
    onMessage(client, msg) {
      if (msg.game !== "road-rivals") return;
      if (msg.type === "state") {
        players.set(msg.id, {
          x: msg.px,
          y: msg.py,
          vx: msg.vx ?? 0,
          vy: msg.vy ?? 0,
          phase: msg.phase,
        });
      } else if (msg.type === "bye") {
        players.delete(msg.id);
      } else if (msg.type === "hit" && String(msg.target).startsWith("bot-")) {
        const bot = bots.find((entry) => entry.id === msg.target);
        if (bot && bot.deadUntil === 0) {
          bot.health -= Math.max(0, Math.min(100, msg.damage ?? 25));
          bot.vx += msg.ix ?? 0;
          bot.vy += msg.iy ?? 0;
          if (bot.health <= 0) {
            bot.deadUntil = Date.now() + 3500;
            room.broadcast({ game: "road-rivals", type: "bot-killed", by: msg.id, botId: bot.id });
          }
        }
      } else if (msg.type === "pickup") {
        const pickup = pickups.find((entry) => entry.id === msg.pickupId);
        const state = players.get(msg.id);
        if (pickup?.active && state && Math.hypot(state.x - pickup.x, state.y - pickup.y) < 55) {
          pickup.active = false;
          pickup.respawnAt = Date.now() + (pickup.kind === "weapon" ? 12000 : 8000);
          if (pickup.kind === "weapon") {
            room.broadcast({
              game: "road-rivals",
              type: "weapon-pickup",
              target: msg.id,
              weapon: pickup.weapon,
            });
          } else {
            room.broadcast({ game: "road-rivals", type: "heal", target: msg.id, amount: 35 });
          }
        }
      }
      // Player snapshots, shots and player/car hits stay immediate peer
      // messages; the authoritative world packet below covers bots/pickups.
      if (!(msg.type === "hit" && String(msg.target).startsWith("bot-")) && msg.type !== "pickup") {
        room.relay(client, msg);
      }
    },
  });
  serverTick(20, () => {
    const now = Date.now();
    for (let i = 0; i < pickups.length; i++) {
      if (!pickups[i].active && now >= pickups[i].respawnAt) pickups[i].active = true;
    }
    players.prune(); // forget players who've gone quiet (dropped sockets)
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (bot.deadUntil) {
        if (now < bot.deadUntil) continue;
        bot.deadUntil = 0;
        bot.health = 100;
        bot.x = botSpawns[i].x;
        bot.y = botSpawns[i].y;
      }
      let target: { x: number; y: number; vx: number; vy: number } | null = null;
      let targetBot: (typeof bots)[number] | null = null;
      let distance = Infinity;
      for (const [, player] of players.entries()) {
        if (player.phase !== "alive") continue;
        const d = Math.hypot(player.x - bot.x, player.y - bot.y);
        if (d < distance) {
          distance = d;
          target = player;
        }
      }
      // Bots are valid opponents too. This keeps the city alive while clients
      // spectate and produces shared server-side bot-vs-bot fights.
      for (const other of bots) {
        if (other === bot || other.deadUntil > now) continue;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < distance) {
          distance = d;
          target = other;
          targetBot = other;
        }
      }
      if (target && distance < 900) {
        const nx = (target.x - bot.x) / (distance || 1);
        const ny = (target.y - bot.y) / (distance || 1);
        // Seek to a combat ring rather than the target center, then orbit in
        // alternating directions. Local separation keeps crowds readable.
        const radial = distance > 280 ? 1 : distance < 190 ? -0.9 : 0;
        const orbit = distance < 520 ? (i % 2 ? 0.72 : -0.72) : 0;
        bot.vx += (nx * radial - ny * orbit) * 18;
        bot.vy += (ny * radial + nx * orbit) * 18;
        for (const neighbor of bots) {
          if (neighbor === bot || neighbor.deadUntil > now) continue;
          const sx = bot.x - neighbor.x;
          const sy = bot.y - neighbor.y;
          const sd = Math.hypot(sx, sy) || 1;
          if (sd < 105) {
            const force = (105 - sd) * 0.11;
            bot.vx += (sx / sd) * force;
            bot.vy += (sy / sd) * force;
          }
        }
        if (distance < 520 && now >= bot.shotAt) {
          bot.shotAt = now + 900 + Math.random() * 650;
          const lead = leadTarget(bot.x, bot.y, target.x, target.y, target.vx, target.vy, 760);
          room.broadcast({
            game: "road-rivals",
            type: "shot",
            id: bot.id,
            bot: true,
            color: "#ff695f",
            shotId: `${bot.id}:${now}`,
            x: bot.x,
            y: bot.y,
            a: Math.atan2((lead?.y ?? target.y) - bot.y, (lead?.x ?? target.x) - bot.x),
          });
          if (targetBot) {
            targetBot.health -= 20;
            targetBot.vx += ((targetBot.x - bot.x) / (distance || 1)) * 55;
            targetBot.vy += ((targetBot.y - bot.y) / (distance || 1)) * 55;
            if (targetBot.health <= 0 && targetBot.deadUntil === 0) {
              targetBot.deadUntil = now + 3500;
              room.broadcast({
                game: "road-rivals",
                type: "bot-killed",
                by: bot.id,
                botId: targetBot.id,
              });
            }
          }
        }
      }
      const nextX = Math.max(30, Math.min(4770, bot.x + bot.vx * 0.05));
      if (!botBlocked(nextX, bot.y)) bot.x = nextX;
      else bot.vx *= -0.25;
      const nextY = Math.max(30, Math.min(2970, bot.y + bot.vy * 0.05));
      if (!botBlocked(bot.x, nextY)) bot.y = nextY;
      else bot.vy *= -0.25;
      bot.vx *= 0.88;
      bot.vy *= 0.88;
    }
    room.broadcast({
      game: "road-rivals",
      type: "world",
      bots: bots.map((bot) => ({
        id: bot.id,
        x: bot.x,
        y: bot.y,
        vx: bot.vx,
        vy: bot.vy,
        health: bot.health,
        dead: bot.deadUntil > now,
      })),
      pickups: pickups.filter((pickup) => pickup.active),
    });
  });
  return road;
}
