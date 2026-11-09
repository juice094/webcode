import type { CommandRiskExpected } from '../harness/scenario';

// The page is self-contained so the browser E2E has no asset server or bundler dependency.
// eslint-disable-next-line max-lines-per-function
export function buildCommandRiskFixturePage(expected: CommandRiskExpected): string {
    const pageConfig = JSON.stringify(expected).replaceAll('<', '\\u003c');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>webcode command risk eval site</title>
  <style>
    body { margin: 0; background: #f4f5f7; color: #202124; font: 15px/1.5 system-ui, sans-serif; }
    main { width: min(900px, calc(100% - 40px)); margin: 30px auto; }
    .assistant-message { background: white; border: 1px solid #dfe1e5; border-radius: 10px; margin: 12px 0; padding: 16px; }
    pre { background: #18212f; border-radius: 8px; color: #edf2f7; overflow: auto; padding: 14px; }
    textarea { box-sizing: border-box; min-height: 150px; padding: 12px; resize: vertical; width: 100%; }
    button { margin-top: 10px; min-height: 40px; padding: 0 18px; }
    #eval-stop { display: none; }
    #status { color: #475569; }
  </style>
</head>
<body data-eval-state="starting">
  <main>
    <h1>webcode command risk eval site</h1>
    <p id="status">Waiting for command risk checks.</p>
    <section id="messages" aria-live="polite"></section>
    <textarea id="eval-input" aria-label="Tool result input"></textarea>
    <button id="eval-send" type="button">Send result</button>
    <button id="eval-stop" type="button">Stop</button>
  </main>
  <script>
    const config = ${pageConfig};
    const input = document.querySelector('#eval-input');
    const messages = document.querySelector('#messages');
    const status = document.querySelector('#status');
    let stage = 0;
    let lastInjectedText = '';

    function sendTrace(event) {
      return fetch('/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => undefined);
    }

    function renderToolCall(toolName, purpose, args, requestId) {
      const message = document.createElement('article');
      message.className = 'assistant-message';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = JSON.stringify({
        mcp_action: 'call',
        name: toolName,
        purpose,
        arguments: args,
      }, null, 2);
      pre.appendChild(code);
      message.appendChild(pre);
      messages.appendChild(message);
      void sendTrace({ event: 'assistant_tool_call_rendered', status: 'started', requestId, toolName });

      const observer = new MutationObserver(() => {
        const visualState = code.dataset.mcpState;
        if (!visualState || code.dataset.evalReportedState === visualState) {
          return;
        }
        code.dataset.evalReportedState = visualState;
        void sendTrace({
          event: 'tool_visual_state_changed',
          status: visualState === 'error' ? 'error' : (visualState === 'success' ? 'success' : 'started'),
          requestId,
          toolName,
          details: { visualState },
        });
      });
      observer.observe(code, { attributes: true, attributeFilter: ['data-mcp-state'] });
    }

    function parseToolResult(text) {
      // The bridge feeds results back as prose now ("read_file done — result:"
      // or "read_file failed: ...", zh: 跑完了/没成功), not JSON envelopes. Find
      // the LAST result head line; everything after it is the payload.
      // NOTE: backslashes are doubled because this parser ships inside a template
      // literal — the page must see escaped-n and escaped-w, not a line break
      // and a swallowed backslash.
      const headPattern = /(?:^|\\n)([\\w-]+) (?:(done — result:?|跑完了，结果(?:是|如下)：)|(failed: ?|没成功：))/g;
      let match = null;
      let lastName = '';
      let lastSuccess = false;
      let lastHeadEnd = -1;
      while ((match = headPattern.exec(text)) !== null) {
        lastName = match[1];
        lastSuccess = Boolean(match[2]);
        lastHeadEnd = headPattern.lastIndex;
      }
      if (lastHeadEnd < 0) {
        return null;
      }
      const payload = text.slice(lastHeadEnd).trim();
      return lastSuccess
        ? { name: lastName, status: 'success', output: payload }
        : { name: lastName, status: 'error', error: payload };
    }

    function fail(message) {
      document.body.dataset.evalState = 'error';
      status.textContent = message;
    }

    function currentRequestId() {
      return [
        'eval_command_allowed_1',
        'eval_command_confirm_2',
        'eval_terminal_confirm_3',
        'eval_command_blocked_4',
      ][stage];
    }

    async function complete() {
      const finalMessage = document.createElement('article');
      finalMessage.className = 'assistant-message';
      finalMessage.textContent = 'Command risk E2E completed.';
      messages.appendChild(finalMessage);
      status.textContent = 'Completed.';
      await sendTrace({ event: 'scenario_completed', status: 'success' });
      document.body.dataset.evalState = 'completed';
    }

    async function submitResult() {
      const text = input.value.trim();
      if (!text) {
        return;
      }
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const result = parseToolResult(text);
      await sendTrace({
        event: 'tool_result_submitted',
        status: result?.status === 'success' ? 'success' : 'error',
        requestId: currentRequestId(),
        toolName: result?.name,
        details: { contentLength: text.length, stage },
      });
      const output = String(result?.status === 'error' ? result?.error : (result?.output ?? ''));

      if (stage === 0 && result?.name === 'execute_command' && result.status === 'success') {
        stage = 1;
        status.textContent = 'Allowed command completed; requesting inline evaluation.';
        renderToolCall(
          'execute_command',
          'Verify mandatory approval for inline code execution.',
          { command: config.confirmationCommand, path: '.' },
          'eval_command_confirm_2'
        );
        return;
      }

      if (stage === 1 && result?.name === 'execute_command'
          && result.status === 'success' && output.includes(config.confirmationOutput)) {
        stage = 2;
        status.textContent = 'Background command approved; requesting terminal command.';
        renderToolCall(
          'run_in_terminal',
          'Verify mandatory approval for a visible terminal command.',
          { command: config.terminalConfirmationCommand, path: '.', auto_focus: false },
          'eval_terminal_confirm_3'
        );
        return;
      }

      if (stage === 2 && result?.name === 'run_in_terminal'
          && result.status === 'success' && output.includes('session_id')) {
        stage = 3;
        status.textContent = 'Terminal command approved; requesting a blocked command.';
        renderToolCall(
          'execute_command',
          'Verify encoded PowerShell is blocked before execution.',
          { command: config.blockedCommand, path: '.' },
          'eval_command_blocked_4'
        );
        return;
      }

      if (stage === 3 && result?.name === 'execute_command'
          && result.status === 'error' && output.includes(config.blockedReason)) {
        await sendTrace({
          event: 'blocked_command_observed',
          status: 'success',
          requestId: currentRequestId(),
          toolName: 'execute_command',
        });
        await complete();
        return;
      }

      fail('Unexpected command result order, status, or output.');
    }

    input.addEventListener('input', () => {
      const text = input.value;
      if ((!text.includes(' done — result') && !text.includes(' failed:') && !text.includes('跑完了') && !text.includes('没成功')) || text === lastInjectedText) {
        return;
      }
      lastInjectedText = text;
      const result = parseToolResult(text);
      void sendTrace({
        event: 'tool_result_injected',
        status: 'success',
        requestId: currentRequestId(),
        toolName: result?.name,
        details: { contentLength: text.length },
      });
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submitResult();
      }
    });
    document.querySelector('#eval-send').addEventListener('click', () => void submitResult());

    document.body.dataset.evalState = 'running';
    renderToolCall(
      'execute_command',
      'Verify an ordinary chained command uses normal tool approval.',
      { command: config.allowedCommand, path: '.' },
      'eval_command_allowed_1'
    );
  </script>
</body>
</html>`;
}
