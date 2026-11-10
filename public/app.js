// ============================================================================
// FENIX CRM — CLIENTE INTERACTIVO EN TIEMPO REAL Y CONTROL DE ACCESO POR CORREO
// ============================================================================

const NOMBRES_MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

const state = {
  lockedRole: "admin", // "admin" | "subadmin" | "supervisor" | "moviles" | "formulario"
  vista: "admin",
  supervisorFiltro: "",
  userEmail: localStorage.getItem("fenix_auth_email") || "",
  activeTab: "hojas",
  supFilterMode: "todos",
  supSearchQuery: "",
  meta: null,
  activeCompanySlug: "",
  collapsedMonths: new Set(),
  form: {
    brandId: "",
    variantId: "",
    company_slug: "",
    operador: "",
    tipo_venta: "",
    subcompania: "",
    es_movil: false,
    ask_click: false,
    hizo_click: "",
    imagen_base64: "",
    manualEdits: {},
  },
  sheetDebounceTimer: null,
  previewDebounceTimer: null,
  currentSheetSalesMap: new Map(),
  selectedRowIds: new Set(),
  sheetPage: 1,
  sheetPageSize: 150,
};

function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n) {
  return "$" + Math.round(Number(n || 0)).toLocaleString("es-CL");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function splitEmailsClient(raw) {
  if (!raw) return [];
  return [
    ...new Set(
      String(raw)
        .split(/[,;\n\r\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 4 && s.includes("@"))
    ),
  ];
}

function countMobileNumbersClient(raw) {
  if (!raw) return [];
  const cleaned = String(raw).replace(/\+56/g, " ");
  const parts = cleaned.split(/[\/|,\n\r;\s]+/);
  const nums = [];
  for (const p of parts) {
    const d = p.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 11) {
      nums.push(d.length === 11 && d.startsWith("56") ? d.slice(2) : d);
    }
  }
  return [...new Set(nums)];
}

function toast(msg) {
  const box = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

async function api(url, options = {}) {
  const isAdminPreview = state.lockedRole === "admin" && state.vista !== "admin" ? "1" : "0";
  const headers = {
    ...requestHeaders(),
    "Content-Type": "application/json",
    "x-fenix-role": state.vista || "admin",
    "x-fenix-email": state.userEmail || "",
    "x-fenix-sup": state.supervisorFiltro || "",
    "x-fenix-admin-preview": isAdminPreview,
    ...(options.headers || {}),
  };
  const res = await fetch(apiUrl(url), { ...options, headers });
  const data = await res.json();
  if (!res.ok && res.status !== 409) {
    if (res.status === 403 && data.requiresEmailGate) {
      await loadBootstrap();
    }
    throw new Error(data.message || "Error en la solicitud");
  }
  return { status: res.status, data };
}

// ============================================================================
// INICIALIZACIÓN, RUTAS SEPARADAS Y CONTROL DE ACCESO POR CORREO
// ============================================================================

async function init() {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;

  if (path === "/formulario" || params.get("vista") === "formulario") {
    state.lockedRole = "formulario";
    state.vista = "formulario";
    document.body.classList.add("standalone-form-mode");
  } else if (
    path === "/ventas-fenix" ||
    path === "/admin-ventas" ||
    params.get("vista") === "subadmin" ||
    params.get("vista") === "ventas-fenix"
  ) {
    state.lockedRole = "subadmin";
    state.vista = "subadmin";
  } else if (path === "/moviles" || params.get("vista") === "moviles") {
    state.lockedRole = "moviles";
    state.vista = "moviles";
  } else if (params.get("vista") === "supervisor" && params.get("sup")) {
    state.lockedRole = "supervisor";
    state.vista = "supervisor";
    state.supervisorFiltro = params.get("sup");
  } else {
    state.lockedRole = "admin";
    state.vista = "admin";
  }

  document.getElementById("formFecha").value = todayISO();
  document.getElementById("dailyDatePicker").value = todayISO();

  const hoy = new Date();
  let mesPago = hoy.getMonth();
  let anioPago = hoy.getFullYear();
  if (hoy.getDate() <= 10) {
    mesPago -= 1;
    if (mesPago < 0) {
      mesPago = 11;
      anioPago -= 1;
    }
  }
  document.getElementById("payMonthSelect").value = String(mesPago);
  document.getElementById("payYearSelect").value = String(anioPago);

  // Pegar imágenes con Ctrl+V cuando esté en el formulario
  window.addEventListener("paste", (ev) => {
    if (state.activeTab !== "formulario") return;
    const items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) readImageFileToBase64(file);
      }
    }
  });

  // Drag & drop para importador de Google Sheets (.xlsx / .json)
  const sheetsDz = document.getElementById("sheetsImportDropzone");
  if (sheetsDz) {
    sheetsDz.addEventListener("dragover", (e) => {
      e.preventDefault();
      sheetsDz.style.borderColor = "#2563eb";
    });
    sheetsDz.addEventListener("dragleave", () => {
      sheetsDz.style.borderColor = "";
    });
    sheetsDz.addEventListener("drop", (e) => {
      e.preventDefault();
      sheetsDz.style.borderColor = "";
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processImportedSheetsFile(e.dataTransfer.files[0]);
      }
    });
  }

  document.getElementById("globalSearchInput").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") runGlobalSearch();
  });

  for (const fieldId of [
    "ov_rut",
    "ov_nombre_cliente",
    "ov_direccion",
    "ov_comuna",
    "ov_telefono",
    "ov_numero_principal",
    "ov_adicional",
    "ov_correo",
    "ov_id_orden",
    "ov_servicio",
  ]) {
    const el = document.getElementById(fieldId);
    if (!el) continue;
    el.addEventListener("input", () => {
      const key = fieldId.replace(/^ov_/, "");
      state.form.manualEdits[key] = true;
      if (key === "comuna") {
        document.getElementById("ov_comuna_movil").value = el.value;
      }
      if (key === "numero_principal" || key === "adicional") {
        refreshMobileLinesCounter();
      }
    });
  }

  await loadBootstrap();
  setupSSE();

  if (!state.meta || state.meta.requiresEmailGate) return;

  if (state.vista === "formulario") {
    switchTab("formulario");
  } else {
    switchTab("hojas");
  }
}

function syncComunaInputs(val) {
  state.form.manualEdits.comuna = true;
  document.getElementById("ov_comuna").value = val;
}

function onBrandClick() {
  if (state.lockedRole === "formulario") return;
  switchTab("hojas");
}

function showEmailGate(access = {}) {
  const gate = document.getElementById("emailGateOverlay");
  const topbar = document.getElementById("topbar");
  const mainNav = document.getElementById("mainNav");
  const workspace = document.getElementById("mainWorkspace");

  gate.classList.remove("hidden");
  topbar.classList.add("hidden");
  mainNav.classList.add("hidden");
  workspace.classList.add("hidden");

  document.getElementById("gateViewTitle").textContent = access.viewTitle || "Verificación de Acceso";
  document.getElementById("gateReasonText").textContent =
    access.reason || "Ingresa tu correo electrónico autorizado para abrir esta hoja.";

  const emailInput = document.getElementById("gateEmailInput");
  if (state.userEmail && !emailInput.value) {
    emailInput.value = state.userEmail;
  }

  const passWrap = document.getElementById("gatePasswordWrap");
  const passInput = document.getElementById("gatePassword");
  if (state.vista === "admin") {
    if (passWrap) passWrap.style.display = "block";
    if (passInput) passInput.required = true;
  } else {
    if (passWrap) passWrap.style.display = "none";
    if (passInput) {
      passInput.required = false;
      passInput.value = "";
    }
  }

  const errBanner = document.getElementById("gateErrorBanner");
  if (state.userEmail && access.reason) {
    errBanner.textContent = access.reason;
    errBanner.classList.remove("hidden");
  } else {
    errBanner.classList.add("hidden");
  }
}

function hideEmailGate() {
  document.getElementById("emailGateOverlay").classList.add("hidden");
  document.getElementById("topbar").classList.remove("hidden");
  document.getElementById("mainWorkspace").classList.remove("hidden");
  if (state.vista !== "formulario") {
    document.getElementById("mainNav").classList.remove("hidden");
  }
}

async function submitEmailGate(ev) {
  ev.preventDefault();
  const email = document.getElementById("gateEmailInput").value.trim().toLowerCase();
  const errBanner = document.getElementById("gateErrorBanner");
  const btn = document.getElementById("btnGateSubmit");
  if (!email) return;

  btn.disabled = true;
  btn.textContent = "Verificando...";
  errBanner.classList.add("hidden");

  try {
    const passInput = document.getElementById("gatePassword");
    const password = passInput ? passInput.value : "";
    const res = await fetch(apiUrl("/api/auth/verify-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vista: state.vista,
        sup: state.supervisorFiltro,
        email,
        password,
      }),
    });
    const data = await res.json();
    if (data.allowed) {
      localStorage.setItem("fenix_session", data.token);
      sessionStorage.setItem("fenix_session", data.token);
      if (passInput) passInput.value = "";
      state.userEmail = email;
      localStorage.setItem("fenix_auth_email", email);
      hideEmailGate();
      await loadBootstrap();
      setupSSE();
      switchTab("hojas");
      toast(`Bienvenido/a (${email})`);
    } else {
      errBanner.textContent = data.reason || "Este correo no tiene permiso para entrar a esta hoja.";
      errBanner.classList.remove("hidden");
    }
  } catch (err) {
    errBanner.textContent = "Error al verificar correo: " + err.message;
    errBanner.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar a la Hoja";
  }
}

async function logoutEmailSession() {
  await fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers: requestHeaders() });
  localStorage.removeItem('fenix_session');
  sessionStorage.removeItem('fenix_session');
  state.eventSource?.close();
  state.userEmail = "";
  localStorage.removeItem("fenix_auth_email");
  document.getElementById("gateEmailInput").value = "";
  await loadBootstrap();
}

async function loadBootstrap() {
  const qs = new URLSearchParams();
  qs.set("vista", state.vista);
  if (state.vista === "supervisor" && state.supervisorFiltro) {
    qs.set("sup", state.supervisorFiltro);
  }

  const { data } = await api(`/api/bootstrap?${qs.toString()}`);
  state.meta = data;

  // --- INICIO DEL FILTRO PARA EL FORMULARIO ---
  // Limpiamos las opciones fantasma del formulario que tengan 0 ventas
  if (state.meta.brandGroups && state.meta.companiesVisibles) {
    state.meta.brandGroups.forEach((g) => {
      g.variants = (g.variants || []).filter((v) => {
        const comp = state.meta.companiesVisibles.find((c) => c.slug === v.company_slug);
        return comp && (comp.totalVentas || 0) > 0;
      });
    });
  }
  // --- FIN DEL FILTRO ---

  if (data.requiresEmailGate) {
    showEmailGate(data.access || {});
    return;
  }

  hideEmailGate();

  if (state.vista === "supervisor" && data.supervisorActivo) {
    state.supervisorFiltro = data.supervisorActivo;
  }

  applyRoleVisibility();

  if (state.vista === "formulario") {
    renderFormMetadata();
    return;
  }

  renderViewSwitcher();
  renderCompanyTabs();
  renderSupervisorsPanel();

  if (
    !state.activeCompanySlug ||
    !(data.companiesVisibles || []).some((c) => c.slug === state.activeCompanySlug)
  ) {
    state.activeCompanySlug =
      data.companiesVisibles && data.companiesVisibles[0] ? data.companiesVisibles[0].slug : "";
  }
}

