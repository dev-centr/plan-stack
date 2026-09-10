import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..", "web");

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  };
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", types[ext] || "application/octet-stream");
  res.end(fs.readFileSync(filePath));
}

/**
 * Local HTTP IPC:
 * GET  /health
 * GET  /status
 * GET  /overview          harness windows → session columns
 * GET  /plans
 * GET  /plans/:id
 * POST /plans             upsert_plan
 * DELETE /plans/:id
 * POST /plans/:id/phases/insert
 * POST /plans/:id/phases/:phaseId/replace
 * PATCH /plans/:id/phases/:phaseId
 * POST /plans/:id/phases/:phaseId/complete
 * POST /plans/:id/recalculate
 * GET  /  and /web/*      standalone UI (when enabled)
 */
export function createIpcServer(state, handlers, { serveUi = true } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.end();
        return;
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/health") {
        send(res, 200, { ok: true, service: "plan-stackd", version: state.version });
        return;
      }

      if (req.method === "GET" && pathname === "/status") {
        send(res, 200, state.snapshot());
        return;
      }

      if (req.method === "GET" && pathname === "/overview") {
        send(res, 200, handlers.overview());
        return;
      }

      if (req.method === "GET" && pathname === "/plans") {
        send(res, 200, { plans: handlers.list() });
        return;
      }

      if (req.method === "POST" && pathname === "/plans") {
        const body = await readJson(req);
        const plan = handlers.upsertPlan(body);
        send(res, 201, plan);
        return;
      }

      const planMatch = pathname.match(/^\/plans\/([^/]+)$/);
      if (planMatch) {
        const planId = decodeURIComponent(planMatch[1]);
        if (req.method === "GET") {
          const plan = handlers.get(planId);
          if (!plan) {
            send(res, 404, { error: "not found" });
            return;
          }
          send(res, 200, plan);
          return;
        }
        if (req.method === "DELETE") {
          const ok = handlers.removePlan(planId);
          send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" });
          return;
        }
      }

      const insertMatch = pathname.match(/^\/plans\/([^/]+)\/phases\/insert$/);
      if (req.method === "POST" && insertMatch) {
        const body = await readJson(req);
        const plan = handlers.insertPhases(decodeURIComponent(insertMatch[1]), body);
        send(res, 200, plan);
        return;
      }

      const replaceMatch = pathname.match(/^\/plans\/([^/]+)\/phases\/([^/]+)\/replace$/);
      if (req.method === "POST" && replaceMatch) {
        const body = await readJson(req);
        const plan = handlers.replacePhase(
          decodeURIComponent(replaceMatch[1]),
          decodeURIComponent(replaceMatch[2]),
          body
        );
        send(res, 200, plan);
        return;
      }

      const completeMatch = pathname.match(/^\/plans\/([^/]+)\/phases\/([^/]+)\/complete$/);
      if (req.method === "POST" && completeMatch) {
        const body = await readJson(req);
        const plan = handlers.completePhase(
          decodeURIComponent(completeMatch[1]),
          decodeURIComponent(completeMatch[2]),
          body
        );
        send(res, 200, plan);
        return;
      }

      const patchMatch = pathname.match(/^\/plans\/([^/]+)\/phases\/([^/]+)$/);
      if (req.method === "PATCH" && patchMatch) {
        const body = await readJson(req);
        const plan = handlers.patchPhase(
          decodeURIComponent(patchMatch[1]),
          decodeURIComponent(patchMatch[2]),
          body
        );
        send(res, 200, plan);
        return;
      }

      const recalcMatch = pathname.match(/^\/plans\/([^/]+)\/recalculate$/);
      if (req.method === "POST" && recalcMatch) {
        const body = await readJson(req);
        const plan = handlers.markRecalculating(
          decodeURIComponent(recalcMatch[1]),
          body.phaseIds || body.phase_ids || []
        );
        send(res, 200, plan);
        return;
      }

      if (serveUi && req.method === "GET") {
        if (pathname === "/" || pathname === "/index.html") {
          sendFile(res, path.join(WEB_ROOT, "index.html"));
          return;
        }
        if (pathname.startsWith("/static/")) {
          sendFile(res, path.join(WEB_ROOT, pathname.slice("/static/".length)));
          return;
        }
        // Allow /app.js /styles.css at root for convenience
        const candidate = path.join(WEB_ROOT, pathname.replace(/^\//, ""));
        if (candidate.startsWith(WEB_ROOT) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          sendFile(res, candidate);
          return;
        }
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: String(err.message || err) });
    }
  });
}

export function serveIpc(port, state, handlers, opts) {
  const server = createIpcServer(state, handlers, opts);
  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}
