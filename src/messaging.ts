import { nanoid } from "nanoid";
import type { Redis } from "ioredis";
import type { Message } from "./types";
import { KEYS, MESSAGE_TTL } from "./redis";

export class Messenger {
  constructor(private redis: Redis) {}

  async send(msg: Omit<Message, "id" | "timestamp">): Promise<Message> {
    const full: Message = {
      ...msg,
      id: nanoid(),
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(full);

    if (msg.channel) {
      const channelKey = KEYS.channel(msg.channel);
      await this.redis.lpush(channelKey, payload);
      await this.redis.expire(channelKey, MESSAGE_TTL);
    } else {
      const inboxKey = KEYS.inbox(msg.to as string);
      await this.redis.lpush(inboxKey, payload);
      await this.redis.expire(inboxKey, MESSAGE_TTL);
    }

    return full;
  }

  async broadcast(
    msg: Omit<Message, "id" | "timestamp" | "to">,
    agentIds: string[]
  ): Promise<number> {
    const full: Message = {
      ...msg,
      id: nanoid(),
      timestamp: Date.now(),
      to: "broadcast",
    };

    const payload = JSON.stringify(full);

    const pipeline = this.redis.pipeline();

    for (const agentId of agentIds) {
      const inboxKey = KEYS.inbox(agentId);
      pipeline.lpush(inboxKey, payload);
      pipeline.expire(inboxKey, MESSAGE_TTL);
    }

    const broadcastKey = KEYS.channel("broadcast");
    pipeline.lpush(broadcastKey, payload);
    pipeline.expire(broadcastKey, MESSAGE_TTL);

    await pipeline.exec();

    return agentIds.length;
  }

  async inbox(agentId: string, limit = 50): Promise<Message[]> {
    const inboxKey = KEYS.inbox(agentId);
    // LRANGE 0 to limit-1; list is stored newest-first (lpush), so reverse for chronological order
    const raw = await this.redis.lrange(inboxKey, 0, limit - 1);
    return raw
      .map((item) => JSON.parse(item) as Message)
      .reverse();
  }

  async channelRead(channel: string, limit = 50): Promise<Message[]> {
    const channelKey = KEYS.channel(channel);
    const raw = await this.redis.lrange(channelKey, 0, limit - 1);
    return raw
      .map((item) => JSON.parse(item) as Message)
      .reverse();
  }

  async clearInbox(agentId: string): Promise<void> {
    await this.redis.del(KEYS.inbox(agentId));
  }
}
