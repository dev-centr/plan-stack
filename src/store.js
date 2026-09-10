import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const PHASE_STATUSES = new Set([
  "pending",
  "active",
  "waiting",
  "done",
  "failed",
  "invalidated",
  "recalculating",
]);

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePhase(input = {}, fallbackClient = "unknown") {
  const estimatedWaitMs = Math.max(0, Number(input.estimatedWaitMs ?? input.estimated_wait_ms ?? 0));
  return {
    id: input.id || newId("ph"),
    title: String(input.title || "Untitled phase"),
    status: PHASE_STATUSES.has(input.status) ? input.status : "pending",
    estimatedWaitMs,
    waitHubId: input.waitHubId ?? input.wait_hub_id ?? null,
    dependsOn: Array.isArray(input.dependsOn)
      ? input.dependsOn.map(String)
      : Array.isArray(input.depends_on)
        ? input.depends_on.map(String)
        : [],
    client: String(input.client || fallbackClient),
    createdAt: input.createdAt || input.created_at || nowIso(),
    updatedAt: input.updatedAt || input.updated_at || nowIso(),
  };
}

export function createStore(config) {
  fs.mkdirSync(config.plans_dir, { recursive: true });

  function planPath(planId) {
    return path.join(config.plans_dir, `${planId}.json`);
  }

  function appendEvent(event) {
    const line = `${JSON.stringify({ ...event, at: event.at || nowIso() })}\n`;
    fs.appendFileSync(config.events_path, line, "utf8");
  }

  function list() {
    if (!fs.existsSync(config.plans_dir)) return [];
    return fs
      .readdirSync(config.plans_dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(config.plans_dir, f), "utf8")))
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  }

  function get(planId) {
    const p = planPath(planId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  function writeStatusSummary(plans = list()) {
    const phaseCounts = {};
    let phaseTotal = 0;
    for (const plan of plans) {
      for (const ph of plan.phases || []) {
        phaseTotal += 1;
        phaseCounts[ph.status] = (phaseCounts[ph.status] || 0) + 1;
      }
    }
    const payload = {
      updatedAt: nowIso(),
      codeRoot: config.code_root,
      planCount: plans.length,
      phaseTotal,
      phaseCounts,
      windows: overview(plans).windows,
    };
    fs.writeFileSync(config.status_path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  function save(plan) {
    plan.updatedAt = nowIso();
    fs.writeFileSync(planPath(plan.id), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    writeStatusSummary();
    return plan;
  }

  /** Group plans into harness windows → session columns for the UI. */
  function overview(plans = list()) {
    const byHarness = new Map();
    for (const plan of plans) {
      const harnessId = plan.harnessId || "default";
      if (!byHarness.has(harnessId)) {
        byHarness.set(harnessId, {
          harnessId,
          label: plan.harnessLabel || harnessId,
          sessions: [],
        });
      }
      const win = byHarness.get(harnessId);
      win.sessions.push({
        planId: plan.id,
        sessionId: plan.sessionId,
        title: plan.title,
        client: plan.client,
        phases: plan.phases,
        updatedAt: plan.updatedAt,
      });
    }
    for (const win of byHarness.values()) {
      win.sessions.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));
    }
    return {
      windows: [...byHarness.values()].sort((a, b) =>
        String(a.harnessId).localeCompare(String(b.harnessId))
      ),
    };
  }

  function upsertPlan(body = {}) {
    const client = String(body.client || "unknown");
    const harnessId = String(body.harnessId || body.harness_id || "default");
    const sessionId = String(body.sessionId || body.session_id || newId("sess"));
    const existingId = body.id || body.planId || body.plan_id;
    let plan = existingId ? get(existingId) : null;

    if (!plan) {
      const match = list().find(
        (p) => p.harnessId === harnessId && p.sessionId === sessionId && !existingId
      );
      plan = match || null;
    }

    if (!plan) {
      plan = {
        id: existingId || newId("plan"),
        title: String(body.title || `Session ${sessionId}`),
        harnessId,
        harnessLabel: String(body.harnessLabel || body.harness_label || harnessId),
        sessionId,
        client,
        phases: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    } else {
      if (body.title) plan.title = String(body.title);
      if (body.harnessLabel || body.harness_label) {
        plan.harnessLabel = String(body.harnessLabel || body.harness_label);
      }
      plan.client = client || plan.client;
    }

    if (Array.isArray(body.phases)) {
      plan.phases = body.phases.map((ph) => normalizePhase(ph, client));
    }

    save(plan);
    appendEvent({
      type: "upsert_plan",
      planId: plan.id,
      harnessId: plan.harnessId,
      sessionId: plan.sessionId,
    });
    return plan;
  }

  function findPhase(plan, phaseId) {
    return plan.phases.findIndex((p) => p.id === phaseId);
  }

  function insertPhases(planId, { afterPhaseId = null, beforePhaseId = null, phases = [], client } = {}) {
    const plan = get(planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const incoming = phases.map((ph) => normalizePhase(ph, client || plan.client));
    if (!incoming.length) throw new Error("phases required");

    let index = plan.phases.length;
    if (beforePhaseId) {
      const i = findPhase(plan, beforePhaseId);
      if (i < 0) throw new Error(`unknown beforePhaseId: ${beforePhaseId}`);
      index = i;
    } else if (afterPhaseId) {
      const i = findPhase(plan, afterPhaseId);
      if (i < 0) throw new Error(`unknown afterPhaseId: ${afterPhaseId}`);
      index = i + 1;
    }

    plan.phases.splice(index, 0, ...incoming);
    save(plan);
    appendEvent({
      type: "insert_phases",
      planId,
      afterPhaseId,
      beforePhaseId,
      phaseIds: incoming.map((p) => p.id),
    });
    return plan;
  }

  function replacePhase(planId, phaseId, { phases = [], client } = {}) {
    const plan = get(planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const i = findPhase(plan, phaseId);
    if (i < 0) throw new Error(`unknown phase: ${phaseId}`);

    plan.phases[i].status = "invalidated";
    plan.phases[i].updatedAt = nowIso();

    const incoming = phases.map((ph) => normalizePhase(ph, client || plan.client));
    if (!incoming.length) {
      save(plan);
      appendEvent({ type: "invalidate_phase", planId, phaseId });
      return plan;
    }

    plan.phases.splice(i + 1, 0, ...incoming);
    // Mark dependents recalculating
    for (const ph of plan.phases) {
      if (ph.dependsOn?.includes(phaseId) && ph.status !== "done" && ph.status !== "failed") {
        ph.status = "recalculating";
        ph.updatedAt = nowIso();
      }
    }

    save(plan);
    appendEvent({
      type: "replace_phase",
      planId,
      phaseId,
      inserted: incoming.map((p) => p.id),
    });
    return plan;
  }

  function patchPhase(planId, phaseId, patch = {}) {
    const plan = get(planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const i = findPhase(plan, phaseId);
    if (i < 0) throw new Error(`unknown phase: ${phaseId}`);
    const ph = plan.phases[i];

    if (patch.title != null) ph.title = String(patch.title);
    if (patch.status != null) {
      if (!PHASE_STATUSES.has(patch.status)) throw new Error(`bad status: ${patch.status}`);
      ph.status = patch.status;
    }
    if (patch.estimatedWaitMs != null || patch.estimated_wait_ms != null) {
      ph.estimatedWaitMs = Math.max(
        0,
        Number(patch.estimatedWaitMs ?? patch.estimated_wait_ms)
      );
    }
    if (patch.waitHubId !== undefined || patch.wait_hub_id !== undefined) {
      ph.waitHubId = patch.waitHubId ?? patch.wait_hub_id;
    }
    if (Array.isArray(patch.dependsOn) || Array.isArray(patch.depends_on)) {
      ph.dependsOn = (patch.dependsOn || patch.depends_on).map(String);
    }
    ph.updatedAt = nowIso();
    save(plan);
    appendEvent({ type: "patch_phase", planId, phaseId, patch });
    return plan;
  }

  function completePhase(planId, phaseId, { status = "done", failDependents = false } = {}) {
    const plan = get(planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const i = findPhase(plan, phaseId);
    if (i < 0) throw new Error(`unknown phase: ${phaseId}`);
    if (!["done", "failed"].includes(status)) throw new Error("status must be done|failed");

    plan.phases[i].status = status;
    plan.phases[i].updatedAt = nowIso();

    for (const ph of plan.phases) {
      if (!ph.dependsOn?.includes(phaseId)) continue;
      if (status === "failed" && failDependents) {
        ph.status = "recalculating";
        ph.updatedAt = nowIso();
      } else if (ph.status === "recalculating" || ph.status === "waiting") {
        // Clear recalc when dependency succeeds
        if (status === "done" && ph.status === "recalculating") {
          ph.status = "pending";
          ph.updatedAt = nowIso();
        }
      }
    }

    save(plan);
    appendEvent({ type: "complete_phase", planId, phaseId, status });
    return plan;
  }

  function markRecalculating(planId, phaseIds = []) {
    const plan = get(planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const set = new Set(phaseIds.map(String));
    for (const ph of plan.phases) {
      if (set.has(ph.id) || phaseIds.length === 0) {
        if (ph.status !== "done" && ph.status !== "failed" && ph.status !== "invalidated") {
          ph.status = "recalculating";
          ph.updatedAt = nowIso();
        }
      }
    }
    save(plan);
    appendEvent({ type: "mark_recalculating", planId, phaseIds });
    return plan;
  }

  function removePlan(planId) {
    const p = planPath(planId);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    writeStatusSummary();
    appendEvent({ type: "remove_plan", planId });
    return true;
  }

  return {
    list,
    get,
    overview,
    upsertPlan,
    insertPhases,
    replacePhase,
    patchPhase,
    completePhase,
    markRecalculating,
    removePlan,
    appendEvent,
    writeStatusSummary: () => writeStatusSummary(list()),
  };
}
