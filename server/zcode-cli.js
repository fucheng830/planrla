// server/zcode-cli.js
//
// ZCode provider spawn wrapper. Unlike the other providers which spawn a
// one-shot CLI process per prompt, ZCode exposes a long-lived stdio
// "app-server" that speaks the ZCode Protocol (NDJSON over stdio). Each
// spawnZcode() call boots a fresh app-server, runs one conversation turn, then
// tears the process down.
//
// Protocol summary (verified against zcode 0.16.1):
//   * Envelopes: request {id:number, method, params?} / response {id, result|error}
//                / server-to-client request {id:"server-N", method, params}
//                / notification {method, params} (no id). NO `jsonrpc` field.
//   * Conversation: session/create {workspace} OR session/resume {sessionId}
//                   -> server asks session/requestRuntimePreferences (must reply
//                      {nativeSearchEnhancementsEnabled:boolean})
//                   -> v4/conversation/subscribe {topic:"conversation/<id>",
//                      connectionId:<client-generated>, clientMode:"desktop-continuous"}
//                      -> live frames arrive as v4/conversation/frame notifications
//                      whose payload.deltas carry row.delta {path:"text", append}
//                      for true streaming text (assistantText rows), plus
//                      reasoning rows and toolCall rows.
//                   -> session/send {sessionId, content} returns ack immediately
//                   -> telemetry events are metadata-only (turn.terminal = end);
//                      session/messages returns the full message list as a
//                      non-streaming fallback.

import { spawn } from 'child_process';
import fsSync from 'node:fs';
import path from 'node:path';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { getZcodeCliHome, resolveZcodeBinary } from './modules/providers/list/zcode/zcode-auth.provider.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

const PROVIDER = 'zcode';

// Map of providerSessionId -> { child, aborted } for abort handling.
const activeZcodeProcesses = new Map();

const ZCODE_INSTALL_HINT = 'ZCode CLI is not installed. Install ZCode from https://zcode.z.ai/';

/**
 * Parses a "providerId/modelId" catalog string into the app-server's modelRef
 * shape ({providerId, modelId}). Splits on the FIRST slash — model ids may
 * contain further segments but provider ids do not.
 */