function applyRoleVisibility() {
  const badge = document.getElementById("roleBadge");
  const mainNav = document.getElementById("mainNav");
  const globalSearch = document.getElementById("globalSearchWrap");
  const topbarActions = document.getElementById("topbarActions");
  const adminSwitcher = document.getElementById("adminViewSwitcher");
  const btnOpenForm = document.getElementById("btnOpenFormStandalone");
  const btnQuickImport = document.getElementById("btnQuickImport");
  const btnNewComp = document.getElementById("btnNewCompany");
  const tabPagos = document.getElementById("navTabPagos");
  const tabSups = document.getElementById("navTabSups");
  const tabInteg = document.getElementById("navTabIntegraciones");
  const btnAddRow = document.getElementById("btnAddManualRow");
  const btnToggleGoals = document.getElementById("btnToggleGoals");
  const goalsConfigPanel = document.getElementById("goalsConfigPanel");
  const permHint = document.getElementById("permissionModeHint");
  const emailChip = document.getElementById("currentEmailChip");
  const emailText = document.getElementById("currentEmailText");

  // Si es la página aislada /formulario (para ejecutivos): ocultar todo el menú de hojas
  if (state.vista === "formulario") {
    badge.textContent = "Formulario de Ventas";
    mainNav.classList.add("hidden");
    globalSearch.classList.add("hidden");
    topbarActions.classList.add("hidden");
    return;
  }

  mainNav.classList.remove("hidden");
  globalSearch.classList.remove("hidden");
  topbarActions.classList.remove("hidden");

  // Mostrar chip de correo conectado cuando aplique
  if (state.userEmail && (state.lockedRole !== "admin" || (state.meta && state.meta.authorizedEmail))) {
    emailText.textContent = `✉️ ${state.userEmail}`;
    emailChip.classList.remove("hidden");
  } else {
    emailChip.classList.add("hidden");
  }

  // El selector "Vista:" es EXCLUSIVO del Admin Principal (nunca aparece en la 2da hoja admin ni supervisores)
  const isRealSuperAdmin = ["admin", "subadmin"].includes(state.lockedRole);
  adminSwitcher.classList.toggle("hidden", !isRealSuperAdmin);

  if (state.vista === "subadmin") {
    // VENTAS FENIX: Solo Hojas de Ventas, Ventas del Día y Pagos Adicionales.
    // Edita ventas existentes, pero NO crea compañías, NO agrega/borra filas y NO cambia tarifas/metas.
    badge.textContent = "Ventas Fenix";
    tabPagos.classList.remove("hidden");
    tabSups.classList.add("hidden");
    tabInteg.classList.add("hidden");
    btnOpenForm.classList.add("hidden");
    btnNewComp.classList.add("hidden");
    btnQuickImport.classList.add("hidden");
    btnAddRow.classList.add("hidden");
    btnToggleGoals.classList.add("hidden");
    goalsConfigPanel.classList.add("hidden");
    permHint.classList.add("hidden");
  } else if (state.vista === "moviles") {
    badge.textContent = "Espejo Móviles";
    tabPagos.classList.add("hidden");
    tabSups.classList.add("hidden");
    tabInteg.classList.add("hidden");
    btnOpenForm.classList.add("hidden");
    btnNewComp.classList.add("hidden");
    btnQuickImport.classList.add("hidden");
    btnAddRow.classList.add("hidden");
    permHint.textContent = "Editable en Notas y Seguimiento";
    permHint.classList.remove("hidden");
  } else if (state.vista === "supervisor") {
    badge.textContent = `Supervisor · ${state.supervisorFiltro}`;
    tabPagos.classList.add("hidden");
    tabSups.classList.add("hidden");
    tabInteg.classList.add("hidden");
    btnOpenForm.classList.add("hidden");
    btnNewComp.classList.add("hidden");
    btnQuickImport.classList.add("hidden");
    btnAddRow.classList.add("hidden");
    permHint.textContent = "Solo Lectura";
    permHint.classList.remove("hidden");
  } else {
    // ADMIN PRINCIPAL
    badge.textContent = "Admin Principal";
    tabPagos.classList.remove("hidden");
    tabSups.classList.remove("hidden");
    tabInteg.classList.remove("hidden");
    btnOpenForm.classList.remove("hidden");
    btnNewComp.classList.remove("hidden");
    btnQuickImport.classList.remove("hidden");
    btnAddRow.classList.remove("hidden");
    btnToggleGoals.classList.remove("hidden");
    permHint.classList.add("hidden");
  }

  updateHeaderBrand();
}

function updateHeaderBrand() {
  const brandComp = document.getElementById("brandCompanyText");
  const roleBadge = document.getElementById("roleBadge");

  const comp = (state.meta?.companiesVisibles || state.meta?.companies || []).find((c) => c.slug === state.activeCompanySlug);
  const compName = comp ? (comp.nombre || comp.hoja) : "";

  if (state.vista === "supervisor") {
    if (brandComp) {
      brandComp.textContent = compName ? `· ${compName}` : "";
      brandComp.classList.toggle("hidden", !compName);
    }
    if (roleBadge) {
      roleBadge.textContent = `Supervisor · ${state.supervisorFiltro || ""}`;
    }
    document.title = compName
      ? `${compName} — Fenix CRM (${state.supervisorFiltro})`
      : `Supervisor ${state.supervisorFiltro} — Fenix CRM`;
  } else if (state.vista === "subadmin") {
    if (brandComp) {
      brandComp.textContent = compName ? `· ${compName}` : "";
      brandComp.classList.toggle("hidden", !compName);
    }
    if (roleBadge) roleBadge.textContent = "Ventas Fenix";
    document.title = compName ? `${compName} — Ventas Fenix` : "Ventas Fenix — CRM";
  } else if (state.vista === "moviles") {
    if (brandComp) {
      brandComp.textContent = "· Móviles";
      brandComp.classList.remove("hidden");
    }
    if (roleBadge) roleBadge.textContent = "Espejo Móviles";
    document.title = "Espejo Móviles — Fenix CRM";
  } else if (state.vista === "formulario") {
    if (brandComp) brandComp.classList.add("hidden");
    if (roleBadge) roleBadge.textContent = "Formulario de Ventas";
    document.title = "Formulario de Ventas — Fenix CRM";
  } else {
    // Admin Principal
    if (brandComp) brandComp.classList.add("hidden");
    if (roleBadge) roleBadge.textContent = "Principal";
    document.title = "Fenix CRM — Gestión de Ventas";
  }
}

function renderViewSwitcher() {
  const sel = document.getElementById("viewSelector");
  if (!sel || !state.meta || !["admin", "subadmin"].includes(state.lockedRole)) return;

  const currentVal =
    state.vista === "subadmin"
      ? "subadmin"
      : state.vista === "moviles"
        ? "moviles"
        : state.vista === "supervisor"
          ? `sup:${state.supervisorFiltro}`
          : "admin";

  let html = `
    ${state.lockedRole === 'admin' ? '<option value="admin">👑 Admin Principal (Control Total)</option>' : ''}
    <option value="subadmin">📊 Todas las ventas · Fenix</option>
    ${state.lockedRole === 'admin' ? '<option value="moviles">📱 Espejo Móviles</option>' : ''}
    <optgroup label="Supervisores (Solo Lectura)">
  `;
  for (const s of state.meta.supervisors || []) {
    const compNote = s.companiaTexto ? ` (${s.companiaTexto})` : "";
    const actNote = s.activo === false ? " [Inactivo]" : "";
    html += `<option value="sup:${esc(s.nombre)}">${esc(s.nombre)}${esc(compNote)}${actNote}</option>`;
  }
  html += `</optgroup>`;
  sel.innerHTML = html;
  sel.value = currentVal;

  sel.onchange = async () => {
    const v = sel.value;
    if (state.lockedRole === "subadmin" && v !== "subadmin" && !v.startsWith("sup:")) return;
    state.sheetPage = 1;
    if (v === "admin") {
      state.vista = "admin";
      state.supervisorFiltro = "";
    } else if (v === "subadmin") {
      state.vista = "subadmin";
      state.supervisorFiltro = "";
    } else if (v === "moviles") {
      state.vista = "moviles";
      state.supervisorFiltro = "";
    } else if (v.startsWith("sup:")) {
      state.vista = "supervisor";
      state.supervisorFiltro = v.slice(4);
    }
    await loadBootstrap();
    if (state.vista === "subadmin" && ["supervisores", "integraciones"].includes(state.activeTab)) {
      switchTab("hojas");
    } else if (
      (state.vista === "moviles" || state.vista === "supervisor") &&
      ["pagos", "supervisores", "integraciones"].includes(state.activeTab)
    ) {
      switchTab("hojas");
    } else {
      refreshCurrentTab();
    }
  };
}

function setupSSE() {
  state.eventSource?.close();
  if (!state.meta || state.meta.requiresEmailGate || state.vista === 'formulario') return;
  const token = localStorage.getItem('fenix_session') || sessionStorage.getItem('fenix_session') || '';
  const evtSource = new EventSource(apiUrl('/api/events?session=' + encodeURIComponent(token)));
  state.eventSource = evtSource;
  const statusEl = document.getElementById('liveStatus');
  evtSource.onopen = () => {
    statusEl.innerHTML = '<span class="dot-live"></span> Datos compartidos · En línea';
    scheduleSharedRefresh();
  };
  evtSource.onmessage = ev => {
    try { if (JSON.parse(ev.data).type !== 'connected') scheduleSharedRefresh(); } catch {}
  };
  evtSource.onerror = () => { statusEl.textContent = 'Sin conexión · Reconectando'; };
}
function scheduleSharedRefresh() {
  clearTimeout(state.sharedRefreshTimer);
  clearSheetCache();
  state.sharedRefreshTimer = setTimeout(async () => {
    if (state.editingCell) { state.pendingSharedRefresh = true; return; }
    try { await loadBootstrap(); refreshCurrentTab(); }
    catch (error) { toast('No se pudo actualizar: ' + error.message); }
  }, 250);
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== `tab-${tabName}`);
  });
  refreshCurrentTab();
}

function refreshCurrentTab() {
  if (!state.meta || state.meta.requiresEmailGate) return;
  if (state.activeTab === "hojas") loadActiveSheet();
  else if (state.activeTab === "resumen") loadDailySummary();
  else if (state.activeTab === "pagos" && (state.vista === "admin" || state.vista === "subadmin")) loadPayments();
  else if (state.activeTab === "supervisores" && state.vista === "admin") renderSupervisorsPanel();
  else if (state.activeTab === "integraciones" && state.vista === "admin") refreshIntegracionesUrls();
}

// ============================================================================
// 1. FORMULARIO AISLADO (/formulario) AGRUPADO POR MARCA + MÓVILES CON ADICIONALES
// ============================================================================

function renderFormMetadata() {
  if (!state.meta) return;
  const groups = state.meta.brandGroups || [];
  const brandGrid = document.getElementById("brandGrid");

  brandGrid.innerHTML = groups
    .map((g) => {
      const selected = state.form.brandId === g.brandId ? "selected" : "";
      const subTxt =
        g.variants.length > 1
          ? `${g.variants.length} opciones`
          : g.variants[0] && g.variants[0].es_movil
            ? "Móvil"
            : "Hogar";
      return `
        <button type="button" class="brand-card ${selected}" onclick="window.app.selectBrand('${esc(g.brandId)}')">
          <div class="brand-dot">${esc(g.emoji)}</div>
          <div class="brand-card-info">
            <span class="brand-card-name">${esc(g.label)}</span>
            <span class="brand-card-sub">${esc(subTxt)}</span>
          </div>
        </button>
      `;
    })
    .join("");

  const supSelect = document.getElementById("formSupervisor");
  const currentSup = supSelect.value || localStorage.getItem("fenix_last_sup") || "";
  supSelect.innerHTML =
    `<option value="">Selecciona supervisor...</option>` +
    (state.meta.supervisors || [])
      .map((s) => `<option value="${esc(s.nombre)}">${esc(s.nombre)}</option>`)
      .join("") +
    `<option value="Otro">Otro...</option>`;

  if (currentSup) {
    supSelect.value = currentSup;
    onFormSupervisorChange();
  }

  const lastExec = localStorage.getItem("fenix_last_exec") || "";
  if (lastExec && !document.getElementById("formEjecutivo").value) {
    document.getElementById("formEjecutivo").value = lastExec;
  }

  const dl = document.getElementById("ejecutivosDatalist");
  dl.innerHTML = (state.meta.todosEjecutivos || []).map((e) => `<option value="${esc(e)}"></option>`).join("");

  if (!state.form.brandId && groups[0]) {
    selectBrand(groups[0].brandId);
  } else if (state.form.brandId) {
    renderBrandVariants();
  }
}

