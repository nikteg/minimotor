import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const logs=[]; p.on("console", m => m.text().startsWith("WHEELDBG") && logs.push(m.text()));
await p.goto("http://localhost:5210/render3d/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.mouse.move(280, 430);
await p.waitForTimeout(300);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(80); }
await p.waitForTimeout(300);
console.log(logs.join("\n"));
await b.close();