function parseZcodeModelRef(model) {
  const value = typeof model === 'string' ? model.trim() : '';
  if (!value) return null;
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return null;
  return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/**
 * The app-server rejects session/send with code ZCODE_RUNTIME_MODEL_UNAVAILABLE
 * when the session pins a model that is no longer in the workspace's catalog
 * (the CLI localizes the message, so prefer the stable code and fall back to
 * broad text matching).
 */
function isStaleModelError(error) {
  const code = String(error?.data?.code ?? error?.code ?? '');
  if (code) return code === 'ZCODE_RUNTIME_MODEL_UNAVAILABLE';
  const message = String(error?.message ?? error ?? '');
  return /已不可用|不可用|unavailable|no longer available|not available/i.test(message);
}

/**
 * setModel rejects an unsupported model with a message that lists the
 * workspace's available models — superseded by buildZcodeRuntimeModel (the
 * catalog is read directly via workspace/readState).
 */

/**
 * Reads a provider's connection config (kind/baseURL/apiKey) from
 * ~/.zcode/cli/config.json's `provider` section. The runtimeModel pushed with
 * session/send needs these; the workspace catalog only carries summaries.
 */
function readZcodeProviderConfig(providerId) {
  try {
    const configPath = path.join(getZcodeCliHome(), 'config.json');
    if (!fsSync.existsSync(configPath)) return null;
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    const entry = config?.provider?.[providerId];
    if (!entry || typeof entry !== 'object') return null;
    return {
      kind: typeof entry.kind === 'string' ? entry.kind : 'anthropic',
      label: typeof entry.name === 'string' ? entry.name : undefined,
      baseURL: typeof entry.options?.baseURL === 'string' ? entry.options.baseURL : undefined,
      apiKey: typeof entry.options?.apiKey === 'string' ? entry.options.apiKey : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Builds the runtimeModel payload that session/send accepts, from the
 * workspace's CURRENT model catalog (workspace/readState) plus the provider
 * connection config in ~/.zcode/cli/config.json. Applying a fresh runtimeModel
 * on send is the app-server's supported way to rebind a session whose
 * persisted model was delisted (it clears the resume restoreWarning).
 *
 * @param preferredModel  optional "providerId/modelId" string; used when it is
 *                        present in the catalog, otherwise the first catalog
 *                        entry wins.
 * @returns null when no usable catalog entry/provider config exists.
 */
async function buildZcodeRuntimeModel(child, nextId, workspace, writer, preferredModel) {
  const rs = await request(child, nextId(), 'workspace/readState', { workspace }, writer);
  if (rs.error) return null;
  const catalog = rs.result?.modelCatalog;
  if (!catalog || !Array.isArray(catalog.available) || catalog.available.length === 0) return null;

  const preferred = preferredModel ? parseZcodeModelRef(preferredModel) : null;
  const entry =
    (preferred && catalog.available.find((m) => {
      const ref = m?.ref ?? {};
      return ref.providerId === preferred.providerId && ref.modelId === preferred.modelId;
    })) ??
    catalog.available[0];
  const modelRef = entry?.ref;
  if (!modelRef?.providerId || !modelRef?.modelId) return null;

  const catalogProvider = (catalog.providers ?? []).find((p) => p.providerId === modelRef.providerId);
  const providerConfig = readZcodeProviderConfig(modelRef.providerId);
  if (!providerConfig?.baseURL) return null;

  return {
    revision: String(catalog.revision ?? 0),
    generatedAt: Date.now(),
    model: { providerId: modelRef.providerId, modelId: modelRef.modelId },
    provider: {
      providerId: modelRef.providerId,
      kind: providerConfig.kind,
      ...(providerConfig.label ? { label: providerConfig.label } : {}),
      source: 'workspace',
      baseURL: providerConfig.baseURL,
      ...(providerConfig.apiKey
        ? { apiKey: { source: 'inline', value: providerConfig.apiKey } }
        : {}),
      ...(Array.isArray(catalogProvider?.models) ? { models: catalogProvider.models } : {}),
    },
  };
}

/**
 * Sends one framed NDJSON request and resolves with the matching response
 * (result or error envelope). server-to-client requests arriving while we wait
 * are answered automatically by handleServerRequest.
 */
function request(child, id, method, params, writer) {
  return new Promise((resolvePromise, reject) => {
    const line = JSON.stringify(params !== undefined ? { id, method, params } : { id, method });
    try {
      child.stdin.write(line + '\n');
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // Resolution is hooked up by the stdout loop in spawnZcode via id->resolver map.
    writer.__pending.set(id, { resolvePromise, reject, method });
  });
}

/**
 * Replies to a server-to-client request (id is a string like "server-1").
 */
function replyServerRequest(child, id, result) {
  try {
    child.stdin.write(JSON.stringify({ id, result }) + '\n');
  } catch {
    // Child stdin may be gone during shutdown; ignore.
  }
}

/**
 * Handles a server-initiated request. The only one we must answer to complete
 * session/create is session/requestRuntimePreferences, which expects
 * {nativeSearchEnhancementsEnabled:boolean} (strict schema, no extra keys).
 */
function handleServerRequest(child, msg, writer) {
  const method = msg.method;
  if (method === 'session/requestRuntimePreferences') {
    replyServerRequest(child, msg.id, { nativeSearchEnhancementsEnabled: false });
    return;
  }
  if (method === 'interaction/requestPermission') {
    // Auto-deny tool permission prompts in headless mode (safer default).
    // The user can re-run interactively from the ZCode app if needed.
    replyServerRequest(child, msg.id, { decision: 'deny', memory: 'session' });
    return;
  }
  if (method === 'interaction/requestUserInput' || method === 'interaction/requestProviderRuntimeHeaders') {
    replyServerRequest(child, msg.id, { cancelled: true });
    return;
  }
  // Unknown server request: answer empty result to avoid blocking the turn.
  replyServerRequest(child, msg.id, {});
}

/**
 * Build the workspace params for session/create. ZCode keys sessions by
 * workspace; we use the run's cwd so the session is discoverable per project.
 */
// ---------------------------------------------------------------------------
// Tool payload summarization
//
// Live toolCall rows carry the FULL input (Edit old_string/new_string with
// whole file chunks, request configs, …) and full output. Pushing those
// verbatim makes expanded tool cards render as monospace walls on mobile.
// Large payloads are trimmed to a compact summary: identity fields the UI
// can show (file_path / url / command / …) plus size markers.
// ---------------------------------------------------------------------------

function summarizeToolPayload(value, maxLen) {
  try {
    if (typeof value === 'string') {
      if (value.length <= maxLen) return value;
      return `${value.slice(0, maxLen)}\n…[truncated ${value.length - maxLen} chars]`;
    }
    const serialized = JSON.stringify(value ?? {});
    if (serialized.length <= maxLen) return value ?? {};
    const summary = { _truncated: true, _originalSize: serialized.length };
    if (value && typeof value === 'object') {
      const KEY_FIELDS = ['file_path', 'path', 'command', 'url', 'pattern', 'query', 'description', 'prompt', 'content'];
      for (const k of KEY_FIELDS) {
        if (typeof value[k] === 'string') summary[k] = value[k].slice(0, 200);
      }
      for (const [k, v] of Object.entries(value)) {
        if (summary[k] !== undefined) continue;
        if (v === null || typeof v !== 'object') {
          const s = String(v);
          if (s.length <= 120) summary[k] = v;
        }
      }
    }
    return summary;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Live echo suppressor
//
// While an agent turn streams, its assistant text can contain tool-invocation
// echo blocks (🌐 header / blank / 输入 line / ```json params / ``` close, then
// marker lines like *执行中…* / **输出：** / *_result_summary:*). History reads
// strip these via stripInjectedBlocks; the live delta path needs the same
// treatment or clients watch raw JSON walls grow in real time. This state
// machine holds back text from the moment a 🌐 line completes until the block
// closes, so partials never leak. A held "header" that turns out NOT to be
// followed by a json fence is flushed verbatim (rare prose mention of 🌐).
// ---------------------------------------------------------------------------

const ECHO_INPUT_LINE_RE = /^\*{0,2}(?:输入|Input)\s*[：:]\s*\*{0,2}\s*$/;
const ECHO_MARKER_PREFIXES = [
  /^[ \t]*\*{0,2}(?:正在服务器上执行|服务器端执行中|执行中|Executing on server)/,
  /^[ \t]*\*{0,2}(?:输出|Output)\s*[：:]/,
  /^[ \t]*\*{0,2}[A-Za-z_.]*result_summary:?/,
];

class EchoSuppressor {
  // Char-level pass-through. Text streams out IMMEDIATELY except:
  //  - at each line start, the first 3 chars are held just long enough to
  //    decide whether the line opens an echo block (`**🌐` / `🌐`). Beyond
  //    that head, or once ruled out, everything flows through verbatim —
  //    no line buffering, so newline-less paragraphs stream normally.
  //  - inside a confirmed echo block: swallowed whole (header + optional
  //    input label + ```json params via brace scanning + closing fence +
  //    trailing marker lines), then streaming resumes at the next real line.
  constructor() {
    this.state = 'flow';    // flow | head | echo-lines | echo-json | echo-fence | echo-markers
    this.head = '';         // candidate line-head chars being decided
    this.lineBuf = '';      // current line while inside an echo phase
    this.json = null;       // brace/quote scanner state
  }

  /** Feed streamed text; returns clean text to emit now. */
  push(text) {
    let out = '';
    for (const ch of text) {
      if (ch === '\r') continue;
      out += this.char(ch);
    }
    return out;
  }

  char(ch) {
    switch (this.state) {
      case 'flow': {
        if (ch === '\n') return '\n';
        this.head = ch;
        this.state = 'head';
        return this.decideHead();
      }
      case 'head': {
        if (ch === '\n') { const h = this.head; this.head = ''; this.state = 'flow'; return h + '\n'; }
        this.head += ch;
        return this.decideHead();
      }
      case 'echo-lines': {
        if (ch === '\n') { const r = this.echoLine(this.lineBuf + '\n'); this.lineBuf = ''; return r; }
        this.lineBuf += ch;
        return '';
      }
      case 'echo-json': {
        this.feedJson(ch);
        return '';
      }
      case 'echo-fence': {
        if (ch === '\n') { this.state = 'echo-markers'; }
        return '';
      }
      case 'echo-markers': {
        if (ch === '\n') {
          const line = this.lineBuf;
          this.lineBuf = '';
          if (line.trim() === '' || /^```/.test(line.trim()) || ECHO_INPUT_LINE_RE.test(line) || ECHO_MARKER_PREFIXES.some(re => re.test(line))) {
            return ''; // closing fence / trailing markers / blank lines of the block
          }
          // Real text resumes — the line head may itself start a new echo.
          this.state = 'flow';
          let out = '';
          for (const c of line + '\n') out += this.char(c);
          return out;
        }
        this.lineBuf += ch;
        return '';
      }
    }
    return '';
  }

  /** Called with this.head just updated; returns text to emit or '' while still deciding. */
  decideHead() {
    const h = this.head;
    // Echo opener? (up to two leading asterisks then the emoji)
    const bare = h.replace(/^\*{1,2}/, '');
    if (bare.startsWith('🌐')) {
      this.state = 'echo-lines';
      this.lineBuf = '';
      this.sawHeaderTail = false;
      this.head = '';
      return '';
    }
    // Not an echo once we have 3 chars that can't become `**🌐`.
    if (h.length >= 3 || h.includes('\n')) {
      this.head = '';
      this.state = 'flow';
      return h;
    }
    return '';
  }

  /** A complete line inside the echo block. Returns text to flush if it turns out not to be an echo. */
  echoLine(line) {
    // The first complete line is the rest of the detected 🌐 header — consume.
    if (!this.sawHeaderTail) { this.sawHeaderTail = true; return ''; }
    const t = line.trim();
    if (t === '' || ECHO_INPUT_LINE_RE.test(line)) return ''; // envelope padding
    if (/^```json\b/.test(t)) {
      this.json = { depth: 0, inStr: false, escaped: false, started: false };
      this.state = 'echo-json';
      return '';
    }
    // Not an echo block after all (prose mention of 🌐) — release everything held.
    this.state = 'flow';
    let out = '';
    for (const c of line) out += this.char(c);
    return out;
  }

  feedJson(ch) {
    const j = this.json;
    if (!j.started) {
      if (ch === '{' || ch === '[') { j.started = true; j.open = ch; j.close = ch === '{' ? '}' : ']'; j.depth = 1; }
      else if (!/\s/.test(ch)) { this.json = null; this.state = 'flow'; } // not JSON — give up holding
      return;
    }
    if (j.inStr) {
      if (j.escaped) j.escaped = false;
      else if (ch === '\\') j.escaped = true;
      else if (ch === '"') j.inStr = false;
      return;
    }
    if (ch === '"') j.inStr = true;
    else if (ch === j.open) j.depth++;
    else if (ch === j.close) {
      j.depth--;
      if (j.depth === 0) {
        this.json = null;
        this.state = 'echo-fence'; // swallow through end of line + the ``` closer line
      }
    }
  }

  /** End of stream: release a still-undecided head (prose), drop mid-block holds. */
  flush() {
    if (this.state === 'head') { const h = this.head; this.head = ''; this.state = 'flow'; return h; }
    if (this.state === 'echo-lines') {
      // Held only a header line that never formed a block → it was prose.
      this.state = 'flow';
      return '';
    }
    this.state = 'flow';
    this.lineBuf = '';
    return '';
  }
}
const echoSuppressors = new Map();
function getEchoSuppressor(rowId) {
  let s = echoSuppressors.get(rowId);
  if (!s) { s = new EchoSuppressor(); echoSuppressors.set(rowId, s); }
  return s;
}

function buildWorkspaceParams(cwd) {
  const workspacePath = cwd || process.cwd();
  return { workspace: { workspacePath, workspaceKey: workspacePath } };
}

export async function spawnZcode(command, options, writer) {
  const opts = options || {};
  const runtimeSessionId = opts.sessionId || null;
  const cwd = opts.cwd || opts.projectPath || process.cwd();

  const { node, script } = resolveZcodeBinary();
  const args = script ? [script, 'app-server'] : ['app-server'];

  let child;
  try {
    child = spawn(node, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (e) {
    writer.send(createNormalizedMessage({
      id: `zcode-spawn-err-${Date.now()}`,
      sessionId: runtimeSessionId,
      timestamp: new Date().toISOString(),
      provider: PROVIDER,
      kind: 'error',
      content: 'Failed to start ZCode app-server.',
    }));
    notifyRunFailed({ error: e });
    writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: runtimeSessionId, exitCode: 1 }));
    return;
  }

  // stdout line buffer + NDJSON framing.
  let stdoutBuf = '';
  let stderrBuf = '';
  let msgId = 0;
  const pending = new Map(); // id -> {resolvePromise, reject, method}
  writer.__pending = pending;

  let zcodeSessionId = runtimeSessionId;
  let completeSent = false;
  let turnTerminalSeen = false;

  // ----- v4 conversation streaming state -----
  // subscribe -> row deltas give true streaming text (telemetry stream.chunk
  // carries no content; see the protocol notes at the top of this file).
  const v4ConnectionId = `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let v4Subscription = null; // { subscriptionId }
  const rowKinds = new Map(); // rowId -> row.kind (assistantText | reasoning | toolCall | ...)
  const reasoningBuf = new Map(); // reasoning rowId -> accumulated delta text
  let streamedAssistantText = false; // any assistant text delta was emitted

  const sendComplete = (exitCode) => {
    if (completeSent) return;
    completeSent = true;
    writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: zcodeSessionId, exitCode }));
  };

  const cleanup = () => {
    activeZcodeProcesses.delete(zcodeSessionId);
    // Best-effort unsubscribe before teardown (ignored if the child is gone).
    if (v4Subscription && zcodeSessionId) {
      try {
        child.stdin.write(JSON.stringify({
          method: 'v4/conversation/unsubscribe',
          params: { topic: `conversation/${zcodeSessionId}`, subscriptionId: v4Subscription.subscriptionId, connectionId: v4ConnectionId },
        }) + '\n');
      } catch { /* stdin already closed */ }
    }
    try { child.kill(); } catch { /* already dead */ }
  };

  // Register for abort lookup (by provider session id; also by child pid as fallback).
  const handle = { child, aborted: false };
  if (zcodeSessionId) activeZcodeProcesses.set(zcodeSessionId, handle);

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleMessage(msg);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  child.on('error', (error) => {
    // Reject pending requests: on spawn failures (e.g. a non-existent cwd on
    // Windows) the process never exits, so without this the awaited
    // session/create promise hangs forever.
    for (const { reject } of pending.values()) {
      reject(new Error(`ZCode app-server failed to start: ${error?.message ?? error}`));
    }
    pending.clear();

    if (!completeSent) {
      const isNotFound = error && /ENOENT|spawn/.test(error.code || error.message || '');
      writer.send(createNormalizedMessage({
        id: `zcode-err-${Date.now()}`,
        sessionId: zcodeSessionId,
        timestamp: new Date().toISOString(),
        provider: PROVIDER,
        kind: 'error',
        content: isNotFound ? ZCODE_INSTALL_HINT : (error.message || 'ZCode runtime error'),
      }));
      sendComplete(1);
    }
    notifyRunFailed({ error });
    cleanup();
  });

  child.on('exit', (code) => {
    // Resolve all pending requests as errors to avoid hung promises.
    for (const { reject } of pending.values()) {
      reject(new Error(`ZCode app-server exited with code ${code}`));
    }
    pending.clear();

    if (handle.aborted) {
      notifyRunStopped();
      sendComplete(0);
    } else if (!completeSent) {
      // Server died before turn.terminal: surface stderr tail if present.
      const hint = providerAuthService.isProviderInstalled(PROVIDER) ? null : ZCODE_INSTALL_HINT;
      const message = (stderrBuf.trim().slice(-400)) || hint || `ZCode app-server exited (code ${code})`;
      writer.send(createNormalizedMessage({
        id: `zcode-exit-${Date.now()}`,
        sessionId: zcodeSessionId,
        timestamp: new Date().toISOString(),
        provider: PROVIDER,
        kind: 'error',
        content: message,
      }));
      sendComplete(code === 0 ? 1 : code);
    }
    cleanup();
  });

  function handleMessage(msg) {
    // Response to our request (numeric id).
    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        entry.resolvePromise(msg);
      }
      return;
    }

    // Server-to-client request (string id like "server-N").
    if (typeof msg.id === 'string' && msg.method) {
      // Capture sessionId from the very first server request during create.
      if (!zcodeSessionId && msg.params && msg.params.sessionId) {
        zcodeSessionId = msg.params.sessionId;
        handle.zcodeSessionId = zcodeSessionId;
        activeZcodeProcesses.set(zcodeSessionId, handle);
        writer.setSessionId(zcodeSessionId);
        writer.send(createNormalizedMessage({
          id: `zcode-session-${zcodeSessionId}`,
          sessionId: zcodeSessionId,
          timestamp: new Date().toISOString(),
          provider: PROVIDER,
          kind: 'session_created',
          content: zcodeSessionId,
        }));
      }
      handleServerRequest(child, msg, writer);
      return;
    }

    // Notification (method, no id).
    if (msg.method && msg.id === undefined) {
      // v4 conversation frames carry the actual streaming content.
      if (msg.method === 'v4/conversation/frame') {
        handleV4Frame(msg.params);
        const flatFrame = JSON.stringify(msg);
        if (flatFrame.includes('"state":"completedSuccess"')) {
          // Turn-level completion also shows up as a row upsert; do not rely
          // on it alone — telemetry turn.terminal below is the primary signal.
        }
        return;
      }

      // Normalize and forward to the UI.
      const normalized = sessionsService.normalizeMessage(PROVIDER, msg.params || msg, zcodeSessionId);
      for (const m of normalized) writer.send(m);

      // Detect turn end. Two signals: telemetry turn.terminal, or state.updated
      // patching status back to idle after running.
      const flat = JSON.stringify(msg);
      if (flat.includes('"kind":"turn.terminal"') || flat.includes('"status":"idle"')) {
        turnTerminalSeen = true;
      }
      return;
    }
  }

  /**
   * Converts one v4/conversation/frame notification into normalized messages.
   * Verified wire shape (zcode 0.16.x):
   *   { frame: { payload: { kind: 'deltas', deltas: [
   *       { op: 'row.appended'|'row.upserted', row: { rowId, kind, state, ... } },
   *       { op: 'row.delta', rowId, path: 'text', append },
   *   ] } } }
   * Row kinds we care about: assistantText (state streaming→complete),
   * reasoning (same), toolCall (status success/error/...).
   */
  function handleV4Frame(params) {
    const payload = params?.frame?.payload;
    if (!payload || payload.kind !== 'deltas' || !Array.isArray(payload.deltas)) return; // snapshot frames carry no live stream

    for (const d of payload.deltas) {
      try {
        if (d.op === 'row.appended' || d.op === 'row.upserted') {
          const row = d.row;
          if (!row || typeof row.rowId !== 'number') continue;
          rowKinds.set(row.rowId, row.kind);

          if (row.kind === 'reasoning' && row.state === 'complete') {
            const text = reasoningBuf.get(row.rowId) ?? (typeof row.text === 'string' ? row.text : '');
            reasoningBuf.delete(row.rowId);
            if (text.trim()) {
              writer.send(createNormalizedMessage({
                id: `zcode-reasoning-${row.rowId}`,
                sessionId: zcodeSessionId,
                timestamp: new Date().toISOString(),
                provider: PROVIDER,
                kind: 'thinking',
                content: text,
              }));
            }
            continue;
          }

          if (row.kind === 'toolCall' && row.status && row.status !== 'inputStreaming' && row.status !== 'pendingApproval' && row.status !== 'running') {
            const toolId = row.toolCallId ?? `zcode-tool-${row.rowId}`;
            const rawInput = row.input ?? (typeof row.inputText === 'string' ? row.inputText : {});
            const rawOutput = row.output === undefined || row.output === null
              ? null
              : (typeof row.output === 'string' ? row.output : JSON.stringify(row.output));
            writer.send(createNormalizedMessage({
              id: toolId,
              sessionId: zcodeSessionId,
              timestamp: new Date().toISOString(),
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: row.toolName ?? 'Tool',
              toolInput: summarizeToolPayload(rawInput, 1500),
              toolId,
              ...(rawOutput !== null
                ? { toolResult: { content: summarizeToolPayload(rawOutput, 2000), isError: row.status === 'error' } }
                : {}),
            }));
            continue;
          }
          continue;
        }

        if (d.op === 'row.delta' && d.path === 'text' && typeof d.append === 'string') {
          const kind = rowKinds.get(d.rowId);
          if (kind === 'assistantText') {
            streamedAssistantText = true;
            // Echo suppressor: the agent's text may include tool-invocation
            // echo blocks (🌐 header + ```json params). History filters them
            // at read time, but the LIVE stream must suppress them too or
            // clients watch raw JSON walls grow in real time. Feed deltas
            // through a per-row state machine; only clean text is emitted.
            const sup = getEchoSuppressor(d.rowId);
            for (const piece of sup.push(d.append)) {
              if (piece) {
                writer.send(createNormalizedMessage({
                  id: `zcode-delta-${d.rowId}`,
                  sessionId: zcodeSessionId,
                  timestamp: new Date().toISOString(),
                  provider: PROVIDER,
                  kind: 'stream_delta',
                  content: piece,
                }));
              }
            }
          } else if (kind === 'reasoning') {
            reasoningBuf.set(d.rowId, (reasoningBuf.get(d.rowId) ?? '') + d.append);
          }
        }
      } catch {
        // A malformed delta must never break the stream loop.
      }
    }
  }

  // ----- Drive the conversation -----
  try {
    // 1. session/create (new) or session/resume (existing).
    let createRes;
    if (runtimeSessionId) {
      createRes = await request(child, ++msgId, 'session/resume', { sessionId: runtimeSessionId }, writer);
    } else {
      createRes = await request(child, ++msgId, 'session/create', buildWorkspaceParams(cwd), writer);
    }
    if (createRes.error) {
      throw new Error(createRes.error.message || 'session/create failed');
    }

    // sessionId may have been captured from a server request already; otherwise
    // pull it from the create result.
    if (!zcodeSessionId) {
      const result = createRes.result || {};
      zcodeSessionId = result.sessionId || result.session?.sessionId || null;
      if (zcodeSessionId) {
        handle.zcodeSessionId = zcodeSessionId;
        activeZcodeProcesses.set(zcodeSessionId, handle);
        writer.setSessionId(zcodeSessionId);
      }
    }
    if (!zcodeSessionId) {
      throw new Error('ZCode did not return a sessionId');
    }

    // 1.5. Subscribe to the v4 conversation stream BEFORE sending the prompt so
    // early deltas (userInput echo, reasoning, first text chunks) are captured.
    // clientMode "desktop-continuous" keeps all delta paths enabled (the
    // "web-remote-replayable" profile drops everything but bare text).
    try {
      const subRes = await request(child, ++msgId, 'v4/conversation/subscribe', {
        topic: `conversation/${zcodeSessionId}`,
        connectionId: v4ConnectionId,
        clientMode: 'desktop-continuous',
      }, writer);
      if (subRes?.result?.ack?.subscriptionId) {
        v4Subscription = subRes.result.ack;
      } else {
        console.warn('[zcode] v4 subscribe failed, falling back to non-streaming:', JSON.stringify(subRes?.error ?? subRes).slice(0, 200));
      }
    } catch (subError) {
      console.warn('[zcode] v4 subscribe error, falling back to non-streaming:', subError?.message ?? subError);
    }

    // 2. Resolve the model. resolveResumeModel returns the model the user
    // switched to in the planrla UI (per-session override) or an explicitly
    // requested one. Must be awaited — it is async (a missing await here meant
    // the override never reached the CLI, silently breaking model switching).
    const resolvedModel = await providerModelsService.resolveResumeModel(PROVIDER, zcodeSessionId, opts.model);
    const preferredModel = typeof resolvedModel === 'string' && resolvedModel ? resolvedModel : null;

    // 3. Send the prompt.
    const sendParams = { sessionId: zcodeSessionId, content: command };
    let sendRes = await request(child, ++msgId, 'session/send', sendParams, writer);
    if (sendRes.error && isStaleModelError(sendRes.error)) {
      // Self-heal: the session pins a model that is no longer in the
      // workspace's catalog (e.g. GLM-5.3 sessions resumed against a CLI whose
      // catalog only offers GLM-5.2). Re-send with a runtimeModel built from
      // the CURRENT catalog — applying it on send is the app-server's
      // supported rebind path and clears the resume restoreWarning.
      let currentModel = preferredModel;
      if (!currentModel) {
        try {
          currentModel = (await providerModelsService.getCurrentActiveModel(PROVIDER))?.model ?? null;
        } catch { /* catalog fallback below picks an entry */ }
      }
      try {
        const runtimeModel = await buildZcodeRuntimeModel(child, () => ++msgId, buildWorkspaceParams(cwd).workspace, writer, currentModel);
        if (runtimeModel) {
          sendRes = await request(child, ++msgId, 'session/send', {
            ...sendParams,
            runtimeModel,
          }, writer);
        }
      } catch (healError) {
        console.warn(`[zcode] stale-model heal failed: ${healError?.message ?? healError}`);
      }
    }
    if (sendRes.error) {
      throw new Error(sendRes.error.message || 'session/send failed');
    }

    // 4. Wait for turn.terminal (or process exit). Cap at 5 minutes.
    const deadline = Date.now() + 5 * 60 * 1000;
    while (!turnTerminalSeen && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }

    // 5. Pull the full message list and surface the assistant reply.
    // When the v4 stream delivered the text live, the assistant's full-text
    // message is SKIPPED — clients accumulate stream_delta, and appending the
    // whole text again would duplicate it on clients with append semantics.
    try {
      const messagesRes = await request(child, ++msgId, 'session/messages', { sessionId: zcodeSessionId }, writer);
      if (messagesRes.result && Array.isArray(messagesRes.result.messages)) {
        const messages = messagesRes.result.messages;
        for (const message of messages) {
          const normalized = sessionsService.normalizeMessage(PROVIDER, message, zcodeSessionId);
          for (const m of normalized) {
            if (streamedAssistantText && m.kind === 'text' && m.role === 'assistant') continue;
            writer.send(m);
          }
        }
      }
    } catch {
      // session/messages is best-effort; turn.terminal already signalled completion.
    }

    if (streamedAssistantText) {
      // Turn over: flush any text the echo suppressor still holds (an echo
      // block that never closed should not eat trailing prose forever).
      for (const [rowId, sup] of echoSuppressors) {
        const tail = sup.flush();
        if (tail) {
          writer.send(createNormalizedMessage({
            id: `zcode-delta-${rowId}`,
            sessionId: zcodeSessionId,
            timestamp: new Date().toISOString(),
            provider: PROVIDER,
            kind: 'stream_delta',
            content: tail,
          }));
        }
      }
      echoSuppressors.clear();

      // Finalize the streamed bubble (clients mark the last assistant done).
      writer.send(createNormalizedMessage({
        id: `zcode-stream-end-${Date.now()}`,
        sessionId: zcodeSessionId,
        timestamp: new Date().toISOString(),
        provider: PROVIDER,
        kind: 'stream_end',
      }));
    }

    sendComplete(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writer.send(createNormalizedMessage({
      id: `zcode-turn-err-${Date.now()}`,
      sessionId: zcodeSessionId,
      timestamp: new Date().toISOString(),
      provider: PROVIDER,
      kind: 'error',
      content: message,
    }));
    sendComplete(1);
  } finally {
    cleanup();
  }
}

/**
 * Aborts a running ZCode turn by sending session/stop, then killing the
 * app-server process if it does not terminate promptly.
 */
function abortZcodeSession(sessionId) {
  const handle = activeZcodeProcesses.get(sessionId);
  if (!handle) return false;

  handle.aborted = true;
  const { child } = handle;

  // Try graceful stop via the protocol (best-effort, fire-and-forget).
  try {
    child.stdin.write(JSON.stringify({ method: 'session/stop', params: { sessionId } }) + '\n');
  } catch {
    // stdin may be closed; fall through to kill.
  }

  // Hard-kill after a short grace.
  setTimeout(() => {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }, 1500).unref();

  activeZcodeProcesses.delete(sessionId);
  return true;
}

function isZcodeSessionActive(sessionId) {
  return activeZcodeProcesses.has(sessionId);
}

function getActiveZcodeSessions() {
  return Array.from(activeZcodeProcesses.keys());
}

export {
  abortZcodeSession,
  isZcodeSessionActive,
  getActiveZcodeSessions,
};
