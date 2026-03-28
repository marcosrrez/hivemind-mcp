import http from "http";
import { createRedisClient } from "./redis.js";
import { Registry } from "./registry.js";
import { Messenger } from "./messaging.js";
import { TaskBoard } from "./tasks.js";
import { ContextStore } from "./context.js";

const PORT = process.env.HIVEMIND_DASHBOARD_PORT ?? "4842";
const REDIS_URL = process.env.HIVEMIND_REDIS_URL ?? "redis://localhost:6379";
const REDIS_PASSWORD = process.env.HIVEMIND_REDIS_PASSWORD;

const redisUrl = REDIS_PASSWORD
  ? REDIS_URL.replace("redis://", `redis://:${REDIS_PASSWORD}@`)
  : REDIS_URL;

const redis = createRedisClient(redisUrl);
const registry = new Registry(redis);
const messenger = new Messenger(redis);
const tasks = new TaskBoard(redis);
const context = new ContextStore(redis);

const sseClients = new Set<http.ServerResponse>();

async function getState() {
  const [agents, taskList, namespaces, recentMessages] = await Promise.all([
    registry.list(),
    tasks.list(),
    context.namespaces(redis),
    messenger.channelRead("_all", 50),
  ]);

  const contextData: Record<string, { key: string; value: string; setBy: string }[]> = {};
  for (const ns of namespaces) {
    const entries = await context.list(ns);
    contextData[ns] = entries.map((e) => ({ key: e.key, value: e.value, setBy: e.setBy }));
  }

  return { agents, tasks: taskList, context: contextData, recentMessages };
}

