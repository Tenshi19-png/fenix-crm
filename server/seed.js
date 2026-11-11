// ============================================================================
// FENIX CRM - IMPORTADOR UNIVERSAL DE GOOGLE SHEETS (.XLSX / SNAPSHOT EN VIVO / CSV)
// ============================================================================
const fs = require("node:fs");
const path = require("node:path");
const {
  db,
  getAllCompanies,
  getAllSupervisors,
  resolveCanonicalSupervisor,
  createCustomCompany,
  upsertSupervisor,
  updateExecutiveGoal,
  upsertBotSession,
} = require("./db");
const {
  normalizarTexto,
  darFormatoNombre,
  formatearRut,
  limpiarRutComparacion,
  extraerTelefonosSeguro,
  extraerDireccionDeFicha,
  extraerFechaSegura,
  parsearFichaCompleta,
} = require("./fichaParser");

const SCRATCH_CSV_DIR = "C:/Users/angel/.gemini/antigravity-ide/scratch";

const HOJAS_SISTEMA_EXCLUIDAS = new Set(
  [
    "ventas del dia",
    "pagos adicionales",
    "configuracion adicional",
    "config tipos de venta",
    "conf. tipos venta",
    "config supervisores",
    "config companias nuevas",
    "formulario de ventas",
    "debug_pyme",
    "debug_adicionales",
    "hoja 1",
  ].map((s) => normalizarTexto(s))
);

function serialAFecha(v) {
  const t = String(v ?? "").trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const days = Math.floor(parseFloat(t));
    if (days >= 20000 && days <= 65000) {
      const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
      return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    }
  }
  return v;
}
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignore
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Importa un diccionario completo de hojas { [nombreHoja]: rows[][] } proveniente
 * de Google Sheets (envío directo desde el botón Fenix, archivo Excel .xlsx o .json).
 */
