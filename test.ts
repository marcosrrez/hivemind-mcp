/**
 * hivemind integration test
 * Simulates two agents joining, messaging, sharing context, and using the task board.
 */
import { createRedisClient } from "./src/redis.ts";
import { Registry } from "./src/registry.ts";
import { Messenger } from "./src/messaging.ts";
import { ContextStore } from "./src/context.ts";
import { TaskBoard } from "./src/tasks.ts";
import { nanoid } from "nanoid";

const redisUrl = process.env.HIVEMIND_REDIS_URL ?? "redis://localhost:6379";
const redisPassword = process.env.HIVEMIND_REDIS_PASSWORD;
const resolvedUrl = redisPassword
  ? redisUrl.replace("redis://", `redis://:${redisPassword}@`)
  : redisUrl;

if (!process.env.HIVEMIND_REDIS_URL && !process.env.HIVEMIND_REDIS_PASSWORD) {
  console.warn("Warning: HIVEMIND_REDIS_URL not set, using redis://localhost:6379");
}

const redis1 = createRedisClient(resolvedUrl);
const redis2 = createRedisClient(resolvedUrl);

const reg1 = new Registry(redis1);
const reg2 = new Registry(redis2);
const msg1 = new Messenger(redis1);
const msg2 = new Messenger(redis2);
const ctx = new ContextStore(redis1);
const board = new TaskBoard(redis1);

function log(label: string, data: unknown) {
  console.log(`\n[${label}]`, JSON.stringify(data, null, 2));
}

async function run() {
  await redis1.connect().catch(() => {});
  await redis2.connect().catch(() => {});

  console.log("=== HIVEMIND INTEGRATION TEST ===\n");

  // --- AGENT REGISTRATION ---
  console.log("1. Two agents join the hive...");
  const idA = nanoid(10);
  const idB = nanoid(10);
  const agentA = await reg1.register(idA, "backend-agent", "Building API", "/home/user/myapp");
  const agentB = await reg2.register(idB, "frontend-agent", "Building UI", "/home/user/myapp");
  log("backend-agent joined", { id: agentA.id, name: agentA.name, role: agentA.role });
  log("frontend-agent joined", { id: agentB.id, name: agentB.name, role: agentB.role });

  const online = await reg1.list();
  log("Active agents in hive", online.map(a => ({ name: a.name, role: a.role })));

  // --- DIRECT MESSAGING ---
  console.log("\n2. backend-agent sends a direct message to frontend-agent...");
  await msg1.send({
    from: idA,
    fromName: "backend-agent",
    to: idB,
    content: "Hey — auth endpoint is live at POST /api/auth/login. JWT response.",
  });

  const inbox = await msg2.inbox(idB);
  log("frontend-agent inbox", inbox.map(m => ({ from: m.fromName, content: m.content })));

  // --- BROADCAST ---
  console.log("\n3. frontend-agent broadcasts to everyone...");
  await msg2.broadcast(
    { from: idB, fromName: "frontend-agent", content: "Starting on the login form. Will use the auth endpoint." },
    [idA]
  );

  const inboxA = await msg1.inbox(idA);
  log("backend-agent inbox", inboxA.map(m => ({ from: m.fromName, content: m.content })));

  // --- SHARED CONTEXT ---
  console.log("\n4. Agents store shared decisions...");
  await ctx.set("decisions", "auth-strategy", "JWT, 7-day expiry, refresh tokens in Redis", idA, "backend-agent");
  await ctx.set("decisions", "api-base-url", "https://api.traumasciencelab.com/v1", idA, "backend-agent");
  await ctx.set("findings", "login-bug", "POST /login returns 500 if email has uppercase — fix pending", idB, "frontend-agent");

  const decisions = await ctx.list("decisions");
  log("Shared decisions (visible to all agents)", decisions.map(e => ({ key: e.key, value: e.value, by: e.setBy })));

  const findings = await ctx.list("findings");
  log("Shared findings", findings.map(e => ({ key: e.key, value: e.value, by: e.setBy })));

  // --- TASK BOARD ---
  console.log("\n5. Task board — add, claim, complete...");
  const t1 = await board.add("Fix login uppercase bug", "POST /login fails with uppercase email", 9, idB, "frontend-agent");
  const t2 = await board.add("Add refresh token endpoint", undefined, 7, idA, "backend-agent");
  const t3 = await board.add("Write API docs", undefined, 3, idA, "backend-agent");

  log("Tasks added", [t1, t2, t3].map(t => ({ title: t.title, priority: t.priority, status: t.status })));

  // Agent A claims highest priority task
  const claimed1 = await board.claim(undefined, idA, "backend-agent");
  log("backend-agent claimed", { title: claimed1?.title, priority: claimed1?.priority });

  // Agent B claims next
  const claimed2 = await board.claim(undefined, idB, "frontend-agent");
  log("frontend-agent claimed", { title: claimed2?.title, priority: claimed2?.priority });

  // Complete
  await board.complete(claimed1!.id, idA, "Fixed in src/auth/login.ts line 42");
  await board.complete(claimed2!.id, idB, "Endpoint live at POST /api/auth/refresh");

  const allTasks = await board.list();
  log("Final task board", allTasks.map(t => ({ title: t.title, status: t.status, result: t.result ?? null })));

  // --- CLEANUP ---
  await reg1.deregister(idA);
  await reg2.deregister(idB);
  const remaining = await reg1.list();
  log("Agents after leaving", remaining);

  // Clean up test keys
  await redis1.del(`hivemind:ctx:decisions:auth-strategy`, `hivemind:ctx:decisions:api-base-url`, `hivemind:ctx_idx:decisions`);
  await redis1.del(`hivemind:ctx:findings:login-bug`, `hivemind:ctx_idx:findings`);

  console.log("\n=== TEST COMPLETE ===");
  await redis1.quit();
  await redis2.quit();
}

run().catch((e) => { console.error(e); process.exit(1); });
