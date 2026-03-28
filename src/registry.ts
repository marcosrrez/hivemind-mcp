import type Redis from "ioredis";
import type { Agent } from "./types";
import { KEYS, AGENT_TTL } from "./redis";

export class Registry {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async register(
    id: string,
    name: string,
    role?: string,
    workdir?: string,
    personality?: string
  ): Promise<Agent> {
    const now = Date.now();
    const agent: Agent = {
      id,
      name,
      ...(role !== undefined && { role }),
      ...(workdir !== undefined && { workdir }),
      ...(personality !== undefined && { personality }),
      joinedAt: now,
      lastSeen: now,
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(KEYS.agents(), id, JSON.stringify(agent));
    pipeline.set(KEYS.heartbeat(id), "1", "EX", AGENT_TTL);
    await pipeline.exec();

    return agent;
  }

  async heartbeat(id: string): Promise<void> {
    const refreshed = await this.redis.expire(KEYS.heartbeat(id), AGENT_TTL);

    if (refreshed === 0) {
      const raw = await this.redis.hget(KEYS.agents(), id);
      if (raw !== null) {
        const agent: Agent = JSON.parse(raw);
        const stale: Agent = { ...agent, lastSeen: agent.lastSeen };
        await this.redis.hset(KEYS.agents(), id, JSON.stringify(stale));
      }
    } else {
      const raw = await this.redis.hget(KEYS.agents(), id);
      if (raw !== null) {
        const agent: Agent = JSON.parse(raw);
        const updated: Agent = { ...agent, lastSeen: Date.now() };
        await this.redis.hset(KEYS.agents(), id, JSON.stringify(updated));
      }
    }
  }

  async deregister(id: string): Promise<void> {
    await Promise.all([
      this.redis.hdel(KEYS.agents(), id),
      this.redis.del(KEYS.heartbeat(id)),
    ]);
  }

  async list(): Promise<Agent[]> {
    const raw = await this.redis.hgetall(KEYS.agents());
    if (!raw || Object.keys(raw).length === 0) {
      return [];
    }

    const agents: Agent[] = [];
    const staleIds: string[] = [];

    for (const [id, json] of Object.entries(raw)) {
      const heartbeatKey = KEYS.heartbeat(id);
      const alive = await this.redis.exists(heartbeatKey);

      if (alive === 0) {
        staleIds.push(id);
      } else {
        try {
          agents.push(JSON.parse(json));
        } catch {
          staleIds.push(id);
        }
      }
    }

    if (staleIds.length > 0) {
      await this.redis.hdel(KEYS.agents(), ...staleIds);
    }

    return agents;
  }

  async get(id: string): Promise<Agent | null> {
    const raw = await this.redis.hget(KEYS.agents(), id);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as Agent;
    } catch {
      return null;
    }
  }

  async findByName(name: string): Promise<Agent | null> {
    const raw = await this.redis.hgetall(KEYS.agents());
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }

    for (const json of Object.values(raw)) {
      try {
        const agent: Agent = JSON.parse(json);
        if (agent.name === name) {
          return agent;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
