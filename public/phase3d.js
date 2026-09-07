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
    if (!response.ok) {
      const error = new Error(payload?.error || 'Request failed');
      error.status = response.status;
      error.body = payload;
      throw error;
    }
    return payload;
  };

  const escapeHtml = (value) => {
    if (window.IQPanelUI?.escapeHtml) return window.IQPanelUI.escapeHtml(value);
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const pending = { retry: null };

  const confirmReauth = async () => {
    const modal = document.getElementById('reauth-modal');
    if (!modal) throw new Error('Re-authentication required');
    modal.hidden = false;
    return new Promise((resolve, reject) => {
      pending.retry = { resolve, reject };
    });
  };

  const originalFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const response = await originalFetch(input, init);
    if (response.status !== 403) return response;
    const clone = response.clone();
    let payload = {};
    try { payload = await clone.json(); } catch {}
    if (!payload.reauth_required || pending.retry) return response;
    try {
      await confirmReauth();
      return originalFetch(input, init);
    } catch {
      return response;
    }
  };

  const renderTeam = async () => {
    const list = document.getElementById('team-list');
    if (!list) return;
    try {
      const members = await jsonFetch('/api/users');
      list.innerHTML = members.map((user) => `
        <div class="data-row">
          <span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)} · ${escapeHtml(user.role)}${user.totp_enabled ? ' · 2FA' : ''}</small></span>
          <div class="row-actions">
            <button type="button" class="secondary-button" data-delete-user="${escapeHtml(user.id)}">Remove</button>
          </div>
        </div>`).join('') || '<div class="data-row empty-row"><span>No team members yet.</span></div>';
      list.querySelectorAll('[data-delete-user]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!confirm('Remove this user?')) return;
          try {
            await jsonFetch(`/api/users/${button.dataset.deleteUser}`, { method: 'DELETE' });
            await renderTeam();
          } catch (error) {
            alert(error.message);
          }
        });
      });
    } catch {
      list.innerHTML = '<div class="data-row empty-row"><span>Team management requires an admin session.</span></div>';
    }
  };

  const renderAudit = async (params = '') => {
    const list = document.getElementById('audit-list');
    if (!list) return;
    const payload = await jsonFetch(`/api/audit${params}`);
    list.innerHTML = (payload.items || []).map((item) => `
      <div class="data-row">
        <span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.actor_email || 'system')} · ${escapeHtml(item.target)} · ${escapeHtml(item.created_at)}</small></span>
        <span>${escapeHtml(item.details || '')}</span>
      </div>`).join('') || '<div class="data-row empty-row"><span>No audit events yet.</span></div>';
  };

  const boot = () => {
    document.getElementById('reauth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const errorEl = document.getElementById('reauth-error');
      try {
        await jsonFetch('/api/reauth', { method: 'POST', body: JSON.stringify({ password: form.get('password'), totp: form.get('totp') || undefined }) });
        document.getElementById('reauth-modal').hidden = true;
        pending.retry?.resolve();
        pending.retry = null;
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
    });

    document.getElementById('team-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (!payload.password) delete payload.password;
      try {
        const created = await jsonFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
        event.currentTarget.reset();
        if (created.password) alert(`Temporary password: ${created.password}`);
        await renderTeam();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById('settings-2fa')?.addEventListener('click', async () => {
      try {
        const begin = await jsonFetch('/api/account/2fa/begin', { method: 'POST', body: '{}' });
        const code = prompt(`Scan or enter this secret, then type a 6-digit code.\n${begin.secret}\nBackup codes:\n${begin.backup_codes.join('\n')}`);
        if (!code) return;
        await jsonFetch('/api/account/2fa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
        alert('Two-factor authentication is on.');
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById('audit-filter')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const query = new URLSearchParams();
      if (form.get('action')) query.set('action', form.get('action'));
      if (form.get('target')) query.set('target', form.get('target'));
      await renderAudit(`?${query}`);
    });

    document.querySelector('[data-view="audit"]')?.addEventListener('click', () => {
      renderAudit().catch(() => {});
    });
    document.querySelector('[data-view="settings"]')?.addEventListener('click', () => {
      renderTeam().catch(() => {});
      jsonFetch('/api/session').then((session) => {
        const label = document.getElementById('settings-user');
        if (label && session.user) label.textContent = `${session.user.email} (${session.user.role})`;
      }).catch(() => {});
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