function importSheetsDictionary(sheetsMap, options = {}) {
  const reset = options.reset !== false;
  const dirPorRut = options.dirPorRut || {};
  const fichaPorRut = options.fichaPorRut || {};

  // 1. Procesar hojas de configuración si vienen incluidas
  for (const [sheetName, rows] of Object.entries(sheetsMap)) {
    if (!Array.isArray(rows) || rows.length < 2) continue;
    const normName = normalizarTexto(sheetName);

    if (normName === "config supervisores") {
      for (let i = 1; i < rows.length; i++) {
        const aliasesRaw = String(rows[i][0] || "").trim();
        if (!aliasesRaw) continue;
        const firstAlias = aliasesRaw.split(",")[0].trim();
        if (firstAlias) upsertSupervisor({ nombre: firstAlias, aliases: aliasesRaw });
      }
    } else if (normName === "config companias nuevas") {
      // Columnas en Código.js: [nombre, iniciales, hoja, basadaEn, movil ("Sí"/"No"), emoji, color]
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const nombre = String(r[0] || "").trim();
        const iniciales = String(r[1] || "").trim();
        const hoja = String(r[2] || nombre).trim();
        const basadaEn = String(r[3] || "").trim();
        const movil = normalizarTexto(String(r[4] || "")).startsWith("si");
        const emoji = String(r[5] || "").trim() || (movil ? "📱" : "🏢");
        const color = String(r[6] || "").trim() || "#00acc1";
        if (!nombre) continue;
        createCustomCompany({
          nombre,
          iniciales: iniciales || nombre.slice(0, 3).toUpperCase(),
          hoja,
          plantilla_slug: basadaEn,
          es_movil: movil,
          es_movil_espejo: movil,
          emoji,
          color,
          ignoreIfExists: true,
        });
      }
    } else if (normName === "configuracion adicional") {
      for (let i = 1; i < rows.length; i++) {
        const nom = String(rows[i][0] || "").trim();
        const min = parseInt(rows[i][1], 10);
        if (nom && !Number.isNaN(min)) {
          updateExecutiveGoal(normalizarTexto(nom), nom, min);
        }
      }
    } else if (normName === "formulario de ventas") {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const blobs = r.filter((cell) => cell && String(cell).includes("\n") && String(cell).includes(":"));
        if (blobs.length === 0) continue;
        const full = blobs.join("\n\n");
        const mRut = full.match(/rut[^:\r\n]*:\s*([0-9.\-kK]+)/i) || full.match(/\b(\d{7,8}-[0-9kK])\b/);
        if (!mRut) continue;
        const rk = limpiarRutComparacion(mRut[1]);
        if (rk.length < 5) continue;
        const dirExt = extraerDireccionDeFicha([full], null).direccion;
        if (dirExt && !dirPorRut[rk]) dirPorRut[rk] = dirExt;
        if (!fichaPorRut[rk]) fichaPorRut[rk] = full;
      }
    }
  }

  // 2. Preparar mapa actualizado de compañías
  let companies = getAllCompanies();
  const findCompanyForSheetName = (sheetName) => {
    const n = normalizarTexto(sheetName);
    return (
      companies.find(
        (c) => normalizarTexto(c.hoja) === n || normalizarTexto(c.nombre) === n || normalizarTexto(c.slug) === n
      ) ||
      (n.length >= 28 ? companies.find((c) => normalizarTexto(c.hoja).startsWith(n)) : undefined)
    );
  };

  // Auto-registrar hojas de ventas nuevas que existan en el Excel/Google Sheet y aún no estén en companies
  for (const [sheetName, rows] of Object.entries(sheetsMap)) {
    if (!Array.isArray(rows) || rows.length < 1) continue;
    const normName = normalizarTexto(sheetName);
    if (HOJAS_SISTEMA_EXCLUIDAS.has(normName)) continue;
    // Ignorar hoja de sesiones del bot si viene con cabecera "telefono,estado,temp_fecha_inicio"
    const headerRowNorm = (rows[0] || []).map((c) => normalizarTexto(c));
    if (headerRowNorm.includes("temp_fecha_inicio")) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0]) {
          upsertBotSession({
            telefono: rows[i][0],
            estado: rows[i][1] || "ESPERANDO_OPCION_MENU",
            temp_fecha_inicio: rows[i][2] || "",
            temp_fecha_fin: rows[i][3] || "",
            temp_hoja: rows[i][4] || "",
          });
        }
      }
      continue;
    }

    const tieneCabecerasVenta =
      headerRowNorm.some((h) => h.includes("fecha")) &&
      headerRowNorm.some((h) => h.includes("ejecutiv") || h.includes("vendedor") || h.includes("rut"));
    if (!tieneCabecerasVenta) continue;

    if (!findCompanyForSheetName(sheetName)) {
      const esMovil =
        normName.includes("movil") ||
        headerRowNorm.some((h) => h.includes("numero principal") || h === "adicional");
      const words = sheetName.trim().split(/\s+/).filter(Boolean);
      const ini = (words.length > 1 ? words.map((w) => w[0]).join("") : sheetName.slice(0, 3)).toUpperCase();
      createCustomCompany({
        nombre: sheetName.trim(),
        hoja: sheetName.trim(),
        iniciales: ini,
        plantilla_slug: esMovil ? "ventas-entel-movil" : "ventas-entel",
        es_movil: esMovil,
        es_movil_espejo: esMovil && !normName.includes("pyme") && !normName.includes("a&a") && !normName.includes("aa sales"),
        ocultar_en_espejo_movil: esMovil && (normName.includes("pyme") || normName.includes("a&a") || normName.includes("aa sales")),
        ignoreIfExists: true,
      });
      companies = getAllCompanies();
    }
  }

  const supsCache = getAllSupervisors();
  const insSale = db.prepare(`
    INSERT INTO sales (
      company_slug, fecha, fecha_orden, mes, anio, ejecutivo, supervisor,
      comuna, direccion, direccion_limpia, rut, nombre_cliente, telefono,
      numero_principal, adicional, cant_titular, cant_adicional, correo,
      servicio, estado, id_orden, fecha_instalacion, observacion,
      subcompania, ficha_original, notas_movil, seguimiento_movil
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, '', ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const insGoal = db.prepare(`
    INSERT INTO executive_goals (ejecutiva_norm, nombre, minimo_ventas, supervisor_habitual)
    VALUES (?, ?, 10, ?)
    ON CONFLICT(ejecutiva_norm) DO UPDATE SET
      supervisor_habitual = CASE WHEN excluded.supervisor_habitual != 'Sin Asignar' THEN excluded.supervisor_habitual ELSE executive_goals.supervisor_habitual END
  `);

  const mesesNombres = [
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

  let totalImportadas = 0;
  let hojasImportadas = 0;

  db.exec("BEGIN TRANSACTION;");
  try {
    if (reset) {
      db.exec("DELETE FROM sales;");
    }

    for (const [sheetName, rows] of Object.entries(sheetsMap)) {
      if (!Array.isArray(rows) || rows.length < 2) continue;
      const normName = normalizarTexto(sheetName);
      if (HOJAS_SISTEMA_EXCLUIDAS.has(normName)) continue;

      const comp = findCompanyForSheetName(sheetName);
      if (!comp) continue;

      const headers = rows[0].map((h) => normalizarTexto(h));
      const idxOf = (...patterns) =>
        headers.findIndex((h) => patterns.some((p) => (typeof p === "function" ? p(h) : h.includes(p))));

      const iFecha = idxOf((h) => h === "fecha" || (h.includes("fecha") && !h.includes("instal")));
      const iEjec = idxOf("ejecutivo", "ejecutiva", "vendedor", "asesor");
      const iComuna = idxOf("comuna");
      const iDir = idxOf("direccion", "domicilio");
      const iRut = idxOf("rut");
      const iNombre = headers.findIndex((h) => (h.includes("nombre") && !h.includes("ejecutiv")) || h === "cliente");
      const iTel = idxOf("telefono", "fono", "celular");
      const iPrinc = idxOf("numero principal", "titular");
      const iAdic = headers.findIndex((h) => h === "adicional" || (h.includes("adicional") && !h.includes("cant")));
      const iCorreo = idxOf("correo", "mail");
      const iServ = idxOf("servicio", "plan");
      const iEstado = idxOf("estado", "status", "etapa");
      const iIdOrden = idxOf("peticion", "id orden", "biometria");
      const iFechaInst = idxOf("fecha instal");
      const iObs = idxOf("observacion");
      const iSup = idxOf("supervisor");
      const iSubComp = idxOf("compania");
      const iNotasMovil = idxOf("notas");
      const iSegMovil = idxOf("seguimiento");

      let mesSeparador = -1;
      let anioSeparador = 2026;
      let filasEnEstaHoja = 0;

      for (let r = 1; r < rows.length; r++) {
        const fila = rows[r];
        const joinedUpper = fila.join(" ").trim().toUpperCase();
        if (!joinedUpper) continue;

        if (joinedUpper.includes("MES DE ")) {
          const mMes = joinedUpper.match(/MES DE ([A-ZÁÉÍÓÚÑ]+)\s*(\d{4})?/);
          if (mMes) {
            const idxM = mesesNombres.indexOf(mMes[1]);
            if (idxM !== -1) mesSeparador = idxM;
            if (mMes[2]) anioSeparador = parseInt(mMes[2], 10);
          }
          continue;
        }

        const rawFecha = iFecha >= 0 ? fila[iFecha] : fila[0];
        const rawEjec = iEjec >= 0 ? String(fila[iEjec] || "").trim() : "";
        const rawRut = iRut >= 0 ? String(fila[iRut] || "").trim() : "";
        let rawNombre = iNombre >= 0 ? String(fila[iNombre] || "").trim() : "";

        if (!rawEjec && !rawRut && !rawNombre) continue;

        let fObj = extraerFechaSegura(serialAFecha(rawFecha));
        if (!fObj && mesSeparador >= 0) {
          fObj = { dia: 1, mes: mesSeparador, anio: anioSeparador };
        }
        if (!fObj) continue;

        const fechaStr = `${String(fObj.dia).padStart(2, "0")}/${String(fObj.mes + 1).padStart(2, "0")}/${fObj.anio}`;
        const fechaOrden = fObj.anio * 10000 + (fObj.mes + 1) * 100 + fObj.dia;
        const ejecFmt = darFormatoNombre(rawEjec);
        const supRaw = iSup >= 0 ? String(fila[iSup] || "").trim() : "";
        const supCanon = resolveCanonicalSupervisor(supRaw, supsCache);
        const rutFmt = formatearRut(rawRut);
        const rutKey = limpiarRutComparacion(rutFmt);

        let comuna = iComuna >= 0 ? String(fila[iComuna] || "").trim() : "";
        if (comuna.includes("(COMUNA)") || comuna.includes("|")) {
          const parts = comuna
            .split("|")
            .map((p) => p.replace(/\(\s*COMUNA\s*\)/gi, "").trim())
            .filter(Boolean);
          comuna = parts.length > 0 ? parts[parts.length - 1] : comuna;
        }

        let direccion = iDir >= 0 ? String(fila[iDir] || "").trim() : "";
        if (!direccion && rutKey && dirPorRut[rutKey]) {
          direccion = dirPorRut[rutKey];
        }

        const rawTelStr = iTel >= 0 ? String(fila[iTel] || "").trim() : "";
        const numsTel = extraerTelefonosSeguro(rawTelStr);
        let telLimpio = numsTel.length > 0 ? numsTel.join(" / ") : rawTelStr.replace(/\([^)]*\)/g, "").trim();

        const rawPrinc = iPrinc >= 0 ? String(fila[iPrinc] || "").trim() : "";
        const rawAdic = iAdic >= 0 ? String(fila[iAdic] || "").trim() : "";
        const numsPrinc = extraerTelefonosSeguro(rawPrinc);
        const numsAdic = extraerTelefonosSeguro(rawAdic);

        let numeroPrincipal = numsPrinc[0] || numsTel[0] || "";
        const listaAdicFinal = (numsAdic.length > 0 ? numsAdic : numsTel.slice(1)).filter(
          (x) => x && x !== numeroPrincipal
        );
        let adicional = listaAdicFinal.join(" | ");
        let cantTitular = numeroPrincipal ? 1 : 0;
        let cantAdicional = listaAdicFinal.length;

        let correo = iCorreo >= 0 ? String(fila[iCorreo] || "").trim() : "";
        let servicio = iServ >= 0 ? String(fila[iServ] || "").trim() : "";
        let estado = (iEstado >= 0 ? String(fila[iEstado] || "").trim() : "") || "Pendiente";
        let idOrden = iIdOrden >= 0 ? String(fila[iIdOrden] || "").trim() : "";
        let fechaInst = iFechaInst >= 0 ? String(fila[iFechaInst] || "").trim() : "";
        let obs = iObs >= 0 ? String(fila[iObs] || "").trim() : "";
        const subComp = iSubComp >= 0 ? String(fila[iSubComp] || "").trim() : "";
        const notasMovil = iNotasMovil >= 0 ? String(fila[iNotasMovil] || "").trim() : "";
        const segMovil = iSegMovil >= 0 ? String(fila[iSegMovil] || "").trim() : "";
        const fichaOrig = rutKey && fichaPorRut[rutKey] ? fichaPorRut[rutKey] : "";

        // --- CORRECCIONES AUTOMÁTICAS DE FILAS MAL SUBIDAS ---
        // (a) Código de petición/biometría (9 dígitos, empieza con 12) mezclado dentro de los teléfonos
        if (/^12\d{7}$/.test(numeroPrincipal) && !idOrden) {
          idOrden = numeroPrincipal;
          const resto = numsTel.filter((n) => n !== numeroPrincipal);
          numeroPrincipal = resto[0] || "";
        }
        {
          const sinCodigos = [];
          for (const n of extraerTelefonosSeguro(telLimpio)) {
            if (/^12\d{7}$/.test(n)) {
              if (!idOrden) idOrden = n;
            } else sinCodigos.push(n);
          }
          if (sinCodigos.length > 0 || telLimpio) telLimpio = sinCodigos.join(" / ");
          if (!numeroPrincipal && !comp.usa_portado) numeroPrincipal = sinCodigos[0] || "";
        }
        // (b) Fila desalineada (teléfono en Comuna, dirección numérica, nombre vacío): se re-lee desde la ficha original
        const filaDesalineada =
          /^\d{8,}$/.test(comuna.replace(/\D/g, "")) && comuna.replace(/[^\d]/g, "").length >= 8 && !/[a-záéíóúñ]/i.test(comuna);
        const dirNumerica = /^\d{3,6}$/.test(direccion);
        if ((filaDesalineada || dirNumerica || (!rawNombre && !direccion)) && fichaOrig) {
          const pf = parsearFichaCompleta(fichaOrig, fechaStr);
          if (pf.comuna) comuna = pf.comuna;
          if (pf.direccion) direccion = pf.direccion;
          if (pf.nombreCliente) rawNombre = pf.nombreCliente;
          if (pf.correo && !correo) correo = pf.correo;
          if (pf.servicio) servicio = pf.servicio;
          if (pf.codigoBiometria) idOrden = pf.codigoBiometria;
          if (pf.telefonoContacto && !comp.usa_portado) {
            telLimpio = pf.telefonoContacto;
            numeroPrincipal = pf.numeroPrincipal || numeroPrincipal;
          }
        }
        // (c) "Doble fecha": Fecha instalación igual a la fecha de venta en ventas aún Pendientes -> se limpia
        if (fechaInst && /pendiente/i.test(estado)) {
          const fi = extraerFechaSegura(fechaInst);
          if (fi && fi.dia === fObj.dia && fi.mes === fObj.mes && fi.anio === fObj.anio) fechaInst = "";
        }

        insSale.run(
          comp.slug,
          fechaStr,
          fechaOrden,
          fObj.mes,
          fObj.anio,
          ejecFmt,
          supCanon,
          comuna,
          direccion,
          rutFmt,
          rawNombre,
          telLimpio,
          numeroPrincipal,
          adicional,
          cantTitular,
          cantAdicional,
          correo,
          servicio,
          estado,
          idOrden,
          fechaInst,
          obs,
          subComp,
          fichaOrig,
          notasMovil,
          segMovil
        );

        if (ejecFmt) {
          insGoal.run(normalizarTexto(ejecFmt), ejecFmt, supCanon);
        }
        filasEnEstaHoja++;
        totalImportadas++;
      }

      if (filasEnEstaHoja > 0) hojasImportadas++;
    }

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  return {
    ok: true,
    imported: totalImportadas,
    sheetsImported: hojasImportadas,
    companiesCount: getAllCompanies().length,
  };
}

function seedIfEmpty(forceReset = false) {
  const currentSales = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
  if (currentSales > 0 && !forceReset) {
    return { imported: 0, skipped: true, total: currentSales };
  }

  if (!fs.existsSync(SCRATCH_CSV_DIR)) {
    return { imported: 0, skipped: true, total: 0 };
  }

  const sheetsMap = {};
  const dirPorRut = {};
  const fichaPorRut = {};

  // Leer Config Supervisores, Configuración Adicional y Bot Sessions si existen localmente
  const localSpecialFiles = [
    { file: "sheet_1492349546.csv", name: "Config Supervisores" },
    { file: "sheet_1890517303.csv", name: "Configuración Adicional" },
    { file: "sheet_919909806.csv", name: "Sesiones Bot" },
    { file: "data.csv", name: "FORMULARIO DE VENTAS" },
    { file: "sheet_1386966259.csv", name: "Paquetizacion Movistar" },
    { file: "sheet_1961294280.csv", name: "Instalaciones Movistar sin Tenencia" },
    { file: "sheet_211014068.csv", name: "Instalacion Movistar Con tenencia" },
    { file: "sheet_259971198.csv", name: "Ventas Entel" },
    { file: "sheet_1062896849.csv", name: "Claro y Vtr Hogar" },
    { file: "sheet_1140958871.csv", name: "Ventas Wom Hogar" },
    { file: "sheet_475232176.csv", name: "Ventas Entel Pyme" },
    { file: "sheet_1850091310.csv", name: "Ventas Entel Movil" },
    { file: "sheet_1388060657.csv", name: "Ventas Moviles Movistar" },
    { file: "sheet_1743160862.csv", name: "Ventas Claro Movil" },
  ];

  for (const item of localSpecialFiles) {
    const fullPath = path.join(SCRATCH_CSV_DIR, item.file);
    if (fs.existsSync(fullPath)) {
      sheetsMap[item.name] = parseCSV(fs.readFileSync(fullPath, "utf8"));
    }
  }

  const res = importSheetsDictionary(sheetsMap, { reset: forceReset, dirPorRut, fichaPorRut });
  return { imported: res.imported, skipped: false, total: res.imported };
}

if (require.main === module) {
  const force = process.argv.includes("--reset");
  const res = seedIfEmpty(force);
  console.log("✅ Seed completado:", res);
}

module.exports = { seedIfEmpty, importSheetsDictionary, parseCSV };



