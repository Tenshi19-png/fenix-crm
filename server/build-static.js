throw new Error("El motor local fue retirado: usa node scripts/package-release.js para preparar la interfaz estática conectada al servidor central.");
// ============================================================================
// FENIX CRM - GENERADOR DE PAQUETE CLOUD ESTÁTICO (HUGGING FACE SPACES + SQL.JS)
// ============================================================================
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

// 1. Leer archivos fuente del backend para compilarlos al motor de navegador
const fichaParserSrc = fs
  .readFileSync(path.join(__dirname, "fichaParser.js"), "utf8")
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "");

const xlsxReaderSrc = fs
  .readFileSync(path.join(__dirname, "xlsxReader.js"), "utf8")
  .replace(/const zlib = require\("node:zlib"\);/, "")
  .replace(/zlib\.inflateRawSync\(rawSlice\)/g, "BrowserBuffer.from(window.pako.inflateRaw(rawSlice))")
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "");

let dbSrc = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
// Quitar bloque de imports iniciales hasta `const db = new DatabaseSync(DB_PATH);`
dbSrc = dbSrc.replace(
  /^[\s\S]*?const db = new DatabaseSync\(DB_PATH\);\r?\ndb\.exec\("PRAGMA journal_mode = WAL;"\);\r?\ndb\.exec\("PRAGMA foreign_keys = ON;"\);/,
  `// db inyectado por createFenixBrowserEngine(db)`
);
// Reemplazar crypto.randomBytes
dbSrc = dbSrc.replace(/crypto\.randomBytes\((\d+)\)\.toString\("hex"\)/g, "randomHex($1)");
// Reemplazar guardado físico de imagen click por Data URI directo en navegador
dbSrc = dbSrc.replace(
  /const fileName = `click_\$\{Date\.now\(\)\}_\$\{randomHex\(3\)\}\.\$\{ext\}`;\s*fs\.writeFileSync\(path\.join\(UPLOADS_DIR, fileName\), Buffer\.from\(m\[2\], "base64"\)\);\s*fotoUrl = `\/uploads\/\$\{fileName\}`;/,
  "fotoUrl = rawClick;"
);
// Quitar module.exports del final de db.js
dbSrc = dbSrc.replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "");

let seedSrc = fs.readFileSync(path.join(__dirname, "seed.js"), "utf8");
seedSrc = seedSrc.replace(/^[\s\S]*?const SCRATCH_CSV_DIR = [^\n]+\n/, "");
seedSrc = seedSrc.replace(/function seedIfEmpty[\s\S]*$/, "");

