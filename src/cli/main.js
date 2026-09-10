import process from "node:process";
import { defaultCodeRoot, defaultConfigPath, loadConfig } from "../config.js";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const args = { cmd: "", rest: [], codeRoot: defaultCodeRoot(), configPath: "", base: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--code-root") args.codeRoot = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--base") args.base = argv[++i];
    else if (a === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!args.cmd) args.cmd = a;
    else args.rest.push(a);
  }
  if (!args.configPath) args.configPath = defaultConfigPath(args.codeRoot);
  return args;
}

function printHelp() {
  console.log(`plan-stack ${VERSION} — CLI for the plan-stack daemon

Commands:
  health
  status
  overview
  list
  get <planId>
  upsert --harness ID --session ID [--title T] [--json FILE|-]
  insert <planId> --after PHASE|--before PHASE --json FILE|-
  replace <planId> <phaseId> --json FILE|-
  patch <planId> <phaseId> --json FILE|-
  complete <planId> <phaseId> [--failed]
  recalc <planId> [phaseId...]
  seed   demo plans for empty machine
  remove <planId>
`);
}

async function readJsonArg(rest) {
  const idx = rest.indexOf("--json");
  if (idx < 0) return {};
  const src = rest[idx + 1];
  if (!src || src === "-") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }
  const fs = await import("node:fs");
  return JSON.parse(fs.readFileSync(src, "utf8"));
}

function flagValue(rest, name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function seedPayloads() {
  return [
    {
      harnessId: "devcentr-harness",
      harnessLabel: "DevCentr harness",
      sessionId: "coord-main",
      title: "Coordinator session",
      client: "seed",
      phases: [
        { id: "ph_plan", title: "Draft speculative plan", status: "done", estimatedWaitMs: 30_000 },
        { id: "ph_push", title: "Push branch", status: "done", estimatedWaitMs: 15_000 },
        {
          id: "ph_ci",
          title: "Wait CI (GitHub Actions)",
          status: "waiting",
          estimatedWaitMs: 480_000,
          dependsOn: ["ph_push"],
        },
        {
          id: "ph_docs",
          title: "Update changelog (queued)",
          status: "pending",
          estimatedWaitMs: 90_000,
          dependsOn: ["ph_ci"],
        },
      ],
    },
    {
      harnessId: "devcentr-harness",
      harnessLabel: "DevCentr harness",
      sessionId: "task-web",
      title: "Worker: web panel",
      client: "seed",
      phases: [
        { title: "Implement dock panel", status: "active", estimatedWaitMs: 120_000 },
        { title: "Wire overview poll", status: "pending", estimatedWaitMs: 60_000 },
      ],
    },
    {
      harnessId: "cursor-cloud",
      harnessLabel: "Cursor cloud",
      sessionId: "cloud-1",
      title: "Cloud agent",
      client: "seed",
      phases: [
        { title: "Open PR", status: "done", estimatedWaitMs: 45_000 },
        { title: "Pages deploy probe", status: "waiting", estimatedWaitMs: 300_000 },
        { title: "Notify harness", status: "pending", estimatedWaitMs: 20_000 },
      ],
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.cmd) {
    printHelp();
    process.exit(1);
  }

  const config = loadConfig(args.configPath, args.codeRoot);
  const base = args.base || `http://127.0.0.1:${config.ipc_port}`;

  if (args.cmd === "health") {
    console.log(JSON.stringify(await api(base, "GET", "/health"), null, 2));
    return;
  }
  if (args.cmd === "status") {
    console.log(JSON.stringify(await api(base, "GET", "/status"), null, 2));
    return;
  }
  if (args.cmd === "overview") {
    console.log(JSON.stringify(await api(base, "GET", "/overview"), null, 2));
    return;
  }
  if (args.cmd === "list") {
    console.log(JSON.stringify(await api(base, "GET", "/plans"), null, 2));
    return;
  }
  if (args.cmd === "get") {
    const id = args.rest[0];
    if (!id) throw new Error("planId required");
    console.log(JSON.stringify(await api(base, "GET", `/plans/${encodeURIComponent(id)}`), null, 2));
    return;
  }
  if (args.cmd === "upsert") {
    const body = await readJsonArg(args.rest);
    body.harnessId = flagValue(args.rest, "--harness") || body.harnessId;
    body.sessionId = flagValue(args.rest, "--session") || body.sessionId;
    body.title = flagValue(args.rest, "--title") || body.title;
    body.client = flagValue(args.rest, "--client") || body.client || "cli";
    console.log(JSON.stringify(await api(base, "POST", "/plans", body), null, 2));
    return;
  }
  if (args.cmd === "insert") {
    const planId = args.rest[0];
    const body = await readJsonArg(args.rest);
    body.afterPhaseId = flagValue(args.rest, "--after") || body.afterPhaseId;
    body.beforePhaseId = flagValue(args.rest, "--before") || body.beforePhaseId;
    console.log(
      JSON.stringify(
        await api(base, "POST", `/plans/${encodeURIComponent(planId)}/phases/insert`, body),
        null,
        2
      )
    );
    return;
  }
  if (args.cmd === "replace") {
    const [planId, phaseId] = args.rest;
    const body = await readJsonArg(args.rest);
    console.log(
      JSON.stringify(
        await api(
          base,
          "POST",
          `/plans/${encodeURIComponent(planId)}/phases/${encodeURIComponent(phaseId)}/replace`,
          body
        ),
        null,
        2
      )
    );
    return;
  }
  if (args.cmd === "patch") {
    const [planId, phaseId] = args.rest;
    const body = await readJsonArg(args.rest);
    console.log(
      JSON.stringify(
        await api(
          base,
          "PATCH",
          `/plans/${encodeURIComponent(planId)}/phases/${encodeURIComponent(phaseId)}`,
          body
        ),
        null,
        2
      )
    );
    return;
  }
  if (args.cmd === "complete") {
    const [planId, phaseId] = args.rest;
    const failed = args.rest.includes("--failed");
    console.log(
      JSON.stringify(
        await api(
          base,
          "POST",
          `/plans/${encodeURIComponent(planId)}/phases/${encodeURIComponent(phaseId)}/complete`,
          { status: failed ? "failed" : "done", failDependents: failed }
        ),
        null,
        2
      )
    );
    return;
  }
  if (args.cmd === "recalc") {
    const [planId, ...phaseIds] = args.rest;
    console.log(
      JSON.stringify(
        await api(base, "POST", `/plans/${encodeURIComponent(planId)}/recalculate`, { phaseIds }),
        null,
        2
      )
    );
    return;
  }
  if (args.cmd === "remove") {
    const id = args.rest[0];
    console.log(JSON.stringify(await api(base, "DELETE", `/plans/${encodeURIComponent(id)}`), null, 2));
    return;
  }
  if (args.cmd === "seed") {
    const results = [];
    for (const payload of seedPayloads()) {
      results.push(await api(base, "POST", "/plans", payload));
    }
    console.log(JSON.stringify({ seeded: results.length, plans: results }, null, 2));
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.data || err.message || err);
  process.exit(1);
});
