import Redis from "ioredis";

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });

  client.on("error", (err: Error) => {
    process.stderr.write(`[hivemind-mcp] Redis error: ${err.message}\n`);
  });

  client.on("connect", () => {
    process.stderr.write("[hivemind-mcp] Redis connected\n");
  });

  client.on("reconnecting", () => {
    process.stderr.write("[hivemind-mcp] Redis reconnecting...\n");
  });

  return client;
}

export const KEYS = {
  agents: (): string => "hivemind:agents",
  heartbeat: (agentId: string): string => `hivemind:heartbeat:${agentId}`,
  inbox: (agentId: string): string => `hivemind:inbox:${agentId}`,
  channel: (name: string): string => `hivemind:channel:${name}`,
  context: (namespace: string, key: string): string =>
    `hivemind:ctx:${namespace}:${key}`,
  contextIndex: (namespace: string): string =>
    `hivemind:ctx_idx:${namespace}`,
  tasks: (): string => "hivemind:tasks",
  taskQueue: (): string => "hivemind:task_queue",
};

export const AGENT_TTL = parseInt(process.env.HIVEMIND_AGENT_TTL ?? "45", 10);
export const MESSAGE_TTL = parseInt(process.env.HIVEMIND_MESSAGE_TTL ?? "86400", 10);
