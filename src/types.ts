export interface Agent {
  id: string;
  name: string;
  role?: string;
  workdir?: string;
  joinedAt: number;
  lastSeen: number;
}

export interface Message {
  id: string;
  from: string;
  fromName: string;
  to: string | "broadcast";
  channel?: string;
  content: string;
  threadId?: string;
  timestamp: number;
}

export interface ContextEntry {
  key: string;
  value: string;
  namespace: string;
  setBy: string;
  setAt: number;
}

export type TaskStatus = "pending" | "claimed" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: number;
  createdBy: string;
  claimedBy?: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HiveConfig {
  redisUrl: string;
  keyPrefix: string;
  agentTtl: number;
  messageTtl: number;
}
