(() => {
  const jsonFetch = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) throw new Error(payload?.error || 'Request failed');
    return payload;
  };

  const boot = () => {
    const typeSelect = document.querySelector('#new-site-form select[name="type"]');
    const webserverSelect = document.querySelector('#new-site-form select[name="server"]');
    if (webserverSelect && ![...webserverSelect.options].some((item) => item.value === 'openlitespeed')) {
      const option = document.createElement('option');
      option.value = 'openlitespeed';
      option.textContent = 'OpenLiteSpeed';
      webserverSelect.appendChild(option);
    }
    if (typeSelect && ![...typeSelect.options].some((item) => item.value === 'docker')) {
      const option = document.createElement('option');
      option.value = 'docker';
      option.textContent = 'Docker Compose';
      typeSelect.appendChild(option);
    }
    if (typeSelect && !document.querySelector('input[name="runtime_version"]')) {
      const label = document.createElement('label');
      label.textContent = 'Runtime version';
      const input = document.createElement('input');
      input.name = 'runtime_version';
      input.placeholder = '8.3 or 20';
      label.appendChild(input);
      typeSelect.closest('.form-row')?.insertAdjacentElement('afterend', label);
    }

    const engineSelect = document.querySelector('#database-form select[name="engine"]');
    if (engineSelect && ![...engineSelect.options].some((item) => item.value === 'postgres')) {
      const option = document.createElement('option');
      option.value = 'postgres';
      option.textContent = 'PostgreSQL';
      engineSelect.appendChild(option);
    }

    const terminalView = document.getElementById('terminal-view');
    if (terminalView && !document.getElementById('terminal-output')) {
      terminalView.classList.remove('placeholder-view');
      terminalView.innerHTML = '<div class="page-heading"><div><p class="eyebrow">SYSTEM / TERMINAL</p><h1>Web terminal<span class="heading-period">.</span></h1></div><label class="terminal-site">Site<select id="terminal-site"><option value="">Admin session</option></select></label><label class="cron-enabled-row"><input type="checkbox" id="terminal-escalate" /> Escalate</label><button class="secondary-button" type="button" id="terminal-start">Start session</button></div><pre class="logs-output" id="terminal-output"></pre><form id="terminal-form"><input id="terminal-input" autocomplete="off" /><button class="primary-button" type="submit">Send</button></form>';
    }

    document.getElementById('create-service-button')?.addEventListener('click', async (event) => {
      if (event.currentTarget.dataset.phase2Bound) return;
    }, { once: true });
    const serviceButton = document.getElementById('create-service-button');
    if (serviceButton && !document.getElementById('service-template-select')) {
      const select = document.createElement('select');
      select.id = 'service-template-select';
       [['laravel-queue', 'Laravel queue'], ['horizon', 'Laravel Horizon'], ['fastapi', 'FastAPI'], ['gunicorn', 'Gunicorn'], ['celery', 'Celery'], ['python-worker', 'Python worker'], ['node', 'Node app'], ['aspnet', 'ASP.NET']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
      serviceButton.parentNode?.insertBefore(select, serviceButton);
    }
    let sessionId = '';
    let stream = null;
    document.getElementById('terminal-start')?.addEventListener('click', async () => {
      const siteSelect = document.getElementById('terminal-site');
      if (siteSelect && siteSelect.options.length <= 1) {
        try {
          const sites = await jsonFetch('/api/sites');
          for (const site of sites) {
            const option = document.createElement('option');
            option.value = site.slug;
            option.textContent = `${site.name} (${site.run_as_user || 'iqpanel-' + site.slug})`;
            siteSelect.appendChild(option);
          }
        } catch {}
      }
      const session = await jsonFetch('/api/terminal', {
        method: 'POST',
        body: JSON.stringify({
          site_slug: siteSelect?.value || undefined,
          escalate: Boolean(document.getElementById('terminal-escalate')?.checked),
        }),
      });
      sessionId = session.id;
      if (stream) stream.close();
      stream = new EventSource(`/api/terminal/${session.id}/stream`);
      stream.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const output = document.getElementById('terminal-output');
          if (output) output.textContent += data.chunk || '';
        } catch {}
      };
    });
    document.getElementById('terminal-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!sessionId) return;
      const field = document.getElementById('terminal-input');
      await jsonFetch(`/api/terminal/${sessionId}/input`, { method: 'POST', body: JSON.stringify({ data: `${field.value}\n` }) });
      field.value = '';
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
