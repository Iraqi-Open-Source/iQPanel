
  const activityTone = (action) => {
    const key = String(action || "").toLowerCase();
    if (key.includes("deploy")) return ["green", "↗"];
    if (key.includes("database")) return ["purple", "◉"];
    if (key.includes("backup")) return ["orange", "↻"];
    return ["blue", "⚙"];
  };

  const renderActivity = (items) => {
    const list = $("#activity-list");
    if (!items?.length) {
      list.innerHTML = '<p class="empty-inline">No activity recorded yet.</p>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const [tone, glyph] = activityTone(item.action);
      const details = item.details ? ` · <code>${escapeHtml(item.details)}</code>` : "";
      return `<div class="activity-item"><span class="activity-icon ${tone}">${glyph}</span><div><strong>${escapeHtml(item.action)}</strong><p>${escapeHtml(item.target)}${details}</p></div><time>${formatWhen(item.created_at)}</time></div>`;
    }).join("");
  };

  const renderServiceHealth = (server) => {
    const services = server?.services || {};
    const entries = Object.entries(services);
    const container = $("#service-health");
    if (!entries.length) {
      container.innerHTML = '<p class="empty-inline">Service status unavailable.</p>';
      $("#health-badge").hidden = true;
      return;
    }
    const healthy = entries.every(([, value]) => String(value).toLowerCase() === "active");
    $("#health-badge").hidden = !healthy;
    container.innerHTML = entries.map(([name, value]) => {
      const ok = String(value).toLowerCase() === "active";
      return `<div><span class="health-check">${ok ? "✓" : "!"}</span><span><strong>${escapeHtml(name.replace(/_/g, " "))}</strong><small>${escapeHtml(String(value))}</small></span><b>${ok ? "Running" : "Check"}</b></div>`;
    }).join("");
  };
