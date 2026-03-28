import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createRedisClient } from "./redis.js";
import { Registry } from "./registry.js";
import { Messenger } from "./messaging.js";
import { ContextStore } from "./context.js";
import { TaskBoard } from "./tasks.js";

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

// Per-session agent identity (in-memory, not persisted)
let sessionAgentId: string | null = null;
let sessionAgentName: string | null = null;

// Heartbeat interval
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function requireJoined(): { id: string; name: string } {
  if (!sessionAgentId || !sessionAgentName) {
    throw new Error(
      "Not joined to hive. Call hive_join first."
    );
  }
  return { id: sessionAgentId, name: sessionAgentName };
}

const server = new Server(
  { name: "hivemind-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "hive_join",
      description:
        "Join the hivemind. Register this Claude instance so others can see and message it. Call this first. Returns your agent ID.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "A short display name for this instance (e.g. 'backend-agent', 'refactor-bot')",
          },
          role: {
            type: "string",
            description: "Optional role description (e.g. 'API developer', 'code reviewer')",
          },
          workdir: {
            type: "string",
            description: "Current working directory (helps other agents know what you're working on)",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "hive_leave",
      description: "Gracefully leave the hivemind. Deregisters this instance.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "hive_agents",
      description:
        "List all active Claude instances currently in the hive. Shows their name, role, workdir, and last seen time.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "hive_send",
      description:
        "Send a direct message to another agent by name or ID. They will see it in their inbox.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient agent name or ID",
          },
          message: {
            type: "string",
            description: "The message content",
          },
          thread_id: {
            type: "string",
            description: "Optional thread ID to group related messages",
          },
        },
        required: ["to", "message"],
      },
    },
    {
      name: "hive_broadcast",
      description:
        "Broadcast a message to all agents in the hive, or to a named channel.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to broadcast",
          },
          channel: {
            type: "string",
            description:
              "Optional channel name. If omitted, sends to all agent inboxes.",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "hive_inbox",
      description:
        "Read your inbox — messages sent directly to you or broadcast to all. Messages persist (reading does not delete them).",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max messages to return (default 20)",
          },
        },
      },
    },
    {
      name: "hive_channel",
      description: "Read messages from a named channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel name to read",
          },
          limit: {
            type: "number",
            description: "Max messages to return (default 20)",
          },
        },
        required: ["channel"],
      },
    },
    {
      name: "hive_remember",
      description:
        "Store a value in the shared context store. All agents can read it. Persists across restarts.",
      inputSchema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Key name",
          },
          value: {
            type: "string",
            description: "Value to store (use JSON strings for structured data)",
          },
          namespace: {
            type: "string",
            description:
              "Namespace to organize context (e.g. 'decisions', 'findings', 'blockers', 'architecture'). Defaults to 'general'.",
          },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "hive_recall",
      description: "Retrieve a value from the shared context store.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          namespace: {
            type: "string",
            description: "Namespace (default: 'general')",
          },
        },
        required: ["key"],
      },
    },
    {
      name: "hive_knowledge",
      description:
        "Browse the shared context store. Lists all keys and values in a namespace, or lists available namespaces.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description:
              "Namespace to browse. If omitted, lists all available namespaces.",
          },
        },
      },
    },
    {
      name: "hive_task_add",
      description: "Add a task to the shared task board for any agent to claim.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title" },
          description: { type: "string", description: "Full task description" },
          priority: {
            type: "number",
            description: "Priority 1-10 (10 = most urgent, default 5)",
          },
        },
        required: ["title"],
      },
    },
    {
      name: "hive_task_claim",
      description:
        "Claim a task from the board to work on. If no task_id given, claims the highest-priority unclaimed task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "Specific task ID to claim (optional)",
          },
        },
      },
    },
    {
      name: "hive_task_done",
      description: "Mark a task as completed with an optional result.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to complete" },
          result: {
            type: "string",
            description: "Optional result or summary of what was done",
          },
        },
        required: ["task_id"],
      },
    },
    {
      name: "hive_tasks",
      description: "List tasks on the shared board.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "claimed", "done"],
            description: "Filter by status (omit for all)",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "hive_join": {
        const parsed = z
          .object({
            name: z.string(),
            role: z.string().optional(),
            workdir: z.string().optional(),
          })
          .parse(args);

        if (sessionAgentId) {
          await registry.deregister(sessionAgentId);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }

        sessionAgentId = nanoid(10);
        sessionAgentName = parsed.name;

        const agent = await registry.register(
          sessionAgentId,
          parsed.name,
          parsed.role,
          parsed.workdir ?? process.cwd()
        );

        // Start heartbeat
        heartbeatInterval = setInterval(async () => {
          if (sessionAgentId) {
            await registry.heartbeat(sessionAgentId).catch(() => {});
          }
        }, 20_000);

        const others = (await registry.list()).filter(
          (a) => a.id !== sessionAgentId
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  joined: true,
                  agent_id: agent.id,
                  name: agent.name,
                  active_agents: others.length,
                  others: others.map((a) => ({
                    id: a.id,
                    name: a.name,
                    role: a.role,
                    workdir: a.workdir,
                  })),
                  tip: "Use hive_inbox to check for messages, hive_broadcast to talk to everyone.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_leave": {
        if (sessionAgentId) {
          await registry.deregister(sessionAgentId);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          sessionAgentId = null;
          sessionAgentName = null;
        }
        return { content: [{ type: "text", text: "Left the hive." }] };
      }

      case "hive_agents": {
        const agents = await registry.list();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                agents.map((a) => ({
                  id: a.id,
                  name: a.name,
                  role: a.role ?? null,
                  workdir: a.workdir ?? null,
                  last_seen_s: Math.round(
                    (Date.now() - a.lastSeen) / 1000
                  ),
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_send": {
        const { id, name: fromName } = requireJoined();
        const parsed = z
          .object({
            to: z.string(),
            message: z.string(),
            thread_id: z.string().optional(),
          })
          .parse(args);

        // Resolve name → id
        let toId = parsed.to;
        const byName = await registry.findByName(parsed.to);
        if (byName) toId = byName.id;

        const msg = await messenger.send({
          from: id,
          fromName,
          to: toId,
          content: parsed.message,
          threadId: parsed.thread_id,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sent: true, message_id: msg.id }, null, 2),
            },
          ],
        };
      }

      case "hive_broadcast": {
        const { id, name: fromName } = requireJoined();
        const parsed = z
          .object({ message: z.string(), channel: z.string().optional() })
          .parse(args);

        if (parsed.channel) {
          const msg = await messenger.send({
            from: id,
            fromName,
            to: "broadcast",
            channel: parsed.channel,
            content: parsed.message,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { sent: true, channel: parsed.channel, message_id: msg.id },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          const agents = await registry.list();
          const otherIds = agents
            .filter((a) => a.id !== id)
            .map((a) => a.id);
          const count = await messenger.broadcast(
            { from: id, fromName, content: parsed.message },
            otherIds
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { sent: true, delivered_to: count },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case "hive_inbox": {
        const { id } = requireJoined();
        const parsed = z
          .object({ limit: z.number().optional() })
          .parse(args ?? {});
        const messages = await messenger.inbox(id, parsed.limit ?? 20);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  from: m.fromName,
                  channel: m.channel ?? null,
                  content: m.content,
                  thread: m.threadId ?? null,
                  at: new Date(m.timestamp).toISOString(),
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_channel": {
        requireJoined();
        const parsed = z
          .object({ channel: z.string(), limit: z.number().optional() })
          .parse(args);
        const messages = await messenger.channelRead(
          parsed.channel,
          parsed.limit ?? 20
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  from: m.fromName,
                  content: m.content,
                  at: new Date(m.timestamp).toISOString(),
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_remember": {
        const { id, name: agentName } = requireJoined();
        const parsed = z
          .object({
            key: z.string(),
            value: z.string(),
            namespace: z.string().optional(),
          })
          .parse(args);
        await context.set(
          parsed.namespace ?? "general",
          parsed.key,
          parsed.value,
          id,
          agentName
        );
        return {
          content: [
            {
              type: "text",
              text: `Stored "${parsed.key}" in namespace "${parsed.namespace ?? "general"}".`,
            },
          ],
        };
      }

      case "hive_recall": {
        requireJoined();
        const parsed = z
          .object({ key: z.string(), namespace: z.string().optional() })
          .parse(args);
        const entry = await context.get(
          parsed.namespace ?? "general",
          parsed.key
        );
        if (!entry) {
          return {
            content: [
              { type: "text", text: `No entry found for "${parsed.key}".` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  key: entry.key,
                  value: entry.value,
                  namespace: entry.namespace,
                  set_by: entry.setBy,
                  set_at: new Date(entry.setAt).toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_knowledge": {
        requireJoined();
        const parsed = z
          .object({ namespace: z.string().optional() })
          .parse(args ?? {});

        if (!parsed.namespace) {
          const ns = await context.namespaces(redis);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ namespaces: ns }, null, 2),
              },
            ],
          };
        }

        const entries = await context.list(parsed.namespace);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                entries.map((e) => ({
                  key: e.key,
                  value: e.value,
                  set_by: e.setBy,
                  set_at: new Date(e.setAt).toISOString(),
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_task_add": {
        const { id, name: agentName } = requireJoined();
        const parsed = z
          .object({
            title: z.string(),
            description: z.string().optional(),
            priority: z.number().min(1).max(10).optional(),
          })
          .parse(args);
        const task = await tasks.add(
          parsed.title,
          parsed.description,
          parsed.priority ?? 5,
          id,
          agentName
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { created: true, task_id: task.id, title: task.title },
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_task_claim": {
        const { id, name: agentName } = requireJoined();
        const parsed = z
          .object({ task_id: z.string().optional() })
          .parse(args ?? {});
        const task = await tasks.claim(parsed.task_id, id, agentName);
        if (!task) {
          return {
            content: [{ type: "text", text: "No unclaimed tasks available." }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  claimed: true,
                  task_id: task.id,
                  title: task.title,
                  description: task.description ?? null,
                  priority: task.priority,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_task_done": {
        const { id } = requireJoined();
        const parsed = z
          .object({ task_id: z.string(), result: z.string().optional() })
          .parse(args);
        const task = await tasks.complete(parsed.task_id, id, parsed.result);
        if (!task) {
          return {
            content: [{ type: "text", text: "Task not found." }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { completed: true, task_id: task.id, title: task.title },
                null,
                2
              ),
            },
          ],
        };
      }

      case "hive_tasks": {
        requireJoined();
        const parsed = z
          .object({
            status: z.enum(["pending", "claimed", "done"]).optional(),
          })
          .parse(args ?? {});
        const list = await tasks.list(parsed.status);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                list.map((t) => ({
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  priority: t.priority,
                  created_by: t.createdBy,
                  claimed_by: t.claimedBy ?? null,
                  result: t.result ?? null,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  await redis.connect().catch(() => {
    // lazyConnect — connect errors surface on first use
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    if (sessionAgentId) {
      await registry.deregister(sessionAgentId).catch(() => {});
    }
    await redis.quit().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
