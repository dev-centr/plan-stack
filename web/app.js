const API = "";

function fmtWait(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function cellHeight(ms) {
  const min = 36;
  const max = 220;
  const scale = 0.00035;
  return Math.round(Math.min(max, Math.max(min, min + ms * scale)));
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function renderPhase(ph, { animateInsert = false } = {}) {
  const el = document.createElement("article");
  el.className = "phase" + (animateInsert ? " is-insert" : "");
  el.dataset.status = ph.status;
  el.dataset.phaseId = ph.id;
  el.style.minHeight = `${cellHeight(ph.estimatedWaitMs)}px`;
  el.innerHTML = `
    ${ph.status === "recalculating" ? '<span class="spinner" aria-hidden="true"></span>' : ""}
    <div class="title"></div>
    <div class="meta"></div>
  `;
  el.querySelector(".title").textContent = ph.title;
  el.querySelector(".meta").textContent = `${ph.status} · ETA ${fmtWait(ph.estimatedWaitMs)}`;
  return el;
}

const knownPhaseIds = new Set();

function renderOverview(data) {
  const root = document.getElementById("windows");
  root.innerHTML = "";
  const windows = data.windows || [];
  if (!windows.length) {
    root.innerHTML = `<p class="empty">No plans yet. Click <strong>Seed demo</strong> or <code>plan-stack seed</code>.</p>`;
    return;
  }

  const nextIds = new Set();
  for (const win of windows) {
    const winEl = document.createElement("section");
    winEl.className = "window";
    winEl.innerHTML = `
      <div class="window-chrome">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <strong></strong>
        <span class="sub-meta"></span>
      </div>
      <div class="columns"></div>
    `;
    winEl.querySelector("strong").textContent = win.label || win.harnessId;
    winEl.querySelector(".sub-meta").textContent = `${(win.sessions || []).length} sessions`;

    const cols = winEl.querySelector(".columns");
    for (const sess of win.sessions || []) {
      const col = document.createElement("div");
      col.className = "column";
      col.innerHTML = `<div class="column-head">Session<strong></strong></div><div class="stack"></div>`;
      col.querySelector("strong").textContent = sess.title || sess.sessionId;
      const stack = col.querySelector(".stack");
      for (const ph of sess.phases || []) {
        nextIds.add(ph.id);
        const isNew = knownPhaseIds.size > 0 && !knownPhaseIds.has(ph.id);
        stack.appendChild(renderPhase(ph, { animateInsert: isNew }));
      }
      cols.appendChild(col);
    }
    root.appendChild(winEl);
  }
  knownPhaseIds.clear();
  for (const id of nextIds) knownPhaseIds.add(id);
}

async function refresh() {
  const conn = document.getElementById("conn");
  const hub = document.getElementById("hub");
  const strip = document.getElementById("status-strip");
  try {
    const [status, overview] = await Promise.all([
      api("GET", "/status"),
      api("GET", "/overview"),
    ]);
    conn.textContent = `ok · :${status.ipcPort || "17358"}`;
    conn.className = "pill ok";
    hub.textContent = status.waitHubOk ? "wait-hub up" : "wait-hub offline";
    hub.className = "pill " + (status.waitHubOk ? "ok" : "muted");
    renderOverview(overview);
    strip.textContent = `${status.planCount || 0} plans · ${status.phaseTotal || 0} phases · polled ${status.lastPollAt || "—"}`;
  } catch (err) {
    conn.textContent = "offline";
    conn.className = "pill bad";
    strip.textContent = String(err.message || err);
  }
}

document.getElementById("btn-seed").addEventListener("click", async () => {
  // Seed via CLI-equivalent payloads
  const payloads = [
    {
      harnessId: "devcentr-harness",
      harnessLabel: "DevCentr harness",
      sessionId: "coord-main",
      title: "Coordinator session",
      client: "ui-seed",
      phases: [
        { id: "ph_plan", title: "Draft speculative plan", status: "done", estimatedWaitMs: 30000 },
        { id: "ph_push", title: "Push branch", status: "done", estimatedWaitMs: 15000 },
        { id: "ph_ci", title: "Wait CI (GitHub Actions)", status: "waiting", estimatedWaitMs: 480000, dependsOn: ["ph_push"] },
        { id: "ph_docs", title: "Update changelog (queued)", status: "pending", estimatedWaitMs: 90000, dependsOn: ["ph_ci"] },
      ],
    },
    {
      harnessId: "devcentr-harness",
      harnessLabel: "DevCentr harness",
      sessionId: "task-web",
      title: "Worker: web panel",
      client: "ui-seed",
      phases: [
        { title: "Implement dock panel", status: "active", estimatedWaitMs: 120000 },
        { title: "Wire overview poll", status: "pending", estimatedWaitMs: 60000 },
      ],
    },
    {
      harnessId: "cursor-cloud",
      harnessLabel: "Cursor cloud",
      sessionId: "cloud-1",
      title: "Cloud agent",
      client: "ui-seed",
      phases: [
        { title: "Open PR", status: "done", estimatedWaitMs: 45000 },
        { title: "Pages deploy probe", status: "waiting", estimatedWaitMs: 300000 },
        { title: "Notify harness", status: "pending", estimatedWaitMs: 20000 },
      ],
    },
  ];
  for (const p of payloads) await api("POST", "/plans", p);
  await refresh();
});

document.getElementById("btn-recalc").addEventListener("click", async () => {
  const overview = await api("GET", "/overview");
  const first = overview.windows?.[0]?.sessions?.[0];
  if (!first) return;
  const waiting = (first.phases || []).find((p) => p.status === "waiting" || p.status === "pending");
  if (!waiting) return;
  await api("POST", `/plans/${encodeURIComponent(first.planId)}/recalculate`, {
    phaseIds: [waiting.id],
  });
  await api("POST", `/plans/${encodeURIComponent(first.planId)}/phases/${encodeURIComponent(waiting.id)}/replace`, {
    phases: [
      { title: "Re-check CI flake", status: "waiting", estimatedWaitMs: 180000 },
      { title: "Retry publish", status: "pending", estimatedWaitMs: 60000 },
    ],
  });
  await refresh();
});

refresh();
setInterval(refresh, 2500);
