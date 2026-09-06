
  const loadDatabases = async () => {
    const items = await api("/api/databases");
    state.databases = items;
    const list = $("#databases-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No databases yet.");
      return;
    }
    list.innerHTML = items.map((db) => `<div class="data-row"><span><strong>${escapeHtml(db.db_name)}</strong><small>${escapeHtml(db.engine)} · ${escapeHtml(db.db_user)}</small></span><div class="row-actions"><button type="button" class="secondary-button" data-db-dump="${escapeHtml(db.id)}">Dump</button><button type="button" class="secondary-button" data-db-delete="${escapeHtml(db.id)}">Delete</button></div></div>`).join("");
  };
