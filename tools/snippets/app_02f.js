
  const updateSidebarAgent = (server) => {
    const online = server?.agent === "online";
    $("#sidebar-agent-label").textContent = online ? "Agent online" : "Agent offline";
    $("#sidebar-agent-meta").textContent = "Mode: " + (server?.agent_mode || "local");
    $("#server-label").textContent = online ? "Connected" : "Disconnected";
    const dot = $("#sidebar-agent-dot");
    if (dot) dot.style.background = online ? "var(--lime)" : "var(--red)";
  };

  const renderSettings = () => {
    const server = state.dashboard?.server || {};
    $("#settings-agent-mode").textContent = server.agent_mode || "local";
    $("#settings-agent-status").textContent = server.agent || "unknown";
    $("#settings-data-root").textContent = server.data_root || state.dashboard?.data_root || "—";
    $("#settings-auth").textContent = state.authRequired ? "Password required" : "Open (no password set)";
  };

  const renderOverviewDate = () => {
    const stamp = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    $("#overview-date").innerHTML = stamp.toUpperCase() + ' <span class="live-label"><i></i>LIVE</span>';
    const sub = $("#overview-subheading");
    if (sub) sub.textContent = state.sites.length ? "Your server dashboard is up to date." : "Create a site to start deploying.";
  };