function selectBrand(brandId) {
  const groups = (state.meta && state.meta.brandGroups) || [];
  const group = groups.find((g) => g.brandId === brandId);
  if (!group) return;

  state.form.brandId = brandId;
  document.querySelectorAll(".brand-card").forEach((el) => {
    const labelEl = el.querySelector(".brand-card-name");
    el.classList.toggle("selected", labelEl && labelEl.textContent === group.label);
  });

  const firstVar = group.variants[0];
  if (firstVar) {
    applyVariantSelection(firstVar);
  }
  renderBrandVariants();
}

function selectVariant(variantId) {
  const groups = (state.meta && state.meta.brandGroups) || [];
  const group = groups.find((g) => g.brandId === state.form.brandId);
  if (!group) return;
  const v = group.variants.find((x) => x.id === variantId);
  if (!v) return;
  applyVariantSelection(v);
  renderBrandVariants();
  triggerFichaPreview();
}

function applyVariantSelection(v) {
  state.form.variantId = v.id;
  state.form.company_slug = v.company_slug;
  state.form.operador = v.operador || "";
  state.form.tipo_venta = v.tipo_venta || "";
  state.form.subcompania = v.subcompania || "";
  state.form.es_movil = !!v.es_movil;
  state.form.ask_click = !!v.ask_click;
  if (!state.form.ask_click) {
    state.form.hizo_click = "";
  } else if (!state.form.hizo_click) {
    state.form.hizo_click = "No";
  }
  updateFormPreviewMode();
}

function renderBrandVariants() {
  const groups = (state.meta && state.meta.brandGroups) || [];
  const group = groups.find((g) => g.brandId === state.form.brandId);
  const box = document.getElementById("brandVariantsBox");
  const pillsContainer = document.getElementById("brandVariantsPills");
  const clickSub = document.getElementById("condSinTenenciaClick");

  if (!group || group.variants.length <= 1) {
    box.classList.add("hidden");
    clickSub.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  document.getElementById("brandVariantsLabel").innerHTML = `Modalidad de <b>${esc(
    group.label
  )}</b> <span class="req">*</span>`;

  pillsContainer.innerHTML = group.variants
    .map((v) => {
      const sel = state.form.variantId === v.id ? "selected" : "";
      const icon = v.es_movil ? "📱 " : "";
      return `
        <button type="button" class="choice-pill ${sel}" onclick="window.app.selectVariant('${esc(v.id)}')">
          ${icon}${esc(v.label)}
        </button>
      `;
    })
    .join("");

  if (state.form.ask_click) {
    clickSub.classList.remove("hidden");
    selectClickOption(state.form.hizo_click || "No");
  } else {
    clickSub.classList.add("hidden");
    document.getElementById("condClickImage").classList.add("hidden");
  }
}

function selectClickOption(val) {
  state.form.hizo_click = val;
  document.querySelectorAll("#clickChoices .choice-pill").forEach((b) => {
    b.classList.toggle("selected", b.dataset.val === val);
  });
  document.getElementById("condClickImage").classList.toggle("hidden", val !== "Sí");
}

function updateFormPreviewMode() {
  const destEl = document.getElementById("previewDestSheet");
  const fijoRow = document.getElementById("previewPhoneFijoRow");
  const movilBox = document.getElementById("previewPhoneMovilBox");
  const mobileBadge = document.getElementById("mobileLinesBadge");

  if (!state.form.company_slug || !state.meta) {
    destEl.textContent = "Selecciona compañía";
    fijoRow.classList.remove("hidden");
    movilBox.classList.add("hidden");
    mobileBadge.classList.add("hidden");
    return;
  }

  const comp = (state.meta.companies || []).find((c) => c.slug === state.form.company_slug);
  const subLabel = state.form.subcompania ? ` (${state.form.subcompania})` : "";
  destEl.textContent = comp ? `${comp.emoji} ${comp.hoja}${subLabel}` : state.form.operador;

  const isMobile = comp ? !!comp.usa_portado : state.form.es_movil;
  state.form.es_movil = isMobile;

  fijoRow.classList.toggle("hidden", isMobile);
  movilBox.classList.toggle("hidden", !isMobile);
  mobileBadge.classList.toggle("hidden", !isMobile);

  if (isMobile) {
    document.getElementById("ov_comuna_movil").value = document.getElementById("ov_comuna").value;
    refreshMobileLinesCounter();
  }
}

function refreshMobileLinesCounter() {
  const badge = document.getElementById("mobileLinesBadge");
  if (!badge) return;
  const princ = countMobileNumbersClient(document.getElementById("ov_numero_principal").value);
  const adic = countMobileNumbersClient(document.getElementById("ov_adicional").value).filter(
    (n) => n !== princ[0]
  );
  const cTit = princ.length > 0 ? 1 : 0;
  badge.textContent = `Titular: ${cTit} · Adicionales: ${adic.length}`;
}

function onFormSupervisorChange() {
  const sup = document.getElementById("formSupervisor").value;
  document.getElementById("formSupervisorOtro").classList.toggle("hidden", sup !== "Otro");

  const chipsBox = document.getElementById("suggestedExecChips");
  if (!state.meta || !sup || sup === "Otro") {
    chipsBox.innerHTML = "";
    return;
  }
  const sugeridos = ((state.meta.ejecutivosPorSupervisor || {})[sup] || []).slice(0, 8);
  chipsBox.innerHTML = sugeridos
    .map(
      (ej) =>
        `<span class="exec-chip" onclick="document.getElementById('formEjecutivo').value='${esc(ej)}'">${esc(ej)}</span>`
    )
    .join("");
}

function handleImageFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (file) readImageFileToBase64(file);
}

function readImageFileToBase64(file) {
  const reader = new FileReader();
  reader.onload = () => {
    state.form.imagen_base64 = reader.result;
    const img = document.getElementById("clickImagePreview");
    img.src = reader.result;
    img.classList.remove("hidden");
    document.getElementById("dropzonePrompt").textContent = "Imagen adjuntada (clic para cambiar)";
  };
  reader.readAsDataURL(file);
}

function triggerFichaPreview() {
  clearTimeout(state.previewDebounceTimer);
  state.previewDebounceTimer = setTimeout(runFichaPreview, 140);
}

async function runFichaPreview() {
  const ficha = document.getElementById("formFicha").value;
  const fecha = document.getElementById("formFecha").value;
  const ejecutivo = document.getElementById("formEjecutivo").value;

  if (!ficha.trim()) {
    document.getElementById("formDuplicateBanner").classList.add("hidden");
    return;
  }

  const { data } = await api("/api/ficha/preview", {
    method: "POST",
    body: JSON.stringify({
      ficha,
      fecha,
      ejecutivo,
      company_slug: state.form.company_slug,
      operador: state.form.operador,
      tipo_venta: state.form.tipo_venta,
    }),
  });

  const p = data.parsed;
  const setIfAuto = (key, val) => {
    if (!state.form.manualEdits[key]) {
      const el = document.getElementById(`ov_${key}`);
      if (el) el.value = val || "";
    }
  };

  setIfAuto("rut", p.rut);
  setIfAuto("nombre_cliente", p.nombreCliente);
  setIfAuto("direccion", p.direccion);
  setIfAuto("comuna", p.comuna);
  if (!state.form.manualEdits.comuna) {
    document.getElementById("ov_comuna_movil").value = p.comuna || "";
  }
  setIfAuto("telefono", p.telefonoContacto);
  setIfAuto("numero_principal", p.numeroPrincipal);
  setIfAuto("adicional", p.adicionales);
  setIfAuto("correo", p.correo);
  setIfAuto("id_orden", p.codigoBiometria);
  setIfAuto("servicio", p.servicio);

  refreshMobileLinesCounter();

  const dirTag = document.getElementById("dirSourceTag");
  if (p.direccion && p.direccionLimpia && p.direccion !== p.direccionLimpia) {
    dirTag.textContent = "✓ Separada de Dir. Limpia";
    dirTag.classList.remove("hidden");
  } else {
    dirTag.classList.add("hidden");
  }

  const dupBanner = document.getElementById("formDuplicateBanner");
  if (data.duplicateCheck && data.duplicateCheck.duplicate) {
    dupBanner.innerHTML = `⚠️ <b>Posible duplicada detectada:</b> ${esc(data.duplicateCheck.reason)}`;
    dupBanner.classList.remove("hidden");
  } else {
    dupBanner.classList.add("hidden");
  }
}

async function handleFormSubmit(ev, forceDuplicate = false) {
  if (ev) ev.preventDefault();

  const feedback = document.getElementById("formFeedbackBanner");
  feedback.classList.add("hidden");

  if (!state.form.company_slug) {
    return toast("Selecciona la compañía de la venta");
  }

  const supervisor = document.getElementById("formSupervisor").value;
  const supervisorOtro = document.getElementById("formSupervisorOtro").value.trim();
  const ejecutivo = document.getElementById("formEjecutivo").value.trim();
  const fecha = document.getElementById("formFecha").value;
  const ficha = document.getElementById("formFicha").value.trim();

  if (document.getElementById("chkRememberExec").checked) {
    localStorage.setItem("fenix_last_sup", supervisor);
    localStorage.setItem("fenix_last_exec", ejecutivo);
  }

  const overrides = {
    rut: document.getElementById("ov_rut").value.trim(),
    nombre_cliente: document.getElementById("ov_nombre_cliente").value.trim(),
    direccion: document.getElementById("ov_direccion").value.trim(),
    comuna: state.form.es_movil
      ? document.getElementById("ov_comuna_movil").value.trim()
      : document.getElementById("ov_comuna").value.trim(),
    telefono: document.getElementById("ov_telefono").value.trim(),
    numero_principal: document.getElementById("ov_numero_principal").value.trim(),
    adicional: document.getElementById("ov_adicional").value.trim(),
    correo: document.getElementById("ov_correo").value.trim(),
    id_orden: document.getElementById("ov_id_orden").value.trim(),
    servicio: document.getElementById("ov_servicio").value.trim(),
  };

  const btn = document.getElementById("btnSubmitSale");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  try {
    const { status, data } = await api("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        company_slug: state.form.company_slug,
        operador: state.form.operador,
        tipo_venta: state.form.tipo_venta,
        subcompania: state.form.subcompania,
        hizo_click: state.form.hizo_click,
        imagen_base64: state.form.imagen_base64,
        supervisor,
        supervisor_otro: supervisorOtro,
        ejecutivo,
        fecha,
        ficha,
        overrides,
        forzar_duplicada: forceDuplicate,
      }),
    });

    if (status === 409 && data.duplicate) {
      feedback.className = "alert-banner alert-error";
      feedback.innerHTML = `
        <div><b>⛔ Venta bloqueada por anti-duplicados:</b> ${esc(data.reason)}</div>
        <div style="margin-top:8px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.app.forceSubmitDuplicate()">
            Es otra venta distinta · Registrar de todos modos
          </button>
        </div>
      `;
      feedback.classList.remove("hidden");
      return;
    }

    const extraMov = state.form.es_movil
      ? ` (Titular: ${data.sale.cant_titular}, Adic: ${data.sale.cant_adicional})`
      : "";
    feedback.className = "alert-banner alert-ok";
    feedback.innerHTML = `✅ <b>¡Venta registrada en ${esc(data.company.hoja)}!</b> Cliente: <b>${esc(
      data.sale.nombre_cliente || data.sale.rut
    )}</b>${esc(extraMov)}.`;
    feedback.classList.remove("hidden");
    toast(`Venta guardada en ${data.company.hoja}`);

    clearSaleForm(true);
  } catch (err) {
    feedback.className = "alert-banner alert-error";
    feedback.textContent = "❌ " + err.message;
    feedback.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Registrar Venta";
  }
}

