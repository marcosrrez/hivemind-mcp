# hivemind-mcp

Real-time coordination layer for multiple Claude Code instances — on one machine or across all your devices.

hivemind gives independently-launched Claude agents a shared nervous system: they can discover each other, exchange messages, store shared context, and coordinate work on a task board — all backed by Redis pub/sub for instant delivery.

---

## Why hivemind?

| Solution | Problem |
|---|---|
| `claude-peers-mcp` | Polls SQLite — not real-time. Requires Bun web auth. |
| Native Agent Teams | One instance must spawn all others. Useless for independently-launched agents. |
| `agent-orchestration` | Generic, not Claude-native. |
| **hivemind** | Redis pub/sub for instant delivery. Works with any independently-launched Claude instance. Shared context persists across restarts. |

---

## Install

```bash
git clone https://github.com/youruser/hivemind-mcp
cd hivemind-mcp
bun install   # or npm install
```

Build (if using the compiled server):

```bash
bun run build
```

Add to Claude Code (production):

```bash
claude mcp add --scope user hivemind-mcp -- node /path/to/hivemind-mcp/dist/server.js
```

Add to Claude Code (development, no build step):

```bash
claude mcp add --scope user hivemind-mcp -- bunx tsx /path/to/hivemind-mcp/src/server.ts
```

Redis must be running locally or reachable via `HIVEMIND_REDIS_URL`.

---

## Multi-Machine Setup

hivemind works across all your devices as long as they share a Redis instance. The recommended approach is a self-hosted Redis server accessible via [Tailscale](https://tailscale.com).

**Architecture:**
```
[Laptop] ──┐
[Phone]  ──┼── Tailscale ──► Redis (home server) ◄── hivemind hub
[Desktop]──┘
```

**On each machine, point hivemind at your shared Redis:**

```bash
claude mcp add --scope user hivemind-mcp \
  -e HIVEMIND_REDIS_URL=redis://<your-tailscale-ip>:6379 \
  -e HIVEMIND_REDIS_PASSWORD=<your-redis-password> \
  -- bunx tsx /path/to/hivemind-mcp/src/server.ts
```

**Requirements for multi-machine:**
- Redis must be reachable on port `6379` from all devices (via Tailscale or VPN)
- All devices must be on the same Tailscale network (or equivalent)
- Redis should have a strong password (`requirepass` in redis.conf or Docker)

**Firewall tip:** Only expose Redis on the Tailscale interface, not the public internet:
```bash
# UFW example — allow Redis only from Tailscale
ufw allow in on tailscale0 to any port 6379 proto tcp
```

Once configured, Claude instances on any device call `hive_join()` and they're all in the same hive.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HIVEMIND_REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `HIVEMIND_REDIS_PASSWORD` | _(none)_ | Redis password, if authentication is required |

---

## MCP Tools Reference

### Agent Registry

**`hive_join(name, role?, workdir?)`**
Register this Claude instance with the hive. Returns an agent ID and the current list of online agents.

**`hive_leave()`**
Deregister gracefully on shutdown.

**`hive_agents()`**
List all active agents — name, role, working directory, and last seen timestamp.

### Messaging

**`hive_send(to, message, thread_id?)`**
Send a direct message to another agent by name or ID. Optionally thread it.

**`hive_broadcast(message, channel?)`**
Send to all agents, or to a named channel.

**`hive_inbox(limit?)`**
Read your messages. Non-destructive — does not clear the inbox.

**`hive_channel(channel, limit?)`**
Read messages from a named channel.

### Shared Context

**`hive_remember(key, value, namespace?)`**
Store a value to the shared context store. Persists across restarts.

**`hive_recall(key, namespace?)`**
Retrieve a value from shared context.

**`hive_knowledge(namespace?)`**
Browse shared context. Lists all keys in a namespace, or all namespaces if none is specified.

### Task Board

**`hive_task_add(title, description?, priority?)`**
Add a task to the shared board. Priority is 1–10 (higher = more urgent).

**`hive_task_claim(task_id?)`**
Claim the highest-priority unclaimed task, or a specific task by ID. Atomic — prevents two agents from claiming the same task.

**`hive_task_done(task_id, result?)`**
Mark a task as complete, optionally storing a result.

**`hive_tasks(status?)`**
List tasks. Optionally filter by status: `pending`, `claimed`, or `done`.

---

## Human CLI

The `hivemind` command lets you interact with the hive directly from your terminal.

```bash
# List online agents
hivemind agents

# Broadcast a message to all agents
hivemind broadcast "Deploying to staging in 5 minutes"

# Send a direct message
hivemind send frontend-agent "Can you check the auth flow?"

# Store shared context
hivemind remember "deploy-target" "staging.example.com" --namespace infra

# Retrieve shared context
hivemind recall "deploy-target" --namespace infra

# Browse context namespaces
hivemind knowledge

# Add a task
hivemind task add "Write unit tests for auth module" --priority 8

# List tasks
hivemind tasks
hivemind tasks --status pending

# Claim a task (useful for debugging)
hivemind task claim
```

---

## Typical Multi-Agent Workflow

Two Claude instances collaborating on the same codebase:

**Claude A** opens the frontend project:
```
hive_join("frontend-agent", "Building React UI", "/home/user/myapp")
```

**Claude B** opens the backend project:
```
hive_join("backend-agent", "Building API", "/home/user/myapp")
```

**Claude A** checks who else is online:
```
hive_agents()
// -> sees backend-agent is active
```

**Claude A** broadcasts an architecture decision:
```
hive_broadcast("Starting on auth components — using JWT")
hive_remember("auth-decision", "JWT with 7 day expiry, refresh tokens in Redis", "decisions")
```

**Claude B** picks up the message:
```
hive_inbox()
// -> sees Claude A's broadcast
```

**Later, Claude C** joins the project and gets up to speed instantly:
```
hive_join("test-agent", "Writing integration tests", "/home/user/myapp")
hive_knowledge("decisions")
// -> sees auth-decision and any other stored decisions
```

**Agents coordinate tasks without double-work:**
```
// Claude A adds tasks
hive_task_add("Implement JWT middleware", priority=9)
hive_task_add("Write auth endpoint tests", priority=7)

// Claude B atomically claims the highest-priority task
hive_task_claim()
// -> claims "Implement JWT middleware", no other agent can claim it

// Claude B finishes
hive_task_done(task_id, "Middleware in src/middleware/auth.ts")
```

---

## Project Structure

```
src/
  types.ts       — shared TypeScript interfaces
  redis.ts       — Redis client and key schema
  registry.ts    — agent registration, heartbeat, discovery
  messaging.ts   — broadcast, direct messages, channels
  context.ts     — shared persistent context store
  tasks.ts       — task board with atomic claiming
  server.ts      — MCP server, wires all tools together
bin/
  hivemind.ts    — human CLI
```

---

## Requirements

- Node.js 18+ or Bun
- Redis 6+
- Claude Code with MCP support

---

## License

MIT
