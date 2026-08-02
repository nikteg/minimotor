import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let n=0; p.on("console", m => m.text()==="CLEARWHEEL" && n++);
await p.goto("http://localhost:5210/render3d/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
console.log("clearWheelClaim calls in ~2.5s:", n);
await b.close();
