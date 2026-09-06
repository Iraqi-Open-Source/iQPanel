
  const stopLogsStream = () => {
    if (state.logsStream) {
      state.logsStream.close();
      state.logsStream = null;
    }
  };

  const loadLogFiles = async () => {
    const slug = $("#logs-site-select")?.value;
    const fileSelect = $("#logs-file-select");
    if (!slug) return;
    const files = await api(`/api/sites/${encodeURIComponent(slug)}/logs`);
    const list = Array.isArray(files) ? files : [];
    fileSelect.innerHTML = list.map((item) => {
      const name = typeof item === "string" ? item : item.name;
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join("");
  };

  const loadLogSnapshot = async () => {
    stopLogsStream();
    const slug = $("#logs-site-select")?.value;
    const file = $("#logs-file-select")?.value;
    if (!slug || !file) {
      $("#logs-output").textContent = "";
      return;
    }
    const result = await api(`/api/sites/${encodeURIComponent(slug)}/logs/${encodeURIComponent(file)}`);
    $("#logs-output").textContent = result.text || "";
  };

  const startLogsStream = () => {
    stopLogsStream();
    const slug = $("#logs-site-select")?.value;
    const file = $("#logs-file-select")?.value;
    if (!slug || !file) return;
    const source = new EventSource(`/api/sites/${encodeURIComponent(slug)}/logs/${encodeURIComponent(file)}/stream`);
    state.logsStream = source;
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const output = $("#logs-output");
        output.textContent += payload.chunk || "";
        output.scrollTop = output.scrollHeight;
      } catch {
        /* ignore malformed chunks */
      }
    };
    source.onerror = () => {
      stopLogsStream();
      $("#logs-stream-toggle").checked = false;
    };
  };

  const loadLogsView = async () => {
    await loadLogFiles();
    if ($("#logs-stream-toggle")?.checked) startLogsStream();
    else await loadLogSnapshot();
  };