const bundleCode = `// ============================================================================
// FENIX CRM - MOTOR SERVERLESS EN NAVEGADOR (SQLite WebAssembly + Cloud Sync)
// Generado automáticamente desde server/fichaParser.js, server/db.js y server/index.js
// ============================================================================
(function () {
  const NTFY_SYNC_TOPIC = "fenix_crm_cloud_sync_918273645_v2";
  const IDB_NAME = "fenix_crm_cloud_idb_v2";
  const IDB_STORE = "sqlite_store";
  const IDB_KEY_DB = "fenix_db_bytes";
  const IDB_KEY_APPLIED = "fenix_applied_mutations";

  function randomHex(bytesLen) {
    const arr = new Uint8Array(bytesLen || 3);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Polyfill ligero de Buffer para el lector nativo .xlsx en el navegador
  class BrowserBuffer extends Uint8Array {
    static from(input, encoding) {
      if (typeof input === "string") {
        if (encoding === "base64") {
          const bin = atob(input.replace(/\\s+/g, ""));
          const out = new BrowserBuffer(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        const enc = new TextEncoder().encode(input);
        return new BrowserBuffer(enc.buffer, enc.byteOffset, enc.byteLength);
      }
      if (input instanceof ArrayBuffer) return new BrowserBuffer(input);
      if (ArrayBuffer.isView(input)) {
        const copy = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        const out = new BrowserBuffer(copy.length);
        out.set(copy);
        return out;
      }
      return new BrowserBuffer(input || 0);
    }
    readUInt16LE(offset) {
      return this[offset] | (this[offset + 1] << 8);
    }
    readUInt32LE(offset) {
      return (
        (this[offset] |
          (this[offset + 1] << 8) |
          (this[offset + 2] << 16) |
          (this[offset + 3] << 24)) >>>
        0
      );
    }
    subarray(begin, end) {
      const sub = super.subarray(begin, end);
      return new BrowserBuffer(sub.buffer, sub.byteOffset, sub.byteLength);
    }
    toString(encoding) {
      if (encoding === "base64") {
        let bin = "";
        for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
        return btoa(bin);
      }
      return new TextDecoder("utf-8").decode(this);
    }
  }

  // Adaptador compatible 100% con node:sqlite DatabaseSync sobre sql.js
  class SqlJsDatabaseSync {
    constructor(sqlJsDb) {
      this.raw = sqlJsDb;
    }
    exec(sql) {
      this.raw.run(sql);
    }
    prepare(sql) {
      const raw = this.raw;
      return {
        all(...params) {
          const stmt = raw.prepare(sql);
          try {
            if (params.length > 0) {
              const clean = params.map((p) => (p === undefined ? null : p));
              stmt.bind(clean);
            }
            const rows = [];
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
        get(...params) {
          const rows = this.all(...params);
          return rows.length > 0 ? rows[0] : undefined;
        },
        run(...params) {
          const clean = params.map((p) => (p === undefined ? null : p));
          raw.run(sql, clean);
          let lastId = 0;
          try {
            const res = raw.exec("SELECT last_insert_rowid()");
            if (res && res[0] && res[0].values && res[0].values[0]) {
              lastId = res[0].values[0][0];
            }
          } catch {}
          const changes = raw.getRowsModified();
          return { lastInsertRowid: lastId, changes };
        },
      };
    }
  }

  // Persistencia en IndexedDB
  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } catch {
      return null;
    }
  }

  async function idbSet(key, val) {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      return false;
    }
  }

  function createFenixEngine(db) {
    const UPLOADS_DIR = "/uploads";
    ${fichaParserSrc}
    ${xlsxReaderSrc}
    ${dbSrc}
    ${seedSrc}

    return {
      db,
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
      parsearFichaCompleta,
      parseXlsxBuffer,
      importSheetsDictionary,
    };
  }

  // EventListeners virtuales para simular /api/events SSE
  const virtualSseListeners = new Set();
  const bcChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fenix_crm_local_sync") : null;

  function emitVirtualSse(type, payload = {}) {
    const msgStr = JSON.stringify({ type, payload, ts: Date.now() });
    for (const fn of virtualSseListeners) {
      try {
        fn({ data: msgStr });
      } catch {}
    }
  }

  if (bcChannel) {
    bcChannel.onmessage = (ev) => {
      if (ev.data && ev.data.type === "MUTATION_APPLIED") {
        window.location.reload();
      }
    };
  }

  let enginePromise = null;
  let sqlJsRawDb = null;
  let appliedMutations = new Set();

  async function getEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      if (typeof window.initSqlJs !== "function") {
        throw new Error("Cargando motor SQLite WebAssembly (sql.js)...");
      }
      const SQL = await window.initSqlJs({
        locateFile: (file) => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/" + file,
      });

      const savedApplied = await idbGet(IDB_KEY_APPLIED);
      if (Array.isArray(savedApplied)) {
        appliedMutations = new Set(savedApplied);
      }

      let dbBytes = await idbGet(IDB_KEY_DB);
      if (!dbBytes || !(dbBytes instanceof Uint8Array) || dbBytes.byteLength < 100000) {
        const resp = await originalFetch("/data/fenix.db", { cache: "no-cache" });
        if (!resp.ok) throw new Error("No se pudo descargar /data/fenix.db (" + resp.status + ")");
        const buf = await resp.arrayBuffer();
        dbBytes = new Uint8Array(buf);
      }

      sqlJsRawDb = new SQL.Database(dbBytes);
      const syncDb = new SqlJsDatabaseSync(sqlJsRawDb);
      const eng = createFenixEngine(syncDb);

      // Sincronizar mutaciones recientes desde la nube (ntfy.sh) en segundo plano
      syncCloudMutations(eng).catch(() => {});
      subscribeCloudMutationsStream(eng);

      return eng;
    })();
    return enginePromise;
  }

  async function persistCurrentDb() {
    if (!sqlJsRawDb) return;
    try {
      const bytes = sqlJsRawDb.export();
      await idbSet(IDB_KEY_DB, bytes);
      await idbSet(IDB_KEY_APPLIED, Array.from(appliedMutations));
    } catch (e) {
      console.warn("Aviso guardando DB en IndexedDB:", e);
    }
  }

  async function applyCloudMutation(eng, mut) {
    if (!mut || !mut.id || appliedMutations.has(mut.id)) return false;
    appliedMutations.add(mut.id);
    try {
      await executeApiRequest(eng, mut.method, mut.url, mut.headers || {}, mut.body || {}, true);
      await persistCurrentDb();
      emitVirtualSse("config_updated", { source: "cloud", mutId: mut.id });
      return true;
    } catch (e) {
      console.warn("Aviso aplicando mutación cloud:", e);
      return false;
    }
  }

  async function publishCloudMutation(method, url, headers, body) {
    const mut = {
      id: "mut_" + Date.now() + "_" + randomHex(4),
      ts: Date.now(),
      method,
      url,
      headers: {
        "x-fenix-role": headers["x-fenix-role"] || "admin",
        "x-fenix-email": headers["x-fenix-email"] || "",
        "x-fenix-sup": headers["x-fenix-sup"] || "",
      },
      body,
    };
    appliedMutations.add(mut.id);
    await persistCurrentDb();

    try {
      // No publicar archivos .xlsx gigantes en ntfy (superan el límite de mensaje)
      if (url === "/api/import/xlsx" || url === "/api/import/snapshot") return;
      await originalFetch("https://ntfy.sh/" + NTFY_SYNC_TOPIC, {
        method: "POST",
        body: JSON.stringify(mut),
      });
    } catch {}
  }

  async function syncCloudMutations(eng) {
    try {
      const resp = await originalFetch("https://ntfy.sh/" + NTFY_SYNC_TOPIC + "/json?poll=1&since=24h");
      if (!resp.ok) return;
      const text = await resp.text();
      const lines = text.split("\\n").filter(Boolean);
      let anyApplied = false;
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.event === "message" && ev.message) {
            const mut = JSON.parse(ev.message);
            const applied = await applyCloudMutation(eng, mut);
            if (applied) anyApplied = true;
          }
        } catch {}
      }
      if (anyApplied) {
        emitVirtualSse("config_updated", { synced: true });
      }
    } catch {}
  }

  function subscribeCloudMutationsStream(eng) {
    try {
      const es = new OrigEventSource("https://ntfy.sh/" + NTFY_SYNC_TOPIC + "/sse");
      es.onmessage = async (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.event === "message" && data.message) {
            const mut = JSON.parse(data.message);
            await applyCloudMutation(eng, mut);
          }
        } catch {}
      };
    } catch {}
  }

  function toCsvValue(val) {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  async function executeApiRequest(eng, method, rawUrl, headers, body, isReplay = false) {
    const urlObj = new URL(rawUrl, window.location.origin);
    const pathname = decodeURIComponent(urlObj.pathname);
    const role = String(headers["x-fenix-role"] || urlObj.searchParams.get("vista") || "admin").toLowerCase();
    const reqEmail = String(headers["x-fenix-email"] || urlObj.searchParams.get("email") || "").trim().toLowerCase();
    const reqSup = String(
      headers["x-fenix-sup"] || urlObj.searchParams.get("sup") || urlObj.searchParams.get("supervisor") || ""
    ).trim();
    const adminPreview = String(headers["x-fenix-admin-preview"] || "") === "1" || isReplay;

    if (method === "GET" && pathname === "/api/health") {
      const totalVentas = eng.db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
      return { status: 200, data: { ok: true, mode: "browser-cloud", totalVentas } };
    }

    if (method === "POST" && pathname === "/api/auth/verify-email") {
      const vista = body.vista || role || "admin";
      const sup = body.sup || reqSup || "";
      const email = body.email || reqEmail || "";
      const check = eng.verifyViewEmailAccess(vista, sup, email, false);
      return { status: 200, data: { ok: true, ...check } };
    }

    if (method === "GET" && pathname === "/api/bootstrap") {
      const vista = urlObj.searchParams.get("vista") || role || "admin";
      const supParam = urlObj.searchParams.get("sup") || reqSup || "";

      if (vista === "formulario") {
        const meta = eng.getFormMetadata();
        return {
          status: 200,
          data: {
            ok: true,
            vista: "formulario",
            requiresEmailGate: false,
            brandGroups: meta.brandGroups,
            companies: meta.companies,
            supervisors: meta.supervisors,
            ejecutivosPorSupervisor: meta.ejecutivosPorSupervisor,
            todosEjecutivos: meta.todosEjecutivos,
          },
        };
      }

      const access = eng.verifyViewEmailAccess(vista, supParam, reqEmail, adminPreview);
      if (!access.allowed) {
        return {
          status: 200,
          data: { ok: true, vista, requiresEmailGate: true, access },
        };
      }

      const meta = eng.getFormMetadata();
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
          const data = eng.getCompanySales(c.slug, { supervisor: supervisorActivo, limit: 1 });
          return data.total > 0;
        });
        if (conVentas.length > 0) companiesVisibles = conVentas;
      }

      const isSuperAdmin = vista === "admin";
      const canSeePayments = vista === "admin" || vista === "subadmin";
      const goals = isSuperAdmin ? eng.db.prepare("SELECT * FROM executive_goals ORDER BY nombre ASC").all() : [];
      const accessPerms = isSuperAdmin ? eng.getAccessPermissions() : null;

      return {
        status: 200,
        data: {
          ok: true,
          vista,
          requiresEmailGate: false,
          authorizedEmail: access.email || "",
          supervisorActivo,
          ...meta,
          companiesVisibles,
          paymentSettings: canSeePayments ? eng.getPaymentSettings() : null,
          executiveGoals: goals,
          accessPermissions: accessPerms,
        },
      };
    }

    if (method === "POST" && pathname === "/api/ficha/preview") {
      const parsed = eng.parsearFichaCompleta(body.ficha || "", body.fecha || null);
      let duplicateCheck = { duplicate: false };
      const targetOp = body.company_slug || body.operador;
      if (targetOp) {
        const comp = eng.resolveCompanyDestination(targetOp, body.tipo_venta || "");
        if (comp && parsed.rut) {
          duplicateCheck = eng.checkDuplicateSale(comp, {
            fecha: body.fecha || parsed.fecha,
            ejecutivo: body.ejecutivo || "",
            rut: parsed.rut,
            direccion: parsed.direccion,
            numero_principal: parsed.numeroPrincipal,
            id_orden: parsed.codigoBiometria,
          });
        }
      }
      return { status: 200, data: { ok: true, parsed, duplicateCheck } };
    }

    if (method === "POST" && pathname === "/api/sales") {
      const result = eng.submitFormSale(isReplay ? { ...body, forzar_duplicada: true } : body);
      if (!result.ok && result.duplicate) {
        return { status: 409, data: result };
      }
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("sale_created", {
          company_slug: result.company.slug,
          hoja: result.company.hoja,
          sale: result.sale,
        });
      }
      return { status: 201, data: result };
    }

    const matchCompSales = pathname.match(/^\\/api\\/companies\\/([a-z0-9\\-]+)\\/sales$/);
    if (method === "GET" && matchCompSales) {
      const slug = matchCompSales[1];
      const data = eng.getCompanySales(slug, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        mes: urlObj.searchParams.get("mes") ?? "",
        anio: urlObj.searchParams.get("anio") ?? "",
        estado: urlObj.searchParams.get("estado") || "all",
        q: urlObj.searchParams.get("q") || "",
        limit: urlObj.searchParams.get("limit") || 1500,
        vistaMovilEspejo: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return { status: 200, data: { ok: true, ...data } };
    }

    const matchSaleId = pathname.match(/^\\/api\\/sales\\/(\\d+)$/);
    if (method === "PATCH" && matchSaleId) {
      const id = Number(matchSaleId[1]);
      try {
        const updated = eng.updateSaleFields(id, body, isReplay ? "admin" : role);
        if (!isReplay) {
          await publishCloudMutation(method, rawUrl, headers, body);
          emitVirtualSse("sale_updated", { sale: updated });
        }
        return { status: 200, data: { ok: true, sale: updated } };
      } catch (permErr) {
        return { status: 403, data: { ok: false, message: permErr.message } };
      }
    }

    if (method === "DELETE" && matchSaleId) {
      const id = Number(matchSaleId[1]);
      eng.deleteSale(id, isReplay ? "admin" : role);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("sale_deleted", { id });
      }
      return { status: 200, data: { ok: true } };
    }

    if (method === "POST" && pathname === "/api/sales/bulk-delete") {
      const resDel = eng.bulkDeleteSales(body.ids || [], isReplay ? "admin" : role);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("sale_deleted", { ids: body.ids || [], deleted: resDel.deleted });
      }
      return { status: 200, data: { ok: true, ...resDel } };
    }

    if (method === "GET" && pathname === "/api/summary/daily") {
      const summary = eng.getDailySummary(urlObj.searchParams.get("fecha") || null, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        onlyMobileMirror: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return { status: 200, data: { ok: true, ...summary } };
    }

    if (method === "GET" && pathname === "/api/payments") {
      const report = eng.getPaymentsReport(
        urlObj.searchParams.get("mes"),
        urlObj.searchParams.get("anio"),
        urlObj.searchParams.get("supervisor") || null
      );
      const goals = role === "admin" ? eng.db.prepare("SELECT * FROM executive_goals ORDER BY nombre ASC").all() : [];
      return { status: 200, data: { ok: true, ...report, executiveGoals: goals } };
    }

    if (method === "PATCH" && pathname === "/api/payments/settings") {
      const tarifas = eng.updatePaymentTarifas(body);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "tarifas" });
      }
      return { status: 200, data: { ok: true, tarifas } };
    }

    if (method === "PATCH" && pathname === "/api/payments/goals") {
      eng.updateExecutiveGoal(body.ejecutiva_norm, body.nombre, body.minimo_ventas);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "goals" });
      }
      return { status: 200, data: { ok: true } };
    }

    if (method === "POST" && pathname === "/api/companies") {
      const company = eng.createCustomCompany(body);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "company_created", company });
      }
      return { status: 201, data: { ok: true, company } };
    }

    if (method === "GET" && pathname === "/api/access") {
      return { status: 200, data: { ok: true, ...eng.getAccessPermissions() } };
    }

    if (method === "PATCH" && pathname === "/api/access/view") {
      const updated = eng.updateViewEmails(body.vista_key, body.correos_autorizados);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "access_updated" });
      }
      return { status: 200, data: { ok: true, viewPermission: updated } };
    }

    if (method === "PATCH" && pathname === "/api/access/supervisor") {
      const updated = eng.updateSupervisorEmails(body.id, body.correos_autorizados);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "access_updated" });
      }
      return { status: 200, data: { ok: true, supervisor: updated } };
    }

    if (method === "POST" && pathname === "/api/supervisors") {
      const sup = eng.upsertSupervisor(body);
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "supervisors" });
      }
      return { status: 200, data: { ok: true, supervisor: sup } };
    }

    const matchSupDel = pathname.match(/^\\/api\\/supervisors\\/(\\d+)$/);
    if (method === "DELETE" && matchSupDel) {
      eng.deleteSupervisor(Number(matchSupDel[1]));
      if (!isReplay) {
        await publishCloudMutation(method, rawUrl, headers, body);
        emitVirtualSse("config_updated", { kind: "supervisors" });
      }
      return { status: 200, data: { ok: true } };
    }

    if (method === "GET" && pathname === "/api/search") {
      const results = eng.globalSearch(urlObj.searchParams.get("q") || "", {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        onlyMobileMirror: urlObj.searchParams.get("vista") === "moviles" || role === "moviles",
      });
      return { status: 200, data: { ok: true, results } };
    }

    if (method === "POST" && pathname === "/api/import/snapshot") {
      const sheets = (body.snapshot && body.snapshot.sheets) || body.sheets || null;
      const result = eng.importSheetsDictionary(sheets, { reset: body.reset !== false });
      await persistCurrentDb();
      emitVirtualSse("config_updated", { kind: "sheets_imported", imported: result.imported });
      return { status: 200, data: result };
    }

    if (method === "POST" && pathname === "/api/import/xlsx") {
      const b64 = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
      const xlsxBuf = BrowserBuffer.from(b64, "base64");
      const sheets = eng.parseXlsxBuffer(xlsxBuf);
      const result = eng.importSheetsDictionary(sheets, { reset: body.reset !== false });
      await persistCurrentDb();
      emitVirtualSse("config_updated", { kind: "xlsx_imported", imported: result.imported });
      return { status: 200, data: result };
    }

    if (pathname.startsWith("/api/n8n/")) {
      if (method === "GET" && pathname === "/api/n8n/ventas-del-dia") {
        const summary = eng.getDailySummary(urlObj.searchParams.get("fecha") || null, {
          supervisor: urlObj.searchParams.get("supervisor") || "",
        });
        return { status: 200, data: { ok: true, ...summary } };
      }
      if ((method === "GET" || method === "POST") && pathname === "/api/n8n/ventas") {
        const resN8n = eng.querySalesForN8n({
          desde: body.desde || urlObj.searchParams.get("desde") || "",
          hasta: body.hasta || urlObj.searchParams.get("hasta") || "",
          hoja: body.hoja || urlObj.searchParams.get("hoja") || "",
          supervisor: body.supervisor || urlObj.searchParams.get("supervisor") || "",
          ejecutiva: body.ejecutiva || urlObj.searchParams.get("ejecutiva") || "",
          estado: body.estado || urlObj.searchParams.get("estado") || "",
          limit: body.limit || urlObj.searchParams.get("limit") || 500,
        });
        return { status: 200, data: { ok: true, ...resN8n } };
      }
    }

    const matchExport = pathname.match(/^\\/api\\/export\\/([a-z0-9\\-]+)\\.csv$/);
    if (method === "GET" && matchExport) {
      const slug = matchExport[1];
      const data = eng.getCompanySales(slug, {
        supervisor: urlObj.searchParams.get("supervisor") || "",
        limit: 50000,
        vistaMovilEspejo: urlObj.searchParams.get("vista") === "moviles",
      });
      const cols = data.company.columnas;
      const lines = [
        cols.map((c) => toCsvValue(c.label)).join(","),
        ...data.sales.map((r) => cols.map((c) => toCsvValue(r[c.key])).join(",")),
      ];
      return {
        status: 200,
        isCsv: true,
        csvText: "\\uFEFF" + lines.join("\\r\\n"),
      };
    }

    return { status: 404, data: { ok: false, message: "Ruta no encontrada: " + pathname } };
  }

  // Interceptar fetch y EventSource cuando corre en Hugging Face Spaces (o host estático)
  const originalFetch = window.fetch.bind(window);
  const OrigEventSource = window.EventSource;

  const isStaticCloudHost =
    window.location.hostname.endsWith(".hf.space") ||
    window.location.hostname.includes("huggingface.co") ||
    window.location.search.includes("cloud=1");

  let useBrowserBackend = isStaticCloudHost;

  window.fetch = async function (input, init = {}) {
    const urlStr = typeof input === "string" ? input : input.url || "";
    const isApiCall = urlStr.startsWith("/api/") || urlStr.startsWith(window.location.origin + "/api/");

    if (!isApiCall) {
      return originalFetch(input, init);
    }

    if (!useBrowserBackend) {
      try {
        const res = await originalFetch(input, init);
        if (res.status !== 404 && res.status !== 405 && res.status !== 502) {
          return res;
        }
        useBrowserBackend = true;
      } catch {
        useBrowserBackend = true;
      }
    }

    try {
      const eng = await getEngine();
      const method = String(init.method || "GET").toUpperCase();
      const headers = {};
      if (init.headers) {
        if (typeof init.headers.forEach === "function") {
          init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
        } else {
          for (const [k, v] of Object.entries(init.headers)) {
            headers[k.toLowerCase()] = v;
          }
        }
      }
      let body = {};
      if (init.body && typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {}
      }

      const relUrl = urlStr.startsWith(window.location.origin)
        ? urlStr.slice(window.location.origin.length)
        : urlStr;

      const result = await executeApiRequest(eng, method, relUrl, headers, body, false);
      if (result.isCsv) {
        return new Response(result.csvText, {
          status: 200,
          headers: { "Content-Type": "text/csv; charset=utf-8" },
        });
      }
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (err) {
      console.error("Error en browser-backend:", err);
      return new Response(JSON.stringify({ ok: false, message: err.message || "Error en motor cloud" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  };

  if (isStaticCloudHost) {
    window.EventSource = function (url) {
      if (url === "/api/events") {
        const instance = {
          onopen: null,
          onmessage: null,
          onerror: null,
          close() {
            virtualSseListeners.delete(listener);
          },
        };
        const listener = (ev) => {
          if (typeof instance.onmessage === "function") instance.onmessage(ev);
        };
        virtualSseListeners.add(listener);
        setTimeout(() => {
          if (typeof instance.onopen === "function") instance.onopen();
        }, 50);
        return instance;
      }
      return new OrigEventSource(url);
    };
  }
})();
`;

// Escribir public/browser-backend.js
fs.writeFileSync(path.join(PUBLIC_DIR, "browser-backend.js"), bundleCode, "utf8");
console.log("✅ Generado public/browser-backend.js (" + Math.round(bundleCode.length / 1024) + " KB)");

// Copiar data/fenix.db a public/data/fenix.db
const pubDataDir = path.join(PUBLIC_DIR, "data");
if (!fs.existsSync(pubDataDir)) fs.mkdirSync(pubDataDir, { recursive: true });
fs.copyFileSync(path.join(DATA_DIR, "fenix.db"), path.join(pubDataDir, "fenix.db"));
console.log("✅ Copiado data/fenix.db -> public/data/fenix.db");

// Crear sub-rutas físicas para que funcionen en servidores estáticos (/ventas-fenix, /formulario, /moviles)
const indexHtmlContent = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
for (const subRoute of ["ventas-fenix", "formulario", "moviles", "admin-ventas"]) {
  const dir = path.join(PUBLIC_DIR, subRoute);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), indexHtmlContent, "utf8");
}
console.log("✅ Creadas sub-rutas estáticas: /ventas-fenix, /formulario, /moviles, /admin-ventas");

