// ============================================================================
// FENIX CRM - SERVIDOR FULL-STACK + API EN TIEMPO REAL (SSE) + N8N / TELEGRAM
// ============================================================================
const http = require("node:http");
const auth = require("./auth");
const { snapshot, backupBeforeChange, restoreSnapshot } = require("./backups");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const {
  db,
  UPLOADS_DIR,
  submitFormSale,
  updateSaleFields,
  deleteSale,
  bulkDeleteSales,
  getCompanySales,
  getDailySummary,
  getPaymentsReport,
  getPaymentSettings,
  getBotSession,
  upsertBotSession,
  querySalesForN8n,
  createCustomCompany,
  upsertSupervisor,
  deleteSupervisor,
  getAccessPermissions,
  updateViewEmails,
  updateSupervisorEmails,
  verifyViewEmailAccess,
  updateExecutiveGoal,
  updatePaymentTarifas,
  globalSearch,
  getFormMetadata,
  resolveCompanyDestination,
  checkDuplicateSale,
} = require("./db");
const { parsearFichaCompleta } = require("./fichaParser");
const { seedIfEmpty, importSheetsDictionary } = require("./seed");
const { parseXlsxBuffer } = require("./xlsxReader");

// La base central se carga únicamente mediante restauración o importación explícita.

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3456);
const N8N_API_KEY = process.env.N8N_API_KEY || "fenix_n8n_secret_token_2026";

// Clientes conectados en vivo por Server-Sent Events (SSE)
const sseClients = new Set();