function forceSubmitDuplicate() {
  handleFormSubmit(null, true);
}

function clearSaleForm(keepFeedback = false) {
  document.getElementById("formFicha").value = "";
  state.form.imagen_base64 = "";
  state.form.manualEdits = {};
  document.getElementById("clickImagePreview").classList.add("hidden");
  document.getElementById("dropzonePrompt").innerHTML =
    "Haz clic para subir imagen o presiona <b>Ctrl + V</b> para pegar captura";

  for (const k of [
    "ov_rut",
    "ov_nombre_cliente",
    "ov_direccion",
    "ov_comuna",
    "ov_comuna_movil",
    "ov_telefono",
    "ov_numero_principal",
    "ov_adicional",
    "ov_correo",
    "ov_id_orden",
    "ov_servicio",
  ]) {
    const el = document.getElementById(k);
    if (el) el.value = "";
  }
  refreshMobileLinesCounter();
  document.getElementById("dirSourceTag").classList.add("hidden");
  document.getElementById("formDuplicateBanner").classList.add("hidden");
  if (!keepFeedback) document.getElementById("formFeedbackBanner").classList.add("hidden");
}

function fillSampleFicha(mobileSample = false) {
  state.form.manualEdits = {};
  if (mobileSample) {
    selectBrand("entel");
    selectVariant("entel-movil");
    document.getElementById("formFicha").value = `PORTABILIDAD ENTEL MÓVIL
RUT CLIENTE: 8313437-2
NOMBRE COMPLETO DEL CLIENTE: ENRIQUE DOMINGO REYES
DIRECCIÓN DE INSTALACIÓN: LOS ALAMOS 7161
COMUNA: LO PRADO
CORREO ELECTRÓNICO: ereyes@prodelap.cl
NÚMERO PRINCIPAL: +56 9 8500 3215
NÚMEROS ADICIONALES: 964218890, 977412305
ID DE ORDEN: 121729598
PLAN SOLICITADO: Plan 200GB Libre $13.990`;
  } else {
    selectBrand("movistar");
    selectVariant("mov-con-tenencia");
    document.getElementById("formFicha").value = `TNE
CÓDIGO DE BIOMETRÍA: BO N°W${Math.floor(1000 + Math.random() * 8999)}
DIRECCION LIMPIA: PASAJE LA FORTALEZA, 203 valparaiso

RUT CLIENTE: 17645584-5
DIRECCION DE INSTALACION: PASAJE LA FORTALEZA, 205, CASA, VALPARAISO
COMUNA: Valparaíso
NOMBRE COMPLETO DEL CLIENTE: LEÓN RAMÍREZ VALENTINA PAZ
CORREO ELECTRÓNICO: valentina.leon.ramirez@gmail.com
TELÉFONOS CONTACTO: +56 9 6661 3096
SERVICIOS A CONTRATAR: 600 Megas Fibra Dúo HBO Max`;
  }
  runFichaPreview();
}

// ============================================================================
// 2. HOJAS POR COMPAÑÍA (CON RESPETO ESTRICTO DE PERMISOS)
// ============================================================================

function renderCompanyTabs() {
  if (!state.meta || !state.meta.companiesVisibles) return;
  const bar = document.getElementById("companyTabsBar");

  // Filtramos las compañías para mostrar solo las que tienen más de 0 ventas
  const companiasActivas = (state.meta.companiesVisibles || []).filter((c) => (c.totalVentas || 0) > 0);

  bar.innerHTML = companiasActivas
    .map((c) => {
      const active = c.slug === state.activeCompanySlug ? "active" : "";
      return `
        <button class="company-pill ${active}" data-slug="${esc(c.slug)}" onclick="window.app.selectCompanyTab('${esc(c.slug)}')">
          <span class="company-pill-dot" style="background:${esc(c.color)}"></span>
          <span>${esc(c.hoja)}</span>
          <span class="company-pill-count">${c.totalVentas}</span>
        </button>
      `;
    })
    .join("");
}

function selectCompanyTab(slug) {
  if (state.activeCompanySlug === slug) return;
  state.activeCompanySlug = slug;
  state.sheetPage = 1;
  const bar = document.getElementById("companyTabsBar");
  if (bar) {
    bar.querySelectorAll(".company-pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.slug === slug);
    });
  }
  updateHeaderBrand();
  loadActiveSheet();
}

function debouncedLoadSheet() {
  state.sheetPage = 1;
  clearTimeout(state.sheetDebounceTimer);
  state.sheetDebounceTimer = setTimeout(loadActiveSheet, 200);
}

function changeSheetPage(delta) {
  const maxPage = state.totalPages || 1;
  const target = (state.sheetPage || 1) + delta;
  state.sheetPage = Math.min(maxPage, Math.max(1, target));
  updateHeaderBrand();
  loadActiveSheet();
}

function onPageSizeChange(val) {
  state.sheetPageSize = Number(val) || 150;
  state.sheetPage = 1;
  updateHeaderBrand();
  loadActiveSheet();
}

function canEditColumnInCurrentView(colKey) {
  // Tanto Admin Principal como Segunda Hoja Admin (subadmin) pueden editar ventas existentes
  if (state.vista === "admin" || state.vista === "subadmin") return true;
  if (state.vista === "moviles") {
    return colKey === "notas_movil" || colKey === "seguimiento_movil";
  }
  return false; // supervisor = solo lectura estricta
}

const sheetCache = new Map();

function clearSheetCache() {
  sheetCache.clear();
}

async function loadActiveSheet() {
  if (state.editingCell) { state.pendingSharedRefresh = true; return; }
  try { await loadActiveSheetData(); }
  catch (error) { document.getElementById('sheetLoadStatus').textContent = 'No se pudo cargar. Pulsa Actualizar.'; toast(error.message); }
}
async function loadActiveSheetData() {
  if (!state.activeCompanySlug) { document.getElementById('sheetTbody').innerHTML = ''; return; }
  const requestId = state.sheetRequestId = (state.sheetRequestId || 0) + 1;
  const tbody = document.getElementById('sheetTbody');
  const qs = new URLSearchParams();
  qs.set('page', state.sheetPage);
  qs.set('pageSize', state.sheetPageSize);
  qs.set('sort', state.sheetSort || 'fecha_orden');
  qs.set('direction', state.sheetDirection || 'desc');
  if (state.supervisorFiltro) qs.set("supervisor", state.supervisorFiltro);
  if (state.vista === "moviles") qs.set("vista", "moviles");
  qs.set("mes", document.getElementById("sheetMonthFilter").value);
  qs.set("anio", document.getElementById("sheetYearFilter").value);
  qs.set("estado", document.getElementById("sheetStatusFilter").value);
  qs.set("q", document.getElementById("sheetSearchInput").value.trim());

  const cacheKey = `${state.activeCompanySlug}:${qs.toString()}`;
  const cached = sheetCache.get(cacheKey);
  if (cached) {
    renderSheetTable(cached);
  } else if (tbody) {
    tbody.style.opacity = "0.45";
    document.getElementById('sheetLoadStatus').textContent = 'Cargando ventas…';
  }

  const { data } = await api(`/api/companies/${state.activeCompanySlug}/sales?${qs.toString()}`);
  if (requestId !== state.sheetRequestId) return;
  sheetCache.set(cacheKey, data);
  if (tbody) tbody.style.opacity = "1";
  renderSheetTable(data);
}

function renderSheetTable(data) {
  state.sheetPage = data.page;
  state.totalPages = data.totalPages;
  state.sheetColumns = data.company.columnas;
  document.getElementById('sheetLoadStatus').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
  const comp = data.company;
  const cols = comp.columnas;

  document.getElementById("activeSheetTitle").textContent = comp.hoja;
  document.getElementById("activeSheetCount").textContent = `${data.total} registro(s)`;

  state.selectedRowIds.clear();
  updateBulkDeleteUI();

  const canChangeStatus = state.vista === "admin" || state.vista === "subadmin";
  const canDeleteRow = state.vista === "admin" || state.vista === "subadmin";

  const thead = document.getElementById("sheetThead");
  thead.innerHTML = `
    <tr>
      <th style="width:${canDeleteRow ? 86 : 48}px; text-align:center;">
        ${canDeleteRow
      ? `<input type="checkbox" id="chkSelectAllRows" class="row-select-chk" title="Seleccionar todas las filas visibles" onchange="window.app.toggleSelectAllRows(this.checked)" />`
      : ""
    }
        <span># · Ficha</span>
      </th>
      ${cols.map((c, i) => `<th style="width:${c.width || 130}px"><span class="column-letter">${columnLetter(i)}</span>${esc(c.label)}</th>`).join("")}
    </tr>
  `;

  const tbody = document.getElementById("sheetTbody");
  const estadosOpciones = comp.usa_portado
    ? ["Pendiente", "Portado", "Instalado", "Cancelado", "No Realizado"]
    : ["Pendiente", "Instalado", "Cancelado", "No Realizado"];

  const pageSize = data.pageSize;
  const totalPages = data.totalPages;
  const startIdx = data.offset;
  const visibleSales = data.sales;
  const pageInfoEl = document.getElementById("sheetPageInfo");
  const prevBtn = document.getElementById("btnPrevPage");
  const nextBtn = document.getElementById("btnNextPage");
  if (pageInfoEl) pageInfoEl.textContent = `Página ${state.sheetPage} de ${totalPages} · ${data.total ? startIdx + 1 : 0}–${startIdx + data.sales.length} de ${data.total}`;
  if (prevBtn) prevBtn.disabled = state.sheetPage <= 1;
  if (nextBtn) nextBtn.disabled = state.sheetPage >= totalPages;

  state.currentSheetSalesMap.clear();
  if (data.sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-sheet">No hay ventas con estos filtros. Prueba otro mes o limpia los filtros.</td></tr>`;
    tbody.style.opacity = "1";
    fitGridHeight(); return;
  }
  let html = "";
  let ultimoMesClave = "";

  for (const [rowIndex, row] of visibleSales.entries()) {
    const mesClave = `${row.anio}-${row.mes}`;
    if (mesClave !== ultimoMesClave) {
      ultimoMesClave = mesClave;
      const collapsed = state.collapsedMonths.has(mesClave);
      const arrow = collapsed ? "▸" : "▾";
      const nombreMes = NOMBRES_MESES[row.mes] || "MES";
      html += `
        <tr class="month-separator-row" onclick="window.app.toggleMonthGroup('${mesClave}')">
          <td colspan="${cols.length + 1}">
            ${arrow} &nbsp;MES DE ${nombreMes} ${row.anio}
          </td>
        </tr>
      `;
    }

    if (state.collapsedMonths.has(mesClave)) continue;

    const estLow = String(row.estado || "").toLowerCase();
    let rowClass = "data-row";
    if (estLow.includes("instalad")) rowClass += " row-status-instalado";
    else if (estLow.includes("portad")) rowClass += " row-status-portado";
    else if (estLow.includes("cancel") || estLow.includes("rechaz") || estLow.includes("anulad")) rowClass += " row-status-cancelado";
    else if (estLow.includes("no realiz") || estLow.includes("no-realiz")) rowClass += " row-status-norealizado";
    else if (estLow.includes("pendi")) rowClass += " row-status-pendiente";

    html += `<tr class="${rowClass}" data-id="${row.id}">`;
    html += `
      <td class="row-actions-cell" style="white-space:nowrap; text-align:center;"><span class="row-number">${startIdx + rowIndex + 1}</span>
        ${canDeleteRow
        ? `<input type="checkbox" class="row-select-chk" data-row-id="${row.id}" onchange="window.app.onRowCheckChange(${row.id}, this.checked)" title="Seleccionar fila para eliminar" />`
        : ""
      }
        <button class="icon-btn" title="Ver ficha completa" onclick="window.app.openSaleDetail(${row.id})">📄</button>
        ${canDeleteRow
        ? `<button class="icon-btn" title="Eliminar esta fila" onclick="window.app.confirmDeleteRow(${row.id})">🗑️</button>`
        : ""
      }
      </td>
    `;

    for (const c of cols) {
      const val = row[c.key] ?? "";
      if (c.type === "status") {
        if (canChangeStatus) {
          const opts = estadosOpciones.includes(val) ? estadosOpciones : [val, ...estadosOpciones];
          html += `
            <td>
              <select class="status-select" onchange="window.app.changeRowStatus(${row.id}, this.value, this)">
                ${opts.map((o) => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}
              </select>
            </td>
          `;
        } else {
          html += `<td><span class="status-readonly-pill">${esc(val)}</span></td>`;
        }
      } else if (canEditColumnInCurrentView(c.key)) {
        const extraCls = state.vista === "moviles" ? " editable-highlight" : "";
        html += `
          <td
            tabindex="0" data-field="${c.key}" data-sale="${row.id}"
            class="editable-cell${extraCls}"
            title="Doble clic para editar: ${esc(val)}"
            ondblclick="window.app.startInlineEdit(this, ${row.id}, '${c.key}')"
          >${esc(val)}</td>
        `;
      } else {
        html += `<td tabindex="0" data-field="${c.key}" data-sale="${row.id}" title="${esc(val)}">${esc(val)}</td>`;
      }
    }

    html += `</tr>`;
  }

  tbody.innerHTML = html;
  tbody.style.opacity = "1";
  state.currentSheetSalesMap = new Map(visibleSales.map((s) => [s.id, s]));
  fitGridHeight();
}

