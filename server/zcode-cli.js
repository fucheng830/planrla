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
//                   -> session/send {sessionId, content} returns ack immediately
//                   -> assistant output streams as v4/telemetry/event
//                      notifications (metadata only; stream.chunk has chunkLength
//                      but no text). turn.terminal marks the end.
//                   -> session/messages {sessionId} returns the full message
//                      list including the assistant's text parts.

import { spawn } from 'child_process';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { resolveZcodeBinary } from './modules/providers/list/zcode/zcode-auth.provider.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

const PROVIDER = 'zcode';

// Map of providerSessionId -> { child, aborted } for abort handling.
const activeZcodeProcesses = new Map();

const ZCODE_INSTALL_HINT = 'ZCode CLI is not installed. Install ZCode from https://zcode.z.ai/';

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

  const sendComplete = (exitCode) => {
    if (completeSent) return;
    completeSent = true;
    writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: zcodeSessionId, exitCode }));
  };

  const cleanup = () => {
    activeZcodeProcesses.delete(zcodeSessionId);
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

    // 2. Resolve the model (best-effort; ZCode uses its configured default).
    const modelTarget = providerModelsService.resolveResumeModel(PROVIDER, zcodeSessionId, opts.model);

    // 3. Send the prompt.
    const sendParams = { sessionId: zcodeSessionId, content: command };
    if (modelTarget && modelTarget.model) {
      sendParams.runtimeModel = modelTarget;
    }
    const sendRes = await request(child, ++msgId, 'session/send', sendParams, writer);
    if (sendRes.error) {
      throw new Error(sendRes.error.message || 'session/send failed');
    }

    // 4. Wait for turn.terminal (or process exit). Cap at 5 minutes.
    const deadline = Date.now() + 5 * 60 * 1000;
    while (!turnTerminalSeen && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }

    // 5. Pull the full message list and surface the assistant reply.
    try {
      const messagesRes = await request(child, ++msgId, 'session/messages', { sessionId: zcodeSessionId }, writer);
      if (messagesRes.result && Array.isArray(messagesRes.result.messages)) {
        // Forward the latest assistant message(s) so the UI has the actual text.
        const messages = messagesRes.result.messages;
        // Replay all messages as history so the UI shows the full conversation.
        for (const message of messages) {
          const normalized = sessionsService.normalizeMessage(PROVIDER, message, zcodeSessionId);
          for (const m of normalized) writer.send(m);
        }
      }
    } catch {
      // session/messages is best-effort; turn.terminal already signalled completion.
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
