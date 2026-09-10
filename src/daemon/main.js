import process from "node:process";
import { defaultCodeRoot, defaultConfigPath, loadConfig, saveDefaultConfig } from "../config.js";
import { createStore } from "../store.js";
import { serveIpc } from "../ipc.js";
import { syncWaitHubPhases, health as waitHubHealth } from "../wait-hub-client.js";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const args = {
    serve: false,
    writeConfig: false,
    ui: true,
    codeRoot: defaultCodeRoot(),
    configPath: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--serve") args.serve = true;
    else if (a === "--write-config") args.writeConfig = true;
    else if (a === "--ui") args.ui = true;
    else if (a === "--no-ui") args.ui = false;
    else if (a === "--code-root") args.codeRoot = argv[++i];
    else if (a === "--config") args.configPath = argv[++i];
    else if (a === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else if (a === "--help" || a === "-h") {
      console.log(`plan-stackd ${VERSION} — speculative plan queue daemon

Usage:
  plan-stackd --serve [--code-root PATH] [--config PATH] [--no-ui]
  plan-stackd --write-config [--code-root PATH]

IPC: 127.0.0.1:<ipc_port> (default 17358)
Consumes wait-hub (17357) when phases bind waitHubId — does not replace it.
`);
      process.exit(0);
    }
  }
  if (!args.configPath) args.configPath = defaultConfigPath(args.codeRoot);
  if (!args.serve && !args.writeConfig) args.serve = true;
  return args;
}

function createState(config, store) {
  return {
    version: VERSION,
    config,
    store,
    startedAt: new Date().toISOString(),
    lastPollAt: null,
    lastError: "",
    waitHubOk: false,
    snapshot() {
      const summary = store.writeStatusSummary();
      return {
        service: "plan-stackd",
        version: VERSION,
        startedAt: this.startedAt,
        lastPollAt: this.lastPollAt,
        error: this.lastError,
        waitHubOk: this.waitHubOk,
        waitHubUrl: config.wait_hub_url,
        codeRoot: config.code_root,
        statusPath: config.status_path,
        eventsPath: config.events_path,
        ipcPort: config.ipc_port,
        ...summary,
      };
    },
  };
}

async function poll(state) {
  state.lastPollAt = new Date().toISOString();
  try {
    const hub = await waitHubHealth(state.config.wait_hub_url);
    state.waitHubOk = Boolean(hub?.ok);
    if (state.waitHubOk) {
      await syncWaitHubPhases(state.store, state.config.wait_hub_url);
    }
    state.store.writeStatusSummary();
  } catch (err) {
    state.lastError = String(err.message || err);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.writeConfig) {
    const cfg = saveDefaultConfig(args.configPath, args.codeRoot);
    console.log(`Wrote ${args.configPath}`);
    console.log(JSON.stringify({ ipc_port: cfg.ipc_port, plans_dir: cfg.plans_dir }, null, 2));
    return;
  }

  const config = loadConfig(args.configPath, args.codeRoot);
  const store = createStore(config);
  const state = createState(config, store);

  const handlers = {
    list: () => store.list(),
    get: (id) => store.get(id),
    overview: () => store.overview(),
    upsertPlan: (body) => store.upsertPlan(body),
    insertPhases: (id, body) => store.insertPhases(id, body),
    replacePhase: (id, phaseId, body) => store.replacePhase(id, phaseId, body),
    patchPhase: (id, phaseId, body) => store.patchPhase(id, phaseId, body),
    completePhase: (id, phaseId, body) => store.completePhase(id, phaseId, body),
    markRecalculating: (id, phaseIds) => store.markRecalculating(id, phaseIds),
    removePlan: (id) => store.removePlan(id),
  };

  await serveIpc(config.ipc_port, state, handlers, { serveUi: args.ui });
  console.log(
    `plan-stackd ${VERSION} listening on http://127.0.0.1:${config.ipc_port}` +
      (args.ui ? " (UI /)" : "")
  );
  store.writeStatusSummary();

  const tick = () => {
    poll(state).catch(() => {});
  };
  tick();
  setInterval(tick, config.poll_interval_ms);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
