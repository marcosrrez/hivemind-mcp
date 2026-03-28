#!/usr/bin/env tsx
/**
 * hivemind CLI — human interface to the hive
 * Usage:
 *   hivemind agents              List active agents
 *   hivemind broadcast <msg>     Broadcast to all agents
 *   hivemind send <name> <msg>   Send direct message
 *   hivemind remember <ns> <k> <v>  Store context
 *   hivemind recall <ns> <k>    Read context
 *   hivemind knowledge [ns]     Browse context
 *   hivemind tasks [status]     List tasks
 *   hivemind task-add <title>   Add a task
 */

import { createRedisClient, KEYS, MESSAGE_TTL } from "../src/redis.js";
import { Registry } from "../src/registry.js";
import { Messenger } from "../src/messaging.js";
import { ContextStore } from "../src/context.js";
import { TaskBoard } from "../src/tasks.js";
import { nanoid } from "nanoid";

const REDIS_URL = process.env.HIVEMIND_REDIS_URL ?? "redis://localhost:6379";
const REDIS_PASSWORD = process.env.HIVEMIND_REDIS_PASSWORD;

const redisUrl = REDIS_PASSWORD
  ? REDIS_URL.replace("redis://", `redis://:${REDIS_PASSWORD}@`)
  : REDIS_URL;

const redis = createRedisClient(redisUrl);
const registry = new Registry(redis);
const messenger = new Messenger(redis);
const context = new ContextStore(redis);
const tasks = new TaskBoard(redis);

const HUMAN_ID = "human";
const HUMAN_NAME = "human";

function fmt(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

async function run() {
  await redis.connect().catch(() => {});

  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case "agents": {
      const agents = await registry.list();
      if (!agents.length) {
        console.log("No active agents in the hive.");
      } else {
        fmt(
          agents.map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role ?? null,
            workdir: a.workdir ?? null,
            last_seen_s: Math.round((Date.now() - a.lastSeen) / 1000),
          }))
        );
      }
      break;
    }

    case "broadcast": {
      const message = rest.join(" ");
      if (!message) {
        console.error("Usage: hivemind broadcast <message>");
        process.exit(1);
      }
      const agents = await registry.list();
      const count = await messenger.broadcast(
        { from: HUMAN_ID, fromName: HUMAN_NAME, content: message },
        agents.map((a) => a.id)
      );
      console.log(`Broadcast delivered to ${count} agents.`);
      break;
    }

    case "send": {
      const [to, ...msgParts] = rest;
      const message = msgParts.join(" ");
      if (!to || !message) {
        console.error("Usage: hivemind send <agent-name> <message>");
        process.exit(1);
      }
      const agent = await registry.findByName(to);
      if (!agent) {
        console.error(`Agent "${to}" not found.`);
        process.exit(1);
      }
      const msg = await messenger.send({
        from: HUMAN_ID,
        fromName: HUMAN_NAME,
        to: agent.id,
        content: message,
      });
      console.log(`Sent. message_id: ${msg.id}`);
      break;
    }

    case "remember": {
      const [namespace, key, ...valueParts] = rest;
      const value = valueParts.join(" ");
      if (!namespace || !key || !value) {
        console.error("Usage: hivemind remember <namespace> <key> <value>");
        process.exit(1);
      }
      await context.set(namespace, key, value, HUMAN_ID, HUMAN_NAME);
      console.log(`Stored "${key}" in namespace "${namespace}".`);
      break;
    }

    case "recall": {
      const [namespace, key] = rest;
      if (!namespace || !key) {
        console.error("Usage: hivemind recall <namespace> <key>");
        process.exit(1);
      }
      const entry = await context.get(namespace, key);
      if (!entry) {
        console.log(`Not found: ${namespace}/${key}`);
      } else {
        fmt(entry);
      }
      break;
    }

    case "knowledge": {
      const [namespace] = rest;
      if (!namespace) {
        const ns = await context.namespaces(redis);
        console.log("Namespaces:", ns.join(", ") || "(none)");
      } else {
        const entries = await context.list(namespace);
        fmt(
          entries.map((e) => ({
            key: e.key,
            value: e.value,
            set_by: e.setBy,
            set_at: new Date(e.setAt).toISOString(),
          }))
        );
      }
      break;
    }

    case "tasks": {
      const [status] = rest as [
        ("pending" | "claimed" | "done") | undefined
      ];
      const list = await tasks.list(status);
      if (!list.length) {
        console.log("No tasks.");
      } else {
        fmt(
          list.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            created_by: t.createdBy,
            claimed_by: t.claimedBy ?? null,
            result: t.result ?? null,
          }))
        );
      }
      break;
    }

    case "task-add": {
      const [priority, ...titleParts] = rest;
      const titleStart =
        isNaN(Number(priority)) ? [priority, ...titleParts] : titleParts;
      const pri = isNaN(Number(priority)) ? 5 : Number(priority);
      const title = titleStart.join(" ");
      if (!title) {
        console.error("Usage: hivemind task-add [priority] <title>");
        process.exit(1);
      }
      const task = await tasks.add(title, undefined, pri, HUMAN_ID, HUMAN_NAME);
      console.log(`Task created: ${task.id} — "${task.title}" (p${task.priority})`);
      break;
    }

    default: {
      console.log(`hivemind — human interface to the Claude hivemind

Commands:
  agents                         List active agents
  broadcast <msg>                Send message to all agents
  send <name> <msg>              Direct message to an agent
  remember <namespace> <key> <value>  Store shared context
  recall <namespace> <key>       Read shared context
  knowledge [namespace]          Browse shared context
  tasks [pending|claimed|done]   List tasks
  task-add [priority] <title>    Add a task (priority 1-10, default 5)

Environment:
  HIVEMIND_REDIS_URL      Redis URL (default: redis://localhost:6379)
  HIVEMIND_REDIS_PASSWORD Redis password if required
`);
    }
  }

  await redis.quit();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
