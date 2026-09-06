
  const loadBackups = async () => {
    const items = await api("/api/backups");
    const list = $("#backups-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No backups recorded yet.");
      return;
    }
    list.innerHTML = items.map((item) => `<div class="data-row"><span><strong>${escapeHtml(item.path || item.id)}</strong><small>${escapeHtml(item.site_id || "")}</small></span><span>${escapeHtml(item.size || "")}</span><time>${formatWhen(item.created_at)}</time></div>`).join("");
  };
