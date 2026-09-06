
  const bindDataModals = () => {
    $("#database-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      try {
        const result = await api("/api/databases", { method: "POST", body: JSON.stringify(payload) });
        closeModals();
        showToast(`Database ${result.db_name} ready`);
        if (result.password) showToast("Password: " + result.password);
        await refreshDashboard();
        if (state.currentView === "databases") await loadDatabases();
      } catch (error) {
        showToast(error.message);
      }
    });

    $("#cron-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      payload.enabled = form.get("enabled") === "on";
      if (!payload.site_slug) delete payload.site_slug;
      try {
        await api("/api/cron", { method: "POST", body: JSON.stringify(payload) });
        closeModals();
        event.currentTarget.reset();
        showToast("Cron job saved");
        await loadCron();
      } catch (error) {
        showToast(error.message);
      }
    });
  };