function fitGridHeight() {
  const w = document.getElementById('sheetGridWrapper');
  if (!w) return;
  const top = w.getBoundingClientRect().top;
  const h = Math.max(260, window.innerHeight - top - 72);
  w.style.height = h + 'px';
}
window.addEventListener('resize', () => fitGridHeight());

function toggleMonthGroup(mesClave) {
  if (state.collapsedMonths.has(mesClave)) state.collapsedMonths.delete(mesClave);
  else state.collapsedMonths.add(mesClave);
  updateHeaderBrand();
  loadActiveSheet();
}

async function changeRowStatus(id, newStatus, selectEl) {
  if (state.vista !== "admin" && state.vista !== "subadmin") return;
  try {
    await api(`/api/sales/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: newStatus }),
    });
    const tr = selectEl.closest("tr");
    tr.className = "data-row";
    const low = newStatus.toLowerCase();
    if (low.includes("instalad")) tr.classList.add("row-status-instalado");
    else if (low.includes("portad")) tr.classList.add("row-status-portado");
    else if (low.includes("cancel") || low.includes("rechaz") || low.includes("anulad")) tr.classList.add("row-status-cancelado");
    else if (low.includes("no realiz") || low.includes("no-realiz")) tr.classList.add("row-status-norealizado");
    else tr.classList.add("row-status-pendiente");

    const sale = state.currentSheetSalesMap?.get(id) || (state.sales || []).find((s) => s.id === id);
    if (sale) sale.estado = newStatus;

    toast(`Estado cambiado a "${newStatus}"`);
  } catch (err) {
    toast("Error: " + err.message);
    updateHeaderBrand();
  loadActiveSheet();
  }
}

function startInlineEdit(td, saleId, fieldKey) {
  if (!canEditColumnInCurrentView(fieldKey)) return;
  if (td.querySelector("input") || state.editingCell) return;
  state.editingCell = true;
  const oldVal = td.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-editor";
  input.value = oldVal;
  td.textContent = "";
  td.appendChild(input);
  input.focus();
  input.select();

  let saved = false;
  const commit = async () => {
    if (saved) return;
    saved = true;
    const newVal = input.value.trim();
    td.textContent = newVal;
    if (newVal === oldVal) { finishCellEdit(); return; }
    try {
      const { data } = await api(`/api/sales/${saleId}`, {
        method: "PATCH",
        body: JSON.stringify({ [fieldKey]: newVal }),
      });
      td.textContent = data.sale[fieldKey] ?? newVal;
      if (state.currentSheetSalesMap.has(saleId)) {
        state.currentSheetSalesMap.set(saleId, data.sale);
      }
      toast("Cambio guardado");
    } catch (e) {
      td.textContent = oldVal;
      toast("Error: " + e.message);
    } finally { finishCellEdit(); }
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") commit();
    else if (ev.key === "Escape") {
      saved = true;
      td.textContent = oldVal;
      finishCellEdit();
    }
  });
  input.addEventListener("blur", commit);
}

async function addManualRow() {
  if (state.vista !== "admin" || !state.activeCompanySlug) return;
  const sup = (state.meta.supervisors[0] && state.meta.supervisors[0].nombre) || "Sin Asignar";
  await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      company_slug: state.activeCompanySlug,
      ejecutivo: "Nuevo Registro",
      supervisor: sup,
      forzar_duplicada: true,
      overrides: { nombre_cliente: "(Doble clic para editar)" },
    }),
  });
  toast("Fila agregada");
  updateHeaderBrand();
  loadActiveSheet();
}

async function confirmDeleteRow(id) {
  if (state.vista !== "admin" && state.vista !== "subadmin") return;
  if (!confirm("¿Eliminar esta venta de la maestra, Ventas Fenix y su supervisor? Se guardará un respaldo antes del cambio.")) return;
  await api(`/api/sales/${id}`, { method: "DELETE" });
  toast("Registro eliminado");
  updateHeaderBrand();
  loadActiveSheet();
  loadBootstrap();
}

function onRowCheckChange(id, checked) {
  const numId = Number(id);
  if (checked) state.selectedRowIds.add(numId);
  else state.selectedRowIds.delete(numId);
  updateBulkDeleteUI();
}

function toggleSelectAllRows(checked) {
  const chks = document.querySelectorAll("#sheetTbody .row-select-chk");
  chks.forEach((chk) => {
    chk.checked = checked;
    const id = Number(chk.getAttribute("data-row-id"));
    if (checked) state.selectedRowIds.add(id);
    else state.selectedRowIds.delete(id);
  });
  updateBulkDeleteUI();
}

function updateBulkDeleteUI() {
  const btn = document.getElementById("btnBulkDeleteRows");
  const cnt = document.getElementById("bulkDeleteCount");
  if (!btn || !cnt) return;
  const total = state.selectedRowIds.size;
  cnt.textContent = String(total);
  if (total > 0 && (state.vista === "admin" || state.vista === "subadmin")) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

async function confirmBulkDeleteRows() {
  if (state.vista !== "admin" && state.vista !== "subadmin") return;
  const ids = Array.from(state.selectedRowIds);
  if (ids.length === 0) return;
  if (!confirm(`¿Seguro que deseas eliminar las ${ids.length} fila(s) seleccionada(s)?`)) return;
  await api("/api/sales/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  state.selectedRowIds.clear();
  updateBulkDeleteUI();
  toast(`${ids.length} registro(s) eliminado(s)`);
  updateHeaderBrand();
  loadActiveSheet();
  loadBootstrap();
}

function openSaleDetail(id) {
  const s = state.currentSheetSalesMap.get(id);
  if (!s) return;
  document.getElementById("modalSearchTitle").textContent = `Venta #${s.id} — ${s.nombre_cliente || s.rut}`;
  document.getElementById("modalSearchBody").innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-bottom:14px; font-size:12.5px;">
      <div><b>Fecha:</b> ${esc(s.fecha)}</div>
      <div><b>Estado:</b> ${esc(s.estado)}</div>
      <div><b>Ejecutivo/a:</b> ${esc(s.ejecutivo)}</div>
      <div><b>Supervisor:</b> ${esc(s.supervisor)}</div>
      <div><b>RUT:</b> ${esc(s.rut)}</div>
      <div><b>Teléfono / Titular:</b> ${esc(s.numero_principal || s.telefono)}</div>
      ${s.adicional
      ? `<div style="grid-column:span 2;"><b>Números Adicionales (${s.cant_adicional}):</b> ${esc(s.adicional)}</div>`
      : ""
    }
      <div style="grid-column:span 2;"><b>Dirección Instalación:</b> ${esc(s.direccion)} (${esc(s.comuna)})</div>
      <div style="grid-column:span 2;"><b>Servicio / Plan:</b> ${esc(s.servicio)}</div>
    </div>
    ${s.imagen_url
      ? `<div style="margin-bottom:14px;"><b>Captura adjunta:</b><br/><img src="${esc(s.imagen_url)}" style="max-width:100%; border-radius:8px; margin-top:6px; border:1px solid #e2e8f0;" /></div>`
      : ""
    }
    <div>
      <b>Ficha Original:</b>
      <pre style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-top:6px; white-space:pre-wrap; font-family:inherit; font-size:12px;">${esc(
      s.ficha_original || "(Importado desde planilla histórica)"
    )}</pre>
    </div>
  `;
  document.getElementById("modalSearch").classList.remove("hidden");
}

async function exportActiveSheetCsv() {
  if (!state.activeCompanySlug) return;
  const qs = new URLSearchParams();
  if (state.supervisorFiltro) qs.set("supervisor", state.supervisorFiltro);
  if (state.vista === "moviles") qs.set("vista", "moviles");
  try {
    for (const [key, id] of [['mes','sheetMonthFilter'],['anio','sheetYearFilter'],['estado','sheetStatusFilter'],['q','sheetSearchInput']]) qs.set(key, document.getElementById(id).value);
    const resp = await fetch(apiUrl(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`), { headers: requestHeaders() });
    if (!resp.ok) throw new Error('No se pudo exportar esta hoja.');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.activeCompanySlug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) { toast(error.message); }
}

// ============================================================================
// 3. VENTAS DEL DÍA
// ============================================================================

function setDailyToday() {
  document.getElementById("dailyDatePicker").value = todayISO();
  loadDailySummary();
}

