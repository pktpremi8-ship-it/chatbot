(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var scriptEl =
    document.currentScript ||
    document.querySelector('script[data-bot-id][src*="widget.js"]');
  if (!scriptEl) return;

  var botId = scriptEl.getAttribute('data-bot-id');
  if (!botId) return;

  var scriptSrc = scriptEl.getAttribute('src') || '';
  var baseUrl = '';
  try {
    baseUrl = new URL(scriptSrc, window.location.href).origin;
  } catch (e) {
    baseUrl = window.location.origin;
  }

  var storageKey = 'kresna_widget_conv_' + botId;
  var conversationId = '';
  try {
    conversationId = window.localStorage.getItem(storageKey) || '';
  } catch (e) {
    conversationId = '';
  }

  var host = document.createElement('div');
  host.setAttribute('data-kresna-widget', botId);
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent =
    ':host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }' +
    '.kresna-root { position: fixed; bottom: 20px; right: 20px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }' +
    '.kresna-root.left { right: auto; left: 20px; align-items: flex-start; }' +
    '.kresna-launcher { width: 56px; height: 56px; border-radius: 9999px; border: none; color: #ffffff; cursor: pointer; box-shadow: 0 10px 28px rgba(15,23,42,0.22); display: flex; align-items: center; justify-content: center; font-size: 22px; transition: transform 140ms ease; }' +
    '.kresna-launcher:hover { transform: scale(1.05); }' +
    '.kresna-panel { width: min(390px, calc(100vw - 24px)); height: min(560px, calc(100vh - 100px)); background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 20px 50px rgba(15,23,42,0.18); display: none; flex-direction: column; overflow: hidden; }' +
    '.kresna-panel.open { display: flex; }' +
    '.kresna-header { padding: 14px 16px; color: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 12px; }' +
    '.kresna-title { font-size: 14px; font-weight: 700; line-height: 1.2; }' +
    '.kresna-subtitle { font-size: 11px; opacity: 0.9; margin-top: 2px; }' +
    '.kresna-close { background: rgba(255,255,255,0.18); border: none; color: #ffffff; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1; }' +
    '.kresna-messages { flex: 1; overflow-y: auto; padding: 14px; background: #f8fafc; display: flex; flex-direction: column; gap: 10px; }' +
    '.kresna-row { display: flex; flex-direction: column; max-width: 86%; }' +
    '.kresna-row.user { align-self: flex-end; align-items: flex-end; }' +
    '.kresna-row.assistant { align-self: flex-start; align-items: flex-start; }' +
    '.kresna-bubble { padding: 10px 13px; border-radius: 12px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }' +
    '.kresna-row.user .kresna-bubble { background: #0f172a; color: #ffffff; }' +
    '.kresna-row.assistant .kresna-bubble { background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; }' +
    '.kresna-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 11px; color: #64748b; }' +
    '.kresna-fb { background: transparent; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px 6px; font-size: 11px; cursor: pointer; color: #475569; }' +
    '.kresna-fb.active { background: #eff6ff; border-color: #1d4ed8; color: #1d4ed8; }' +
    '.kresna-citations { margin-top: 6px; padding: 6px 8px; border-radius: 8px; background: #f1f5f9; font-size: 11px; color: #334155; }' +
    '.kresna-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }' +
    '.kresna-chip { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; border-radius: 9999px; padding: 4px 10px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 120ms ease; }' +
    '.kresna-chip:hover { background: #dbeafe; border-color: #93c5fd; }' +
    '.kresna-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e2e8f0; background: #ffffff; }' +
    '.kresna-input { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: #0f172a; outline: none; }' +
    '.kresna-input:focus { border-color: #1d4ed8; }' +
    '.kresna-send { border: none; border-radius: 8px; padding: 0 14px; font-size: 12px; font-weight: 600; color: #ffffff; cursor: pointer; }' +
    '.kresna-send:disabled { opacity: 0.55; cursor: not-allowed; }' +
    '.kresna-error { padding: 8px 12px; background: #fef2f2; color: #991b1b; font-size: 12px; border-top: 1px solid #fecaca; display: none; }';
  shadow.appendChild(style);

  var root = document.createElement('div');
  root.className = 'kresna-root';

  var panel = document.createElement('div');
  panel.className = 'kresna-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat assistant');

  var header = document.createElement('div');
  header.className = 'kresna-header';
  var headerText = document.createElement('div');
  var titleEl = document.createElement('div');
  titleEl.className = 'kresna-title';
  titleEl.textContent = 'Assistant';
  var subtitleEl = document.createElement('div');
  subtitleEl.className = 'kresna-subtitle';
  subtitleEl.textContent = 'Powered by KRESNA';
  headerText.appendChild(titleEl);
  headerText.appendChild(subtitleEl);

  var closeBtn = document.createElement('button');
  closeBtn.className = 'kresna-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.textContent = '×';
  header.appendChild(headerText);
  header.appendChild(closeBtn);

  var messagesEl = document.createElement('div');
  messagesEl.className = 'kresna-messages';

  var errorBar = document.createElement('div');
  errorBar.className = 'kresna-error';

  var form = document.createElement('form');
  form.className = 'kresna-form';
  var input = document.createElement('input');
  input.className = 'kresna-input';
  input.type = 'text';
  input.placeholder = 'Write a message...';
  input.setAttribute('aria-label', 'Message');
  var sendBtn = document.createElement('button');
  sendBtn.className = 'kresna-send';
  sendBtn.type = 'submit';
  sendBtn.textContent = 'Send';
  form.appendChild(input);
  form.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(messagesEl);
  panel.appendChild(errorBar);
  panel.appendChild(form);

  var launcher = document.createElement('button');
  launcher.className = 'kresna-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat widget');
  launcher.textContent = '💬';

  root.appendChild(panel);
  root.appendChild(launcher);
  shadow.appendChild(root);

  var accent = scriptEl.getAttribute('data-accent') || '#1D4ED8';
  function applyAccent(color) {
    header.style.background = color;
    launcher.style.background = color;
    sendBtn.style.background = color;
  }
  applyAccent(accent);

  function showError(msg) {
    errorBar.textContent = msg;
    errorBar.style.display = msg ? 'block' : 'none';
  }

  function appendMessage(role, text, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'kresna-row ' + role;

    var bubble = document.createElement('div');
    bubble.className = 'kresna-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);

    if (role === 'assistant' && opts.citations && opts.citations.length > 0) {
      var citeBox = document.createElement('div');
      citeBox.className = 'kresna-citations';
      citeBox.textContent = 'Sources: ' + opts.citations.join(' · ');
      row.appendChild(citeBox);
    }

    if (role === 'assistant' && opts.suggestedFollowups && opts.suggestedFollowups.length > 0) {
      var chipsBox = document.createElement('div');
      chipsBox.className = 'kresna-chips';
      opts.suggestedFollowups.forEach(function (chipText) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'kresna-chip';
        chip.textContent = chipText;
        chip.addEventListener('click', function () {
          sendMessage(chipText);
        });
        chipsBox.appendChild(chip);
      });
      row.appendChild(chipsBox);
    }

    if (role === 'assistant' && opts.messageId) {
      var meta = document.createElement('div');
      meta.className = 'kresna-meta';
      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'kresna-fb';
      upBtn.textContent = 'Helpful';
      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'kresna-fb';
      downBtn.textContent = 'Not helpful';

      function sendFb(val) {
        fetch(baseUrl + '/api/widget/' + encodeURIComponent(botId) + '/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: opts.messageId, feedback: val }),
        }).catch(function () {});
        upBtn.className = 'kresna-fb' + (val === 'up' ? ' active' : '');
        downBtn.className = 'kresna-fb' + (val === 'down' ? ' active' : '');
      }

      upBtn.addEventListener('click', function () { sendFb('up'); });
      downBtn.addEventListener('click', function () { sendFb('down'); });
      meta.appendChild(upBtn);
      meta.appendChild(downBtn);
      row.appendChild(meta);
    }

    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { row: row, bubble: bubble };
  }

  var configLoaded = false;
  function loadConfig() {
    if (configLoaded) return Promise.resolve();
    return fetch(baseUrl + '/api/widget/' + encodeURIComponent(botId) + '/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Widget unavailable');
          return data;
        });
      })
      .then(function (cfg) {
        configLoaded = true;
        titleEl.textContent = cfg.title || cfg.name || 'Support Assistant';
        subtitleEl.textContent = cfg.subtitle || 'Online · KRESNA Agent';
        if (cfg.accentColor) applyAccent(cfg.accentColor);
        if (cfg.position === 'bottom-left') {
          root.className = 'kresna-root left';
        }
        if (messagesEl.children.length === 0 && cfg.welcomeMessage) {
          appendMessage('assistant', cfg.welcomeMessage);
        }
      })
      .catch(function (err) {
        showError(err.message || 'Unable to connect widget.');
      });
  }

  var isOpen = false;
  function togglePanel(forceOpen) {
    isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
    panel.className = isOpen ? 'kresna-panel open' : 'kresna-panel';
    if (isOpen) {
      loadConfig();
      input.focus();
    }
  }

  launcher.addEventListener('click', function () { togglePanel(); });
  closeBtn.addEventListener('click', function () { togglePanel(false); });

  function sendMessage(text) {
    text = (text || '').trim();
    if (!text) return;

    showError('');
    input.value = '';
    appendMessage('user', text);
    sendBtn.disabled = true;

    var pending = appendMessage('assistant', 'Thinking...');
    var streamedText = '';

    fetch(baseUrl + '/api/widget/' + encodeURIComponent(botId) + '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message: text,
        conversationId: conversationId || undefined,
      }),
    })
      .then(function (res) {
        var ct = res.headers.get('content-type') || '';
        if (!res.ok) {
          return res.json().then(function (d) {
            throw new Error(d.error || 'Widget request failed');
          });
        }

        if (ct.indexOf('text/event-stream') !== -1 && res.body) {
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) return;
              buffer += decoder.decode(chunk.value, { stream: true });
              var events = buffer.split('\n\n');
              buffer = events.pop() || '';
              events.forEach(function (evBlock) {
                var lines = evBlock.split('\n');
                var eventType = 'message';
                var dataLine = '';
                lines.forEach(function (line) {
                  if (line.indexOf('event: ') === 0) eventType = line.slice(7).trim();
                  if (line.indexOf('data: ') === 0) dataLine += line.slice(6);
                });
                if (!dataLine) return;
                try {
                  var payload = JSON.parse(dataLine);
                  if (eventType === 'token' && payload.token) {
                    streamedText += payload.token;
                    pending.bubble.textContent = streamedText;
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  } else if (eventType === 'done') {
                    if (payload.conversationId) {
                      conversationId = payload.conversationId;
                      try { window.localStorage.setItem(storageKey, conversationId); } catch (e) {}
                    }
                    pending.row.remove();
                    appendMessage('assistant', payload.content || streamedText, {
                      messageId: payload.messageId,
                      citations: payload.citations || [],
                      suggestedFollowups: payload.suggestedFollowups || [],
                    });
                  } else if (eventType === 'error') {
                    showError(payload.error || 'Assistant error');
                  }
                } catch (parseErr) {}
              });
              return pump();
            });
          }
          return pump();
        }

        return res.json().then(function (data) {
          if (data.conversationId) {
            conversationId = data.conversationId;
            try { window.localStorage.setItem(storageKey, conversationId); } catch (e) {}
          }
          pending.row.remove();
          appendMessage('assistant', data.assistantMessage.content, {
            messageId: data.assistantMessage.id,
            citations: data.citations || [],
            suggestedFollowups: data.suggestedFollowups || [],
          });
        });
      })
      .catch(function (err) {
        pending.row.remove();
        showError(err.message || 'Could not reach KRESNA assistant.');
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    sendMessage(input.value);
  });

  if (scriptEl.getAttribute('data-open') === 'true') {
    togglePanel(true);
  }
})();
