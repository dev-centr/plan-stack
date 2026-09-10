/**
 * Optional wait-hub bridge — plan-stack owns plans; wait-hub owns atomic waits.
 */

export async function fetchWait(waitHubUrl, waitId) {
  const url = `${waitHubUrl.replace(/\/$/, "")}/waits/${encodeURIComponent(waitId)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`wait-hub ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function health(waitHubUrl) {
  try {
    const res = await fetch(`${waitHubUrl.replace(/\/$/, "")}/health`);
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

/**
 * Poll phases that have waitHubId; map wait-hub status onto phase status.
 */
export async function syncWaitHubPhases(store, waitHubUrl) {
  const plans = store.list();
  let changed = 0;
  for (const plan of plans) {
    for (const ph of plan.phases || []) {
      if (!ph.waitHubId) continue;
      if (["done", "failed", "invalidated"].includes(ph.status)) continue;
      try {
        const wait = await fetchWait(waitHubUrl, ph.waitHubId);
        if (!wait) continue;
        if (!TERMINAL.has(wait.status)) {
          if (ph.status !== "waiting" && ph.status !== "recalculating") {
            store.patchPhase(plan.id, ph.id, { status: "waiting" });
            changed += 1;
          }
          continue;
        }
        if (wait.status === "succeeded") {
          store.completePhase(plan.id, ph.id, { status: "done" });
          changed += 1;
        } else {
          store.completePhase(plan.id, ph.id, { status: "failed", failDependents: true });
          changed += 1;
        }
      } catch {
        // wait-hub optional — leave phase as-is
      }
    }
  }
  return changed;
}
