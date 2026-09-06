
  const bindSiteModal = () => {
    $("#new-site-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Generating key…";
      try {
        const result = await api("/api/sites", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
        state.pendingSiteSlug = result.slug;
        $("#deploy-key").textContent = result.deploy_key_public;
        $("#new-site-form").hidden = true;
        $("#site-modal-kicker").innerHTML = '<span class="step-dot active"></span><span></span><span class="step-dot active"></span><span></span><span class="step-dot"></span>';
        $("#site-modal-eyebrow").textContent = "NEW SITE / STEP 2 OF 3";
        $("#deploy-success").hidden = false;
        showToast("Deploy key generated");
      } catch (error) {
        showToast(error.message);
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Generate deploy key <span>→</span>';
      }
    });

    $("#copy-key").addEventListener("click", async () => {
      const key = $("#deploy-key").textContent;
      try { await navigator.clipboard.writeText(key); } catch { /* clipboard may be unavailable */ }
      const button = $("#copy-key");
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    });

    $("#finish-site").addEventListener("click", async () => {
      closeModals();
      if (!state.pendingSiteSlug) return;
      try {
        const result = await api(`/api/sites/${encodeURIComponent(state.pendingSiteSlug)}/deploy`, { method: "POST" });
        showToast(result.status === "queued" ? "Clone job queued" : "Deployment requested");
      } catch (error) {
        showToast(error.message);
      }
      await refreshDashboard();
    });
  };