function broadcast(data: unknown) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// Assign a consistent color per agent name
const AGENT_COLORS = [
  "#c0a0ff","#ff79c6","#8be9fd","#50fa7b","#f1fa8c",
  "#ffb86c","#ff5555","#bd93f9","#6be5fd","#ffe461",
];
function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hivemind</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #08080f; color: #e0e0e0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; }
  header { padding: 14px 20px; border-bottom: 1px solid #1a1a28; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 15px; color: #c0a0ff; letter-spacing: 3px; text-transform: uppercase; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: #50fa7b; animation: pulse 2s infinite; flex-shrink:0; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
  .updated { font-size: 10px; color: #333; margin-left: auto; }
  .layout { display: grid; grid-template-columns: 280px 1fr 240px; height: calc(100vh - 45px); }
  .panel { border-right: 1px solid #1a1a28; display: flex; flex-direction: column; overflow: hidden; }
  .panel:last-child { border-right: none; }
  .panel-header { padding: 10px 14px; border-bottom: 1px solid #1a1a28; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; flex-shrink: 0; }
  .panel-body { overflow-y: auto; flex: 1; padding: 10px 14px; }
  .panel-body::-webkit-scrollbar { width: 4px; }
  .panel-body::-webkit-scrollbar-track { background: transparent; }
  .panel-body::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }

  /* Agents */
  .agent { padding: 10px 0; border-bottom: 1px solid #12121e; }
  .agent:last-child { border: none; }
  .agent-header { display: flex; align-items: center; gap: 8px; }
  .agent-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .agent-name { font-weight: bold; font-size: 13px; }
  .agent-personality { color: #555; font-size: 10px; margin-top: 4px; line-height: 1.4; font-style: italic; }
  .agent-role { color: #666; font-size: 10px; margin-top: 2px; }
  .agent-seen { font-size: 9px; color: #333; margin-top: 2px; }

  /* Messages */
  .msg { padding: 8px 0; border-bottom: 1px solid #12121e; }
  .msg:last-child { border: none; }
  .msg-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
  .msg-from { font-weight: bold; font-size: 11px; }
  .msg-to { font-size: 10px; color: #444; }
  .msg-time { font-size: 9px; color: #333; margin-left: auto; }
  .msg-content { color: #bbb; font-size: 12px; line-height: 1.4; }

  /* Tasks */
  .task { padding: 8px 0; border-bottom: 1px solid #12121e; }
  .task:last-child { border: none; }
  .task-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: bold; flex-shrink: 0; }
  .badge.pending { background: #1e1e04; color: #f1fa8c; }
  .badge.claimed { background: #041020; color: #8be9fd; }
  .badge.done { background: #041204; color: #50fa7b; }
  .priority { font-size: 9px; color: #ff79c6; }
  .task-title { font-size: 12px; color: #ddd; }
  .task-meta { font-size: 10px; color: #444; margin-top: 2px; }

  /* Context */
  .ctx-ns { margin-bottom: 14px; }
  .ctx-label { font-size: 9px; color: #8be9fd; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .ctx-entry { padding: 3px 0; }
  .ctx-key { color: #f1fa8c; font-size: 11px; }
  .ctx-val { color: #888; font-size: 11px; margin-top: 1px; word-break: break-word; }

  .empty { color: #2a2a3a; font-style: italic; font-size: 11px; }
</style>
</head>
<body>
<header>
  <div class="pulse"></div>
  <h1>Hivemind</h1>
  <span class="updated" id="updated">connecting...</span>
</header>
<div class="layout">

  <div class="panel">
    <div class="panel-header">Agents · <span id="agent-count">0</span> online</div>
    <div class="panel-body" id="agents"><span class="empty">No agents online</span></div>
  </div>

  <div class="panel">
    <div class="panel-header">Message Feed</div>
    <div class="panel-body" id="messages"><span class="empty">No messages yet</span></div>
  </div>

  <div class="panel" style="display:flex;flex-direction:column;">
    <div class="panel-header">Tasks</div>
    <div class="panel-body" id="tasks" style="flex:1;"><span class="empty">No tasks</span></div>
    <div style="border-top:1px solid #1a1a28;">
      <div class="panel-header" style="border:none;">Shared Context</div>
      <div class="panel-body" id="context" style="max-height:35vh;"><span class="empty">No context stored</span></div>
    </div>
  </div>

</div>
<script>
const COLORS = ["#c0a0ff","#ff79c6","#8be9fd","#50fa7b","#f1fa8c","#ffb86c","#ff5555","#bd93f9","#6be5fd","#ffe461"];
function agentColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

const es = new EventSource('/stream');
es.onmessage = (e) => {
  render(JSON.parse(e.data));
  document.getElementById('updated').textContent = new Date().toLocaleTimeString();
};
es.onerror = () => {
  document.getElementById('updated').textContent = 'reconnecting...';
};

function render(d) {
  // Agents
  document.getElementById('agent-count').textContent = d.agents.length;
  document.getElementById('agents').innerHTML = d.agents.length
    ? d.agents.map(a => {
        const c = agentColor(a.name);
        return \`<div class="agent">
          <div class="agent-header">
            <div class="agent-dot" style="background:\${c}"></div>
            <div class="agent-name" style="color:\${c}">\${esc(a.name)}</div>
          </div>
          \${a.personality ? \`<div class="agent-personality">\${esc(a.personality)}</div>\` : ''}
          \${a.role ? \`<div class="agent-role">\${esc(a.role)}</div>\` : ''}
          <div class="agent-seen">\${a.lastSeen ? Math.round((Date.now()-a.lastSeen)/1000)+'s ago' : ''}\${a.workdir ? ' · '+esc(a.workdir) : ''}</div>
        </div>\`;
      }).join('')
    : '<span class="empty">No agents online</span>';

  // Messages — show newest at bottom
  const msgs = [...d.recentMessages].slice(0, 40);
  const msgEl = document.getElementById('messages');
  const wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop <= msgEl.clientHeight + 40;
  msgEl.innerHTML = msgs.length
    ? msgs.map(m => {
        const c = agentColor(m.fromName);
        const isDirect = m.to && m.to !== 'broadcast';
        const toLabel = isDirect ? \`→ \${esc(m.to)}\` : (m.channel && m.channel !== '_all' ? \`#\${esc(m.channel)}\` : '');
        return \`<div class="msg">
          <div class="msg-header">
            <span class="msg-from" style="color:\${c}">\${esc(m.fromName)}</span>
            \${toLabel ? \`<span class="msg-to">\${toLabel}</span>\` : ''}
            <span class="msg-time">\${new Date(m.timestamp).toLocaleTimeString()}</span>
          </div>
          <div class="msg-content">\${esc(m.content)}</div>
        </div>\`;
      }).join('')
    : '<span class="empty">No messages yet</span>';
  if (wasAtBottom) msgEl.scrollTop = msgEl.scrollHeight;

  // Tasks
  const sorted = [...d.tasks].sort((a,b) => b.priority - a.priority);
  document.getElementById('tasks').innerHTML = sorted.length
    ? sorted.map(t => \`
      <div class="task">
        <div class="task-header">
          <span class="badge \${t.status}">\${t.status}</span>
          <span class="priority">p\${t.priority}</span>
        </div>
        <div class="task-title">\${esc(t.title)}</div>
        <div class="task-meta">\${t.claimedBy ? '→ '+esc(t.claimedBy) : ''}\${t.result ? ' ✓ '+esc(t.result) : ''}</div>
      </div>\`).join('')
    : '<span class="empty">No tasks</span>';

  // Context
  const ns = Object.entries(d.context).filter(([k]) => !k.startsWith('_'));
  document.getElementById('context').innerHTML = ns.length
    ? ns.map(([name, entries]) => \`
      <div class="ctx-ns">
        <div class="ctx-label">\${esc(name)}</div>
        \${entries.map(e => \`
          <div class="ctx-entry">
            <div class="ctx-key">\${esc(e.key)}</div>
            <div class="ctx-val">\${esc(e.value)}</div>
          </div>\`).join('')}
      </div>\`).join('')
    : '<span class="empty">No context stored</span>';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;

async function main() {
  await redis.connect().catch(() => {});

  const srv = http.createServer(async (req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML);
      return;
    }

    if (req.url === "/api/state") {
      const state = await getState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state));
      return;
    }

    if (req.url === "/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 3000\n\n");
      sseClients.add(res);

      // Send initial state immediately
      const state = await getState();
      res.write(`data: ${JSON.stringify(state)}\n\n`);

      req.on("close", () => sseClients.delete(res));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  srv.listen(PORT, () => {
    process.stderr.write(`Hivemind dashboard running at http://localhost:${PORT}\n`);
  });

  // Push updates every 3 seconds
  setInterval(async () => {
    if (sseClients.size === 0) return;
    const state = await getState();
    broadcast(state);
  }, 3000);
}

main().catch((e) => {
  process.stderr.write(`Dashboard error: ${e}\n`);
  process.exit(1);
});