async function loadDailySummary(customFechaLatina = null) {
  const pickerVal = customFechaLatina || document.getElementById("dailyDatePicker").value;
  const qs = new URLSearchParams();
  if (pickerVal) qs.set("fecha", pickerVal);
  if (state.supervisorFiltro) qs.set("supervisor", state.supervisorFiltro);
  if (state.vista === "moviles") qs.set("vista", "moviles");

  const { data } = await api(`/api/summary/daily?${qs.toString()}`);

  document.getElementById("dailyTitle").textContent = `Ventas del Día · ${data.fecha} (Total: ${data.granTotal})`;

  const recentBar = document.getElementById("recentDatesBar");
  if (data.ultimasFechas && data.ultimasFechas.length > 0) {
    recentBar.innerHTML =
      `<span style="font-size:11.5px; color:#64748b;">Días recientes:</span>` +
      data.ultimasFechas
        .map(
          (u) =>
            `<button class="date-chip ${u.fecha === data.fecha ? "active" : ""}" onclick="window.app.loadDailySummary('${esc(
              u.fecha
            )}')">${esc(u.fecha)} (${u.cantidad})</button>`
        )
        .join("");
  }

  const container = document.getElementById("dailySummaryContainer");
  if (!data.bloques || data.bloques.length === 0) {
    container.innerHTML = `
      <div class="sup-daily-block" style="text-align:center; padding:34px; color:#64748b;">
        <h3>Sin ventas registradas el ${esc(data.fecha)}</h3>
        <p style="margin-top:4px;">Selecciona otra fecha arriba para consultar días anteriores.</p>
      </div>
    `;
    return;
  }

  // Calcular totales globales por compañía para la barra superior
  const compTotals = {};
  data.bloques.forEach((b) => {
    b.campanias.forEach((c) => {
      compTotals[c.titulo] = compTotals[c.titulo] || { titulo: c.titulo, color: c.color, total: 0 };
      compTotals[c.titulo].total += c.total;
    });
  });

  const kpisHtml = `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 20px; margin-bottom:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">🏢 Ventas por Compañía</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">
        ${Object.values(compTotals)
          .sort((a, b) => b.total - a.total)
          .map(
            (c) => `
            <div style="display:flex; align-items:center; gap:6px; background:#f8fafc; border:1px solid #e2e8f0; padding:6px 12px; border-radius:20px; font-size:13px;">
              <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${esc(c.color)};"></span>
              <span>${esc(c.titulo)}:</span>
              <strong style="color:#0f172a;">${c.total}</strong>
            </div>
          `
          )
          .join("")}
      </div>

      <div style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">👑 Ventas por Supervisor</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${data.bloques
          .map(
            (b) => `
            <div style="display:flex; align-items:center; gap:6px; background:#f0fdf4; border:1px solid #bbf7d0; padding:6px 12px; border-radius:20px; font-size:13px; color:#166534;">
              <span>👤 <b>${esc(b.supervisor)}:</b></span>
              <span style="background:#16a34a; color:#fff; border-radius:10px; padding:1px 7px; font-size:11.5px; font-weight:700;">${b.total}</span>
            </div>
          `
          )
          .join("")}
      </div>
    </div>
  `;

  container.innerHTML =
    kpisHtml +
    data.bloques
      .map(
        (b) => `
      <div class="sup-daily-block" style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; margin-bottom:24px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <div class="sup-daily-header" style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:14px 20px;">
          <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:16px;">
            <span>👤</span>
            <span>Equipo: <b>${esc(b.supervisor)}</b></span>
          </h3>
          <span class="sup-total-pill" style="background:#0f172a; color:#fff; font-weight:700; font-size:13px; padding:4px 12px; border-radius:20px;">TOTAL: ${b.total}</span>
        </div>
        <div class="camp-cards-grid" style="padding:16px; background:#fff;">
          ${b.campanias
            .map(
              (c) => `
              <div class="camp-daily-card" style="border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                <div class="camp-daily-head" style="background:${esc(c.color)}; color:#fff; font-weight:700; padding:10px 14px; font-size:13px;">${esc(c.titulo)}</div>
                <div class="camp-daily-sub" style="padding:6px 12px; background:#f8fafc; border-bottom:1px solid #f1f5f9; font-size:12px; color:#475569;">
                  <span>👤 Supervisor: <b>${esc(b.supervisor)}</b></span>
                </div>
                <div class="camp-daily-list" style="padding:10px 12px;">
                  ${c.listaEjecutivos
                    .map(
                      (ej, idx) => {
                        const medal = idx === 0 && ej.cantidad > 1 ? "🥇 " : idx === 1 && ej.cantidad > 1 ? "🥈 " : idx === 2 && ej.cantidad > 1 ? "🥉 " : "";
                        return `
                          <div class="camp-exec-row" style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px dashed #f1f5f9; font-size:12.5px;">
                            <span>${medal}${esc(ej.nombre)}</span>
                            <b style="background:#f1f5f9; padding:2px 7px; border-radius:10px; color:#0f172a;">${ej.cantidad}</b>
                          </div>
                        `;
                      }
                    )
                    .join("")}
                </div>
                <div class="camp-daily-foot" style="background:#f8fafc; border-top:1px solid #e2e8f0; color:#334155; font-weight:700; padding:8px 12px; font-size:12px; text-align:right;">
                  Subtotal: <b style="color:${esc(c.color)}; font-size:13px;">${c.total}</b>
                </div>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
    `
      )
      .join("");
}

// ============================================================================
// 4. PAGOS ADICIONALES (Admin Principal y Segunda Hoja Admin)
// ============================================================================

async function loadPayments() {
  if (state.vista !== "admin" && state.vista !== "subadmin") return;
  const mes = document.getElementById("payMonthSelect").value;
  const anio = document.getElementById("payYearSelect").value;
  const { data } = await api(`/api/payments?mes=${mes}&anio=${anio}`);

  const nombreMes = NOMBRES_MESES[data.mes] || "";
  document.getElementById("paymentsTitle").textContent = `Pagos Adicionales · ${nombreMes} ${data.anio}`;

  if (state.vista === "admin") {
    document.getElementById("cfgPagoPaq").value = data.tarifas.PAGO_PAQ;
    document.getElementById("cfgPagoFibra").value = data.tarifas.PAGO_FIBRA;
    document.getElementById("cfgPagoClaro").value = data.tarifas.PAGO_CLARO;

    document.getElementById("goalsListGrid").innerHTML = (data.executiveGoals || [])
      .map(
        (g) => `
        <div class="goal-item">
          <span>${esc(g.nombre)}</span>
          <input
            type="number"
            min="0"
            value="${g.minimo_ventas}"
            onchange="window.app.saveExecGoal('${esc(g.ejecutiva_norm)}', '${esc(g.nombre)}', this.value)"
          />
        </div>
      `
      )
      .join("");
  }

  document.getElementById("paymentsSummaryBanner").innerHTML = `
    <div class="kpi-pill">Período: <b>${nombreMes} ${data.anio}</b></div>
    <div class="kpi-pill">Supervisores activos: <b>${data.tarjetasSupervisores.length}</b></div>
    <div class="kpi-pill">Total Pagos del Mes: <b style="color:#1d4ed8; font-size:14.5px;">${fmtMoney(
    data.granTotalDinero
  )}</b></div>
  `;

  const grid = document.getElementById("paymentsCardsGrid");
  if (data.tarjetasSupervisores.length === 0) {
    const syncBtn =
      state.vista === "admin"
        ? `<button class="btn btn-primary" onclick="document.getElementById('sheetsFileInput').click()">📥 Subir Google Sheets (.xlsx) ahora</button>`
        : "";
    grid.innerHTML = `
      <div class="sup-daily-block" style="grid-column:1/-1; text-align:center; padding:28px; color:#334155;">
        <div style="font-size:14px; font-weight:600; margin-bottom:6px;">
          No hay ventas en estado <b>Instalado</b> o <b>Portado</b> registradas en Fenix CRM para <b>${nombreMes} ${data.anio}</b>.
        </div>
        <div style="font-size:12.5px; color:#64748b; max-width:640px; margin:0 auto 14px; line-height:1.5;">
          La copia local precargada llegaba hasta el <b>04/09/2026</b> (puedes ver por ejemplo <b>Agosto 2026</b> con sus <b>$540.000</b> exactos). Para traer <b>Octubre y Noviembre 2026</b> desde tu Google Sheets privado, sincronízalo en 1 clic desde el menú de tu planilla o sube el archivo <code>.xlsx</code>.
        </div>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          ${syncBtn}
          <button class="btn btn-outline" onclick="document.getElementById('payMonthSelect').value='7'; document.getElementById('payYearSelect').value='2026'; window.app.loadPayments();">👀 Ver ejemplo Agosto 2026 ($540.000)</button>
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = data.tarjetasSupervisores
    .map((sup) => {
      return `
        <div class="pay-sup-card">
          <div class="pay-sup-head">
            <span>👤 ${esc(sup.supervisor)}</span>
            <span>${fmtMoney(sup.subtotalDinero)}</span>
          </div>
          <div style="overflow-x:auto;">
            <table class="pay-table">
              <thead>
                <tr>
                  <th>Ejecutiva</th>
                  <th>Paq</th>
                  <th>Fib</th>
                  ${sup.mostrarClaro ? "<th>C/V</th>" : ""}
                  ${sup.mostrarMovil ? "<th>E.M. Tit</th><th>E.M. Adi</th>" : ""}
                  ${sup.mostrarPyme ? "<th>Pyme</th>" : ""}
                  ${sup.mostrarPymeMovil ? "<th>P.M. Tit</th><th>P.M. Adi</th>" : ""}
                  ${sup.mostrarAA ? "<th>A&A</th>" : ""}
                  ${sup.customInitials.map((ini) => `<th>${esc(ini)}</th>`).join("")}
                  <th>$ Paq</th>
                  <th>$ Fib</th>
                  ${sup.mostrarClaro ? "<th>$ C/V</th>" : ""}
                  <th>$ Total</th>
                </tr>
              </thead>
              <tbody>
                ${sup.ejecutivos
          .map(
            (e) => `
                  <tr>
                    <td>${esc(e.nombre)}</td>
                    <td>${e.paq}</td>
                    <td>${e.fib}</td>
                    ${sup.mostrarClaro ? `<td>${e.claroVtr}</td>` : ""}
                    ${sup.mostrarMovil ? `<td>${e.emTit}</td><td>${e.emAdi}</td>` : ""}
                    ${sup.mostrarPyme ? `<td>${e.pyme}</td>` : ""}
                    ${sup.mostrarPymeMovil ? `<td>${e.pmTit}</td><td>${e.pmAdi}</td>` : ""}
                    ${sup.mostrarAA ? `<td>${e.aa}</td>` : ""}
                    ${sup.customInitials.map((ini) => `<td>${(e.customCounts && e.customCounts[ini]) || 0}</td>`).join("")}
                    <td class="pay-money">${fmtMoney(e.dineroPaq)}</td>
                    <td class="pay-money">${fmtMoney(e.dineroFib)}</td>
                    ${sup.mostrarClaro ? `<td class="pay-money">${fmtMoney(e.dineroClaro)}</td>` : ""}
                    <td class="pay-money">${fmtMoney(e.dineroTotal)}</td>
                  </tr>
                `
          )
          .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
}

function toggleGoalsConfig() {
  if (state.vista !== "admin") return;
  document.getElementById("goalsConfigPanel").classList.toggle("hidden");
}

async function saveTarifas() {
  await api("/api/payments/settings", {
    method: "PATCH",
    body: JSON.stringify({
      PAGO_PAQ: Number(document.getElementById("cfgPagoPaq").value),
      PAGO_FIBRA: Number(document.getElementById("cfgPagoFibra").value),
      PAGO_CLARO: Number(document.getElementById("cfgPagoClaro").value),
    }),
  });
  toast("Tarifas actualizadas");
  loadPayments();
}

async function saveExecGoal(norm, nombre, val) {
  await api("/api/payments/goals", {
    method: "PATCH",
    body: JSON.stringify({ ejecutiva_norm: norm, nombre, minimo_ventas: Number(val) }),
  });
  toast(`Mínimo de ${nombre}: ${val}`);
  loadPayments();
}

// ============================================================================
// 5. ACCESOS POR CORREO (ESTILO GOOGLE SHEETS) Y GESTIÓN DE SUPERVISORES
// ============================================================================

function renderEmailChipsBox(kind, targetId, correosStr, placeholderTxt = "Agregar correo (ej: nombre@gmail.com)...") {
  const emails = splitEmailsClient(correosStr);
  const encodedList = encodeURIComponent(emails.join(", "));
  const inputId = `emailAdd_${kind}_${targetId}`;

  const chipsHtml =
    emails.length > 0
      ? emails
        .map(
          (em) => `
          <span class="email-chip-tag">
            <span>✉️ ${esc(em)}</span>
            <button
              type="button"
              class="email-chip-remove"
              title="Quitar permiso a ${esc(em)}"
              onclick="window.app.removeAuthorizedEmail('${esc(kind)}', '${esc(targetId)}', '${esc(
            em
          )}', '${encodedList}')"
            >×</button>
          </span>
        `
        )
        .join("")
      : `<span style="font-size:11.5px; color:#94a3b8;">${kind === "view" && targetId === "admin"
        ? "Sin restricción de correo (entra directo). Si agregas tu correo, lo pedirá al entrar."
        : "⚠️ Sin correos autorizados aún (nadie puede entrar hasta que agregues un correo)."
      }</span>`;

  return `
    <div class="email-access-box">
      <div class="email-access-label">
        <span>🔒 Correos con permiso para entrar (${emails.length})</span>
      </div>
      <div class="email-chips-list">${chipsHtml}</div>
      <div class="email-add-row">
        <input
          type="email"
          id="${esc(inputId)}"
          placeholder="${esc(placeholderTxt)}"
          onkeydown="if(event.key==='Enter'){event.preventDefault();window.app.addAuthorizedEmail('${esc(
    kind
  )}','${esc(targetId)}','${encodedList}');}"
        />
        <button
          type="button"
          class="btn btn-outline btn-sm"
          onclick="window.app.addAuthorizedEmail('${esc(kind)}','${esc(targetId)}','${encodedList}')"
        >+ Dar acceso</button>
      </div>
    </div>
  `;
}

async function addAuthorizedEmail(kind, targetId, encodedCurrent) {
  const inputEl = document.getElementById(`emailAdd_${kind}_${targetId}`);
  if (!inputEl) return;
  const newRaw = inputEl.value.trim().toLowerCase();
  if (!newRaw || !newRaw.includes("@")) {
    return toast("Escribe un correo electrónico válido (con @)");
  }
  const currentList = splitEmailsClient(decodeURIComponent(encodedCurrent || ""));
  const merged = [...new Set([...currentList, ...splitEmailsClient(newRaw)])].join(", ");

  if (kind === "view") {
    await api("/api/access/view", {
      method: "PATCH",
      body: JSON.stringify({ vista_key: targetId, correos_autorizados: merged }),
    });
  } else {
    await api("/api/access/supervisor", {
      method: "PATCH",
      body: JSON.stringify({ id: Number(targetId), correos_autorizados: merged }),
    });
  }
  inputEl.value = "";
  toast(`Permiso concedido a ${newRaw}`);
  await loadBootstrap();
}

async function removeAuthorizedEmail(kind, targetId, emailToRemove, encodedCurrent) {
  const currentList = splitEmailsClient(decodeURIComponent(encodedCurrent || ""));
  const nextList = currentList.filter((e) => e !== emailToRemove.toLowerCase()).join(", ");

  if (kind === "view") {
    await api("/api/access/view", {
      method: "PATCH",
      body: JSON.stringify({ vista_key: targetId, correos_autorizados: nextList }),
    });
  } else {
    await api("/api/access/supervisor", {
      method: "PATCH",
      body: JSON.stringify({ id: Number(targetId), correos_autorizados: nextList }),
    });
  }
  toast(`Permiso revocado a ${emailToRemove}`);
  await loadBootstrap();
}

function renderSupervisorsPanel() {
  if (!state.meta || state.vista !== "admin") return;

  const viewsList = (state.meta.accessPermissions && state.meta.accessPermissions.views) || [];
  const byKey = Object.fromEntries(viewsList.map((v) => [v.vista_key, v.correos_autorizados || ""]));

  const generalGrid = document.getElementById("generalViewsAccessGrid");
  if (generalGrid) {
    generalGrid.innerHTML = `
      <!-- 1. FORMULARIO SEPARADO PARA EJECUTIVOS -->
      <div class="integ-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <span class="sl-badge">Formulario Aislado (Ejecutivos)</span>
            <h3>📝 Formulario de Ingreso de Ventas (/?vista=formulario)</h3>
            <p class="integ-desc" style="margin-bottom:8px;">
              100% separado de las hojas de ventas. Los ejecutivos solo ven el formulario limpio y no tienen acceso a ninguna pestaña ni base de datos.
            </p>
          </div>
          <div class="sl-actions">
            <button class="btn btn-outline btn-sm" onclick="window.open('/?vista=formulario', '_blank')">Abrir ↗</button>
            <button class="btn btn-primary btn-sm" onclick="window.app.copyFormLink()">Copiar Link</button>
          </div>
        </div>
        <div class="email-access-box" style="background:#f0fdf4; border-color:#bbf7d0; color:#166534; font-size:12px;">
          ✅ <b>Acceso libre con el link:</b> Cualquier ejecutivo con el enlace puede subir fichas sin ver las hojas.
        </div>
      </div>

      <!-- 2. VENTAS FENIX (EDICIÓN DE VENTAS + PAGOS) -->
      <div class="integ-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <span class="sl-badge" style="background:#fef3c7; color:#92400e;">Ventas Fenix</span>
            <h3>📊 Ventas Fenix (/?vista=ventas-fenix)</h3>
            <p class="integ-desc" style="margin-bottom:6px;">
              Solo muestra <b>Hojas de Ventas</b>, <b>Ventas del Día</b> y <b>Pagos Adicionales</b>. Permite editar ventas existentes, y eliminarlas para todos. Incluye las vistas de supervisores en solo lectura; no permite abrir el panel maestro ni cambiar tarifas o accesos.
            </p>
          </div>
          <div class="sl-actions">
            <button class="btn btn-outline btn-sm" onclick="window.open('/?vista=ventas-fenix', '_blank')">Abrir ↗</button>
            <button class="btn btn-primary btn-sm" onclick="window.app.copyLink('/?vista=ventas-fenix', 'Link de Ventas Fenix copiado')">Copiar Link</button>
          </div>
        </div>
        ${renderEmailChipsBox("view", "subadmin", byKey.subadmin || "")}
      </div>

      <!-- 3. HOJA ESPEJO MÓVILES -->
      <div class="integ-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <span class="sl-badge sl-badge-movil">Espejo Móviles</span>
            <h3>📱 Vista Móviles — Solo Notas y Seguimiento (/?vista=moviles)</h3>
            <p class="integ-desc" style="margin-bottom:6px;">
              Incluye Movistar Móvil, Claro Móvil, Entel Móvil y A&A Sales (oculta Entel Pyme Móvil). Bloquea los datos del cliente y solo deja editar Notas y Seguimiento.
            </p>
          </div>
          <div class="sl-actions">
            <button class="btn btn-outline btn-sm" onclick="window.open('/?vista=moviles', '_blank')">Abrir ↗</button>
            <button class="btn btn-primary btn-sm" onclick="window.app.copyLink('/?vista=moviles', 'Link de Espejo Móviles copiado')">Copiar Link</button>
          </div>
        </div>
        ${renderEmailChipsBox("view", "moviles", byKey.moviles || "")}
      </div>

      <!-- 4. ADMIN PRINCIPAL -->
      <div class="integ-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <span class="sl-badge">Tu Panel Maestro</span>
            <h3>👑 Admin Principal (/)</h3>
            <p class="integ-desc" style="margin-bottom:6px;">
              Control total de compañías, supervisores, tarifas e integraciones. Si agregas tu correo aquí, también pedirá tu correo al abrir el panel principal en internet.
            </p>
          </div>
        </div>
        ${renderEmailChipsBox("view", "admin", byKey.admin || "", "Tu correo de Admin Principal...")}
      </div>
    `;
  }

  const allSupervisors = state.meta.supervisors || [];
  const totalCount = allSupervisors.length;
  const activeCount = allSupervisors.filter((s) => s.activo !== false).length;
  const inactiveCount = totalCount - activeCount;

  const countAllEl = document.getElementById("countSupsAll");
  const countActEl = document.getElementById("countSupsActive");
  const countInactEl = document.getElementById("countSupsInactive");
  if (countAllEl) countAllEl.textContent = String(totalCount);
  if (countActEl) countActEl.textContent = String(activeCount);
  if (countInactEl) countInactEl.textContent = String(inactiveCount);

  const filterMode = state.supFilterMode || "todos";
  const searchQ = (state.supSearchQuery || "").toLowerCase().trim();

  const filteredSups = allSupervisors.filter((s) => {
    const isActive = s.activo !== false;
    if (filterMode === "activos" && !isActive) return false;
    if (filterMode === "inactivos" && isActive) return false;
    if (searchQ) {
      const matchName = String(s.nombre || "").toLowerCase().includes(searchQ);
      const matchComp = String(s.companiaTexto || s.compania || "").toLowerCase().includes(searchQ);
      const matchAliases = String(s.aliases || "").toLowerCase().includes(searchQ);
      const matchEmails = String(s.correos_autorizados || "").toLowerCase().includes(searchQ);
      if (!matchName && !matchComp && !matchAliases && !matchEmails) return false;
    }
    return true;
  });

  const grid = document.getElementById("supervisorsGrid");
  if (!grid) return;

  if (filteredSups.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 28px; text-align: center; color: #64748b; background: #fff; border: 1px dashed #cbd5e1; border-radius: 10px;">
        No se encontraron supervisores ${filterMode === "activos" ? "activos" : filterMode === "inactivos" ? "inactivos" : ""} con el filtro actual.
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredSups
    .map((s) => {
      const relUrl = `/?vista=supervisor&sup=${encodeURIComponent(s.token_acceso)}`;
      const ini = s.nombre.charAt(0).toUpperCase();
      const isActive = s.activo !== false;
      const compLabel = s.companiaTexto || s.compania || "Fenix Multi-Compañía";
      return `
        <div class="sup-card ${isActive ? '' : 'is-inactive'}">
          <div class="sup-card-top">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <div class="sup-avatar" style="${isActive ? '' : 'background:#e2e8f0; color:#64748b;'}">${esc(ini)}</div>
              <div style="min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span style="font-weight:700; font-size:13.5px; color:${isActive ? '#0f172a' : '#64748b'};">${esc(s.nombre)}</span>
                  <span class="sup-status-badge ${isActive ? 'sup-status-active' : 'sup-status-inactive'}">
                    <span class="${isActive ? 'sup-dot-active' : 'sup-dot-inactive'}"></span> ${isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div class="sup-company-badge" title="Compañía asociada a este acceso">
                  🏢 <b>Compañía:</b> ${esc(compLabel)}
                </div>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">Solo lectura · Alias: ${esc(s.aliases)}</div>
              </div>
            </div>
            <div style="display:flex; gap:5px; flex-shrink:0; align-items:center;">
              ${isActive
                ? `<button class="btn btn-outline btn-sm" onclick="window.app.toggleSupervisorStatus(${s.id}, false)" title="Desactivar temporalmente este acceso">Desactivar</button>`
                : `<button class="btn btn-success btn-sm" onclick="window.app.toggleSupervisorStatus(${s.id}, true)" title="Reactivar acceso">Activar</button>`
              }
              <button class="btn btn-outline btn-sm" onclick="window.open('${relUrl}', '_blank')" title="Abrir portal del supervisor">Abrir ↗</button>
              <button class="btn btn-primary btn-sm" onclick="window.app.copyLink('${relUrl}', 'Link de ${esc(s.nombre)} copiado')">Copiar Link</button>
              <button class="btn btn-outline btn-sm" onclick="window.app.removeSupervisor(${s.id}, '${esc(s.nombre)}')" title="Eliminar supervisor">✕</button>
            </div>
          </div>
          ${renderEmailChipsBox("sup", String(s.id), s.correos_autorizados || "", `Correo de ${s.nombre}...`)}
        </div>
      `;
    })
    .join("");
}

async function addSupervisor() {
  const nombre = document.getElementById("newSupName").value.trim();
  const company = (document.getElementById("newSupCompany")?.value || "").trim();
  const aliases = document.getElementById("newSupAliases").value.trim();
  const correos = document.getElementById("newSupEmails").value.trim();
  if (!nombre) return toast("Escribe el nombre del supervisor");

  await api("/api/supervisors", {
    method: "POST",
    body: JSON.stringify({
      nombre,
      compania: company,
      aliases: aliases || nombre,
      correos_autorizados: correos,
    }),
  });
  document.getElementById("newSupName").value = "";
  if (document.getElementById("newSupCompany")) document.getElementById("newSupCompany").value = "";
  document.getElementById("newSupAliases").value = "";
  document.getElementById("newSupEmails").value = "";
  toast(`Supervisor "${nombre}" agregado`);
  await loadBootstrap();
}

async function toggleSupervisorStatus(id, newActivo) {
  try {
    await api(`/api/supervisors/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ activo: newActivo }),
    });
    toast(newActivo ? "Supervisor activado" : "Supervisor desactivado");
    await loadBootstrap();
  } catch (err) {
    toast("Error: " + err.message);
  }
}

