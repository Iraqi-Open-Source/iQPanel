
  const modals = () => $$(".modal-backdrop");

  const openModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (id === "site-modal") resetSiteModal();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector("input,select,button")?.focus();
  };

  const closeModals = () => {
    modals().forEach((modal) => { modal.hidden = true; });
    document.body.style.overflow = "";
  };

  const resetSiteModal = () => {
    $("#new-site-form").reset();
    $("#new-site-form").hidden = false;
    $("#deploy-success").hidden = true;
    $("#site-modal-eyebrow").textContent = "NEW SITE / STEP 1 OF 3";
    $("#site-modal-kicker").innerHTML = '<span class="step-dot active"></span><span></span><span class="step-dot"></span><span></span><span class="step-dot"></span>';
    state.pendingSiteSlug = "";
  };
