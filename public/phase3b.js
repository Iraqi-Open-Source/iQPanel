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

  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const enhanceDeployments = () => {
    const original = window.loadDeployments;
    if (!original || window.__phase3bDeployments) return;
    window.__phase3bDeployments = true;
    window.loadDeployments = async () => {
      const items = await jsonFetch('/api/deployments');
      const list = document.querySelector('#deployments-list');
      if (!list) return;
      if (!items.length) {
        list.innerHTML = '<div class="data-row"><span>No deployments yet.</span></div>';
        return;
      }
      list.innerHTML = items.map((item) => `
        <div class="data-row deployment-row">
          <span>
            <strong>${escapeHtml(item.site_name || item.site_slug || 'Site')}</strong>
            <small>${escapeHtml(item.triggered_by || 'admin')}${item.commit_sha ? ` · ${escapeHtml(item.commit_sha.slice(0, 7))}` : ''}</small>
          </span>
          <span class="badge ${item.status === 'succeeded' ? 'badge-ok' : item.status === 'failed' ? 'badge-warn' : ''}">${escapeHtml(item.status || 'queued')}</span>
          <code>${escapeHtml((item.log || '').slice(0, 120))}</code>
          <div class="row-actions">
            ${item.status === 'succeeded' && item.commit_sha && item.site_slug ? `<button type="button" class="secondary-button" data-rollback="${escapeHtml(item.id)}" data-site="${escapeHtml(item.site_slug)}">Rollback</button>` : ''}
          </div>
        </div>`).join('');
      list.querySelectorAll('[data-rollback]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!confirm('Roll back this site to the selected deployment commit?')) return;
          try {
            await jsonFetch(`/api/sites/${encodeURIComponent(button.dataset.site)}/deployments/${button.dataset.rollback}/rollback`, { method: 'POST', body: '{}' });
            alert('Rollback queued');
            await window.loadDeployments();
          } catch (error) {
            alert(error.message);
          }
        });
      });
    };
  };

  const renderDeploySettings = async () => {
    const view = document.querySelector('#deployments-view .page-heading');
    if (!view || document.querySelector('#deploy-settings-panel')) return;
    const sites = await jsonFetch('/api/sites');
    const panel = document.createElement('div');
    panel.id = 'deploy-settings-panel';
    panel.className = 'settings-panel panel';
    panel.innerHTML = `
      <div class="panel-heading"><div><h2>GitHub webhooks</h2><p>Auto-deploy on push to the configured branch.</p></div></div>
      <label class="search-box logs-site-label">Site
        <select id="deploy-settings-site"></select>
      </label>
      <div class="data-row"><span>Deploy branch</span><input id="deploy-branch-input" placeholder="main" /></div>
      <div class="data-row"><span>Webhook URL</span><code id="deploy-webhook-url">—</code></div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" id="deploy-branch-save">Save branch</button>
        <button type="button" class="secondary-button" id="deploy-webhook-rotate">Rotate webhook secret</button>
      </div>`;
    view.insertAdjacentElement('afterend', panel);

    const select = panel.querySelector('#deploy-settings-site');
    sites.forEach((site) => {
      const option = document.createElement('option');
      option.value = site.slug;
      option.textContent = site.name;
      select.appendChild(option);
    });

    const refresh = async () => {
      const slug = select.value;
      if (!slug) return;
      const config = await jsonFetch(`/api/sites/${encodeURIComponent(slug)}/webhook`);
      panel.querySelector('#deploy-branch-input').value = config.deploy_branch || 'main';
      panel.querySelector('#deploy-webhook-url').textContent = config.webhook_url || '—';
    };

    select.addEventListener('change', refresh);
    panel.querySelector('#deploy-branch-save').addEventListener('click', async () => {
      const slug = select.value;
      const deploy_branch = panel.querySelector('#deploy-branch-input').value;
      await jsonFetch(`/api/sites/${encodeURIComponent(slug)}/deploy`, {
        method: 'PATCH',
        body: JSON.stringify({ deploy_branch }),
      });
      await refresh();
    });
    panel.querySelector('#deploy-webhook-rotate').addEventListener('click', async () => {
      const slug = select.value;
      await jsonFetch(`/api/sites/${encodeURIComponent(slug)}/webhook/rotate`, { method: 'POST', body: '{}' });
      alert('Webhook secret rotated. Update the secret in GitHub repository settings.');
      await refresh();
    });
    if (select.value) await refresh();
  };

  const boot = () => {
    enhanceDeployments();
    renderDeploySettings().catch(() => {});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
