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

  const statusClass = (status) => (status === 'online' ? 'badge-ok' : status === 'offline' ? 'badge-warn' : '');

  const ensureSiteServerField = (servers, activeId) => {
    const form = document.querySelector('#new-site-form');
    if (!form || document.querySelector('#site-server-select')) return;
    const label = document.createElement('label');
    label.textContent = 'Target server';
    const select = document.createElement('select');
    select.id = 'site-server-select';
    select.name = 'server_id';
    servers.forEach((server) => {
      const option = document.createElement('option');
      option.value = server.id;
      option.textContent = `${server.name} (${server.status || 'unknown'})`;
      if (server.id === activeId) option.selected = true;
      select.appendChild(option);
    });
    label.appendChild(select);
    form.querySelector('.form-row')?.insertAdjacentElement('afterend', label);
  };

  const renderServerSwitcher = (servers, activeId) => {
    const switcher = document.querySelector('.server-switcher');
    if (!switcher) return;
    let select = document.querySelector('#active-server-select');
    if (!select) {
      switcher.innerHTML = '<span class="server-pulse" id="server-pulse"></span><div><small>Connected server</small><select id="active-server-select" class="server-select"></select></div>';
      select = document.querySelector('#active-server-select');
      select.addEventListener('change', async () => {
        try {
          await jsonFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ active_server_id: select.value }) });
        } catch (error) {
          console.error(error);
        }
      });
    }
    const active = servers.find((item) => item.id === activeId) || servers[0];
    select.innerHTML = servers.map((server) => `<option value="${server.id}">${server.name}</option>`).join('');
    select.value = active?.id || 'local';
    const pulse = document.querySelector('#server-pulse');
    if (pulse) pulse.className = `server-pulse ${active?.status === 'online' ? 'online' : 'offline'}`;
    const label = document.querySelector('#server-label');
    if (label) label.textContent = active?.status === 'online' ? 'Connected' : 'Disconnected';
  };

  const renderSettingsServers = (servers) => {
    const panel = document.querySelector('#settings-view .settings-panel');
    if (!panel || document.querySelector('#remote-servers-panel')) return;
    const block = document.createElement('div');
    block.id = 'remote-servers-panel';
    block.className = 'settings-servers panel';
    block.innerHTML = `
      <div class="panel-heading"><div><h2>Managed servers</h2><p>Register remote Agents for multi-server routing.</p></div></div>
      <div class="data-list" id="remote-servers-list"></div>
      <form id="remote-server-form" class="remote-server-form">
        <label>Name<input name="name" required placeholder="Edge VM" /></label>
        <div class="form-row">
          <label>Host<input name="host" required placeholder="10.0.0.8" /></label>
          <label>Port<input name="port" type="number" value="4174" min="1" max="65535" /></label>
        </div>
        <label>Agent token<input name="token" required type="password" autocomplete="new-password" /></label>
        <div class="modal-actions"><button class="primary-button" type="submit">Register server</button></div>
      </form>`;
    panel.appendChild(block);

    const list = () => document.querySelector('#remote-servers-list');
    const paint = (items) => {
      list().innerHTML = items.map((server) => `
        <div class="data-row">
          <span><strong>${server.name}</strong><small>${server.host}:${server.port} · ${server.kind}</small></span>
          <span class="badge ${statusClass(server.status)}">${server.status || 'unknown'}</span>
          <div class="row-actions">
            ${server.id !== 'local' ? `<button type="button" class="secondary-button" data-probe-server="${server.id}">Probe</button><button type="button" class="secondary-button" data-delete-server="${server.id}">Remove</button>` : '<small>Local Agent</small>'}
          </div>
        </div>`).join('');
      list().querySelectorAll('[data-probe-server]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const result = await jsonFetch(`/api/servers/${button.dataset.probeServer}/probe`, { method: 'POST', body: '{}' });
            button.closest('.data-row').querySelector('.badge').textContent = result.status;
            button.closest('.data-row').querySelector('.badge').className = `badge ${statusClass(result.status)}`;
          } catch (error) {
            alert(error.message);
          }
        });
      });
      list().querySelectorAll('[data-delete-server]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!confirm('Remove this server registration?')) return;
          try {
            await jsonFetch(`/api/servers/${button.dataset.deleteServer}`, { method: 'DELETE' });
            const refreshed = await jsonFetch('/api/servers');
            paint(refreshed);
          } catch (error) {
            alert(error.message);
          }
        });
      });
    };
    paint(servers);

    document.querySelector('#remote-server-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      payload.port = Number(payload.port || 4174);
      try {
        await jsonFetch('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
        event.currentTarget.reset();
        const refreshed = await jsonFetch('/api/servers');
        paint(refreshed);
        ensureSiteServerField(refreshed, refreshed.find((item) => item.kind === 'local')?.id || 'local');
        renderServerSwitcher(refreshed, 'local');
      } catch (error) {
        alert(error.message);
      }
    });
  };

  const boot = async () => {
    try {
      const dashboard = await jsonFetch('/api/dashboard');
      const servers = dashboard.servers || await jsonFetch('/api/servers');
      const activeId = dashboard.active_server_id || dashboard.server?.active_server_id || 'local';
      ensureSiteServerField(servers, activeId);
      renderServerSwitcher(servers, activeId);
      renderSettingsServers(servers);
    } catch {
      /* dashboard may require auth first */
    }
  };

  const schedule = () => {
    const shell = document.getElementById('app-shell');
    if (window.iqpanelAuthed || (shell && !shell.hidden)) boot();
    else window.addEventListener('iqpanel:authed', boot, { once: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();
