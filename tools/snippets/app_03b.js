
  const loadDeployments = async () => {
    const items = await api("/api/deployments");
    const list = $("#deployments-list");
    if (!items.length) {
      list.innerHTML = emptyRow("No deployments yet.");
      return;
    }
    list.innerHTML = items.map((item) => `<div class="data-row"><span>${escapeHtml(item.site_name || "Site")}</span><span class="badge ${item.status === "succeeded" ? "badge-ok" : item.status === "failed" ? "badge-warn" : ""}">${escapeHtml(item.status || "queued")}</span><code>${escapeHtml(item.log || "")}</code><time>${formatWhen(item.created_at)}</time></div>`).join("");
  };