function broadcastEvent(type, payload = {}) {
  const safePayload = { company_slug: payload.company_slug || payload.sale?.company_slug };
  const msg = `data: ${JSON.stringify({ type, payload: safePayload, ts: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://bot-n8n.7lshe4.easypanel.host/webhook/web";

function notificarN8n(sale, company, rawBody = {}) {
  if (!N8N_WEBHOOK_URL) return;
  try {
    const compNombre = company ? (company.nombre || company.hoja) : (sale.company_slug || "");
    const tipoVenta = rawBody.tipo_venta || sale.servicio || (company ? company.hoja : "");
    const ficha = sale.ficha_original || rawBody.ficha || "";
    let imgUrl = sale.imagen_url || rawBody.imagen_url || "";
    if (imgUrl && !imgUrl.startsWith("http")) {
      const baseUrl = process.env.PUBLIC_APP_URL || "https://fenix-crm-production-f20e6e67.up.railway.app";
      imgUrl = baseUrl.replace(/\/+$/, "") + (imgUrl.startsWith("/") ? "" : "/") + imgUrl;
    }
    const payload = {
      source: "fenix_crm",
      compania: compNombre,
      tipoVenta,
      ejecutivo: sale.ejecutivo || "",
      supervisor: sale.supervisor || "",
      ficha,
      imagenUrl: imgUrl,
      cliente: {
        nombre: sale.nombre_cliente || "",
        rut: sale.rut || "",
        telefono: sale.telefono || sale.numero_principal || "",
        direccion: sale.direccion || "",
        comuna: sale.comuna || "",
        servicio: sale.servicio || "",
        id_orden: sale.id_orden || ""
      },
      data: {
        fields: [
          { label: "Compañía", value: compNombre },
          { label: "Tipo de venta", value: tipoVenta },
          { label: "Ejecutivo", value: sale.ejecutivo || "" },
          { label: "Supervisor", value: sale.supervisor || "" },
          { label: "Hizo click", value: sale.hizo_click || rawBody.hizo_click || "" },
          { label: "Imagen", value: imgUrl ? [{ url: imgUrl, name: "click.jpg" }] : [] },
          { label: "Ficha", value: ficha }
        ]
      }
    };

    fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.warn("Aviso: no se pudo notificar a n8n:", err.message);
    });
  } catch (err) {
    console.warn("Aviso al armar payload para n8n:", err.message);
  }
}

const CORS_HEADERS = {

  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, x-fenix-role, x-fenix-email, x-fenix-sup, x-fenix-admin-preview, x-api-key, Authorization",
  "Access-Control-Allow-Private-Network": "true",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readRawBuffer(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("El archivo supera el tamaño máximo permitido (60 MB)."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req, maxBytes = 60 * 1024 * 1024) {
  const buf = await readRawBuffer(req, maxBytes);
  const raw = buf.toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("JSON inválido en la petición.");
  }
}

function getRequestRole(req, urlObj) {
  return String(req.headers["x-fenix-role"] || urlObj.searchParams.get("vista") || "admin").toLowerCase();
}

function getRequestEmail(req, urlObj) {
  return String(req.headers["x-fenix-email"] || urlObj.searchParams.get("email") || "").trim().toLowerCase();
}

function getRequestSup(req, urlObj) {
  return String(
    req.headers["x-fenix-sup"] ||
      urlObj.searchParams.get("sup") ||
      urlObj.searchParams.get("supervisor") ||
      ""
  ).trim();
}

function isRequestAdminPreview(req) {
  return String(req.headers["x-fenix-admin-preview"] || "") === "1";
}

function checkN8nAuth(req, urlObj) {
  if (!N8N_API_KEY) return false;
  const provided =
    req.headers["x-api-key"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    urlObj.searchParams.get("api_key") ||
    "";
  return provided === N8N_API_KEY;
}

function toCsvValue(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    const allowedOrigins = String(process.env.FENIX_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (origin) {
      const ownOrigin = origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`;
      if (!ownOrigin && !allowedOrigins.includes(origin)) return sendJson(res, 403, {ok:false,message:'Origen no autorizado.'});
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(urlObj.pathname);
    const method = req.method || "GET";
    let role = getRequestRole(req, urlObj);
    let reqEmail = getRequestEmail(req, urlObj);
    let reqSup = getRequestSup(req, urlObj);
    let adminPreview = false;
    const session = auth.principal(req, urlObj);
    const isPublicForm = role === 'formulario' && (
      (method === 'GET' && pathname === '/api/bootstrap') ||
      (method === 'POST' && ['/api/sales','/api/ficha/preview'].includes(pathname)));
    const hasN8nKey = checkN8nAuth(req, urlObj);
    const isIntegration = pathname.startsWith('/api/n8n/') || pathname === '/api/webhook/tally' || hasN8nKey;
    if (pathname.startsWith('/api/') && !['/api/health','/api/auth/verify-email','/api/auth/logout'].includes(pathname) && !isPublicForm) {
      if (isIntegration) {
        if (!hasN8nKey) return sendJson(res, 403, { ok: false, message: 'Clave de integración requerida.' });
        role = 'admin';
      } else {
        if (session && pathname === '/api/events') { role = session.role; reqSup = session.sup; }
        if (!auth.canView(session, role, reqSup)) {
          const access = { reason: 'Ingresa con tu correo y clave para abrir este acceso.', requiresEmail: true };
          if (pathname === '/api/bootstrap') return sendJson(res, 200, { ok: true, requiresEmailGate: true, access });
          return sendJson(res, 403, { ok: false, requiresEmailGate: true, message: access.reason });
        }
        reqEmail = session.email;
        adminPreview = true; // Authorization already checked against the server session.
        // A supervisor cannot override the scoped query with another supervisor name.
        if (role === 'supervisor') urlObj.searchParams.set('supervisor', reqSup);
        if (role === 'moviles') urlObj.searchParams.set('vista', 'moviles');
      }
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      auth.logout(req, urlObj); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/access/credential' && method === 'POST') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede generar claves.' });
      return sendJson(res, 200, { ok: true, ...auth.issueCredential((await readJsonBody(req)).email) });
    }
    if (pathname === '/api/backup' && method === 'GET') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede respaldar.' });
      return sendJson(res, 200, snapshot());
    }
    if (pathname === '/api/restore' && method === 'POST') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede restaurar.' });
      const body = await readJsonBody(req);
      if (body.confirm !== 'RESTAURAR') return sendJson(res, 400, { ok: false, message: 'Confirma la restauración.' });
      const result = restoreSnapshot(body.backup);
      broadcastEvent('config_updated');
      return sendJson(res, 200, result);
    }
    if (pathname.startsWith('/api/import/')) {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede importar.' });
      if (method === 'POST') backupBeforeChange();
    }
    if (method === 'DELETE' || pathname === '/api/sales/bulk-delete') backupBeforeChange();

    // Healthcheck para Docker / Render / Koyeb / n8n
    if (method === "GET" && pathname === "/api/health") {
      const totalVentas = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
      return sendJson(res, 200, { ok: true, status: "online", totalVentas, ts: new Date().toISOString() });
    }

    // 1. SSE Real-Time Stream
    if (method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);
      sseClients.add(res);
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
      req.on("close", () => { clearInterval(heartbeat); sseClients.delete(res); });
      return;
    }

    // 1b. Verificación de acceso por Correo Electrónico (estilo Google Sheets)
    if (method === "POST" && pathname === "/api/auth/verify-email") {
      const body = await readJsonBody(req);
      const check = auth.login(req, body);
      return sendJson(res, 200, { ok: true, ...check });
    }

    // 2. Bootstrap general (compañías, grupos de marcas, supervisores, ejecutivas, permisos de correo)
    if (method === "GET" && pathname === "/api/bootstrap") {
      const vista = role;
      const supParam = urlObj.searchParams.get("sup") || reqSup || "";

      // Si es el formulario aislado (/formulario), solo entrega metadatos del formulario sin pedir correo
      if (vista === "formulario") {
        const meta = getFormMetadata();
        return sendJson(res, 200, {
          ok: true,
          vista: "formulario",
          requiresEmailGate: false,
          brandGroups: meta.brandGroups,
          companies: meta.companies,
          supervisors: meta.supervisors.map(s => ({nombre:s.nombre})),
          ejecutivosPorSupervisor: meta.ejecutivosPorSupervisor,
          todosEjecutivos: meta.todosEjecutivos,
        });
      }

      // Verificar permiso de correo para la vista solicitada

      const meta = getFormMetadata({
        supervisor: vista === "supervisor" ? supParam : "",
        includeAllSupervisors: vista === "admin",
      });
      if (vista === "supervisor" && session?.role === "supervisor") {
        meta.supervisors = meta.supervisors.filter(s => s.token_acceso === supParam || s.nombre === supParam);
        meta.ejecutivosPorSupervisor = {}; meta.todosEjecutivos = [];
      }
      if (vista !== "admin") meta.supervisors = meta.supervisors.map(({correos_autorizados, ...s}) => s);
      let companiesVisibles = meta.companies;
      let supervisorActivo = null;

      if (vista === "moviles") {
        companiesVisibles = companiesVisibles.filter((c) => c.es_movil_espejo && !c.ocultar_en_espejo_movil);
      } else if (vista === "supervisor" && supParam) {
        const foundSup = meta.supervisors.find(
          (s) => s.token_acceso === supParam || s.nombre.toLowerCase() === supParam.toLowerCase()
        );
        supervisorActivo = foundSup ? foundSup.nombre : supParam;
        const conVentas = companiesVisibles.filter((c) => {
          const data = getCompanySales(c.slug, { supervisor: supervisorActivo, limit: 1 });
          return data.total > 0;
        });
        companiesVisibles = conVentas;
      }

      const isSuperAdmin = vista === "admin";
      const canSeePayments = vista === "admin" || vista === "subadmin";
      const goals = isSuperAdmin ? db.prepare("SELECT * FROM executive_goals ORDER BY nombre ASC").all() : [];
      const accessPerms = isSuperAdmin ? getAccessPermissions() : null;

      return sendJson(res, 200, {
        ok: true,
        vista,
        requiresEmailGate: false,
        authorizedEmail: session?.email || reqEmail || "",
        supervisorActivo,
        ...meta,
        companiesVisibles,
        paymentSettings: canSeePayments ? getPaymentSettings() : null,
        executiveGoals: goals,
        accessPermissions: accessPerms,
      });
    }

    // 3. Vista previa en vivo de la Ficha (mientras la pegan en el Formulario Propio)
    if (method === "POST" && pathname === "/api/ficha/preview") {
      const body = await readJsonBody(req);
      const parsed = parsearFichaCompleta(body.ficha || "", body.fecha || null);
      let duplicateCheck = { duplicate: false };
      const targetOp = body.company_slug || body.operador;
      if (targetOp) {
        const comp = resolveCompanyDestination(targetOp, body.tipo_venta || "");
        if (comp && parsed.rut) {
          duplicateCheck = checkDuplicateSale(comp, {
            fecha: body.fecha || parsed.fecha,
            ejecutivo: body.ejecutivo || "",
            rut: parsed.rut,
            direccion: parsed.direccion,
            numero_principal: parsed.numeroPrincipal,
            id_orden: parsed.codigoBiometria,
          });
        }
      }
      return sendJson(res, 200, { ok: true, parsed, duplicateCheck });
    }

    // 4. Envío de nueva venta desde el Formulario Propio (o Fila Manual de Admin Principal)
    if (method === "POST" && pathname === "/api/sales") {
      const body = await readJsonBody(req);
      const isManualEmptyRow =
        body.forzar_duplicada &&
        !body.ficha &&
        body.overrides &&
        body.overrides.nombre_cliente === "(Doble clic para editar)";

      if (isManualEmptyRow && role !== "admin") {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo el Administrador Principal puede insertar filas vacías manuales.",
        });
      }
      if (!body.operador && !body.company_slug) {
        return sendJson(res, 400, { ok: false, message: "Selecciona la compañía u operador." });
      }
      if (!body.ejecutivo || !String(body.ejecutivo).trim()) {
        return sendJson(res, 400, { ok: false, message: "Ingresa el nombre del ejecutivo." });
      }
      if (!body.supervisor || !String(body.supervisor).trim()) {
        return sendJson(res, 400, { ok: false, message: "Selecciona el supervisor." });
      }
      if (
        !body.ficha &&
        !(
          body.overrides &&
          (body.overrides.rut || body.overrides.nombre_cliente || body.overrides.numero_principal)
        )
      ) {
        return sendJson(res, 400, { ok: false, message: "Pega la ficha de la venta." });
      }

      const result = submitFormSale(body);
      if (!result.ok && result.duplicate) {
        return sendJson(res, 409, result);
      }
      broadcastEvent("sale_created", {
        company_slug: result.company.slug,
        hoja: result.company.hoja,
        sale: result.sale,
      });
      notificarN8n(result.sale, result.company, body);
      return sendJson(res, 201, result);
    }

    // 5. Webhook compatible con Tally
    if (method === "POST" && pathname === "/api/webhook/tally") {
      const body = await readJsonBody(req);
      const fields = body.data && Array.isArray(body.data.fields) ? body.data.fields : (Array.isArray(body.fields) ? body.fields : []);
      let operador = body.operador || body.compania || "";
      let tipoVenta = body.tipo_venta || body.tipoVenta || "";
      let ejecutivo = body.ejecutivo || "";
      let supervisor = body.supervisor || "";
      let subcompania = body.subcompania || "";
      let hizoClick = body.hizo_click || body.hizoClick || "";
      let ficha = body.ficha || "";
      let imagenUrl = body.imagen_url || body.imagenUrl || "";

      const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      for (const f of fields) {
        const label = norm(f.label);
        let val = f.value;
        if (Array.isArray(val) && f.options) {
          val = val
            .map((id) => {
              const opt = f.options.find((o) => o.id === id);
              return opt ? opt.text : id;
            })
            .join(", ");
        } else if (Array.isArray(val) && val[0] && typeof val[0] === 'object' && val[0].url) {
          val = val.map(v => v.url).join(", ");
        }
        const sVal = String(val ?? "").trim();
        if (!sVal) continue;
        if (!operador && (label.includes("compan") || label.includes("operador") || label.includes("multiple choice"))) operador = sVal;
        else if (!tipoVenta && label.includes("tipo de venta")) tipoVenta = sVal;
        else if (!ejecutivo && label.includes("ejecutivo")) ejecutivo = sVal;
        else if (!supervisor && label.includes("supervisor")) supervisor = sVal;
        else if (!subcompania && (label.includes("compania es la venta") || label.includes("compañia es la venta"))) subcompania = sVal;
        else if (!hizoClick && label.includes("click")) hizoClick = sVal;
        else if (!ficha && (label.includes("ficha") || (sVal.includes("\n") && sVal.includes(":")))) ficha = sVal;
        else if (!imagenUrl && (label.includes("imagen") || label.includes("archivo") || label.includes("suba"))) imagenUrl = sVal;
      }

      const result = submitFormSale({
        operador,
        tipo_venta: tipoVenta,
        ejecutivo: ejecutivo || "Ejecutivo Tally",
        supervisor: supervisor || "Sin Asignar",
        subcompania,
        hizo_click: hizoClick,
        imagen_url: imagenUrl,
        ficha,
        forzar_duplicada: !!body.forzar_duplicada
      });
      if (result.ok && result.sale && result.company) {
        broadcastEvent("sale_created", {
          company_slug: result.company.slug,
          hoja: result.company.hoja,
          sale: result.sale,
        });
      }
      return sendJson(res, 200, result);
    }

    // 6. Obtener ventas de una hoja específica
    const matchCompSales = pathname.match(/^\/api\/companies\/([a-z0-9\-]+)\/sales$/);
    if (method === "GET" && matchCompSales) {
      const slug = matchCompSales[1];
      const data = getCompanySales(slug, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        mes: urlObj.searchParams.get("mes") ?? "",
        anio: urlObj.searchParams.get("anio") ?? "",
        estado: urlObj.searchParams.get("estado") || "all",
        q: urlObj.searchParams.get("q") || "",
        page: urlObj.searchParams.get("page"),
        pageSize: urlObj.searchParams.get("pageSize"),
        sort: urlObj.searchParams.get("sort"),
        direction: urlObj.searchParams.get("direction"),
        vistaMovilEspejo: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 7. Editar celda(s) de una venta en vivo (protegido según rol y correo)
    const matchSaleId = pathname.match(/^\/api\/sales\/(\d+)$/);
    if (method === "PATCH" && matchSaleId) {
      const id = Number(matchSaleId[1]);
      const patch = await readJsonBody(req);
      try {
        // 'admin' y 'subadmin' pueden editar ventas existentes; 'moviles' solo notas/seguimiento; 'supervisor' bloqueado
        const updated = updateSaleFields(id, patch, role);
        broadcastEvent("sale_updated", { sale: updated });
        return sendJson(res, 200, { ok: true, sale: updated });
      } catch (permErr) {
        if (permErr.statusCode === 403 || permErr.message.includes("Solo Lectura") || permErr.message.includes("Espejo Móviles")) {
          return sendJson(res, 403, { ok: false, message: permErr.message });
        }
        throw permErr;
      }
    }

    if (method === "DELETE" && matchSaleId) {
      if (role !== "admin" && role !== "subadmin") {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo Administración o Ventas Fenix pueden eliminar ventas.",
        });
      }
      const id = Number(matchSaleId[1]);
      deleteSale(id, role);
      broadcastEvent("sale_deleted", { id });
      return sendJson(res, 200, { ok: true });
    }

    if (method === "POST" && pathname === "/api/sales/bulk-delete") {
      if (role !== "admin" && role !== "subadmin") {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo Administración o Ventas Fenix pueden eliminar ventas.",
        });
      }
      const body = await readJsonBody(req);
      const resDel = bulkDeleteSales(body.ids || [], role);
      broadcastEvent("sale_deleted", { ids: body.ids || [], deleted: resDel.deleted });
      return sendJson(res, 200, { ok: true, ...resDel });
    }

    // 8. Resumen Ventas del Día
    if (method === "GET" && pathname === "/api/summary/daily") {
      const summary = getDailySummary(urlObj.searchParams.get("fecha") || null, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        onlyMobileMirror: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return sendJson(res, 200, { ok: true, ...summary });
    }

    // 9. Pagos Adicionales (Visible en Admin Principal y en Segunda Hoja Admin 'subadmin')
    if (method === "GET" && pathname === "/api/payments") {
      if (role !== "admin" && role !== "subadmin") {
        return sendJson(res, 403, { ok: false, message: "Acceso restringido a Administración." });
      }
      const report = getPaymentsReport(
        urlObj.searchParams.get("mes"),
        urlObj.searchParams.get("anio"),
        urlObj.searchParams.get("supervisor") || null
      );
      const goals = role === "admin" ? db.prepare("SELECT * FROM executive_goals ORDER BY nombre ASC").all() : [];
      return sendJson(res, 200, { ok: true, ...report, executiveGoals: goals });
    }

    // Editar tarifas y metas: EXCLUSIVO de Admin Principal
    if (method === "PATCH" && pathname === "/api/payments/settings") {
      if (role !== "admin") {
        return sendJson(res, 403, { ok: false, message: "Solo el Administrador Principal puede modificar tarifas." });
      }
      const body = await readJsonBody(req);
      const tarifas = updatePaymentTarifas(body);
      broadcastEvent("config_updated", { kind: "tarifas" });
      return sendJson(res, 200, { ok: true, tarifas });
    }

    if (method === "PATCH" && pathname === "/api/payments/goals") {
      if (role !== "admin") {
        return sendJson(res, 403, { ok: false, message: "Solo el Administrador Principal puede modificar metas." });
      }
      const body = await readJsonBody(req);
      updateExecutiveGoal(body.ejecutiva_norm, body.nombre, body.minimo_ventas);
      broadcastEvent("config_updated", { kind: "goals" });
      return sendJson(res, 200, { ok: true });
    }

    // 10. Crear Compañía Nueva ("parecida a..."): EXCLUSIVO de Admin Principal
    if (method === "POST" && pathname === "/api/companies") {
      if (role !== "admin") {
        return sendJson(res, 403, {
          ok: false,
          message: "Solo el Administrador Principal puede crear nuevas hojas de compañías.",
        });
      }
      const body = await readJsonBody(req);
      const company = createCustomCompany(body);
      broadcastEvent("config_updated", { kind: "company_created", company });
      return sendJson(res, 201, { ok: true, company });
    }

    // 11. Gestión de Supervisores y Permisos por Correo (Estilo Google Sheets): EXCLUSIVO de Admin Principal
    if (method === "GET" && pathname === "/api/access") {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      return sendJson(res, 200, { ok: true, ...getAccessPermissions() });
    }

    if (method === "PATCH" && pathname === "/api/access/view") {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      const body = await readJsonBody(req);
      const updated = updateViewEmails(body.vista_key, body.correos_autorizados);
      broadcastEvent("config_updated", { kind: "access_updated" });
      return sendJson(res, 200, { ok: true, viewPermission: updated });
    }

    if (method === "PATCH" && pathname === "/api/access/supervisor") {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      const body = await readJsonBody(req);
      const updated = updateSupervisorEmails(body.id, body.correos_autorizados);
      broadcastEvent("config_updated", { kind: "access_updated" });
      return sendJson(res, 200, { ok: true, supervisor: updated });
    }

    if (method === "POST" && pathname === "/api/supervisors") {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      const body = await readJsonBody(req);
      const sup = upsertSupervisor(body);
      broadcastEvent("config_updated", { kind: "supervisors" });
      return sendJson(res, 200, { ok: true, supervisor: sup });
    }

    const matchSupDel = pathname.match(/^\/api\/supervisors\/(\d+)$/);
    if (method === "DELETE" && matchSupDel) {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      deleteSupervisor(Number(matchSupDel[1]));
      broadcastEvent("config_updated", { kind: "supervisors" });
      return sendJson(res, 200, { ok: true });
    }

    const matchSupPatch = pathname.match(/^\/api\/supervisors\/(\d+)$/);
    if (method === "PATCH" && matchSupPatch) {
      if (role !== "admin") return sendJson(res, 403, { ok: false, message: "No autorizado." });
      const body = await readJsonBody(req);
      const id = Number(matchSupPatch[1]);
      if (body.activo !== undefined) {
        db.prepare("UPDATE supervisors SET activo = ? WHERE id = ?").run(body.activo ? 1 : 0, id);
      }
      if (body.compania !== undefined) {
        db.prepare("UPDATE supervisors SET compania = ? WHERE id = ?").run(String(body.compania || "").trim(), id);
      }
      broadcastEvent("config_updated", { kind: "supervisors" });
      const updated = db.prepare("SELECT * FROM supervisors WHERE id = ?").get(id);
      return sendJson(res, 200, { ok: true, supervisor: updated });
    }

    // 12. Buscador Global
    if (method === "GET" && pathname === "/api/search") {
      const results = globalSearch(urlObj.searchParams.get("q") || "", {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        onlyMobileMirror: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return sendJson(res, 200, { ok: true, results });
    }

    // 13. IMPORTACIÓN COMPLETA DESDE GOOGLE SHEETS (Botón directo en Sheets, .XLSX o .JSON)
    if (method === "POST" && pathname === "/api/import/snapshot") {
      const body = await readJsonBody(req);
      const sheets = (body.snapshot && body.snapshot.sheets) || body.sheets || null;
      if (!sheets || typeof sheets !== "object") {
        return sendJson(res, 400, { ok: false, message: "El paquete no contiene un mapa válido de hojas." });
      }
      const result = importSheetsDictionary(sheets, { reset: body.reset !== false });
      broadcastEvent("config_updated", { kind: "sheets_imported", imported: result.imported });
      return sendJson(res, 200, result);
    }

    if (method === "POST" && pathname === "/api/import/xlsx") {
      let xlsxBuf;
      const cType = String(req.headers["content-type"] || "").toLowerCase();
      if (cType.includes("application/json")) {
        const body = await readJsonBody(req);
        const b64 = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
        xlsxBuf = Buffer.from(b64, "base64");
        const sheets = parseXlsxBuffer(xlsxBuf);
        const result = importSheetsDictionary(sheets, { reset: body.reset !== false });
        broadcastEvent("config_updated", { kind: "xlsx_imported", imported: result.imported });
        return sendJson(res, 200, result);
      } else {
        xlsxBuf = await readRawBuffer(req);
        const sheets = parseXlsxBuffer(xlsxBuf);
        const result = importSheetsDictionary(sheets, { reset: true });
        broadcastEvent("config_updated", { kind: "xlsx_imported", imported: result.imported });
        return sendJson(res, 200, result);
      }
    }

    // 14. ENDPOINTS DEDICADOS PARA N8N + BOT DE TELEGRAM
    if (pathname.startsWith("/api/n8n/")) {
      if (!checkN8nAuth(req, urlObj)) {
        return sendJson(res, 401, { ok: false, message: "API Key de n8n inválida." });
      }

      if (method === "GET" && pathname === "/api/n8n/hojas") {
        const meta = getFormMetadata();
        return sendJson(res, 200, {
          ok: true,
          hojas: meta.companies.map((c) => ({
            slug: c.slug,
            hoja: c.hoja,
            emoji: c.emoji,
            totalVentas: c.totalVentas,
          })),
          supervisores: meta.supervisors.map((s) => s.nombre),
        });
      }

      if ((method === "GET" || method === "POST") && (pathname === "/api/n8n/ventas" || pathname === "/api/n8n/consultar")) {
        const body = method === "POST" ? await readJsonBody(req) : {};
        const params = {
          desde: body.desde || urlObj.searchParams.get("desde") || "",
          hasta: body.hasta || urlObj.searchParams.get("hasta") || "",
          hoja: body.hoja || urlObj.searchParams.get("hoja") || "",
          supervisor: body.supervisor || urlObj.searchParams.get("supervisor") || "",
          ejecutiva: body.ejecutiva || urlObj.searchParams.get("ejecutiva") || "",
          estado: body.estado || urlObj.searchParams.get("estado") || "",
          limit: body.limit || urlObj.searchParams.get("limit") || 500,
        };
        const resN8n = querySalesForN8n(params);
        return sendJson(res, 200, { ok: true, ...resN8n });
      }

      if (method === "GET" && pathname === "/api/n8n/ventas-del-dia") {
        const summary = getDailySummary(urlObj.searchParams.get("fecha") || null, {
          supervisor: urlObj.searchParams.get("supervisor") || "",
        });
        return sendJson(res, 200, { ok: true, ...summary });
      }

      if (method === "GET" && pathname === "/api/n8n/sesion") {
        const tel = urlObj.searchParams.get("telefono") || urlObj.searchParams.get("chat_id") || "";
        if (!tel) return sendJson(res, 400, { ok: false, message: "Indica ?telefono= o ?chat_id=" });
        const sesion = getBotSession(tel);
        return sendJson(res, 200, { ok: true, sesion, ...(sesion || {}) });
      }

      if ((method === "POST" || method === "PATCH") && pathname === "/api/n8n/sesion") {
        const body = await readJsonBody(req);
        const sesion = upsertBotSession(body);
        return sendJson(res, 200, { ok: true, sesion, ...(sesion || {}) });
      }

      // Endpoint para registrar ventas directamente desde n8n
      if (method === "POST" && (pathname === "/api/n8n/registrar-venta" || pathname === "/api/n8n/sales")) {
        const body = await readJsonBody(req);

        // Si la venta ya fue originada en Fenix CRM o es una notificación de WhatsApp / Pedro Ballesteros, no se reinserta en el CRM
        const supCheck = String(body.supervisor || body.datosVenta?.supervisor || "").toLowerCase();
        if (body.source === "fenix_crm" || supCheck.includes("pedro") || supCheck.includes("ballesteros")) {
          return sendJson(res, 200, { ok: true, ignored: true, message: "Venta ya registrada o notificación de WhatsApp; no se duplica en CRM." });
        }

        let operador = body.operador || body.compania || body.datosVenta?.compania || "";
        let tipoVenta = body.tipo_venta || body.tipoVenta || body.datosVenta?.tipoVenta || "";
        let ejecutivo = body.ejecutivo || body.datosVenta?.ejecutivo || "";
        let supervisor = body.supervisor || body.datosVenta?.supervisor || "";
        let subcompania = body.subcompania || body.datosVenta?.subcompania || "";
        let hizoClick = body.hizo_click || body.hizoClick || body.datosVenta?.hizoClick || "";
        let ficha = body.ficha || body.datosVenta?.ficha || "";
        let imagenUrl = body.imagen_url || body.imagenUrl || body.datosVenta?.imagenUrl || "";
        let overrides = body.overrides || {};

        // Si viene con campos de Tally en data.fields o fields
        const fields = (body.data && Array.isArray(body.data.fields)) ? body.data.fields : (Array.isArray(body.fields) ? body.fields : []);
        if (fields.length > 0) {
          const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          for (const f of fields) {
            const label = norm(f.label);
            let val = f.value;
            if (Array.isArray(val) && f.options) {
              val = val.map(id => {
                const opt = f.options.find(o => o.id === id);
                return opt ? opt.text : id;
              }).join(", ");
            } else if (Array.isArray(val) && val[0] && typeof val[0] === 'object' && val[0].url) {
              val = val.map(v => v.url).join(", ");
            }
            const sVal = String(val ?? "").trim();
            if (!sVal) continue;
            if (!operador && (label.includes("compan") || label.includes("operador") || label.includes("multiple choice"))) operador = sVal;
            else if (!tipoVenta && label.includes("tipo de venta")) tipoVenta = sVal;
            else if (!ejecutivo && label.includes("ejecutivo")) ejecutivo = sVal;
            else if (!supervisor && label.includes("supervisor")) supervisor = sVal;
            else if (!subcompania && (label.includes("compania es la venta") || label.includes("compañia es la venta"))) subcompania = sVal;
            else if (!hizoClick && label.includes("click")) hizoClick = sVal;
            else if (!ficha && (label.includes("ficha") || (sVal.includes("\n") && sVal.includes(":")))) ficha = sVal;
            else if (!imagenUrl && (label.includes("imagen") || label.includes("archivo") || label.includes("suba"))) imagenUrl = sVal;
          }
        }

        const result = submitFormSale({
          operador,
          tipo_venta: tipoVenta,
          ejecutivo: ejecutivo || "Ejecutivo n8n",
          supervisor: supervisor || "Sin Asignar",
          subcompania,
          hizo_click: hizoClick,
          imagen_url: imagenUrl,
          ficha,
          overrides,
          forzar_duplicada: !!body.forzar_duplicada
        });

        if (result.ok && result.sale && result.company) {
          broadcastEvent("sale_created", {
            company_slug: result.company.slug,
            hoja: result.company.hoja,
            sale: result.sale,
          });
        }
        return sendJson(res, 200, result);
      }
    }

    // 15. Exportación CSV / Excel de cualquier hoja
    const matchExport = pathname.match(/^\/api\/export\/([a-z0-9\-]+)\.csv$/);
    if (method === "GET" && matchExport) {
      const slug = matchExport[1];
      const data = getCompanySales(slug, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        exportAll: true,
        mes: urlObj.searchParams.get("mes") ?? "",
        anio: urlObj.searchParams.get("anio") ?? "",
        estado: urlObj.searchParams.get("estado") || "all",
        q: urlObj.searchParams.get("q") || "",
        vistaMovilEspejo: urlObj.searchParams.get("vista") === "moviles",
      });
      const cols = data.company.columnas;
      const lines = [
        cols.map((c) => toCsvValue(c.label)).join(","),
        ...data.sales.map((r) => cols.map((c) => toCsvValue(r[c.key])).join(",")),
      ];
      const csvBuffer = Buffer.from("\uFEFF" + lines.join("\r\n"), "utf8");
      res.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.csv"`,
      });
      res.end(csvBuffer);
      return;
    }

    // 16. Archivos subidos (capturas de Click sin tenencia, etc.)
    if (method === "GET" && pathname.startsWith("/uploads/")) {
      const safeName = path.basename(pathname);
      const fullUpload = path.join(UPLOADS_DIR, safeName);
      if (fs.existsSync(fullUpload)) {
        const ext = path.extname(fullUpload).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        fs.createReadStream(fullUpload).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end("Archivo no encontrado");
      return;
    }

    // Never serve the old public database or browser-local write engine.
    if (pathname.startsWith('/data/') || pathname === '/browser-backend.js' || pathname === '/README.md') {
      res.writeHead(404); res.end('No encontrado'); return;
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, message: 'Ruta no encontrada.' });
    // 17. Archivos estáticos y SPA (/formulario, /ventas-fenix, /moviles)
    const spaRoutes = new Set(["/", "/formulario", "/ventas-fenix", "/admin-ventas", "/moviles"]);
    let filePath = path.join(PUBLIC_DIR, spaRoutes.has(pathname) ? "index.html" : pathname);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      res.end("Acceso denegado");
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("❌ Error en petición:", err);
    sendJson(res, 500, { ok: false, message: err.message || "Error interno del servidor" });
  }
});

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && (!process.env.FENIX_ADMIN_EMAIL || String(process.env.FENIX_ADMIN_PASSWORD || '').length < 12 || !process.env.FENIX_DATA_DIR)) {
    console.warn('⚠️ AVISO: Configura FENIX_ADMIN_EMAIL y FENIX_ADMIN_PASSWORD (12+ caracteres) en las Variables de Railway para acceder como Administrador.');
  }
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`🚀 Fenix CRM (Admin Principal): http://localhost:${PORT}`);
    console.log(`📊 Ventas Fenix:                http://localhost:${PORT}/ventas-fenix`);
    console.log(`📝 Formulario Ejecutivos:       http://localhost:${PORT}/formulario`);
    console.log(`📱 Espejo Móviles:              http://localhost:${PORT}/moviles`);
    console.log(`🤖 API n8n / Telegram:          http://localhost:${PORT}/api/n8n/ventas-del-dia`);
  });
}

module.exports = { server };
