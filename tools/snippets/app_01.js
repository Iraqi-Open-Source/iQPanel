(() => {
  const state = {
    dashboard: null,
    sites: [],
    authRequired: false,
    authenticated: false,
    currentView: "overview",
    siteFilter: "all",
    pendingSiteSlug: "",
    servicesSiteSlug: "",
    logsStream: null,
    cronJobs: [],
    databases: [],
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3500);
  };

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "include",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (response.status === 401 && state.authenticated && !path.endsWith("/api/session")) {
      state.authenticated = false;
      showLogin();
    }
    if (!response.ok) {
      const error = new Error(body?.error || response.statusText || "Request failed");
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };

  const fetchSession = async () => {
    const response = await fetch("/api/session", { credentials: "include" });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    return { ok: response.ok, status: response.status, body };
  };

  const showLogin = () => {
    $("#login-screen").hidden = false;
    $("#app-shell").hidden = true;
    $("#login-error").hidden = true;
  };

  const showApp = () => {
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;
  };

  const typeLabel = (type) => ({ php: "PHP / Laravel", node: "Node.js", python: "Python", static: "Static site" }[type] || type);
  const logoClasses = ["logo-green", "logo-purple", "logo-orange", "logo-blue"];

  const formatWhen = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diff = Date.now() - date.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m";
    const hours = Math.round(mins / 60);
    if (hours < 48) return hours + "h";
    return date.toLocaleDateString();
  };

  const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
