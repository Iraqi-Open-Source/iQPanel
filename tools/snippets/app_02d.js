
  const renderMetrics = (server, sites) => {
    const online = sites.filter((s) => s.status === "online").length;
    const total = sites.length || 0;
    const cpu = server?.cpu ?? 0;
    const memory = server?.memory ?? 0;
    const disk = server?.disk ?? 0;
    const load = server?.load ?? 0;
    $("#metric-grid").innerHTML = `<article class="metric-card accent-cyan"><div class="metric-top"><span>Sites online</span><span class="metric-icon">⌘</span></div><strong>${online} <small>/ ${total}</small></strong><div class="metric-foot"><span class="up">Live</span> from panel store</div></article><article class="metric-card accent-lime"><div class="metric-top"><span>CPU usage</span><span class="metric-icon">◒</span></div><strong>${cpu}<span class="unit">%</span></strong><div class="meter"><i style="width:${cpu}%"></i></div><div class="metric-foot">load <b>${load}</b></div></article><article class="metric-card accent-violet"><div class="metric-top"><span>Memory</span><span class="metric-icon">▤</span></div><strong>${memory}<span class="unit">%</span></strong><div class="meter violet"><i style="width:${memory}%"></i></div><div class="metric-foot">host memory pressure</div></article><article class="metric-card accent-orange"><div class="metric-top"><span>Disk space</span><span class="metric-icon">◫</span></div><strong>${disk}<span class="unit">%</span></strong><div class="meter orange"><i style="width:${disk}%"></i></div><div class="metric-foot">root filesystem</div></article>`;
  };
