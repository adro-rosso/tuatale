// tools/review-station/session.js — MATERIALISE a prod book's review/ artifacts to a
// TRANSIENT temp dir, and guarantee it never outlives the review session.
//
// A prod book leaves only book.pdf locally reachable; its per-page artifacts live in
// Storage under orders/<id>/review/ (retained while awaiting_review). To review page by
// page the station pulls that tree DOWN to a temp dir and works against it as today.
//
// "Transient" is the load-bearing property — these are a child's page illustrations and
// front-facing character portraits landing on the operator's laptop, so they must be
// PROVABLY gone after the session, on every exit path:
//   graceful (SIGINT/SIGTERM/normal exit) → cleanupSession() deletes + VERIFIES gone.
//   ungraceful (SIGKILL, power loss, crash) → no handler runs; the NEXT startup's
//     sweepOrphanSessions() is the backstop.
//
// LIVENESS via a HEARTBEAT, not PID alone. Each live session touches .heartbeat every
// HEARTBEAT_INTERVAL_MS; the sweep treats a session as orphaned when its owning PID is
// gone (definitive, immediate) OR its heartbeat is stale (catches PID reuse, where a
// crashed session's PID gets recycled by an unrelated live process). A live concurrent
// station keeps a fresh heartbeat and is spared.
//
// The temp dir lives under the OS temp dir, NEVER under output/books/ — a materialised
// prod book must not be mistakable for a durable local book, or picked up by
// generate-book.js / anything scanning output/.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const BUCKET = "tuatale-books";
export const SESSIONS_PARENT = path.join(os.tmpdir(), "tuatale-review-sessions");
const HEARTBEAT_FILE = ".heartbeat";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_STALE_MS = 120_000; // 4 missed beats ⇒ dead/hung

const reviewPrefix = (orderId) => `orders/${orderId}/review`;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence probe, sends nothing
    return true;
  } catch (e) {
    return e.code === "EPERM"; // EPERM: exists but not ours; ESRCH: gone
  }
}

/** Recursively enumerate every object path under a storage prefix (list() is not recursive). */
async function listAllUnderPrefix(client, prefix) {
  const LIMIT = 100;
  const out = [];
  const walk = async (p) => {
    for (let offset = 0; ; offset += LIMIT) {
      const { data, error } = await client.storage.from(BUCKET).list(p, { limit: LIMIT, offset });
      if (error) throw new Error(`list("${p}") failed: ${error.message}`);
      const entries = data ?? [];
      for (const o of entries) {
        const full = `${p}/${o.name}`;
        if (o.id === null) await walk(full);
        else out.push(full);
      }
      if (entries.length < LIMIT) break;
    }
  };
  await walk(prefix);
  return out;
}

/**
 * STARTUP SWEEP — remove temp dirs left by any previously-crashed session BEFORE the
 * station does anything else. This is what makes "transient" true even when a process is
 * SIGKILLed. Verifies each removal via existsSync (not the rm's own success).
 * Returns { swept, kept } for logging.
 */
export async function sweepOrphanSessions() {
  if (!fs.existsSync(SESSIONS_PARENT)) return { swept: [], kept: [] };
  const swept = [];
  const kept = [];
  for (const name of await fsp.readdir(SESSIONS_PARENT)) {
    const dir = path.join(SESSIONS_PARENT, name);
    let stat;
    try {
      stat = await fsp.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const m = /^session-pid(\d+)-/.exec(name);
    const pid = m ? Number(m[1]) : NaN;
    let heartbeatAge = Infinity;
    try {
      heartbeatAge = Date.now() - (await fsp.stat(path.join(dir, HEARTBEAT_FILE))).mtimeMs;
    } catch {
      heartbeatAge = Infinity; // no heartbeat ⇒ treat as stale
    }
    const orphan = !isProcessAlive(pid) || heartbeatAge > HEARTBEAT_STALE_MS;
    if (!orphan) {
      kept.push(name);
      continue;
    }
    await fsp.rm(dir, { recursive: true, force: true });
    if (fs.existsSync(dir)) throw new Error(`orphan sweep failed to remove ${dir}`);
    swept.push(name);
  }
  return { swept, kept };
}

/**
 * MATERIALISE — download orders/<orderId>/review/ into a fresh temp session dir and return
 * { dir, count }. Throws if there is nothing to materialise (the order was never retained,
 * or already shipped/reaped) rather than opening an empty station.
 */
export async function materializeOrder(orderId, client) {
  await fsp.mkdir(SESSIONS_PARENT, { recursive: true });
  const dir = path.join(SESSIONS_PARENT, `session-pid${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  await fsp.mkdir(dir, { recursive: true });

  const prefix = reviewPrefix(orderId);
  const remotes = await listAllUnderPrefix(client, prefix);
  if (remotes.length === 0) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw new Error(`no review artifacts for order ${orderId} — nothing under ${prefix}/ (shipped, reaped, or never retained)`);
  }
  for (const remote of remotes) {
    const rel = remote.slice(prefix.length + 1);
    const local = path.join(dir, rel);
    await fsp.mkdir(path.dirname(local), { recursive: true });
    const { data, error } = await client.storage.from(BUCKET).download(remote);
    if (error) throw new Error(`download ${remote}: ${error.message}`);
    await fsp.writeFile(local, Buffer.from(await data.arrayBuffer()));
  }
  return { dir, count: remotes.length };
}

/**
 * Begin the heartbeat for a materialised session. Returns a handle whose .stop() clears the
 * timer. The interval is unref'd so it never keeps the process alive on its own.
 */
export function startHeartbeat(dir) {
  const beat = () => {
    try {
      fs.writeFileSync(path.join(dir, HEARTBEAT_FILE), String(Date.now()));
    } catch {
      /* a transient touch failure is harmless — the next beat retries */
    }
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Delete a session's temp dir and VERIFY it is gone (existsSync, not the rm's own success).
 * Idempotent — a second call after the dir is gone is a no-op. Throws if the dir survives.
 */
export async function cleanupSession(dir) {
  if (!dir || !fs.existsSync(dir)) return { removed: false };
  await fsp.rm(dir, { recursive: true, force: true });
  if (fs.existsSync(dir)) throw new Error(`session cleanup failed to remove ${dir}`);
  return { removed: true };
}

/** Synchronous best-effort cleanup for the process 'exit' event (no async allowed there). */
export function cleanupSessionSync(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* last-ditch; the startup sweep is the real backstop */
  }
}
