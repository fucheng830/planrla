import { spawn } from 'child_process';

import crossSpawn from 'cross-spawn';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { resolveKimiBinary } from './modules/providers/list/kimi/kimi-auth.provider.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const activeKimiProcesses = new Map();

const KIMI_INSTALL_HINT = 'Kimi Code CLI is not installed. Install it from https://code.kimi.com/';

function readKimiSessionId(event) {
  // `kimi -p --output-format stream-json` reports the session id once, in the
  // trailing meta line: {"role":"meta","type":"session.resume_hint","session_id":"..."}.
  if (!event || typeof event !== 'object') {
    return null;
  }

  if (event.role === 'meta' && event.type === 'session.resume_hint') {
    return event.session_id || null;
  }

  return event.sessionId || event.session_id || null;
}

async function spawnKimi(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, sessionSummary } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let kimiProcess = null;
    // kimi writes thinking/tool progress to stderr even on healthy runs, so it
    // cannot be streamed to the UI as an error. Keep a small tail to attach to
    // genuine failure messages instead.
    const stderrTail = [];
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;
    // kimi `-p --output-format stream-json` emits the full assistant reply as
    // one JSON line, so the UI never sees a real stream. Break the complete
    // content into small chunks and emit them as timed stream_delta frames so
    // mobile and web clients render the reply progressively.
    const deltaQueue = [];
    let isFlushingDeltas = false;
    const flushWaiters = new Set();

    const flushDeltaQueue = async () => {
      if (isFlushingDeltas) return;
      isFlushingDeltas = true;
      while (deltaQueue.length > 0) {
        const { content, targetSessionId } = deltaQueue.shift();
        const chars = Array.from(content);
        const chunkSize = 12;
        const delayMs = 16;
        for (let i = 0; i < chars.length; i += chunkSize) {
          const chunk = chars.slice(i, i + chunkSize).join('');
          ws.send(createNormalizedMessage({
            kind: 'stream_delta',
            content: chunk,
            sessionId: targetSessionId,
            provider: 'kimi',
          }));
          if (i + chunkSize < chars.length) {
            await new Promise((resolve) => { setTimeout(resolve, delayMs); });
          }
        }
      }
      isFlushingDeltas = false;
      for (const waiter of flushWaiters) {
        waiter();
      }
      flushWaiters.clear();
    };

    const enqueueStreamDelta = (content, targetSessionId) => {
      deltaQueue.push({ content, targetSessionId });
      if (!isFlushingDeltas) flushDeltaQueue();
    };

    const waitForDeltaFlush = async () => {
      while (isFlushingDeltas || deltaQueue.length > 0) {
        if (!isFlushingDeltas) flushDeltaQueue();
        await new Promise((resolve) => { flushWaiters.add(resolve); });
      }
    };

    const rememberStderr = (text) => {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          stderrTail.push(line.trim());
        }
      }
      if (stderrTail.length > 20) {
        stderrTail.splice(0, stderrTail.length - 20);
      }
    };

    const readStderrTail = () => stderrTail.join('\n').trim();

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'kimi',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'kimi',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Kimi Code CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      if (processKey !== capturedSessionId && kimiProcess) {
        activeKimiProcesses.delete(processKey);
        activeKimiProcesses.set(capturedSessionId, kimiProcess);
      }
      if (kimiProcess) {
        kimiProcess.sessionId = capturedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!sessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'kimi',
        }));
      }
    };

    const processKimiOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'kimi',
        }));
        return;
      }

      try {
        registerSession(readKimiSessionId(response));
        const normalized = sessionsService.normalizeMessage(
          'kimi',
          response,
          capturedSessionId || sessionId || null,
        );
        for (const msg of normalized) {
          if (msg.kind === 'stream_delta' && typeof msg.content === 'string' && msg.content.length > 0) {
            enqueueStreamDelta(msg.content, msg.sessionId || capturedSessionId || sessionId || null);
          } else {
            ws.send(msg);
          }
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Kimi] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'kimi',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('kimi', sessionId, model).then((resolvedModel) => {
      // kimi -p runs one prompt non-interactively under the CLI's own auto
      // permission policy; --yolo/--auto/--plan cannot be combined with -p.
      const args = ['-p', command && command.trim() ? command.trim() : '', '--output-format', 'stream-json'];
      if (sessionId) {
        args.push('--session', sessionId);
      }
      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }

      kimiProcess = spawnFunction(resolveKimiBinary(), args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeKimiProcesses.set(processKey, kimiProcess);
      kimiProcess.sessionId = processKey;
      kimiProcess.stdin.end();

      kimiProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processKimiOutputLine(line.trim());
        });
      });

      kimiProcess.stderr.on('data', (data) => {
        rememberStderr(data.toString());
      });

      kimiProcess.on('close', async (code) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeKimiProcesses.delete(finalSessionId);
        activeKimiProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processKimiOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        // Wait for any staged stream_delta chunks to leave the wire before
        // sending the terminal complete, otherwise clients mark the run done
        // while text is still typing out.
        await waitForDeltaFlush();

        if (code !== 0 && code !== null) {
          const stderrText = readStderrTail();
          if (stderrText) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: stderrText,
              sessionId: finalSessionId,
              provider: 'kimi',
            }));
          }
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !kimiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'kimi', sessionId: finalSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('kimi');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: KIMI_INSTALL_HINT,
              sessionId: finalSessionId,
              provider: 'kimi',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Kimi Code CLI process was terminated' : `Kimi Code CLI exited with code ${code}`));
      });

      kimiProcess.on('error', async (error) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeKimiProcesses.delete(finalSessionId);
        activeKimiProcesses.delete(processKey);

        const installed = await providerAuthService.isProviderInstalled('kimi');
        const errorContent = !installed ? KIMI_INSTALL_HINT : error.message;

        await waitForDeltaFlush();

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'kimi',
        }));
        if (!completeSent && !kimiProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'kimi', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortKimiSession(sessionId) {
  const process = activeKimiProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeKimiProcesses.delete(sessionId);
  return true;
}

function isKimiSessionActive(sessionId) {
  return activeKimiProcesses.has(sessionId);
}

function getActiveKimiSessions() {
  return Array.from(activeKimiProcesses.keys());
}

export {
  spawnKimi,
  abortKimiSession,
  isKimiSessionActive,
  getActiveKimiSessions,
};
