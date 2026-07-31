// ---------- Network diagnostics CLI ----------
import { defineFeature } from "@src/cli/feature.js";
import { numberOption, percentile, takeFlag } from "@src/cli/utils.js";

const help = `Model multiplayer snapshot delivery

Usage:
  mm net doctor [options]

Options:
  --latency <ms>    One-way base latency. Default 20
  --jitter <ms>     Arrival jitter. Default 5
  --loss <percent>  Packet loss percentage. Default 0
  --rate <hz>       Snapshot send rate. Default 30
  --seconds <n>     Simulated duration. Default 10
  --seed <n>        Deterministic random seed. Default 1
  --json            Print machine-readable JSON.
`;

export interface NetDoctorOptions {
  latency: number;
  jitter: number;
  loss: number;
  rate: number;
  seconds: number;
  seed: number;
}

export interface NetDoctorReport {
  sent: number;
  delivered: number;
  lost: number;
  lossPercent: number;
  arrivalGapP50: number;
  arrivalGapP95: number;
  arrivalGapP99: number;
  recommendedBufferMs: number;
}

/** Deterministic snapshot-network model used by `mm net doctor`. */
export function diagnoseNetwork(options: NetDoctorOptions): NetDoctorReport {
  if (options.rate <= 0 || options.seconds <= 0) {
    throw new Error("rate and seconds must be greater than zero");
  }
  if (options.latency < 0 || options.jitter < 0 || options.loss < 0 || options.loss > 100) {
    throw new Error("latency/jitter must be positive and loss must be 0..100");
  }
  let state = options.seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const interval = 1000 / options.rate;
  const sent = Math.ceil(options.seconds * options.rate);
  const arrivals: number[] = [];
  for (let i = 0; i < sent; i++) {
    if (random() * 100 < options.loss) continue;
    const noise = (random() + random() + random() - 1.5) * options.jitter * 2;
    arrivals.push(i * interval + options.latency + noise);
  }
  arrivals.sort((a, b) => a - b);
  const gaps = arrivals.slice(1).map((arrival, index) => arrival - arrivals[index]);
  const p50 = percentile(gaps, 0.5);
  const p95 = percentile(gaps, 0.95);
  const p99 = percentile(gaps, 0.99);
  const delivered = arrivals.length;
  return {
    sent,
    delivered,
    lost: sent - delivered,
    lossPercent: sent ? ((sent - delivered) / sent) * 100 : 0,
    arrivalGapP50: p50,
    arrivalGapP95: p95,
    arrivalGapP99: p99,
    recommendedBufferMs: Math.ceil(Math.max(interval, p95 + Math.max(0, p99 - p50))),
  };
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

export default defineFeature({
  name: "net",
  summary: "Diagnose latency, jitter, loss, and snapshot rates.",
  usage: ["mm net doctor [options]"],
  run(input) {
    if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    if (input[0] !== "doctor")
      throw new Error(`unknown net command "${input.join(" ")}"\n\n${help}`);
    const args = input.slice(1);
    const json = takeFlag(args, "--json");
    const report = diagnoseNetwork({
      latency: numberOption(args, 20, "--latency"),
      jitter: numberOption(args, 5, "--jitter"),
      loss: numberOption(args, 0, "--loss"),
      rate: numberOption(args, 30, "--rate"),
      seconds: numberOption(args, 10, "--seconds"),
      seed: numberOption(args, 1, "--seed"),
    });
    if (args.length) throw new Error(`unknown option "${args[0]}"`);
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Network snapshot report
  packets       ${report.delivered}/${report.sent} delivered (${report.lossPercent.toFixed(1)}% loss)
  arrival gap   p50 ${ms(report.arrivalGapP50)} · p95 ${ms(report.arrivalGapP95)} · p99 ${ms(report.arrivalGapP99)}
  buffer        ${report.recommendedBufferMs} ms suggested adaptive ceiling
`);
  },
});
