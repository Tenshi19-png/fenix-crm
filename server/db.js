// ============================================================================
// FENIX CRM - CAPA DE BASE DE DATOS SQL Y REGLAS DE NEGOCIO (SQLite Nativo)
// ============================================================================
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  normalizarTexto,
  darFormatoNombre,
  formatearRut,
  limpiarRutComparacion,
  extraerTelefonosSeguro,
  extraerDireccionDeFicha,
  normalizarDireccionComparacion,
  sonDireccionesIguales,
  extraerCodigoBiometriaDeFicha,
  extraerFechaSegura,
  formatearFechaISOaLatina,
  fechaAClaveOrden,
  parsearFichaCompleta,
} = require("./fichaParser");

const DATA_DIR = path.resolve(process.env.FENIX_DATA_DIR || path.join(__dirname, "..", "data"));
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "fenix.db");
const SEED_DB = path.join(__dirname, "seed-data", "fenix.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (!process.env.FENIX_IS_TEST && !fs.existsSync(DB_PATH) && fs.existsSync(SEED_DB)) {
  fs.copyFileSync(SEED_DB, DB_PATH);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA cache_size = -64000;");
db.exec("PRAGMA temp_store = MEMORY;");
db.exec("PRAGMA mmap_size = 268435456;");
db.function("fenix_norm", { deterministic: true }, (value) => normalizarTexto(String(value ?? "")));

// Columnas estándar según tipo de plantilla (igual a Google Sheets)
const COLS_FIBRA_TENENCIA = [
  { key: "fecha", label: "Fecha", width: 100 },
  { key: "ejecutivo", label: "Nombre Ejecutivo", width: 160 },
  { key: "comuna", label: "Comuna", width: 125 },
  { key: "direccion", label: "Dirección de Instalación", width: 235 },
  { key: "rut", label: "RUT Cliente", width: 112 },
  { key: "nombre_cliente", label: "Nombre Cliente", width: 195 },
  { key: "telefono", label: "Teléfonos Contacto", width: 135 },
  { key: "correo", label: "Correo Electrónico", width: 185 },
  { key: "servicio", label: "Servicios a Contratar", width: 185 },
  { key: "estado", label: "Estado del producto", width: 132, type: "status" },
  { key: "id_orden", label: "Número de petición", width: 130 },
  { key: "observacion", label: "Observación", width: 190 },
  { key: "fecha_instalacion", label: "Fecha instalación", width: 118 },
  { key: "supervisor", label: "Supervisor", width: 145 },
];

const COLS_FIBRA_HOGAR = [
  { key: "fecha", label: "Fecha", width: 100 },
  { key: "ejecutivo", label: "Nombre Ejecutivo", width: 160 },
  { key: "comuna", label: "Comuna", width: 125 },
  { key: "direccion", label: "Dirección", width: 225 },
  { key: "nombre_cliente", label: "Nombre", width: 195 },
  { key: "rut", label: "RUT", width: 112 },
  { key: "telefono", label: "Teléfono", width: 130 },
  { key: "servicio", label: "Servicio", width: 185 },
  { key: "id_orden", label: "Número de Petición", width: 130 },
  { key: "estado", label: "Estado del producto", width: 132, type: "status" },
  { key: "fecha_instalacion", label: "Fecha instalación", width: 118 },
  { key: "observacion", label: "Observación", width: 190 },
  { key: "supervisor", label: "Supervisor", width: 145 },
];

const COLS_CLARO_VTR = [
  { key: "fecha", label: "Fecha", width: 100 },
  { key: "ejecutivo", label: "Nombre Ejecutivo", width: 160 },
  { key: "comuna", label: "Comuna", width: 125 },
  { key: "direccion", label: "Dirección", width: 225 },
  { key: "nombre_cliente", label: "Nombre", width: 195 },
  { key: "rut", label: "RUT", width: 112 },
  { key: "telefono", label: "Teléfono", width: 130 },
  { key: "servicio", label: "Servicio", width: 180 },
  { key: "estado", label: "Estado del producto", width: 132, type: "status" },
  { key: "subcompania", label: "Compañía", width: 98 },
  { key: "fecha_instalacion", label: "Fecha instalación", width: 118 },
  { key: "supervisor", label: "Supervisor", width: 145 },
  { key: "observacion", label: "Observación", width: 190 },
];

const COLS_MOVIL = [
  { key: "fecha", label: "Fecha", width: 100 },
  { key: "ejecutivo", label: "Nombre Ejecutivo", width: 160 },
  { key: "comuna", label: "Comuna", width: 120 },
  { key: "direccion", label: "Dirección", width: 205 },
  { key: "nombre_cliente", label: "Nombre", width: 190 },
  { key: "rut", label: "RUT", width: 112 },
  { key: "correo", label: "Correo", width: 180 },
  { key: "servicio", label: "Plan Solicitado", width: 170 },
  { key: "numero_principal", label: "Número Principal", width: 130 },
  { key: "adicional", label: "Adicional", width: 150 },
  { key: "estado", label: "Estado de Trabajo", width: 132, type: "status" },
  { key: "id_orden", label: "ID Orden", width: 112 },
  { key: "observacion", label: "Observación (DD-MM)", width: 165 },
  { key: "supervisor", label: "Supervisor", width: 145 },
  { key: "cant_titular", label: "Cant. Titular", width: 92 },
  { key: "cant_adicional", label: "Cant. Adicional", width: 102 },
];

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      slug TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      hoja TEXT NOT NULL UNIQUE,
      operador_form TEXT NOT NULL,
      operadores_extra TEXT NOT NULL DEFAULT '',
      iniciales_pagos TEXT NOT NULL DEFAULT '',
      tipo_categoria TEXT NOT NULL DEFAULT 'fibra',
      basada_en TEXT NOT NULL DEFAULT '',
      es_movil_espejo INTEGER NOT NULL DEFAULT 0,
      ocultar_en_espejo_movil INTEGER NOT NULL DEFAULT 0,
      usa_portado INTEGER NOT NULL DEFAULT 0,
      emoji TEXT NOT NULL DEFAULT '📊',
      color TEXT NOT NULL DEFAULT '#1a73e8',
      orden INTEGER NOT NULL DEFAULT 100,
      columnas_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS supervisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      aliases TEXT NOT NULL DEFAULT '',
      token_acceso TEXT NOT NULL UNIQUE,
      correos_autorizados TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS view_permissions (
      vista_key TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      correos_autorizados TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS executive_goals (
      ejecutiva_norm TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      minimo_ventas INTEGER NOT NULL DEFAULT 10,
      supervisor_habitual TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS payment_settings (
      clave TEXT PRIMARY KEY,
      valor REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_sessions (
      telefono TEXT PRIMARY KEY,
      estado TEXT NOT NULL DEFAULT 'ESPERANDO_OPCION_MENU',
      temp_fecha_inicio TEXT NOT NULL DEFAULT '',
      temp_fecha_fin TEXT NOT NULL DEFAULT '',
      temp_hoja TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_slug TEXT NOT NULL,
      fecha TEXT NOT NULL,
      fecha_orden INTEGER NOT NULL DEFAULT 0,
      mes INTEGER NOT NULL DEFAULT 0,
      anio INTEGER NOT NULL DEFAULT 2026,
      ejecutivo TEXT NOT NULL DEFAULT '',
      supervisor TEXT NOT NULL DEFAULT '',
      comuna TEXT NOT NULL DEFAULT '',
      direccion TEXT NOT NULL DEFAULT '',
      direccion_limpia TEXT NOT NULL DEFAULT '',
      rut TEXT NOT NULL DEFAULT '',
      nombre_cliente TEXT NOT NULL DEFAULT '',
      telefono TEXT NOT NULL DEFAULT '',
      numero_principal TEXT NOT NULL DEFAULT '',
      adicional TEXT NOT NULL DEFAULT '',
      cant_titular INTEGER NOT NULL DEFAULT 0,
      cant_adicional INTEGER NOT NULL DEFAULT 0,
      correo TEXT NOT NULL DEFAULT '',
      servicio TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      id_orden TEXT NOT NULL DEFAULT '',
      fecha_instalacion TEXT NOT NULL DEFAULT '',
      observacion TEXT NOT NULL DEFAULT '',
      subcompania TEXT NOT NULL DEFAULT '',
      hizo_click TEXT NOT NULL DEFAULT '',
      imagen_url TEXT NOT NULL DEFAULT '',
      ficha_original TEXT NOT NULL DEFAULT '',
      notas_movil TEXT NOT NULL DEFAULT '',
      seguimiento_movil TEXT NOT NULL DEFAULT '',
      estado_pago TEXT NOT NULL DEFAULT 'No Pagado',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_slug) REFERENCES companies(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sales_comp_orden ON sales(company_slug, fecha_orden DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_sup ON sales(supervisor);
    CREATE INDEX IF NOT EXISTS idx_sales_rut ON sales(rut);
    CREATE INDEX IF NOT EXISTS idx_sales_mes_anio ON sales(anio, mes);
    CREATE INDEX IF NOT EXISTS idx_sales_comp_mes_anio ON sales(company_slug, anio, mes);
  `);

  try {
    db.exec("ALTER TABLE supervisors ADD COLUMN correos_autorizados TEXT NOT NULL DEFAULT '';");
  } catch {}
  try {
    db.exec("ALTER TABLE supervisors ADD COLUMN compania TEXT NOT NULL DEFAULT '';");
  } catch {}
  try {
    db.exec("ALTER TABLE sales ADD COLUMN estado_pago TEXT NOT NULL DEFAULT 'No Pagado';");
  } catch {}

  const insViewPerm = db.prepare(
    "INSERT OR IGNORE INTO view_permissions (vista_key, nombre, correos_autorizados) VALUES (?, ?, ?)"
  );
  insViewPerm.run("admin", "👑 Admin Principal (Control Total)", "");
  insViewPerm.run("subadmin", "📊 Ventas Fenix (Modificar)", "");
  insViewPerm.run("subadmin_readonly", "👁️ Ventas Fenix (Solo Lectura)", "");
  insViewPerm.run("moviles", "📱 Hoja Espejo Móviles (Solo Notas y Seguimiento)", "");
  db.prepare("UPDATE view_permissions SET nombre = '📊 Ventas Fenix (Modificar)' WHERE vista_key = 'subadmin'").run();
  db.prepare("UPDATE companies SET es_movil_espejo = 0, ocultar_en_espejo_movil = 1 WHERE slug = 'aa-sales'").run();

  const insSetting = db.prepare("INSERT OR IGNORE INTO payment_settings (clave, valor) VALUES (?, ?)");
  insSetting.run("PAGO_PAQ", 10000);
  insSetting.run("PAGO_FIBRA", 15000);
  insSetting.run("PAGO_CLARO", 15000);
}

initSchema();

function slugify(str) {
  return normalizarTexto(str)
    .replace(/&/g, "y")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureDefaultCompaniesAndSupervisors() {
  const count = db.prepare("SELECT COUNT(*) as c FROM companies").get().c;
  if (count === 0) {
    const defaultCompanies = [
      {
        slug: "paquetizacion-movistar",
        nombre: "Paquetizacion Movistar",
        hoja: "Paquetizacion Movistar",
        operador_form: "Movistar Fijo",
        operadores_extra: "Paquetizacion",
        iniciales_pagos: "Paq",
        tipo_categoria: "paquetizacion",
        basada_en: "Fibra Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "💙",
        color: "#019df4",
        orden: 10,
        columnas: COLS_FIBRA_HOGAR,
      },
      {
        slug: "movistar-sin-tenencia",
        nombre: "Instalaciones Movistar sin Tenencia",
        hoja: "Instalaciones Movistar sin Tenencia",
        operador_form: "Movistar Fijo",
        operadores_extra: "Instalacion sin tenencia",
        iniciales_pagos: "Fib",
        tipo_categoria: "fibra",
        basada_en: "Fibra Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "💙",
        color: "#0288d1",
        orden: 20,
        columnas: COLS_FIBRA_HOGAR,
      },
      {
        slug: "movistar-con-tenencia",
        nombre: "Instalacion Movistar Con tenencia",
        hoja: "Instalacion Movistar Con tenencia",
        operador_form: "Movistar Fijo",
        operadores_extra: "Instalacion con tenencia",
        iniciales_pagos: "Fib",
        tipo_categoria: "fibra",
        basada_en: "Fibra Tenencia",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "🏡",
        color: "#0097a7",
        orden: 30,
        columnas: COLS_FIBRA_TENENCIA,
      },
      {
        slug: "ventas-entel",
        nombre: "Ventas Entel",
        hoja: "Ventas Entel",
        operador_form: "Entel Fijo",
        operadores_extra: "Entel Hogar",
        iniciales_pagos: "Fib",
        tipo_categoria: "fibra",
        basada_en: "Fibra Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "🧡",
        color: "#ff6600",
        orden: 40,
        columnas: COLS_FIBRA_HOGAR,
      },
      {
        slug: "claro-vtr-hogar",
        nombre: "Claro y Vtr Hogar",
        hoja: "Claro y Vtr Hogar",
        operador_form: "Claro y Vtr Hogar",
        operadores_extra: "CLARO, VTR",
        iniciales_pagos: "C/V",
        tipo_categoria: "claroVtr",
        basada_en: "Claro y Vtr Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "❤️",
        color: "#da291c",
        orden: 50,
        columnas: COLS_CLARO_VTR,
      },
      {
        slug: "ventas-wom-hogar",
        nombre: "Ventas Wom Hogar",
        hoja: "Ventas Wom Hogar",
        operador_form: "Wom Fijo",
        operadores_extra: "WOM",
        iniciales_pagos: "Fib",
        tipo_categoria: "fibra",
        basada_en: "Fibra Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "💜",
        color: "#9c27b0",
        orden: 60,
        columnas: COLS_FIBRA_HOGAR,
      },
      {
        slug: "ventas-entel-pyme",
        nombre: "Ventas Entel Pyme",
        hoja: "Ventas Entel Pyme",
        operador_form: "Entel Pyme",
        operadores_extra: "",
        iniciales_pagos: "Pyme",
        tipo_categoria: "pyme",
        basada_en: "Fibra Hogar",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 0,
        usa_portado: 0,
        emoji: "🏢",
        color: "#00897b",
        orden: 70,
        columnas: COLS_FIBRA_HOGAR,
      },
      {
        slug: "ventas-entel-movil",
        nombre: "Ventas Entel Movil",
        hoja: "Ventas Entel Movil",
        operador_form: "Entel Movil",
        operadores_extra: "Entel Móvil",
        iniciales_pagos: "E.M.",
        tipo_categoria: "movil",
        basada_en: "Móvil",
        es_movil_espejo: 1,
        ocultar_en_espejo_movil: 0,
        usa_portado: 1,
        emoji: "📱",
        color: "#f4511e",
        orden: 80,
        columnas: COLS_MOVIL,
      },
      {
        slug: "ventas-entel-pyme-movil",
        nombre: "Ventas Entel Pyme Movil",
        hoja: "Ventas Entel Pyme Movil",
        operador_form: "Entel Pyme Movil",
        operadores_extra: "Entel Pyme Móvil",
        iniciales_pagos: "P.M.",
        tipo_categoria: "pymeMovil",
        basada_en: "Ventas Entel Movil",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 1,
        usa_portado: 1,
        emoji: "💼",
        color: "#00695c",
        orden: 90,
        columnas: COLS_MOVIL,
      },
      {
        slug: "ventas-claro-movil",
        nombre: "Ventas Claro Movil",
        hoja: "Ventas Claro Movil",
        operador_form: "Claro Movil",
        operadores_extra: "Claro Móvil",
        iniciales_pagos: "E.M.",
        tipo_categoria: "movil",
        basada_en: "Ventas Entel Movil",
        es_movil_espejo: 1,
        ocultar_en_espejo_movil: 0,
        usa_portado: 1,
        emoji: "📱",
        color: "#c62828",
        orden: 100,
        columnas: COLS_MOVIL,
      },
      {
        slug: "ventas-moviles-movistar",
        nombre: "Ventas Moviles Movistar",
        hoja: "Ventas Moviles Movistar",
        operador_form: "Movistar Movil",
        operadores_extra: "Movistar Móvil",
        iniciales_pagos: "E.M.",
        tipo_categoria: "movil",
        basada_en: "Ventas Entel Movil",
        es_movil_espejo: 1,
        ocultar_en_espejo_movil: 0,
        usa_portado: 1,
        emoji: "📱",
        color: "#1976d2",
        orden: 110,
        columnas: COLS_MOVIL,
      },
      {
        slug: "aa-sales",
        nombre: "A&A Sales",
        hoja: "A&A Sales",
        operador_form: "A&A Sales",
        operadores_extra: "A&A, AA Sales",
        iniciales_pagos: "A&A",
        tipo_categoria: "aa",
        basada_en: "Ventas Entel Movil",
        es_movil_espejo: 0,
        ocultar_en_espejo_movil: 1,
        usa_portado: 1,
        emoji: "🤝",
        color: "#00acc1",
        orden: 120,
        columnas: COLS_MOVIL,
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO companies (
        slug, nombre, hoja, operador_form, operadores_extra, iniciales_pagos,
        tipo_categoria, basada_en, es_movil_espejo, ocultar_en_espejo_movil,
        usa_portado, emoji, color, orden, columnas_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of defaultCompanies) {
      stmt.run(
        c.slug,
        c.nombre,
        c.hoja,
        c.operador_form,
        c.operadores_extra,
        c.iniciales_pagos,
        c.tipo_categoria,
        c.basada_en,
        c.es_movil_espejo,
        c.ocultar_en_espejo_movil,
        c.usa_portado,
        c.emoji,
        c.color,
        c.orden,
        JSON.stringify(c.columnas)
      );
    }
  }

  const supCount = db.prepare("SELECT COUNT(*) as c FROM supervisors").get().c;
  if (supCount === 0) {
    const defaultSups = [
      { nombre: "Francisca", aliases: "Francisca" },
      { nombre: "Emmanuel Rodriguez", aliases: "Emmanuel Rodriguez, Emmanuel" },
      { nombre: "German Vallejo", aliases: "GERMAN VALLEJO, German Vallejo" },
      { nombre: "Elimar Graterol", aliases: "Elimar Graterol, Elimar" },
      { nombre: "David Aguirre", aliases: "DAVID AGUIRRE, David Aguirre" },
      { nombre: "Alexander Cantillo", aliases: "Alexander Cantillo" },
      { nombre: "Mario Rodriguez", aliases: "Mario Rodriguez" },
      { nombre: "Wilmer Cassiani", aliases: "Wilmer Cassiani" },
      { nombre: "Andres Arias", aliases: "Andres Arias" },
      { nombre: "Reinaldo Joel Claro Bodero", aliases: "Reinaldo Joel Claro Bodero, Reinaldo Claro" },
      { nombre: "Jose Luis", aliases: "JOSE LUIS, Jose Luis" },
      { nombre: "Angela Manchola", aliases: "Angela Manchola" },
      { nombre: "Irieleth Rodriguez", aliases: "Irieleth Rodriguez" },
      { nombre: "Abel Cervantes Fernandez", aliases: "Abel Cervantes Fernandez" },
      { nombre: "Jesus Vergara", aliases: "Jesus Vergara" },
    ];
    const insSup = db.prepare(
      "INSERT OR IGNORE INTO supervisors (nombre, aliases, token_acceso, activo) VALUES (?, ?, ?, 1)"
    );
    for (const s of defaultSups) {
      const token = slugify(s.nombre) + "-" + crypto.randomBytes(3).toString("hex");
      insSup.run(s.nombre, s.aliases, token);
    }
  }
}

ensureDefaultCompaniesAndSupervisors();

// ============================================================================
// CONSULTAS Y RESOLUCIÓN DE SUPERVISORES / COMPAÑÍAS
// ============================================================================

/**
 * Returns whether a company is visible in the Espejo Móviles view.
 */
function isMobileMirrorCompany(company) {
  return Boolean(company && company.es_movil_espejo && !company.ocultar_en_espejo_movil);
}

/**
 * Returns whether a company belongs to mobile services (Entel Móvil, Claro Móvil, Movistar Móvil, Pyme Móvil).
 */
function isMobileCompany(company) {
  if (!company) return false;
  return Boolean(
    company.tipo_categoria === "movil" ||
      company.tipo_categoria === "pymeMovil" ||
      company.es_movil_espejo ||
      (company.slug && company.slug.includes("movil"))
  );
}

/**
 * Throws a 403 error if a company is not accessible from the Espejo Móviles view.
 */
function assertMobileMirrorCompany(company) {
  if (!isMobileMirrorCompany(company)) {
    const err = new Error("Esta hoja no está disponible en el acceso Espejo Móviles.");
    err.statusCode = 403;
    throw err;
  }
}

function getAllCompanies() {
  const rows = db.prepare("SELECT * FROM companies ORDER BY orden ASC, nombre ASC").all();
  return rows.filter(r => !r.hoja.toLowerCase().includes("debug")).map((r) => ({
    ...r,
    es_movil_espejo: !!r.es_movil_espejo,
    ocultar_en_espejo_movil: !!r.ocultar_en_espejo_movil,
    usa_portado: !!r.usa_portado,
    columnas: JSON.parse(r.columnas_json || "[]"),
  }));
}

function getAllSupervisors() {
  return db
    .prepare("SELECT * FROM supervisors ORDER BY nombre ASC")
    .all()
    .map((s) => ({
      ...s,
      activo: !!s.activo,
      compania: s.compania || "",
      aliasesList: String(s.aliases || s.nombre)
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    }));
}

function resolveCanonicalSupervisor(rawSup, supsCache = null) {
  const limpio = String(rawSup || "").trim();
  if (!limpio) return "Sin Asignar";
  const norm = normalizarTexto(limpio);
  const sups = supsCache || getAllSupervisors();
  for (const s of sups) {
    for (const alias of s.aliasesList) {
      const an = normalizarTexto(alias);
      if (an && (norm === an || norm.includes(an) || an.includes(norm))) {
        return s.nombre;
      }
    }
  }
  return darFormatoNombre(limpio);
}

function supervisorMatchesFilter(saleSupervisor, supObjOrName, supsCache = null) {
  if (!supObjOrName) return true;
  const saleNorm = normalizarTexto(saleSupervisor);
  if (!saleNorm) return false;
  if (typeof supObjOrName === "object" && supObjOrName.aliasesList) {
    return supObjOrName.aliasesList.some((a) => {
      const an = normalizarTexto(a);
      return an && (saleNorm === an || saleNorm.includes(an) || an.includes(saleNorm));
    });
  }
  const targetNorm = normalizarTexto(String(supObjOrName));
  const sups = supsCache || getAllSupervisors();
  const found = sups.find(
    (s) =>
      normalizarTexto(s.nombre) === targetNorm ||
      s.token_acceso === String(supObjOrName) ||
      s.aliasesList.some((a) => normalizarTexto(a) === targetNorm)
  );
  if (found) {
    return found.aliasesList.some((a) => {
      const an = normalizarTexto(a);
      return an && (saleNorm === an || saleNorm.includes(an) || an.includes(saleNorm));
    });
  }
  return saleNorm.includes(targetNorm) || targetNorm.includes(saleNorm);
}

function resolveCompanyDestination(operador, tipoVenta = "") {
  const opNorm = normalizarTexto(operador);
  const tvNorm = normalizarTexto(tipoVenta);
  const combined = normalizarTexto((operador || "") + " " + (tipoVenta || ""));
  const companies = getAllCompanies();

  if (!opNorm && !tvNorm) return null;

  // 1. Coincidencia exacta con slug, hoja o nombre cuando no hay ambigüedad
  const exact = companies.find((c) =>
    normalizarTexto(c.slug) === opNorm ||
    normalizarTexto(c.hoja) === opNorm ||
    normalizarTexto(c.nombre) === opNorm ||
    normalizarTexto(c.operador_form) === opNorm
  );
  if (exact && !tvNorm) return exact;

  // 2. Entel (Pyme Móvil, Pyme Hogar, Móvil, Fijo/Hogar)
  if (combined.includes("entel") && combined.includes("pyme") && combined.includes("movil")) {
    const c = companies.find((c) => c.slug === "ventas-entel-pyme-movil");
    if (c) return c;
  }
  if (combined.includes("entel") && combined.includes("pyme")) {
    const c = companies.find((c) => c.slug === "ventas-entel-pyme");
    if (c) return c;
  }
  if (combined.includes("entel") && combined.includes("movil")) {
    const c = companies.find((c) => c.slug === "ventas-entel-movil");
    if (c) return c;
  }
  if (combined.includes("entel")) {
    const c = companies.find((c) => c.slug === "ventas-entel");
    if (c) return c;
  }

  // 3. Claro y VTR (Móvil vs Hogar)
  if (combined.includes("claro") && combined.includes("movil")) {
    const c = companies.find((c) => c.slug === "ventas-claro-movil");
    if (c) return c;
  }
  if (combined.includes("claro") || combined.includes("vtr")) {
    const c = companies.find((c) => c.slug === "claro-vtr-hogar");
    if (c) return c;
  }

  // 4. WOM (Hogar)
  if (combined.includes("wom")) {
    const c = companies.find((c) => c.slug === "ventas-wom-hogar");
    if (c) return c;
  }

  // 5. A&A Sales
  if (combined.includes("a&a") || combined.includes("aa sales") || combined.includes("a and a")) {
    const c = companies.find((c) => c.slug === "aa-sales");
    if (c) return c;
  }

  // 6. Movistar (Móvil, Paquetización, Con Tenencia, Sin Tenencia)
  if (combined.includes("movistar") || combined.includes("instalacion") || combined.includes("paquetiz") || combined.includes("tenencia")) {
    if (combined.includes("movil")) return companies.find((c) => c.slug === "ventas-moviles-movistar");
    if (combined.includes("paquetiz")) return companies.find((c) => c.slug === "paquetizacion-movistar");
    if (combined.includes("con tenencia")) return companies.find((c) => c.slug === "movistar-con-tenencia");
    if (combined.includes("sin tenencia")) return companies.find((c) => c.slug === "movistar-sin-tenencia");
    return companies.find((c) => c.slug === "movistar-sin-tenencia");
  }

  // 7. Búsqueda por operadores_extra
  for (const c of companies) {
    const extras = String(c.operadores_extra || "")
      .split(",")
      .map((x) => normalizarTexto(x))
      .filter(Boolean);
    if (extras.some((ext) => opNorm.includes(ext) || tvNorm.includes(ext) || ext.includes(opNorm))) return c;
  }

  if (exact) return exact;
  return null;
}

// ============================================================================
// DETECCIÓN INTELIGENTE DE DUPLICADOS EN BASE DE DATOS
// ============================================================================

function checkDuplicateSale(company, candidate) {
  const rutComp = limpiarRutComparacion(candidate.rut);
  if (!rutComp || rutComp.length < 5) return { duplicate: false };

  const rows = db
    .prepare("SELECT * FROM sales WHERE company_slug = ? ORDER BY id DESC LIMIT 400")
    .all(company.slug);

  const fNueva = extraerFechaSegura(candidate.fecha);
  const ejecNuevo = normalizarTexto(candidate.ejecutivo);
  const codBioNuevo = String(candidate.id_orden || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const tieneColDireccion = !company.usa_portado;

  for (const ex of rows) {
    const est = normalizarTexto(ex.estado);
    if (
      est.includes("cancel") ||
      est.includes("no realiz") ||
      est.includes("rechaz") ||
      est.includes("anulad") ||
      est.includes("caid")
    ) {
      continue;
    }

    if (limpiarRutComparacion(ex.rut) !== rutComp) continue;

    const ejecEx = normalizarTexto(ex.ejecutivo);
    if (ejecNuevo && ejecEx && ejecEx !== ejecNuevo) continue;

    const codBioEx = String(ex.id_orden || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (codBioNuevo && codBioEx && codBioNuevo !== codBioEx) continue;

    if (tieneColDireccion) {
      if (!sonDireccionesIguales(candidate.direccion, ex.direccion)) continue;
    } else {
      const pNuevo = String(candidate.numero_principal || candidate.telefono || "").replace(/\D/g, "");
      const pEx = String(ex.numero_principal || ex.telefono || "").replace(/\D/g, "");
      if (!pNuevo || !pEx || pNuevo !== pEx) continue;
    }

    const fEx = extraerFechaSegura(ex.fecha);
    if (!fNueva || !fEx) continue;
    if (fNueva.dia !== fEx.dia || fNueva.mes !== fEx.mes || fNueva.anio !== fEx.anio) continue;

    return {
      duplicate: true,
      existingId: ex.id,
      reason: tieneColDireccion
        ? `Ya existe una venta activa en la fecha ${ex.fecha} para el RUT ${ex.rut} en la misma dirección (${ex.direccion}).`
        : `Ya existe una venta móvil activa en la fecha ${ex.fecha} para el RUT ${ex.rut} con el mismo número (${ex.numero_principal}).`,
    };
  }

  return { duplicate: false };
}

// ============================================================================
// INGRESO DE VENTAS (FORMULARIO PROPIO Y TALLY WEBHOOK)
// ============================================================================

function insertSaleRecord(company, data, skipDuplicateCheck = false) {
  const fechaLatina = formatearFechaISOaLatina(data.fecha || new Date());
  const fObj = extraerFechaSegura(fechaLatina) || {
    dia: new Date().getDate(),
    mes: new Date().getMonth(),
    anio: new Date().getFullYear(),
  };
  const fechaOrden = fechaAClaveOrden(fechaLatina);
  const sups = getAllSupervisors();
  const supervisorCanon = resolveCanonicalSupervisor(data.supervisor, sups);
  const ejecutivoFmt = darFormatoNombre(data.ejecutivo || "");

  const record = {
    company_slug: company.slug,
    fecha: fechaLatina,
    fecha_orden: fechaOrden,
    mes: fObj.mes,
    anio: fObj.anio,
    ejecutivo: ejecutivoFmt,
    supervisor: supervisorCanon,
    comuna: String(data.comuna || "").trim(),
    direccion: String(data.direccion || "").trim(),
    direccion_limpia: String(data.direccion_limpia || "").trim(),
    rut: formatearRut(data.rut || ""),
    nombre_cliente: String(data.nombre_cliente || "").trim(),
    telefono: String(data.telefono || "").trim(),
    numero_principal: String(data.numero_principal || "").trim(),
    adicional: String(data.adicional || "").trim(),
    cant_titular: Number(data.cant_titular || 0),
    cant_adicional: Number(data.cant_adicional || 0),
    correo: String(data.correo || "").trim(),
    servicio: String(data.servicio || "").trim(),
    estado: String(data.estado || "Pendiente").trim() || "Pendiente",
    id_orden: String(data.id_orden || "").trim(),
    fecha_instalacion: String(data.fecha_instalacion || "").trim(),
    observacion: String(data.observacion || "").trim(),
    subcompania: String(data.subcompania || "").trim(),
    hizo_click: String(data.hizo_click || "").trim(),
    imagen_url: String(data.imagen_url || "").trim(),
    ficha_original: String(data.ficha_original || "").trim(),
    notas_movil: String(data.notas_movil || "").trim(),
    seguimiento_movil: String(data.seguimiento_movil || "").trim(),
    estado_pago: String(data.estado_pago || "").trim() === "Pagado" ? "Pagado" : "No Pagado",
  };

  if (!record.telefono && record.numero_principal) {
    record.telefono = record.adicional
      ? `${record.numero_principal} / ${record.adicional.replace(/\s*\|\s*/g, " / ")}`
      : record.numero_principal;
  }
  if (!record.numero_principal && record.telefono) {
    const nums = extraerTelefonosSeguro(record.telefono);
    record.numero_principal = nums[0] || "";
    if (!record.adicional && nums.length > 1) {
      record.adicional = nums.slice(1).join(" | ");
    }
  }
  if (record.numero_principal && record.cant_titular === 0) record.cant_titular = 1;
  if (record.adicional) {
    const adicClean = extraerTelefonosSeguro(record.adicional).filter((n) => n !== record.numero_principal);
    record.adicional = adicClean.join(" | ");
    record.cant_adicional = adicClean.length;
  } else {
    record.cant_adicional = 0;
  }

  if (!skipDuplicateCheck) {
    const dup = checkDuplicateSale(company, record);
    if (dup.duplicate) {
      return { ok: false, duplicate: true, message: dup.reason, existingId: dup.existingId };
    }
  }

  const stmt = db.prepare(`
    INSERT INTO sales (
      company_slug, fecha, fecha_orden, mes, anio, ejecutivo, supervisor,
      comuna, direccion, direccion_limpia, rut, nombre_cliente, telefono,
      numero_principal, adicional, cant_titular, cant_adicional, correo,
      servicio, estado, id_orden, fecha_instalacion, observacion,
      subcompania, hizo_click, imagen_url, ficha_original, notas_movil, seguimiento_movil, estado_pago
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const info = stmt.run(
    record.company_slug,
    record.fecha,
    record.fecha_orden,
    record.mes,
    record.anio,
    record.ejecutivo,
    record.supervisor,
    record.comuna,
    record.direccion,
    record.direccion_limpia,
    record.rut,
    record.nombre_cliente,
    record.telefono,
    record.numero_principal,
    record.adicional,
    record.cant_titular,
    record.cant_adicional,
    record.correo,
    record.servicio,
    record.estado,
    record.id_orden,
    record.fecha_instalacion,
    record.observacion,
    record.subcompania,
    record.hizo_click,
    record.imagen_url,
    record.ficha_original,
    record.notas_movil,
    record.seguimiento_movil,
    record.estado_pago
  );

  if (record.ejecutivo) {
    const ejNorm = normalizarTexto(record.ejecutivo);
    db.prepare(
      "INSERT INTO executive_goals (ejecutiva_norm, nombre, minimo_ventas, supervisor_habitual) VALUES (?, ?, 10, ?) ON CONFLICT(ejecutiva_norm) DO UPDATE SET supervisor_habitual = CASE WHEN excluded.supervisor_habitual != 'Sin Asignar' THEN excluded.supervisor_habitual ELSE executive_goals.supervisor_habitual END"
    ).run(ejNorm, record.ejecutivo, record.supervisor);
  }

  const created = db.prepare("SELECT * FROM sales WHERE id = ?").get(info.lastInsertRowid);
  return { ok: true, sale: created, company };
}

function submitFormSale(payload) {
  const company = resolveCompanyDestination(payload.company_slug || payload.operador, payload.tipo_venta || "");
  if (!company) {
    throw new Error(`No se encontró una hoja configurada para "${payload.operador || payload.company_slug}".`);
  }

  const parsed = parsearFichaCompleta(payload.ficha || "", payload.fecha || null);

  let imagenUrl = payload.imagen_url || "";
  if (payload.imagen_base64 && String(payload.imagen_base64).startsWith("data:")) {
    const rawDataUri = String(payload.imagen_base64);
    const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
    const mImg = rawDataUri.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    const mPdf = rawDataUri.match(/^data:application\/pdf;base64,(.+)$/i);
    if (mImg) {
      const ext = mImg[1].toLowerCase() === "jpeg" ? "jpg" : mImg[1].toLowerCase();
      const buf = Buffer.from(mImg[2], "base64");
      const validMagic =
        (ext === "png" && buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
        (ext === "jpg" && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
        (ext === "gif" && buf.length >= 4 && buf.subarray(0, 3).toString("ascii") === "GIF") ||
        (ext === "webp" && buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP");
      if (validMagic && buf.length <= MAX_UPLOAD_BYTES) {
        const fileName = `click_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
        imagenUrl = `/uploads/${fileName}`;
      }
    } else if (mPdf) {
      const buf = Buffer.from(mPdf[1], "base64");
      const isPdfMagic = buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-";
      if (isPdfMagic && buf.length <= MAX_UPLOAD_BYTES) {
        const fileName = `click_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.pdf`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
        imagenUrl = `/uploads/${fileName}`;
      }
    }
  }

  const override = payload.overrides || payload || {};

  // Soporte explícito para Número Principal y Números Adicionales en Móviles
  let numeroPrincipal = parsed.numeroPrincipal;
  let adicional = parsed.adicionales;
  let telefono = parsed.telefonoContacto;

  if (company.usa_portado) {
    if (override.numero_principal !== undefined) {
      const pClean = extraerTelefonosSeguro(override.numero_principal);
      numeroPrincipal = pClean[0] || String(override.numero_principal).trim();
    }
    if (override.adicional !== undefined) {
      const aClean = extraerTelefonosSeguro(override.adicional).filter((n) => n !== numeroPrincipal);
      adicional = aClean.join(" | ");
    }
    const allMobile = [numeroPrincipal, ...extraerTelefonosSeguro(adicional)].filter(Boolean);
    telefono = allMobile.join(" / ");
  } else if (override.telefono !== undefined && override.telefono !== "") {
    const telsOverride = extraerTelefonosSeguro(override.telefono);
    telefono = telsOverride.length > 0 ? telsOverride.join(" / ") : String(override.telefono).trim();
    numeroPrincipal = telsOverride[0] || "";
    adicional = telsOverride.length > 1 ? telsOverride.slice(1).join(" | ") : "";
  }

  const cantTitular = numeroPrincipal ? 1 : 0;
  const cantAdicional = adicional ? extraerTelefonosSeguro(adicional).filter((n) => n !== numeroPrincipal).length : 0;

  const data = {
    fecha: payload.fecha || parsed.fecha,
    ejecutivo: payload.ejecutivo,
    supervisor: payload.supervisor === "Otro" && payload.supervisor_otro ? payload.supervisor_otro : payload.supervisor,
    ficha_original: payload.ficha || "",
    rut: override.rut !== undefined && override.rut !== "" ? override.rut : parsed.rut,
    nombre_cliente:
      override.nombre_cliente !== undefined && override.nombre_cliente !== ""
        ? override.nombre_cliente
        : parsed.nombreCliente,
    direccion:
      override.direccion !== undefined && override.direccion !== "" ? override.direccion : parsed.direccion,
    direccion_limpia: parsed.direccionLimpia,
    comuna: override.comuna !== undefined && override.comuna !== "" ? override.comuna : parsed.comuna,
    correo: override.correo !== undefined && override.correo !== "" ? override.correo : parsed.correo,
    telefono,
    numero_principal: numeroPrincipal,
    adicional,
    cant_titular: cantTitular,
    cant_adicional: cantAdicional,
    servicio: override.servicio !== undefined && override.servicio !== "" ? override.servicio : parsed.servicio,
    id_orden:
      override.id_orden !== undefined && override.id_orden !== "" ? override.id_orden : parsed.codigoBiometria,
    subcompania: payload.subcompania || "",
    hizo_click: payload.hizo_click || "",
    imagen_url: imagenUrl,
    observacion: payload.observacion || (payload.hizo_click === "Sí" ? "Click Sí" : ""),
    estado: payload.estado || "Pendiente",
  };

  return insertSaleRecord(company, data, !!payload.forzar_duplicada);
}

// ============================================================================
// EDICIÓN EN VIVO DE CELDAS (CON PERMISOS POR ROL)
// ============================================================================

const ALLOWED_SALE_FIELDS = new Set([
  "fecha",
  "ejecutivo",
  "supervisor",
  "comuna",
  "direccion",
  "direccion_limpia",
  "rut",
  "nombre_cliente",
  "telefono",
  "numero_principal",
  "adicional",
  "cant_titular",
  "cant_adicional",
  "correo",
  "servicio",
  "estado",
  "id_orden",
  "fecha_instalacion",
  "observacion",
  "subcompania",
  "notas_movil",
  "seguimiento_movil",
  "estado_pago",
  "company_slug",
]);

const MOBILE_MIRROR_EDITABLE_FIELDS = new Set(["notas_movil", "seguimiento_movil", "estado_pago"]);

function updateSaleFields(id, patch, roleOrOpts = "admin") {
  const role = typeof roleOrOpts === "object" && roleOrOpts !== null ? roleOrOpts.role || "admin" : roleOrOpts;
  if (role === "supervisor") {
    const err = new Error("Modo Solo Lectura: el perfil Supervisor no tiene permisos para editar celdas.");
    err.statusCode = 403;
    throw err;
  }

  const existing = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
  if (!existing) throw new Error("Venta no encontrada.");
  if (role === "moviles") {
    const comp = db
      .prepare("SELECT es_movil_espejo, ocultar_en_espejo_movil FROM companies WHERE slug = ?")
      .get(existing.company_slug);
    assertMobileMirrorCompany(comp);
  }

  const updates = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED_SALE_FIELDS.has(k)) continue;
    if (role === "moviles" && !MOBILE_MIRROR_EDITABLE_FIELDS.has(k)) {
      const err = new Error("En la vista Espejo Móviles solo se pueden editar Notas, Seguimiento y Estado de Pago.");
      err.statusCode = 403;
      throw err;
    }
    if (k === "estado_pago") {
      updates[k] = String(v || "").trim() === "Pagado" ? "Pagado" : "No Pagado";
    } else {
      updates[k] = v === null || v === undefined ? "" : v;
    }
  }

  if (updates.fecha !== undefined) {
    updates.fecha = formatearFechaISOaLatina(updates.fecha);
    const fObj = extraerFechaSegura(updates.fecha);
    if (fObj) {
      updates.fecha_orden = fechaAClaveOrden(updates.fecha);
      updates.mes = fObj.mes;
      updates.anio = fObj.anio;
    }
  }
  if (updates.rut !== undefined && updates.rut !== "") {
    updates.rut = formatearRut(updates.rut);
  }
  if (updates.supervisor !== undefined && updates.supervisor !== "") {
    updates.supervisor = resolveCanonicalSupervisor(updates.supervisor);
  }
  if (updates.ejecutivo !== undefined && updates.ejecutivo !== "") {
    updates.ejecutivo = darFormatoNombre(updates.ejecutivo);
  }
  if (updates.numero_principal !== undefined || updates.adicional !== undefined) {
    const np = updates.numero_principal !== undefined ? updates.numero_principal : existing.numero_principal;
    const ad = updates.adicional !== undefined ? updates.adicional : existing.adicional;
    const cleanAd = extraerTelefonosSeguro(ad).filter((x) => x !== np);
    updates.cant_titular = np ? 1 : 0;
    updates.cant_adicional = cleanAd.length;
    if (updates.adicional !== undefined) updates.adicional = cleanAd.join(" | ");
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) return existing;

  const setSql = keys.map((k) => `${k} = ?`).join(", ") + ", updated_at = datetime('now')";
  const values = keys.map((k) => updates[k]);
  db.prepare(`UPDATE sales SET ${setSql} WHERE id = ?`).run(...values, id);

  return db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
}

function deleteSale(id, roleOrOpts = "admin") {
  const role = typeof roleOrOpts === "object" && roleOrOpts !== null ? roleOrOpts.role || "admin" : roleOrOpts;
  if (role !== "admin" && role !== "subadmin") {
    const err = new Error("Solo Administración o Ventas Fenix pueden eliminar registros.");
    err.statusCode = 403;
    throw err;
  }
  db.prepare("DELETE FROM sales WHERE id = ?").run(id);
}

function bulkDeleteSales(ids = [], roleOrOpts = "admin") {
  const role = typeof roleOrOpts === "object" && roleOrOpts !== null ? roleOrOpts.role || "admin" : roleOrOpts;
  if (role !== "admin" && role !== "subadmin") {
    const err = new Error("Solo Administración o Ventas Fenix pueden eliminar registros.");
    err.statusCode = 403;
    throw err;
  }
  const cleanIds = (Array.isArray(ids) ? ids : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (cleanIds.length === 0) return { deleted: 0 };
  const stmt = db.prepare("DELETE FROM sales WHERE id = ?");
  let deleted = 0;
  db.exec("BEGIN TRANSACTION;");
  try {
    for (const id of cleanIds) {
      const r = stmt.run(id);
      deleted += r.changes || 0;
    }
    db.exec("COMMIT;");
  } catch (e) {
    db.exec("ROLLBACK;");
    throw e;
  }
  return { deleted };
}

// ============================================================================
// CONSULTA DE HOJA CON SEPARACIÓN POR MESES Y FILTRO DE SUPERVISOR / MÓVILES
// ============================================================================

function getCompanySales(companySlug, options = {}) {
  const company = db.prepare("SELECT * FROM companies WHERE slug = ?").get(companySlug);
  if (!company) throw new Error("Compañía no encontrada.");
  if (options.vistaMovilEspejo) assertMobileMirrorCompany(company);

  const where = ['company_slug = ?'];
  const args = [companySlug];
  const sups = getAllSupervisors();
  if (options.supervisor) {
    const names = db.prepare('SELECT DISTINCT supervisor FROM sales').all()
      .map(r => r.supervisor).filter(name => supervisorMatchesFilter(name, options.supervisor, sups));
    where.push(names.length ? `supervisor IN (${names.map(() => '?').join(',')})` : '0');
    args.push(...names);
  }
  for (const key of ['mes', 'anio']) {
    if (options[key] !== undefined && options[key] !== '' && options[key] !== 'all') {
      where.push(`${key} = ?`); args.push(Number(options[key]));
    }
  }
  if (options.dia !== undefined && options.dia !== '' && options.dia !== 'all') {
    const diaNum = Number(options.dia);
    if (Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31) {
      where.push('(fecha_orden % 100) = ?');
      args.push(diaNum);
    }
  }
  if (options.estado && options.estado !== 'all') {
    where.push('fenix_norm(estado) = ?'); args.push(normalizarTexto(options.estado));
  }
  if (options.q) {
    const columns = ['rut','nombre_cliente','direccion','comuna','ejecutivo','supervisor','telefono','numero_principal','adicional','id_orden','observacion'];
    where.push(`instr(fenix_norm(${columns.join(" || ' ' || ")}), ?) > 0`);
    args.push(normalizarTexto(options.q));
  }
  const clause = where.join(' AND ');
  const totalMatching = db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE ${clause}`).get(...args).n;
  const requestedSize = Number(options.pageSize || options.limit || 150);
  const pageSize = options.exportAll ? Math.max(1, totalMatching) : Math.max(1, Math.min(400, Number.isFinite(requestedSize) ? Math.floor(requestedSize) : 150));
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  const requestedPage = Number(options.page || 1);
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const offset = (page - 1) * pageSize;
  const sortable = new Set(['fecha_orden','ejecutivo','supervisor','nombre_cliente','comuna','estado','rut','id']);
  const sort = sortable.has(options.sort) ? options.sort : 'fecha_orden';
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT * FROM sales WHERE ${clause} ORDER BY ${sort} ${direction}, id ${direction} LIMIT ? OFFSET ?`).all(...args, pageSize, offset);

  let columnas = JSON.parse(company.columnas_json || "[]");
  const usaColumnaPago =
    isMobileCompany(company) ||
    Boolean(company.usa_portado) ||
    company.slug === "aa-sales" ||
    company.tipo_categoria === "aa";
  if (usaColumnaPago && !columnas.some((c) => c.key === "estado_pago")) {
    columnas = [
      ...columnas,
      { key: "estado_pago", label: "💳 Pago", width: 128, type: "payment_status" },
    ];
  }
  if ((usaColumnaPago || options.vistaMovilEspejo) && !columnas.some((c) => c.key === "notas_movil")) {
    columnas = [
      ...columnas,
      { key: "notas_movil", label: "📝 Notas", width: 185 },
      { key: "seguimiento_movil", label: "📋 Seguimiento", width: 185 },
    ];
  }

  return {
    company: {
      ...company,
      es_movil_espejo: !!company.es_movil_espejo,
      ocultar_en_espejo_movil: !!company.ocultar_en_espejo_movil,
      usa_portado: !!company.usa_portado,
      columnas,
    },
    total: totalMatching,
    page, pageSize, totalPages, offset,
    sales: rows,
  };
}

// ============================================================================
// VENTAS DEL DÍA (EN TIEMPO REAL, CON SELECTOR DE FECHA + FORMATO TELEGRAM)
// ============================================================================

function formatDailySummaryTelegram(summary) {
  const est = summary.resumenEstados || {};
  const mov = summary.resumenMoviles || {};
  const totIng = est.totalIngresadas ?? summary.granTotal ?? 0;
  const aprob = est.aprobadasInstaladas ?? 0;
  const pend = est.pendientes ?? 0;
  const rech = est.rechazadasCaidas ?? 0;
  const tasa = est.tasaConversion || (totIng > 0 ? ((aprob / totIng) * 100).toFixed(1) + "%" : "0.0%");

  const movTot = mov.totalMoviles ?? 0;
  const movTit = mov.totalTitulares ?? 0;
  const movAdi = mov.totalAdicionales ?? 0;

  const lines = [
    `╔════════════════════════════════════╗`,
    `  🔥  *REPORTE DIARIO DE VENTAS*  🔥`,
    `  📅  *Fecha:* ${summary.fecha}`,
    `  🌟  *Total Ingresadas:* ${totIng} ventas`,
    `╚════════════════════════════════════╝`,
    ``,
    `📊 *RESUMEN GENERAL DEL DÍA:*`,
    `• 📥 Total Ingresadas: *${totIng}*`,
    `• ✅ Aprobadas / Instaladas: *${aprob}*`,
    `• ⏳ Pendientes / En Proceso: *${pend}*`,
    `• ❌ Rechazadas / Caídas: *${rech}*`,
    `• 📈 Tasa de Conversión: *${tasa}*`,
    ``,
    `📱 *DESGLOSE DE LÍNEAS MÓVILES:*`,
    `• 🔹 Titulares: *${movTit}*`,
    `• 🔸 Adicionales: *${movAdi}*`,
    `• 📲 Total Móviles: *${movTot}*`,
    ``
  ];

  if (!summary.bloques || summary.bloques.length === 0) {
    lines.push("_Sin ventas registradas en esta fecha._");
    return lines.join("\n");
  }

  // Resumen rápido de totales por Compañía
  const compTotals = {};
  for (const b of summary.bloques) {
    for (const c of b.campanias) {
      if (!compTotals[c.titulo]) {
        compTotals[c.titulo] = { titulo: c.titulo, total: 0, esMovil: Boolean(c.esMovil), totalTit: 0, totalAdi: 0 };
      }
      compTotals[c.titulo].total += c.total;
      if (c.esMovil) {
        compTotals[c.titulo].totalTit += c.totalTitulares || 0;
        compTotals[c.titulo].totalAdi += c.totalAdicionales || 0;
      }
    }
  }

  lines.push(`🏢 *TOTALES POR COMPAÑÍA:*`);
  for (const info of Object.values(compTotals).sort((a, b) => b.total - a.total)) {
    const extra = info.esMovil ? ` _(${info.totalTit} Tit · ${info.totalAdi} Adi)_` : "";
    lines.push(`• ${info.titulo}: *${info.total}*${extra}`);
  }

  lines.push(``, `👑 *TOTALES POR SUPERVISOR:*`);
  for (const b of summary.bloques) {
    lines.push(`• 👤 *${b.supervisor}:* ${b.total} ventas`);
  }

  lines.push(``, `════════════════════════════════════`);
  lines.push(`👥 *DETALLE POR EQUIPO Y COMPAÑÍA*`);
  lines.push(`════════════════════════════════════`);

  for (const b of summary.bloques) {
    lines.push(``);
    lines.push(`👤 *SUPERVISOR: ${b.supervisor.toUpperCase()}*  ⭐ [${b.total} ventas]`);
    lines.push(`────────────────────────────────────`);

    for (const c of b.campanias) {
      const extraComp = c.esMovil ? ` (${c.totalTitulares || 0} Tit · ${c.totalAdicionales || 0} Adi)` : "";
      lines.push(`  ${c.titulo} (${c.total}${extraComp})`);
      const list = c.listaEjecutivos || [];
      list.forEach((ej, idx) => {
        const medal = idx === 0 && ej.cantidad > 1 ? "🥇" : idx === 1 && ej.cantidad > 1 ? "🥈" : idx === 2 && ej.cantidad > 1 ? "🥉" : "🔹";
        const extraEj = c.esMovil ? ` (${ej.titulares} Tit · ${ej.adicionales} Adi)` : "";
        lines.push(`     ${medal} ${ej.cantidad}${extraEj} ➔ ${ej.nombre}`);
      });
      lines.push(``);
    }
  }

  return lines.join("\n");
}

function getFechaHoyChile() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Santiago",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date());
    const d = parts.find((p) => p.type === "day")?.value || "01";
    const m = parts.find((p) => p.type === "month")?.value || "01";
    const y = parts.find((p) => p.type === "year")?.value || "2026";
    return `${d}/${m}/${y}`;
  } catch {
    return formatearFechaISOaLatina(new Date());
  }
}

function getDailySummary(fechaStr = null, options = {}) {
  const fechaObjetivo = fechaStr ? formatearFechaISOaLatina(fechaStr) : getFechaHoyChile();
  const fTarget = extraerFechaSegura(fechaObjetivo);

  const companies = getAllCompanies().filter((c) => !options.onlyMobileMirror || isMobileMirrorCompany(c));
  const companyMap = new Map(companies.map((c) => [c.slug, c]));
  const sups = getAllSupervisors();

  const ordenTarget = fechaAClaveOrden(fechaObjetivo);
  let rows = db.prepare("SELECT * FROM sales WHERE fecha_orden = ?").all(ordenTarget);

  if (options.supervisor) {
    rows = rows.filter((r) => supervisorMatchesFilter(r.supervisor, options.supervisor, sups));
  }

  const porSupervisor = {};
  let granTotal = 0;
  let totalIngresadas = 0;
  let aprobadasInstaladas = 0;
  let pendientes = 0;
  let rechazadasCaidas = 0;
  let totalTitularesGlobal = 0;
  let totalAdicionalesGlobal = 0;
  let totalMovilesGlobal = 0;

  for (const r of rows) {
    const comp = companyMap.get(r.company_slug);
    if (!comp) continue;
    const fr = extraerFechaSegura(r.fecha);
    if (!fr || !fTarget || fr.dia !== fTarget.dia || fr.mes !== fTarget.mes || fr.anio !== fTarget.anio) continue;

    totalIngresadas++;
    const estLower = (r.estado || "").trim().toLowerCase();
    if (
      estLower.includes("instalad") ||
      estLower.includes("portad") ||
      estLower.includes("aprob") ||
      estLower.includes("activo") ||
      estLower.includes("conforme") ||
      estLower.includes("exitosa") ||
      estLower.includes("ok")
    ) {
      aprobadasInstaladas++;
    } else if (
      estLower.includes("cancel") ||
      estLower.includes("no real") ||
      estLower.includes("rechaz") ||
      estLower.includes("caid") ||
      estLower.includes("caíd") ||
      estLower.includes("anul") ||
      estLower.includes("cesad") ||
      estLower.includes("baja")
    ) {
      rechazadasCaidas++;
    } else {
      pendientes++;
    }

    const ejec = darFormatoNombre(r.ejecutivo || "Sin Nombre");
    const sup = resolveCanonicalSupervisor(r.supervisor, sups);

    const isMovil = isMobileCompany(comp);
    let cantTit = 1;
    let cantAdi = 0;

    if (isMovil) {
      cantTit = Number(r.cant_titular || 0);
      if (cantTit === 0 && r.numero_principal) cantTit = 1;
      cantAdi = Number(r.cant_adicional || 0);
      if (cantAdi === 0 && r.adicional) {
        const nums = extraerTelefonosSeguro(r.adicional).filter((n) => n !== r.numero_principal);
        cantAdi = nums.length;
      }
      if (cantTit === 0 && cantAdi === 0) cantTit = 1;
      totalTitularesGlobal += cantTit;
      totalAdicionalesGlobal += cantAdi;
      totalMovilesGlobal += (cantTit + cantAdi);
    }
    const cantTotal = isMovil ? cantTit + cantAdi : 1;

    if (!porSupervisor[sup]) {
      porSupervisor[sup] = { supervisor: sup, total: 0, campanias: {} };
    }
    if (!porSupervisor[sup].campanias[comp.slug]) {
      porSupervisor[sup].campanias[comp.slug] = {
        slug: comp.slug,
        hoja: comp.hoja,
        titulo: `${comp.emoji} ${comp.hoja}`,
        color: comp.color,
        esMovil: isMovil,
        total: 0,
        totalTitulares: 0,
        totalAdicionales: 0,
        ejecutivos: {},
      };
    }

    if (!porSupervisor[sup].campanias[comp.slug].ejecutivos[ejec]) {
      porSupervisor[sup].campanias[comp.slug].ejecutivos[ejec] = {
        cantidad: 0,
        titulares: 0,
        adicionales: 0,
      };
    }

    const ejData = porSupervisor[sup].campanias[comp.slug].ejecutivos[ejec];
    ejData.cantidad += cantTotal;
    ejData.titulares += cantTit;
    ejData.adicionales += cantAdi;

    porSupervisor[sup].campanias[comp.slug].total += cantTotal;
    porSupervisor[sup].campanias[comp.slug].totalTitulares += cantTit;
    porSupervisor[sup].campanias[comp.slug].totalAdicionales += cantAdi;
    porSupervisor[sup].total += cantTotal;
    granTotal += cantTotal;
  }

  const bloques = Object.values(porSupervisor)
    .sort((a, b) => b.total - a.total || a.supervisor.localeCompare(b.supervisor))
    .map((b) => ({
      supervisor: b.supervisor,
      total: b.total,
      campanias: Object.values(b.campanias).map((c) => ({
        ...c,
        listaEjecutivos: Object.entries(c.ejecutivos)
          .map(([nombre, d]) => ({
            nombre,
            cantidad: d.cantidad,
            titulares: d.titulares,
            adicionales: d.adicionales,
          }))
          .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre)),
      })),
    }));

  const ultimasFechas = db
    .prepare(
      "SELECT fecha, fecha_orden, COUNT(*) as cantidad FROM sales WHERE fecha_orden > 0 GROUP BY fecha_orden ORDER BY fecha_orden DESC LIMIT 10"
    )
    .all();

  const tasaConversion = totalIngresadas > 0
    ? ((aprobadasInstaladas / totalIngresadas) * 100).toFixed(1) + "%"
    : "0.0%";

  const resumenEstados = {
    totalIngresadas,
    aprobadasInstaladas,
    pendientes,
    rechazadasCaidas,
    tasaConversion,
  };

  const resumenMoviles = {
    totalMoviles: totalMovilesGlobal,
    totalTitulares: totalTitularesGlobal,
    totalAdicionales: totalAdicionalesGlobal,
  };

  const resObj = {
    fecha: fechaObjetivo,
    granTotal,
    resumenEstados,
    resumenMoviles,
    bloques,
    ultimasFechas,
  };
  resObj.texto_telegram = formatDailySummaryTelegram(resObj);
  return resObj;
}

function getExecutiveLiveOverview(fechaStr = null) {
  const daily = getDailySummary(fechaStr);
  const companies = getAllCompanies();
  const companyMap = new Map(companies.map((c) => [c.slug, c]));

  const metaDiaria = 50;
  const granTotal = daily.granTotal || 0;
  const avanceMeta = Math.min(100, Math.round((granTotal / (metaDiaria || 1)) * 100));

  const ultimasRows = db
    .prepare(
      "SELECT id, company_slug, fecha, ejecutivo, supervisor, comuna, rut, nombre_cliente, telefono, cant_titular, cant_adicional, servicio, estado, created_at FROM sales ORDER BY id DESC LIMIT 25"
    )
    .all();

  const ultimasVentas = ultimasRows.map((r) => {
    const comp = companyMap.get(r.company_slug);
    const isMovil = comp ? isMobileCompany(comp) : false;
    let hora = "";
    if (r.created_at) {
      try {
        const d = new Date(r.created_at.includes("T") ? r.created_at : r.created_at.replace(" ", "T") + "Z");
        if (!isNaN(d.getTime())) {
          hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
        }
      } catch {}
    }
    if (!hora) hora = "Reciente";

    return {
      id: r.id,
      hora,
      fecha: r.fecha || "",
      ejecutivo: darFormatoNombre(r.ejecutivo || "Sin Ejecutivo"),
      supervisor: r.supervisor || "Sin Supervisor",
      compania: comp ? comp.hoja : (r.company_slug || "General"),
      color: comp ? comp.color : "#2563eb",
      servicio: r.servicio || (comp ? comp.hoja : "Servicio"),
      cliente: r.nombre_cliente || "Cliente",
      estado: r.estado || "Pendiente",
      esMovil: isMovil,
      cant_titular: Number(r.cant_titular || 1),
      cant_adicional: Number(r.cant_adicional || 0),
    };
  });

  return {
    ok: true,
    timestamp: Date.now(),
    fecha: daily.fecha,
    fechaHoy: getFechaHoyChile(),
    kpis: {
      totalVentas: granTotal,
      metaDiaria,
      avanceMeta,
      aprobadas: daily.resumenEstados?.aprobadasInstaladas || 0,
      pendientes: daily.resumenEstados?.pendientes || 0,
      rechazadas: daily.resumenEstados?.rechazadasCaidas || 0,
      tasaConversion: daily.resumenEstados?.tasaConversion || "0.0%",
    },
    moviles: {
      total: daily.resumenMoviles?.totalMoviles || 0,
      titulares: daily.resumenMoviles?.totalTitulares || 0,
      adicionales: daily.resumenMoviles?.totalAdicionales || 0,
    },
    supervisores: daily.bloques || [],
    ultimasFechas: daily.ultimasFechas || [],
    ultimasVentas,
  };
}

// ============================================================================
// PAGOS ADICIONALES (PARIDAD 100% EXACTA CON GOOGLE SHEETS Código.js)
// ============================================================================

function getPaymentSettings() {
  const rows = db.prepare("SELECT clave, valor FROM payment_settings").all();
  const map = { PAGO_PAQ: 10000, PAGO_FIBRA: 15000, PAGO_CLARO: 15000 };
  for (const r of rows) map[r.clave] = Number(r.valor);
  return map;
}

function parseMesInstalacionOPortabilidad(sale, company, anioObjetivo) {
  const cat = company.tipo_categoria;

  // 1. Móvil estándar (Entel Movil, Movistar Movil, Claro Movil):
  //    En Google Sheets (Código.js líneas 4344-4358), solo entra a Pagos cuando Observación tiene DD-MM (o Fecha instalación).
  if (cat === "movil") {
    const obs = String(sale.observacion || "").trim();
    const mObs = obs.match(/^(\d{1,2})[\-\/](\d{1,2})(?:[\-\/](\d{2,4}))?$/);
    if (mObs) {
      const mes = parseInt(mObs[2], 10) - 1;
      const anio = mObs[3]
        ? parseInt(mObs[3], 10) < 100
          ? 2000 + parseInt(mObs[3], 10)
          : parseInt(mObs[3], 10)
        : sale.anio || anioObjetivo;
      if (mes >= 0 && mes <= 11) return { mes, anio };
    }
    if (sale.fecha_instalacion) {
      const fi = extraerFechaSegura(sale.fecha_instalacion);
      if (fi) return { mes: fi.mes, anio: fi.anio };
    }
    return { mes: -1, anio: -1 };
  }

  // 2. Pyme Móvil, A&A Sales y Compañías Personalizadas Móviles (usaEstadoPortado_ en Código.js líneas 4320-4343):
  //    Usa DD-MM en Observación si existe; si no, usa Fecha Instalación o Fecha de la Venta.
  if (company.usa_portado || cat === "pymeMovil" || cat === "aa") {
    const obs = String(sale.observacion || "").trim();
    const mObs = obs.match(/^(\d{1,2})[\-\/](\d{1,2})(?:[\-\/](\d{2,4}))?/);
    if (mObs) {
      const mes = parseInt(mObs[2], 10) - 1;
      const anio = mObs[3]
        ? parseInt(mObs[3], 10) < 100
          ? 2000 + parseInt(mObs[3], 10)
          : parseInt(mObs[3], 10)
        : sale.anio || anioObjetivo;
      if (mes >= 0 && mes <= 11) return { mes, anio };
    }
  }

  // 3. Fibra Hogar, Paquetización, Claro/VTR, Pyme Fijo (y fallback de Pyme Móvil / A&A):
  if (sale.fecha_instalacion) {
    const rawInst = String(sale.fecha_instalacion).trim();
    const fFull = extraerFechaSegura(rawInst);
    if (fFull) return { mes: fFull.mes, anio: fFull.anio };
    const mCorto = rawInst.match(/^(\d{1,2})[\-\/](\d{1,2})(?:\b|\s|$)/);
    if (mCorto) {
      const mes = parseInt(mCorto[2], 10) - 1;
      if (mes >= 0 && mes <= 11) {
        let anio = sale.anio || anioObjetivo;
        if (sale.mes === 11 && mes === 0) anio += 1;
        return { mes, anio };
      }
    }
  }

  return { mes: sale.mes, anio: sale.anio };
}

function getPaymentsReport(mesParam = null, anioParam = null, supervisorFilter = null) {
  const hoy = new Date();
  let mesObjetivo = hoy.getMonth();
  let anioObjetivo = hoy.getFullYear();
  if (hoy.getDate() <= 10) {
    mesObjetivo -= 1;
    if (mesObjetivo < 0) {
      mesObjetivo = 11;
      anioObjetivo -= 1;
    }
  }
  if (mesParam !== null && mesParam !== undefined && mesParam !== "") mesObjetivo = Number(mesParam);
  if (anioParam !== null && anioParam !== undefined && anioParam !== "") anioObjetivo = Number(anioParam);

  const tarifas = getPaymentSettings();
  const goalsRows = db.prepare("SELECT * FROM executive_goals").all();
  const goalsMap = {};
  for (const g of goalsRows) goalsMap[g.ejecutiva_norm] = Number(g.minimo_ventas ?? 10);

  const companies = getAllCompanies();
  const compMap = new Map(companies.map((c) => [c.slug, c]));
  const sups = getAllSupervisors();

  const salesRows = db
    .prepare("SELECT * FROM sales WHERE lower(estado) LIKE '%instalad%' OR lower(estado) LIKE '%portad%'")
    .all();

  const resumen = {};
  const campaniasPorSup = {};

  for (const s of salesRows) {
    const comp = compMap.get(s.company_slug);
    if (!comp) continue;
    if (!s.ejecutivo) continue;

    const est = normalizarTexto(s.estado);
    if (comp.tipo_categoria === "movil") {
      if (!est.includes("portad")) continue;
    } else if (comp.usa_portado || comp.tipo_categoria === "pymeMovil" || comp.tipo_categoria === "aa") {
      if (!est.includes("portad") && !est.includes("instalad")) continue;
    } else {
      if (!est.includes("instalad")) continue;
    }

    const periodo = parseMesInstalacionOPortabilidad(s, comp, anioObjetivo);
    if (periodo.mes !== mesObjetivo || periodo.anio !== anioObjetivo) continue;

    if (supervisorFilter && !supervisorMatchesFilter(s.supervisor, supervisorFilter, sups)) continue;

    const nombreEjec = darFormatoNombre(s.ejecutivo);
    const claveEjec = normalizarTexto(nombreEjec);
    const supCanon = resolveCanonicalSupervisor(s.supervisor, sups);

    if (!resumen[claveEjec]) {
      resumen[claveEjec] = {
        ejecutiva_norm: claveEjec,
        nombre: nombreEjec,
        supervisor: supCanon,
        minimo: goalsMap[claveEjec] ?? 10,
        totalPaq: 0,
        totalFib: 0,
        totalClaro: 0,
        totalPyme: 0,
        totalAA: 0,
        movilTitSet: new Set(),
        movilAdiSet: new Set(),
        pymeMovilTitSet: new Set(),
        pymeMovilAdiSet: new Set(),
        customCounts: {},
      };
    } else if (resumen[claveEjec].supervisor === "Sin Asignar" && supCanon !== "Sin Asignar") {
      resumen[claveEjec].supervisor = supCanon;
    }

    if (!campaniasPorSup[supCanon]) campaniasPorSup[supCanon] = new Set();
    campaniasPorSup[supCanon].add(
      comp.tipo_categoria === "custom" ? `custom:${comp.iniciales_pagos}` : comp.tipo_categoria
    );

    const cat = comp.tipo_categoria;
    if (cat === "paquetizacion") {
      resumen[claveEjec].totalPaq++;
    } else if (cat === "claroVtr") {
      resumen[claveEjec].totalClaro++;
    } else if (cat === "pyme") {
      resumen[claveEjec].totalPyme++;
    } else if (cat === "aa") {
      resumen[claveEjec].totalAA++;
    } else if (cat === "movil") {
      const tit = String(s.numero_principal || "").replace(/\D/g, "");
      if (tit.length >= 6) resumen[claveEjec].movilTitSet.add(tit);
      if (s.adicional) {
        for (const p of String(s.adicional).split(/\||,|\/|\s+/)) {
          const d = p.replace(/\s*\(.*\)/, "").replace(/\D/g, "").trim();
          if (d.length >= 6) resumen[claveEjec].movilAdiSet.add(d);
        }
      }
    } else if (cat === "pymeMovil") {
      const antes = resumen[claveEjec].pymeMovilTitSet.size;
      const tit = String(s.numero_principal || s.telefono || "").replace(/\D/g, "");
      if (tit.length >= 6) resumen[claveEjec].pymeMovilTitSet.add(tit);
      if (s.adicional) {
        for (const p of String(s.adicional).split(/\||,|\/|\s+/)) {
          const d = p.replace(/\s*\(.*\)/, "").replace(/\D/g, "").trim();
          if (d.length >= 6) resumen[claveEjec].pymeMovilAdiSet.add(d);
        }
      }
      if (resumen[claveEjec].pymeMovilTitSet.size === antes) {
        resumen[claveEjec].pymeMovilTitSet.add(`venta_${s.id}`);
      }
    } else if (cat === "custom") {
      const ini = comp.iniciales_pagos || comp.nombre.slice(0, 3).toUpperCase();
      resumen[claveEjec].customCounts[ini] = (resumen[claveEjec].customCounts[ini] || 0) + 1;
    } else {
      resumen[claveEjec].totalFib++;
    }
  }

  const porSup = {};
  let granTotalDinero = 0;

  for (const ej of Object.values(resumen)) {
    const dineroPaq = Math.max(0, ej.totalPaq - ej.minimo) * tarifas.PAGO_PAQ;
    const dineroFib = Math.max(0, ej.totalFib - ej.minimo) * tarifas.PAGO_FIBRA;
    const dineroClaro = Math.max(0, ej.totalClaro - ej.minimo) * tarifas.PAGO_CLARO;
    const dineroTotal = dineroPaq + dineroFib + dineroClaro;
    granTotalDinero += dineroTotal;

    const fila = {
      ejecutiva_norm: ej.ejecutiva_norm,
      nombre: ej.nombre,
      supervisor: ej.supervisor,
      minimo: ej.minimo,
      paq: ej.totalPaq,
      fib: ej.totalFib,
      claroVtr: ej.totalClaro,
      emTit: ej.movilTitSet.size,
      emAdi: ej.movilAdiSet.size,
      pyme: ej.totalPyme,
      pmTit: ej.pymeMovilTitSet.size,
      pmAdi: ej.pymeMovilAdiSet.size,
      aa: ej.totalAA,
      customCounts: ej.customCounts,
      dineroPaq,
      dineroFib,
      dineroClaro,
      dineroTotal,
    };

    if (!porSup[ej.supervisor]) porSup[ej.supervisor] = [];
    porSup[ej.supervisor].push(fila);
  }

  const tarjetasSupervisores = Object.keys(porSup)
    .sort()
    .map((supName) => {
      const camps = campaniasPorSup[supName] || new Set();
      const customInitials = Array.from(camps)
        .filter((c) => c.startsWith("custom:"))
        .map((c) => c.slice(7))
        .sort();
      const ejecutivos = porSup[supName].sort((a, b) => a.nombre.localeCompare(b.nombre));
      const subtotalSup = ejecutivos.reduce((acc, e) => acc + e.dineroTotal, 0);

      const totales = {
        paq: ejecutivos.reduce((acc, e) => acc + (e.paq || 0), 0),
        fib: ejecutivos.reduce((acc, e) => acc + (e.fib || 0), 0),
        claroVtr: ejecutivos.reduce((acc, e) => acc + (e.claroVtr || 0), 0),
        emTit: ejecutivos.reduce((acc, e) => acc + (e.emTit || 0), 0),
        emAdi: ejecutivos.reduce((acc, e) => acc + (e.emAdi || 0), 0),
        pyme: ejecutivos.reduce((acc, e) => acc + (e.pyme || 0), 0),
        pmTit: ejecutivos.reduce((acc, e) => acc + (e.pmTit || 0), 0),
        pmAdi: ejecutivos.reduce((acc, e) => acc + (e.pmAdi || 0), 0),
        aa: ejecutivos.reduce((acc, e) => acc + (e.aa || 0), 0),
        customCounts: {},
        dineroPaq: ejecutivos.reduce((acc, e) => acc + (e.dineroPaq || 0), 0),
        dineroFib: ejecutivos.reduce((acc, e) => acc + (e.dineroFib || 0), 0),
        dineroClaro: ejecutivos.reduce((acc, e) => acc + (e.dineroClaro || 0), 0),
        dineroTotal: subtotalSup,
      };
      for (const ini of customInitials) {
        totales.customCounts[ini] = ejecutivos.reduce(
          (acc, e) => acc + ((e.customCounts && e.customCounts[ini]) || 0),
          0
        );
      }

      return {
        supervisor: supName,
        subtotalDinero: subtotalSup,
        mostrarClaro: camps.has("claroVtr"),
        mostrarMovil: camps.has("movil"),
        mostrarPyme: camps.has("pyme"),
        mostrarPymeMovil: camps.has("pymeMovil"),
        mostrarAA: camps.has("aa") && !camps.has("custom:A&A"),
        customInitials,
        ejecutivos,
        totales,
      };
    });

  const mesesDisponibles = db
    .prepare("SELECT DISTINCT anio, mes FROM sales WHERE anio >= 2024 ORDER BY anio DESC, mes DESC")
    .all();

  return {
    mes: mesObjetivo,
    anio: anioObjetivo,
    tarifas,
    granTotalDinero,
    tarjetasSupervisores,
    mesesDisponibles,
  };
}

// ============================================================================
// CONSULTAS PARA N8N + BOT DE TELEGRAM + SESIONES CONVERSACIONALES
// ============================================================================

function getBotSession(telefono) {
  const key = String(telefono || "").trim();
  if (!key) return null;
  let row = db.prepare("SELECT * FROM bot_sessions WHERE telefono = ?").get(key);
  if (!row) {
    db.prepare(
      "INSERT INTO bot_sessions (telefono, estado, temp_fecha_inicio, temp_fecha_fin, temp_hoja) VALUES (?, 'ESPERANDO_OPCION_MENU', '', '', '')"
    ).run(key);
    row = db.prepare("SELECT * FROM bot_sessions WHERE telefono = ?").get(key);
  }
  return row;
}

function upsertBotSession(payload) {
  const key = String(payload.telefono || payload.chat_id || "").trim();
  if (!key) throw new Error("Se requiere 'telefono' o 'chat_id'.");
  const current = getBotSession(key);
  const estado =
    payload.nuevo_estado !== undefined
      ? String(payload.nuevo_estado)
      : payload.estado !== undefined
      ? String(payload.estado)
      : current.estado;
  const fIni = payload.temp_fecha_inicio !== undefined ? String(payload.temp_fecha_inicio) : current.temp_fecha_inicio;
  const fFin = payload.temp_fecha_fin !== undefined ? String(payload.temp_fecha_fin) : current.temp_fecha_fin;
  const hoja = payload.temp_hoja !== undefined ? String(payload.temp_hoja) : current.temp_hoja;

  db.prepare(`
    UPDATE bot_sessions
    SET estado = ?, temp_fecha_inicio = ?, temp_fecha_fin = ?, temp_hoja = ?, updated_at = datetime('now')
    WHERE telefono = ?
  `).run(estado, fIni, fFin, hoja, key);

  return db.prepare("SELECT * FROM bot_sessions WHERE telefono = ?").get(key);
}

function querySalesForN8n(params = {}) {
  const hoyStr = getFechaHoyChile();
  const desdeStr = params.desde ? formatearFechaISOaLatina(params.desde) : hoyStr;
  const hastaStr = params.hasta ? formatearFechaISOaLatina(params.hasta) : desdeStr;

  const ordDesde = fechaAClaveOrden(desdeStr);
  const ordHasta = fechaAClaveOrden(hastaStr);

  const companies = getAllCompanies();
  const compMap = new Map(companies.map((c) => [c.slug, c]));
  const sups = getAllSupervisors();

  let rows = db
    .prepare("SELECT * FROM sales WHERE fecha_orden >= ? AND fecha_orden <= ? ORDER BY fecha_orden DESC, id DESC")
    .all(Math.min(ordDesde, ordHasta), Math.max(ordDesde, ordHasta));

  // Filtro opcional por hoja/compañía o marca
  const hojaParam = normalizarTexto(params.hoja || "");
  if (hojaParam && hojaParam !== "todas" && hojaParam !== "all" && hojaParam !== "todo") {
    const exactComp = resolveCompanyDestination(params.hoja);
    if (exactComp) {
      rows = rows.filter((r) => r.company_slug === exactComp.slug);
    } else {
      rows = rows.filter((r) => {
        const c = compMap.get(r.company_slug);
        return c && (normalizarTexto(c.hoja).includes(hojaParam) || normalizarTexto(c.slug).includes(hojaParam));
      });
    }
  }

  if (params.supervisor) {
    rows = rows.filter((r) => supervisorMatchesFilter(r.supervisor, params.supervisor, sups));
  }
  if (params.ejecutiva || params.ejecutivo) {
    const ejNorm = normalizarTexto(params.ejecutiva || params.ejecutivo);
    rows = rows.filter((r) => normalizarTexto(r.ejecutivo).includes(ejNorm));
  }
  if (params.estado && params.estado !== "all" && params.estado !== "todos") {
    const estNorm = normalizarTexto(params.estado);
    rows = rows.filter((r) => normalizarTexto(r.estado).includes(estNorm));
  }

  const porHoja = {};
  const porEstado = { Instalado: 0, Portado: 0, Iniciado: 0, Pendiente: 0, Cancelado: 0, "No Realizado": 0, Otros: 0 };
  const porSupervisor = {};

  const ventasLimpias = rows.map((r) => {
    const comp = compMap.get(r.company_slug);
    const nombreHoja = comp ? comp.hoja : r.company_slug;
    const supCanon = resolveCanonicalSupervisor(r.supervisor, sups);

    porHoja[nombreHoja] = (porHoja[nombreHoja] || 0) + 1;
    porSupervisor[supCanon] = (porSupervisor[supCanon] || 0) + 1;

    const estLow = normalizarTexto(r.estado);
    if (estLow.includes("instalad")) porEstado.Instalado++;
    else if (estLow.includes("iniciad")) porEstado.Iniciado++;
    else if (estLow.includes("portad")) porEstado.Portado++;
    else if (estLow.includes("cancel")) porEstado.Cancelado++;
    else if (estLow.includes("no realiz")) porEstado["No Realizado"]++;
    else if (estLow.includes("pendi")) porEstado.Pendiente++;
    else porEstado.Otros++;

    return {
      id: r.id,
      fecha: r.fecha,
      hoja: nombreHoja,
      company_slug: r.company_slug,
      supervisor: supCanon,
      ejecutivo: r.ejecutivo,
      rut: r.rut,
      cliente: r.nombre_cliente,
      comuna: r.comuna,
      direccion: r.direccion,
      telefono: r.telefono || r.numero_principal,
      numero_principal: r.numero_principal,
      adicional: r.adicional,
      servicio: r.servicio,
      estado: r.estado,
      id_orden: r.id_orden,
      observacion: r.observacion,
    };
  });

  // Generar resumen listo para enviar directo a Telegram desde n8n
  const rangoTxt = desdeStr === hastaStr ? desdeStr : `${desdeStr} al ${hastaStr}`;
  const hojaTitulo = params.hoja && hojaParam !== "todas" ? params.hoja.toUpperCase() : "TODAS LAS HOJAS (CONSOLIDADO)";
  const tgLines = [
    `╔════════════════════════════════════╗`,
    `  🏢  *REPORTE: ${hojaTitulo}*`,
    `  📅  *Período:* ${rangoTxt}`,
    `  ⭐  *Total Encontradas:* ${ventasLimpias.length} ventas`,
    `╚════════════════════════════════════╝`,
    ``
  ];

  if (ventasLimpias.length > 0) {
    const inicTxt = porEstado.Iniciado > 0 ? ` | 🔵 Inic: ${porEstado.Iniciado}` : "";
    tgLines.push(
      `⚡ *Estados:* 🟢 Inst/Port: ${porEstado.Instalado + porEstado.Portado}${inicTxt} | 🟡 Pend: ${porEstado.Pendiente} | 🔴 Canc: ${porEstado.Cancelado}`,
      ``
    );

    if (!params.hoja || hojaParam === "todas") {
      tgLines.push(`🏢 *TOTALES POR COMPAÑÍA:*`);
      for (const [h, cant] of Object.entries(porHoja).sort((a, b) => b[1] - a[1])) {
        tgLines.push(`• ${h}: *${cant}*`);
      }
      tgLines.push(``);
    }

    tgLines.push(`👑 *TOTALES POR SUPERVISOR:*`);
    for (const [s, cant] of Object.entries(porSupervisor).sort((a, b) => b[1] - a[1])) {
      tgLines.push(`• 👤 *${s}:* ${cant} ventas`);
    }

    tgLines.push(``, `════════════════════════════════════`);
    tgLines.push(`👥 *DETALLE POR SUPERVISOR Y EQUIPO*`);
    tgLines.push(`════════════════════════════════════`);

    const agrupadoSup = {};
    for (const v of ventasLimpias) {
      const sup = v.supervisor || "Sin Supervisor";
      if (!agrupadoSup[sup]) agrupadoSup[sup] = { total: 0, campanias: {}, ejecutivos: {} };
      agrupadoSup[sup].total++;
      agrupadoSup[sup].ejecutivos[v.ejecutivo] = (agrupadoSup[sup].ejecutivos[v.ejecutivo] || 0) + 1;
      if (!agrupadoSup[sup].campanias[v.hoja]) agrupadoSup[sup].campanias[v.hoja] = { total: 0, ejecutivos: {} };
      agrupadoSup[sup].campanias[v.hoja].total++;
      agrupadoSup[sup].campanias[v.hoja].ejecutivos[v.ejecutivo] = (agrupadoSup[sup].campanias[v.hoja].ejecutivos[v.ejecutivo] || 0) + 1;
    }

    for (const [sup, info] of Object.entries(agrupadoSup).sort((a, b) => b[1].total - a[1].total)) {
      tgLines.push(``);
      tgLines.push(`👤 *SUPERVISOR: ${sup.toUpperCase()}*  ⭐ [${info.total} ventas]`);
      tgLines.push(`────────────────────────────────────`);

      if (params.hoja && hojaParam !== "todas") {
        const ejs = Object.entries(info.ejecutivos).sort((a, b) => b[1] - a[1]);
        ejs.forEach(([eje, cant], idx) => {
          const medal = idx === 0 && cant > 1 ? "🥇" : idx === 1 && cant > 1 ? "🥈" : idx === 2 && cant > 1 ? "🥉" : "🔹";
          tgLines.push(`   ${medal} ${cant} ➔ ${eje}`);
        });
      } else {
        for (const [hoja, hInfo] of Object.entries(info.campanias).sort((a, b) => b[1].total - a[1].total)) {
          tgLines.push(`  📋 ${hoja} (${hInfo.total})`);
          const ejs = Object.entries(hInfo.ejecutivos).sort((a, b) => b[1] - a[1]);
          ejs.forEach(([eje, cant], idx) => {
            const medal = idx === 0 && cant > 1 ? "🥇" : idx === 1 && cant > 1 ? "🥈" : idx === 2 && cant > 1 ? "🥉" : "🔹";
            tgLines.push(`     ${medal} ${cant} ➔ ${eje}`);
          });
          tgLines.push(``);
        }
      }
    }
  } else {
    tgLines.push(`_No se encontraron ventas para este filtro._`);
  }

  return {
    desde: desdeStr,
    hasta: hastaStr,
    total: ventasLimpias.length,
    porEstado,
    porHoja,
    porSupervisor,
    texto_telegram: tgLines.join("\n"),
    ventas: ventasLimpias.slice(0, Number(params.limit || 500)),
  };
}

// ============================================================================
// CREAR COMPAÑÍA NUEVA ("PARECIDA A...") + GESTIÓN DE SUPERVISORES Y METAS
// ============================================================================

function createCustomCompany(payload) {
  const nombre = String(payload.nombre || "").trim();
  if (!nombre) throw new Error("Escribe el nombre de la compañía nueva.");

  const hoja = String(payload.hoja || nombre).trim();
  const iniciales = String(payload.iniciales || "")
    .trim()
    .toUpperCase()
    .slice(0, 8);
  if (!iniciales) throw new Error("Indica las iniciales para Pagos Adicionales (ej. A&A, M.P.).");

  const slug = slugify(hoja);
  const existing = db.prepare("SELECT * FROM companies WHERE slug = ? OR lower(hoja) = lower(?)").get(slug, hoja);
  if (existing) {
    if (payload.ignoreIfExists) return getAllCompanies().find((c) => c.slug === existing.slug);
    throw new Error(`Ya existe una hoja con el nombre "${hoja}".`);
  }

  const plantilla = db.prepare("SELECT * FROM companies WHERE slug = ? OR lower(hoja) = lower(?)").get(
    payload.plantilla_slug || "",
    payload.plantilla_slug || ""
  );

  const usaPortado =
    payload.es_movil !== undefined
      ? payload.es_movil
        ? 1
        : 0
      : plantilla
      ? Number(plantilla.usa_portado)
      : 0;
  const esMovilEspejo = payload.es_movil_espejo !== undefined ? (payload.es_movil_espejo ? 1 : 0) : usaPortado;
  const ocultarEspejo = payload.ocultar_en_espejo_movil ? 1 : 0;
  const columnas = plantilla ? JSON.parse(plantilla.columnas_json) : usaPortado ? COLS_MOVIL : COLS_FIBRA_HOGAR;

  const maxOrden = db.prepare("SELECT COALESCE(MAX(orden), 120) as m FROM companies").get().m;
  const paleta = ["#00acc1", "#7b1fa2", "#f4511e", "#43a047", "#5e35b1", "#d81b60", "#3949ab"];
  const color = payload.color || paleta[Math.floor(Math.random() * paleta.length)];
  const emoji = payload.emoji || (usaPortado ? "📱" : "🏢");

  db.prepare(`
    INSERT INTO companies (
      slug, nombre, hoja, operador_form, operadores_extra, iniciales_pagos,
      tipo_categoria, basada_en, es_movil_espejo, ocultar_en_espejo_movil,
      usa_portado, emoji, color, orden, columnas_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug,
    nombre,
    hoja,
    nombre,
    String(payload.operadores_extra || "").trim(),
    iniciales,
    plantilla ? plantilla.hoja : "Personalizada",
    esMovilEspejo,
    ocultarEspejo,
    usaPortado,
    emoji,
    color,
    maxOrden + 10,
    JSON.stringify(columnas)
  );

  return getAllCompanies().find((c) => c.slug === slug);
}

function upsertSupervisor(payload) {
  const nombre = darFormatoNombre(String(payload.nombre || "").trim());
  if (!nombre) throw new Error("El nombre del supervisor es obligatorio.");
  const aliases = String(payload.aliases || nombre).trim();
  const correos =
    payload.correos_autorizados !== undefined
      ? normalizeEmailListString(payload.correos_autorizados)
      : null;
  const compania = payload.compania !== undefined ? String(payload.compania || "").trim() : null;

  if (payload.id) {
    const act = payload.activo === false ? 0 : 1;
    if (correos !== null && compania !== null) {
      db.prepare(
        "UPDATE supervisors SET nombre = ?, aliases = ?, correos_autorizados = ?, compania = ?, activo = ? WHERE id = ?"
      ).run(nombre, aliases, correos, compania, act, Number(payload.id));
    } else if (correos !== null) {
      db.prepare(
        "UPDATE supervisors SET nombre = ?, aliases = ?, correos_autorizados = ?, activo = ? WHERE id = ?"
      ).run(nombre, aliases, correos, act, Number(payload.id));
    } else if (compania !== null) {
      db.prepare(
        "UPDATE supervisors SET nombre = ?, aliases = ?, compania = ?, activo = ? WHERE id = ?"
      ).run(nombre, aliases, compania, act, Number(payload.id));
    } else {
      db.prepare("UPDATE supervisors SET nombre = ?, aliases = ?, activo = ? WHERE id = ?").run(
        nombre,
        aliases,
        act,
        Number(payload.id)
      );
    }
    return db.prepare("SELECT * FROM supervisors WHERE id = ?").get(Number(payload.id));
  }

  const existing = db.prepare("SELECT * FROM supervisors WHERE lower(nombre) = lower(?)").get(nombre);
  if (existing) {
    const compVal = compania !== null ? compania : (existing.compania || "");
    if (correos !== null) {
      db.prepare("UPDATE supervisors SET aliases = ?, correos_autorizados = ?, compania = ?, activo = 1 WHERE id = ?").run(
        aliases,
        correos,
        compVal,
        existing.id
      );
    } else {
      db.prepare("UPDATE supervisors SET aliases = ?, compania = ?, activo = 1 WHERE id = ?").run(aliases, compVal, existing.id);
    }
    return db.prepare("SELECT * FROM supervisors WHERE id = ?").get(existing.id);
  }

  const token = slugify(nombre) + "-" + crypto.randomBytes(3).toString("hex");
  const info = db
    .prepare(
      "INSERT INTO supervisors (nombre, aliases, token_acceso, correos_autorizados, activo, compania) VALUES (?, ?, ?, ?, 1, ?)"
    )
    .run(nombre, aliases, token, correos || "", compania || "");
  return db.prepare("SELECT * FROM supervisors WHERE id = ?").get(info.lastInsertRowid);
}

function deleteSupervisor(id) {
  db.prepare("DELETE FROM supervisors WHERE id = ?").run(Number(id));
}

// ============================================================================
// CONTROL DE ACCESO POR CORREO ELECTRÓNICO (ESTILO GOOGLE SHEETS)
// ============================================================================

function parseEmailList(raw) {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[,;\n\r\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 4 && s.includes("@"));
  return [...new Set(parts)];
}

function normalizeEmailListString(raw) {
  return parseEmailList(raw).join(", ");
}

function getAccessPermissions() {
  const views = db.prepare("SELECT * FROM view_permissions ORDER BY vista_key ASC").all();
  const supervisors = getAllSupervisors();
  return { views, supervisors };
}

function updateViewEmails(vistaKey, correosRaw) {
  const clean = normalizeEmailListString(correosRaw);
  db.prepare("UPDATE view_permissions SET correos_autorizados = ? WHERE vista_key = ?").run(
    clean,
    String(vistaKey || "").trim()
  );
  return db.prepare("SELECT * FROM view_permissions WHERE vista_key = ?").get(String(vistaKey || "").trim());
}

function updateSupervisorEmails(supId, correosRaw) {
  const clean = normalizeEmailListString(correosRaw);
  db.prepare("UPDATE supervisors SET correos_autorizados = ? WHERE id = ?").run(clean, Number(supId));
  return db.prepare("SELECT * FROM supervisors WHERE id = ?").get(Number(supId));
}

/**
 * Verifica si un correo tiene permiso para entrar a una vista específica:
 *  - formulario: siempre libre y aislado (no pide correo)
 *  - admin: si no se han configurado correos aún, permite paso libre para que el dueño configure;
 *           si ya configuró correos en 'admin', exige que el correo esté en esa lista.
 *  - subadmin (Segunda Hoja Admin): exige correo autorizado en 'subadmin' (o en 'admin').
 *  - moviles (Espejo Móviles): exige correo autorizado en 'moviles' (o en 'admin').
 *  - supervisor: exige correo autorizado en ese supervisor específico (o en 'admin').
 */
function verifyViewEmailAccess(vista, supParam = "", emailInput = "", isAdminPreview = false) {
  const role = String(vista || "admin").trim().toLowerCase();
  if (role === "formulario") {
    return { allowed: true, requiresEmail: false, email: "" };
  }

  const adminRow = db.prepare("SELECT correos_autorizados FROM view_permissions WHERE vista_key = 'admin'").get();
  const adminEmails = parseEmailList(adminRow ? adminRow.correos_autorizados : "");
  const emailNorm = String(emailInput || "").trim().toLowerCase();

  // Si es el Admin Principal previsualizando desde el selector interno
  if (isAdminPreview) {
    if (adminEmails.length === 0 || (emailNorm && adminEmails.includes(emailNorm))) {
      return { allowed: true, requiresEmail: false, email: emailNorm };
    }
  }

  if (role === "admin") {
    if (adminEmails.length === 0) {
      return { allowed: true, requiresEmail: false, email: emailNorm, listaVacia: true };
    }
    if (!emailNorm) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle: "👑 Panel Admin Principal",
        reason: "Ingresa tu correo de Administrador para acceder.",
      };
    }
    if (adminEmails.includes(emailNorm)) {
      return { allowed: true, requiresEmail: true, email: emailNorm };
    }
    return {
      allowed: false,
      requiresEmail: true,
      viewTitle: "👑 Panel Admin Principal",
      reason: `El correo "${emailNorm}" no tiene permiso para acceder al Panel Principal.`,
    };
  }

  if (role === "subadmin") {
    const rowWrite = db.prepare("SELECT * FROM view_permissions WHERE vista_key = 'subadmin'").get();
    const rowReadOnly = db.prepare("SELECT * FROM view_permissions WHERE vista_key = 'subadmin_readonly'").get();
    const writeList = [...new Set([...parseEmailList(rowWrite ? rowWrite.correos_autorizados : ""), ...adminEmails])];
    const readOnlyList = parseEmailList(rowReadOnly ? rowReadOnly.correos_autorizados : "");
    const allowedList = [...new Set([...writeList, ...readOnlyList])];
    const viewTitle = "📊 Ventas Fenix";

    if (allowedList.length === 0) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle,
        listaVacia: true,
        reason:
          "Esta hoja aún no tiene correos autorizados. En el Panel Admin Principal ve a 'Accesos y Supervisores' y agrega los correos con permiso para Ventas Fenix.",
      };
    }
    if (!emailNorm) {
      return { allowed: false, requiresEmail: true, viewTitle, reason: "Ingresa tu correo electrónico autorizado." };
    }
    if (allowedList.includes(emailNorm)) {
      const isReadOnly = !writeList.includes(emailNorm) && readOnlyList.includes(emailNorm);
      return {
        allowed: true,
        requiresEmail: true,
        email: emailNorm,
        viewTitle: isReadOnly ? "👁️ Ventas Fenix (Solo Lectura)" : "📊 Ventas Fenix",
        readOnly: isReadOnly,
      };
    }
    return {
      allowed: false,
      requiresEmail: true,
      viewTitle,
      reason: `El correo "${emailNorm}" no está autorizado para abrir esta hoja. Solicita acceso al Administrador.`,
    };
  }

  if (role === "moviles") {
    const row = db.prepare("SELECT * FROM view_permissions WHERE vista_key = 'moviles'").get();
    const allowedList = [...new Set([...parseEmailList(row ? row.correos_autorizados : ""), ...adminEmails])];
    const viewTitle = "📱 Hoja Espejo Móviles";
    if (allowedList.length === 0) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle,
        listaVacia: true,
        reason:
          "Esta hoja aún no tiene correos autorizados. En el Panel Admin Principal ve a 'Accesos y Supervisores' y agrega los correos con permiso.",
      };
    }
    if (!emailNorm) {
      return { allowed: false, requiresEmail: true, viewTitle, reason: "Ingresa tu correo electrónico autorizado." };
    }
    if (allowedList.includes(emailNorm)) {
      return { allowed: true, requiresEmail: true, email: emailNorm, viewTitle };
    }
    return {
      allowed: false,
      requiresEmail: true,
      viewTitle,
      reason: `El correo "${emailNorm}" no está autorizado para abrir la Hoja Espejo Móviles.`,
    };
  }

  if (role === "supervisor") {
    const sups = getAllSupervisors();
    const found = sups.find(
      (s) => s.token_acceso === supParam || normalizarTexto(s.nombre) === normalizarTexto(supParam)
    );
    const supName = found ? found.nombre : supParam || "Supervisor";
    const compLabel = found?.compania ? ` · ${found.compania}` : "";
    const viewTitle = `👤 Hoja Supervisor: ${supName}${compLabel}`;

    if (found && !found.activo) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle: `⛔ Acceso Inactivo: ${supName}`,
        reason: `El acceso para el supervisor "${supName}" se encuentra temporalmente inactivo. Contacta al Administrador de Fenix CRM para reactivarlo.`,
      };
    }

    const supEmails = found ? parseEmailList(found.correos_autorizados) : [];
    const allowedList = [...new Set([...supEmails, ...adminEmails])];

    if (allowedList.length === 0) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle,
        listaVacia: true,
        reason: `La hoja de ${supName} aún no tiene correos autorizados. Agrégalos desde el Panel Admin Principal → 'Accesos y Supervisores'.`,
      };
    }
    if (!emailNorm) {
      return {
        allowed: false,
        requiresEmail: true,
        viewTitle,
        reason: `Ingresa tu correo autorizado para ver la hoja de ${supName}.`,
      };
    }
    if (allowedList.includes(emailNorm)) {
      return { allowed: true, requiresEmail: true, email: emailNorm, viewTitle };
    }
    return {
      allowed: false,
      requiresEmail: true,
      viewTitle,
      reason: `El correo "${emailNorm}" no tiene permiso para ver la hoja de ${supName}.`,
    };
  }

  return { allowed: true, requiresEmail: false, email: emailNorm };
}

function updateExecutiveGoal(ejecutivaNorm, nombre, minimoVentas) {
  const norm = normalizarTexto(ejecutivaNorm || nombre);
  if (!norm) return;
  db.prepare(
    "INSERT INTO executive_goals (ejecutiva_norm, nombre, minimo_ventas) VALUES (?, ?, ?) ON CONFLICT(ejecutiva_norm) DO UPDATE SET minimo_ventas = excluded.minimo_ventas"
  ).run(norm, darFormatoNombre(nombre || ejecutivaNorm), Number(minimoVentas));
}

function updatePaymentTarifas(patch) {
  const stmt = db.prepare(
    "INSERT INTO payment_settings (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
  );
  for (const k of ["PAGO_PAQ", "PAGO_FIBRA", "PAGO_CLARO"]) {
    if (patch[k] !== undefined) stmt.run(k, Number(patch[k]));
  }
  return getPaymentSettings();
}

function globalSearch(q, options = {}) {
  const qNorm = normalizarTexto(q);
  if (!qNorm || qNorm.length < 2) return [];
  const companies = getAllCompanies();
  const compMap = new Map(companies.map((c) => [c.slug, c]));
  const sups = getAllSupervisors();

  const rows = db.prepare("SELECT * FROM sales ORDER BY fecha_orden DESC, id DESC").all();
  const res = [];
  for (const r of rows) {
    const comp = compMap.get(r.company_slug);
    if (!comp) continue;
    if (options.onlyMobileMirror && !isMobileMirrorCompany(comp)) continue;
    if (options.supervisor && !supervisorMatchesFilter(r.supervisor, options.supervisor, sups)) continue;

    const texto = normalizarTexto(
      `${r.rut} ${r.nombre_cliente} ${r.direccion} ${r.comuna} ${r.ejecutivo} ${r.supervisor} ${r.telefono} ${r.numero_principal} ${r.adicional} ${r.id_orden} ${r.correo} ${r.servicio}`
    );
    if (texto.includes(qNorm)) {
      res.push({
        ...r,
        hoja: comp.hoja,
        emoji: comp.emoji,
        color: comp.color,
      });
      if (res.length >= 150) break;
    }
  }
  return res;
}

/**
 * Construye la estructura agrupada de marcas para el Formulario Propio:
 *   Movistar -> Con Tenencia, Sin Tenencia, Paquetización, Móvil
 *   Entel    -> Fijo Hogar, Móvil, Pyme Fijo, Pyme Móvil
 *   Claro/VTR-> Claro Hogar, VTR Hogar, Claro Móvil
 *   WOM      -> Fijo Hogar
 *   A&A Sales-> Móvil (directo)
 *   + Cualquier compañía nueva se agrupa automáticamente si comparte nombre de marca o crea su propia tarjeta.
 */
function buildBrandGroupsForForm(companies) {
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  const groups = [
    {
      brandId: "movistar",
      label: "Movistar",
      emoji: "💙",
      color: "#019df4",
      variants: [
        {
          id: "mov-con-tenencia",
          label: "Con Tenencia",
          company_slug: "movistar-con-tenencia",
          operador: "Movistar Fijo",
          tipo_venta: "Instalacion con tenencia",
          es_movil: false,
          ask_click: true,
        },
        {
          id: "mov-sin-tenencia",
          label: "Sin Tenencia",
          company_slug: "movistar-sin-tenencia",
          operador: "Movistar Fijo",
          tipo_venta: "Instalacion sin tenencia",
          es_movil: false,
          ask_click: true,
        },
        {
          id: "mov-paquetizacion",
          label: "Paquetización",
          company_slug: "paquetizacion-movistar",
          operador: "Movistar Fijo",
          tipo_venta: "Paquetizacion",
          es_movil: false,
          ask_click: false,
        },
        {
          id: "mov-movil",
          label: "Móvil",
          company_slug: "ventas-moviles-movistar",
          operador: "Movistar Movil",
          tipo_venta: "",
          es_movil: true,
          ask_click: false,
        },
      ],
    },
    {
      brandId: "entel",
      label: "Entel",
      emoji: "🧡",
      color: "#ff6600",
      variants: [
        {
          id: "entel-fijo",
          label: "Fijo Hogar",
          company_slug: "ventas-entel",
          operador: "Entel Fijo",
          tipo_venta: "",
          es_movil: false,
        },
        {
          id: "entel-movil",
          label: "Móvil",
          company_slug: "ventas-entel-movil",
          operador: "Entel Movil",
          tipo_venta: "",
          es_movil: true,
        },
        {
          id: "entel-pyme",
          label: "Pyme Fijo",
          company_slug: "ventas-entel-pyme",
          operador: "Entel Pyme",
          tipo_venta: "",
          es_movil: false,
        },
        {
          id: "entel-pyme-movil",
          label: "Pyme Móvil",
          company_slug: "ventas-entel-pyme-movil",
          operador: "Entel Pyme Movil",
          tipo_venta: "",
          es_movil: true,
        },
      ],
    },
    {
      brandId: "claro-vtr",
      label: "Claro / VTR",
      emoji: "❤️",
      color: "#da291c",
      variants: [
        {
          id: "claro-hogar",
          label: "Claro Hogar",
          company_slug: "claro-vtr-hogar",
          operador: "Claro y Vtr Hogar",
          subcompania: "CLARO",
          es_movil: false,
        },
        {
          id: "vtr-hogar",
          label: "VTR Hogar",
          company_slug: "claro-vtr-hogar",
          operador: "Claro y Vtr Hogar",
          subcompania: "VTR",
          es_movil: false,
        },
        {
          id: "claro-movil",
          label: "Claro Móvil",
          company_slug: "ventas-claro-movil",
          operador: "Claro Movil",
          subcompania: "",
          es_movil: true,
        },
      ],
    },
    {
      brandId: "wom",
      label: "WOM",
      emoji: "💜",
      color: "#9c27b0",
      variants: [
        {
          id: "wom-hogar",
          label: "Fijo Hogar",
          company_slug: "ventas-wom-hogar",
          operador: "Wom Fijo",
          es_movil: false,
        },
      ],
    },
    {
      brandId: "aa-sales",
      label: "A&A Sales",
      emoji: "🤝",
      color: "#00acc1",
      variants: [
        {
          id: "aa-movil",
          label: "A&A Móvil",
          company_slug: "aa-sales",
          operador: "A&A Sales",
          es_movil: true,
        },
      ],
    },
  ];

  const baseSlugs = new Set([
    "paquetizacion-movistar",
    "movistar-sin-tenencia",
    "movistar-con-tenencia",
    "ventas-moviles-movistar",
    "ventas-entel",
    "ventas-entel-movil",
    "ventas-entel-pyme",
    "ventas-entel-pyme-movil",
    "claro-vtr-hogar",
    "ventas-claro-movil",
    "ventas-wom-hogar",
    "aa-sales",
  ]);

  // Enriquecer cada variante con hoja y emoji real, y sumar dinámicamente compañías nuevas
  for (const c of companies) {
    if (baseSlugs.has(c.slug)) continue;
    const norm = normalizarTexto(c.nombre);
    const variantObj = {
      id: `custom-${c.slug}`,
      label: c.nombre,
      company_slug: c.slug,
      operador: c.operador_form || c.nombre,
      es_movil: !!c.usa_portado,
    };

    if (norm.includes("movistar")) {
      groups[0].variants.push({ ...variantObj, label: c.nombre.replace(/movistar/i, "").trim() || c.nombre });
    } else if (norm.includes("entel")) {
      groups[1].variants.push({ ...variantObj, label: c.nombre.replace(/entel/i, "").trim() || c.nombre });
    } else if (norm.includes("claro") || norm.includes("vtr")) {
      groups[2].variants.push(variantObj);
    } else if (norm.includes("wom")) {
      groups[3].variants.push({ ...variantObj, label: c.nombre.replace(/wom/i, "").trim() || c.nombre });
    } else {
      groups.push({
        brandId: c.slug,
        label: c.nombre,
        emoji: c.emoji || "🏢",
        color: c.color || "#475569",
        variants: [variantObj],
      });
    }
  }

  for (const g of groups) {
    g.variants = g.variants
      .filter((v) => bySlug.has(v.company_slug))
      .map((v) => {
        const comp = bySlug.get(v.company_slug);
        return {
          ...v,
          hoja: comp.hoja,
          emoji: comp.emoji,
          es_movil: !!comp.usa_portado,
        };
      });
  }

  return groups.filter((g) => g.variants.length > 0);
}

function getFormMetadata(options = {}) {
  const companies = getAllCompanies();
  const allSups = getAllSupervisors();
  const supervisors = options.includeAllSupervisors ? allSups : allSups.filter((s) => s.activo);

  const execRows = db
    .prepare(
      "SELECT ejecutivo, supervisor, COUNT(*) as total FROM sales WHERE ejecutivo != '' GROUP BY ejecutivo, supervisor ORDER BY total DESC"
    )
    .all();

  const supsCache = allSups;
  const ejecutivosPorSupervisor = {};
  const todosEjecutivos = new Set();

  for (const r of execRows) {
    const ej = darFormatoNombre(r.ejecutivo);
    if (!ej) continue;
    todosEjecutivos.add(ej);
    const sup = resolveCanonicalSupervisor(r.supervisor, supsCache);
    if (!ejecutivosPorSupervisor[sup]) ejecutivosPorSupervisor[sup] = [];
    if (!ejecutivosPorSupervisor[sup].includes(ej)) {
      ejecutivosPorSupervisor[sup].push(ej);
    }
  }

  const brandGroups = buildBrandGroupsForForm(companies);

  const countsRows = db.prepare("SELECT company_slug, supervisor, COUNT(*) as total FROM sales GROUP BY company_slug, supervisor").all();
  const countsMap = {};
  for (const row of countsRows) {
    if (!options.supervisor || supervisorMatchesFilter(row.supervisor, options.supervisor, supsCache)) {
      countsMap[row.company_slug] = (countsMap[row.company_slug] || 0) + row.total;
    }
  }

  // Estadísticas reales de actividad de ventas por supervisor
  // Punto de corte para determinar si está activo subiendo ventas (últimos 40-45 días de actividad)
  const cutoff = 20261001;
  const salesStatsRows = db.prepare(`
    SELECT supervisor,
           COUNT(*) as total,
           SUM(CASE WHEN fecha_orden >= ? THEN 1 ELSE 0 END) as recientes,
           MAX(fecha) as ult_fecha,
           MAX(fecha_orden) as ult_orden
    FROM sales
    WHERE supervisor IS NOT NULL AND trim(supervisor) != ''
    GROUP BY supervisor
  `).all(cutoff);

  const statsMap = new Map();
  for (const s of allSups) {
    statsMap.set(s.nombre, { total: 0, recientes: 0, ult_fecha: null, ult_orden: 0 });
  }

  for (const r of salesStatsRows) {
    const canon = resolveCanonicalSupervisor(r.supervisor, supsCache);
    if (statsMap.has(canon)) {
      const st = statsMap.get(canon);
      st.total += r.total;
      st.recientes += (r.recientes || 0);
      if (r.ult_orden && r.ult_orden > (st.ult_orden || 0)) {
        st.ult_orden = r.ult_orden;
        st.ult_fecha = r.ult_fecha;
      }
    }
  }

  const enrichedSupervisors = supervisors.map((s) => {
    const st = statsMap.get(s.nombre) || { total: 0, recientes: 0, ult_fecha: null, ult_orden: 0 };
    const compLimpia = (s.compania || "").trim();
    return {
      ...s,
      compania: compLimpia,
      companiaTexto: compLimpia,
      totalVentas: st.total,
      ventasRecientes: st.recientes,
      ultimaVentaFecha: st.ult_fecha,
      activoVentas: st.recientes > 0,
    };
  });

  return {
    brandGroups,
    companies: companies.map((c) => ({ ...c, totalVentas: countsMap[c.slug] || 0 })),
    supervisors: enrichedSupervisors,
    ejecutivosPorSupervisor,
    todosEjecutivos: Array.from(todosEjecutivos).sort(),
  };
}

module.exports = {
  db,
  DATA_DIR,
  UPLOADS_DIR,
  COLS_FIBRA_HOGAR,
  COLS_FIBRA_TENENCIA,
  COLS_CLARO_VTR,
  COLS_MOVIL,
  slugify,
  isMobileMirrorCompany,
  isMobileCompany,
  getAllCompanies,
  getAllSupervisors,
  resolveCanonicalSupervisor,
  supervisorMatchesFilter,
  resolveCompanyDestination,
  checkDuplicateSale,
  insertSaleRecord,
  submitFormSale,
  updateSaleFields,
  deleteSale,
  bulkDeleteSales,
  getCompanySales,
  getDailySummary,
  getExecutiveLiveOverview,
  getPaymentsReport,
  getPaymentSettings,
  getBotSession,
  upsertBotSession,
  querySalesForN8n,
  createCustomCompany,
  upsertSupervisor,
  deleteSupervisor,
  parseEmailList,
  normalizeEmailListString,
  getAccessPermissions,
  updateViewEmails,
  updateSupervisorEmails,
  verifyViewEmailAccess,
  updateExecutiveGoal,
  updatePaymentTarifas,
  globalSearch,
  getFormMetadata,
};
