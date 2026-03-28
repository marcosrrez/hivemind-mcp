import { nanoid } from "nanoid";
import type { Redis } from "ioredis";
import type { Task, TaskStatus } from "./types";
import { KEYS } from "./redis";

export class TaskBoard {
  constructor(private redis: Redis) {}

  async add(
    title: string,
    description: string | undefined,
    priority: number,
    agentId: string,
    agentName: string
  ): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: nanoid(),
      title,
      description,
      status: "pending",
      priority,
      createdBy: `${agentId}:${agentName}`,
      createdAt: now,
      updatedAt: now,
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(KEYS.tasks(), task.id, JSON.stringify(task));
    pipeline.zadd(KEYS.taskQueue(), priority, task.id);
    await pipeline.exec();

    return task;
  }

  async claim(
    taskId: string | undefined,
    agentId: string,
    agentName: string
  ): Promise<Task | null> {
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let targetId: string | undefined = taskId;

      if (!targetId) {
        // Peek at the highest-priority item without popping yet
        const top = await this.redis.zrange(KEYS.taskQueue(), 0, 0, "REV");
        if (!top || top.length === 0) return null;
        targetId = top[0];
      }

      const taskKey = KEYS.tasks();

      // Watch the tasks hash field for this task
      await this.redis.watch(taskKey);

      const raw = await this.redis.hget(taskKey, targetId);
      if (!raw) {
        await this.redis.unwatch();
        // If a specific task was requested and it doesn't exist, return null
        if (taskId) return null;
        // Otherwise something was removed between peek and get; retry
        continue;
      }

      const task = JSON.parse(raw) as Task;
      if (task.status !== "pending") {
        await this.redis.unwatch();
        // If caller asked for a specific task and it's not pending, return null
        if (taskId) return null;
        // Otherwise pop it from the queue (stale entry) and retry
        await this.redis.zrem(KEYS.taskQueue(), targetId);
        continue;
      }

      const updated: Task = {
        ...task,
        status: "claimed",
        claimedBy: `${agentId}:${agentName}`,
        updatedAt: Date.now(),
      };

      const multi = this.redis.multi();
      multi.hset(taskKey, targetId, JSON.stringify(updated));
      multi.zrem(KEYS.taskQueue(), targetId);

      const results = await multi.exec();

      if (results === null) {
        // Transaction was aborted due to WATCH conflict; retry
        continue;
      }

      return updated;
    }

    return null;
  }

  async complete(
    taskId: string,
    agentId: string,
    result?: string
  ): Promise<Task | null> {
    const raw = await this.redis.hget(KEYS.tasks(), taskId);
    if (!raw) return null;

    const task = JSON.parse(raw) as Task;
    const updated: Task = {
      ...task,
      status: "done",
      result,
      updatedAt: Date.now(),
    };

    await this.redis.hset(KEYS.tasks(), taskId, JSON.stringify(updated));
    // Ensure it's removed from queue in case it was somehow still there
    await this.redis.zrem(KEYS.taskQueue(), taskId);

    return updated;
  }

  async list(status?: TaskStatus): Promise<Task[]> {
    const raws = await this.redis.hvals(KEYS.tasks());
    let tasks = raws.map((r) => JSON.parse(r) as Task);

    if (status !== undefined) {
      tasks = tasks.filter((t) => t.status === status);
    }

    tasks.sort((a, b) => b.priority - a.priority);
    return tasks;
  }
}