function filterSupervisors(mode) {
  state.supFilterMode = mode;
  const bar = document.getElementById("supFilterPills");
  if (bar) {
    bar.querySelectorAll(".sup-filter-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === mode);
    });
  }
  renderSupervisorsPanel();
}

function onSupervisorSearch(q) {
  state.supSearchQuery = q;
  renderSupervisorsPanel();
}

async function removeSupervisor(id, nombre) {
  if (!confirm(`¿Quitar al supervisor "${nombre}" de la lista? (Sus ventas se conservan).`)) return;
  await api(`/api/supervisors/${id}`, { method: "DELETE" });
  toast(`Supervisor eliminado`);
  await loadBootstrap();
}

function copyLink(relPath, msg) {
  const full = window.location.origin + relPath;
  navigator.clipboard.writeText(full);
  toast(`${msg}`);
}

function copyFormLink() {
  copyLink("/?vista=formulario", "Link del Formulario copiado");
}

function copyApiEndpoint(relPath) {
  const full = window.location.origin + relPath;
  navigator.clipboard.writeText(full);
  toast(`URL copiada: ${full}`);
}

function refreshIntegracionesUrls() {
  const origin = window.location.origin;
  document.getElementById("epUrlDaily").textContent = `${origin}/api/n8n/ventas-del-dia`;
  document.getElementById("epUrlRange").textContent = `${origin}/api/n8n/ventas?desde=01/11/2026&hasta=08/11/2026&hoja=todas`;
}

