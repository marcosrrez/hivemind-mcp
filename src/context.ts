import type { Redis } from "ioredis";
import type { ContextEntry } from "./types";
import { KEYS } from "./redis";

export class ContextStore {
  constructor(private redis: Redis) {}

  async set(
    namespace: string,
    key: string,
    value: string,
    agentId: string,
    agentName: string,
    ttl?: number
  ): Promise<void> {
    const entry: ContextEntry = {
      key,
      value,
      namespace,
      setBy: `${agentId}:${agentName}`,
      setAt: Date.now(),
    };

    const pipeline = this.redis.pipeline();
    if (ttl && ttl > 0) {
      pipeline.set(KEYS.context(namespace, key), JSON.stringify(entry), "EX", ttl);
    } else {
      pipeline.set(KEYS.context(namespace, key), JSON.stringify(entry));
    }
    pipeline.sadd(KEYS.contextIndex(namespace), key);
    await pipeline.exec();
  }

  async get(namespace: string, key: string): Promise<ContextEntry | null> {
    const raw = await this.redis.get(KEYS.context(namespace, key));
    if (!raw) return null;
    return JSON.parse(raw) as ContextEntry;
  }

  async list(namespace: string): Promise<ContextEntry[]> {
    const keys = await this.redis.smembers(KEYS.contextIndex(namespace));
    if (keys.length === 0) return [];

    const redisKeys = keys.map((k) => KEYS.context(namespace, k));
    const values = await this.redis.mget(...redisKeys);

    const entries: ContextEntry[] = [];
    for (const raw of values) {
      if (raw) {
        entries.push(JSON.parse(raw) as ContextEntry);
      }
    }
    return entries;
  }

  async namespaces(redis: Redis): Promise<string[]> {
    const namespaces: string[] = [];
    let cursor = "0";
    const pattern = "hivemind:ctx_idx:*";

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        // "hivemind:ctx_idx:" is 18 characters
        const ns = key.slice("hivemind:ctx_idx:".length);
        if (ns) namespaces.push(ns);
      }
    } while (cursor !== "0");

    return [...new Set(namespaces)];
  }

  async delete(namespace: string, key: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(KEYS.context(namespace, key));
    pipeline.srem(KEYS.contextIndex(namespace), key);
    await pipeline.exec();
  }
}