async function testN8nTelegramPreview() {
  const box = document.getElementById("n8nTelegramPreview");
  box.textContent = "Consultando API de n8n...";
  try {
    let { data } = await api("/api/n8n/ventas-del-dia");
    if (data.granTotal === 0 && data.ultimasFechas && data.ultimasFechas.length > 0) {
      const ultima = data.ultimasFechas[0].fecha;
      const resp2 = await api(`/api/n8n/ventas-del-dia?fecha=${encodeURIComponent(ultima)}`);
      data = resp2.data;
    }
    box.textContent = data.texto_telegram;
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

function handleSheetsImportFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (file) processImportedSheetsFile(file);
}

function processImportedSheetsFile(file) {
  const statusBox = document.getElementById("sheetsImportStatus");
  if (!confirm('Esta importación reemplaza el historial compartido para todos. Se guardará un respaldo automático. ¿Continuar?')) return;
  const isJson = file.name.toLowerCase().endsWith(".json");
  if (statusBox) {
    statusBox.innerHTML = `⏳ <b>Importando ${esc(file.name)}...</b> Por favor espera unos segundos.`;
  }
  toast(`Importando ${file.name}...`);

  if (isJson) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.format === 'fenix-backup-v1') {
          const { data: restored } = await api('/api/restore', { method:'POST', body:JSON.stringify({confirm:'RESTAURAR',backup:parsed}) });
          if (statusBox) statusBox.textContent = `Respaldo restaurado: ${restored.total} ventas compartidas.`;
          await loadBootstrap(); refreshCurrentTab(); return;
        }
        const { data } = await api("/api/import/snapshot", {
          method: "POST",
          body: JSON.stringify({ reset: true, snapshot: parsed }),
        });
        if (statusBox) {
          statusBox.innerHTML = `✅ <b>¡Importación completada!</b> ${data.imported} ventas y ${data.companiesCount} hojas sincronizadas.`;
        }
        toast(`Sincronizadas ${data.imported} ventas`);
        await loadBootstrap();
        refreshCurrentTab();
      } catch (err) {
        if (statusBox) statusBox.innerHTML = `❌ <b>Error al importar JSON:</b> ${esc(err.message)}`;
        toast("Error: " + err.message);
      }
    };
    reader.readAsText(file);
  } else {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { data } = await api("/api/import/xlsx", {
          method: "POST",
          body: JSON.stringify({ reset: true, base64: reader.result }),
        });
        if (statusBox) {
          statusBox.innerHTML = `✅ <b>¡Excel de Google Sheets importado con éxito!</b> ${data.imported} ventas cargadas en ${data.sheetsImported} hojas.`;
        }
        toast(`Importadas ${data.imported} ventas desde Excel`);
        await loadBootstrap();
        refreshCurrentTab();
      } catch (err) {
        if (statusBox) statusBox.innerHTML = `❌ <b>Error al leer .xlsx:</b> ${esc(err.message)}`;
        toast("Error: " + err.message);
      }
    };
    reader.readAsDataURL(file);
  }
}

function openNewCompanyModal() {
  const sel = document.getElementById("ncPlantilla");
  sel.innerHTML = (state.meta.companies || [])
    .map(
      (c) =>
        `<option value="${esc(c.slug)}" data-movil="${c.usa_portado ? "1" : "0"}">${esc(c.hoja)} ${c.usa_portado ? "(Móvil / Portado)" : "(Fibra / Instalado)"
        }</option>`
    )
    .join("");
  onTemplateCompanyChange();
  document.getElementById("modalNewCompany").classList.remove("hidden");
}

function onTemplateCompanyChange() {
  const sel = document.getElementById("ncPlantilla");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("ncEspejoMovil").checked = !!(opt && opt.dataset.movil === "1");
}

function suggestCompanyInitials() {
  const n = document.getElementById("ncNombre").value.trim();
  const words = n.split(/\s+/).filter(Boolean);
  const ini = words.length > 1 ? words.map((w) => w[0]).join("") : n.slice(0, 3);
  document.getElementById("ncIniciales").value = ini.toUpperCase();
}

async function submitNewCompany() {
  const nombre = document.getElementById("ncNombre").value.trim();
  const iniciales = document.getElementById("ncIniciales").value.trim();
  const hoja = document.getElementById("ncHoja").value.trim();
  const plantilla_slug = document.getElementById("ncPlantilla").value;
  const es_movil_espejo = document.getElementById("ncEspejoMovil").checked;

  try {
    const { data } = await api("/api/companies", {
      method: "POST",
      body: JSON.stringify({ nombre, iniciales, hoja, plantilla_slug, es_movil_espejo }),
    });
    closeModals();
    document.getElementById("ncNombre").value = "";
    document.getElementById("ncIniciales").value = "";
    document.getElementById("ncHoja").value = "";
    await loadBootstrap();
    state.activeCompanySlug = data.company.slug;
    switchTab("hojas");
    toast(`Compañía "${data.company.hoja}" creada`);
  } catch (err) {
    toast("Error: " + err.message);
  }
}

async function runGlobalSearch() {
  const q = document.getElementById("globalSearchInput").value.trim();
  if (q.length < 2) return toast("Escribe al menos 2 caracteres para buscar");

  const qs = new URLSearchParams({ q });
  if (state.supervisorFiltro) qs.set("supervisor", state.supervisorFiltro);
  if (state.vista === "moviles") qs.set("vista", "moviles");

  const { data } = await api(`/api/search?${qs.toString()}`);
  document.getElementById("modalSearchTitle").textContent = `${data.results.length} resultado(s) para "${q}"`;

  if (data.results.length === 0) {
    document.getElementById("modalSearchBody").innerHTML = `<p style="padding:20px; text-align:center; color:#64748b;">No se encontraron ventas para "${esc(
      q
    )}".</p>`;
  } else {
    document.getElementById("modalSearchBody").innerHTML = data.results
      .map(
        (r) => `
        <div style="border:1px solid #e2e8f0; border-radius:9px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div>
            <div style="font-size:11.5px; font-weight:600; color:${esc(r.color)};">${esc(r.hoja)} · ${esc(
          r.fecha
        )} · ${esc(r.estado)}</div>
            <div style="font-size:13px; font-weight:600; margin-top:2px;">${esc(
          r.nombre_cliente || "Sin nombre"
        )} — RUT: ${esc(r.rut)}</div>
            <div style="font-size:11.5px; color:#64748b;">${esc(r.direccion)} (${esc(r.comuna)}) · Tel: ${esc(
          r.numero_principal || r.telefono
        )} · Ejecutiva: <b>${esc(r.ejecutivo)}</b> (${esc(r.supervisor)})</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="window.app.jumpToSearchResult('${esc(r.company_slug)}', '${esc(
          r.rut || r.nombre_cliente
        )}')">Ver</button>
        </div>
      `
      )
      .join("");
  }
  document.getElementById("modalSearch").classList.remove("hidden");
}

function jumpToSearchResult(slug, term) {
  closeModals();
  state.activeCompanySlug = slug;
  document.getElementById("sheetSearchInput").value = term;
  switchTab("hojas");
}

function closeModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}

window.app = {
  onBrandClick,
  switchTab,
  submitEmailGate,
  logoutEmailSession,
  selectBrand,
  selectVariant,
  selectClickOption,
  syncComunaInputs,
  onFormSupervisorChange,
  handleImageFile,
  triggerFichaPreview,
  handleFormSubmit,
  forceSubmitDuplicate,
  clearSaleForm,
  fillSampleFicha,
  selectCompanyTab,
  debouncedLoadSheet,
  loadActiveSheet,
  changeSheetPage,
  onPageSizeChange,
  toggleMonthGroup,
  changeRowStatus,
  startInlineEdit,
  addManualRow,
  confirmDeleteRow,
  onRowCheckChange,
  toggleSelectAllRows,
  confirmBulkDeleteRows,
  openSaleDetail,
  exportActiveSheetCsv,
  setDailyToday,
  loadDailySummary,
  loadPayments,
  toggleGoalsConfig,
  saveTarifas,
  saveExecGoal,
  addAuthorizedEmail,
  removeAuthorizedEmail,
  addSupervisor,
  removeSupervisor,
  toggleSupervisorStatus,
  filterSupervisors,
  onSupervisorSearch,
  copyLink,
  copyFormLink,
  copyApiEndpoint,
  testN8nTelegramPreview,
  handleSheetsImportFile,
  openNewCompanyModal,
  onTemplateCompanyChange,
  suggestCompanyInitials,
  submitNewCompany,
  closeModals,
  jumpToSearchResult,
};

window.addEventListener("DOMContentLoaded", init);

