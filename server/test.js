// ============================================================================
// FENIX CRM - PRUEBAS AUTOMÁTICAS DE INTEGRACIÓN, PERMISOS, N8N Y PARIDAD SHEETS
// ============================================================================
const assert = require("node:assert");
const { parsearFichaCompleta, sonDireccionesIguales } = require("./fichaParser");
const {
  db,
  getAllCompanies,
  getAllSupervisors,
  submitFormSale,
  updateSaleFields,
  deleteSale,
  getDailySummary,
  getPaymentsReport,
  getFormMetadata,
  querySalesForN8n,
  getBotSession,
  upsertBotSession,
  updateViewEmails,
  updateSupervisorEmails,
  verifyViewEmailAccess,
} = require("./db");
const { seedIfEmpty } = require("./seed");
const { parseXlsxBuffer } = require("./xlsxReader");

function runTests() {
  console.log("🧪 Ejecutando suite completa de pruebas de Fenix CRM...");

  // Limpieza preventiva de filas de prueba previas
  db.prepare("DELETE FROM sales WHERE rut IN ('8313437-2', '17645584-5') AND fecha = '08/11/2026'").run();
  db.prepare("DELETE FROM bot_sessions WHERE telefono = '__test_tg_999999__'").run();

  // 1. Seed real data (8.702 ventas reales de Google Sheets)
  const seed = seedIfEmpty(false);
  console.log(`   ✓ Base de datos verificada (${seed.total} ventas reales importadas).`);
  assert.strictEqual(seed.total, 8702, "Debería contener exactamente las 8.702 ventas reales de Google Sheets");

  // 2. Paridad exacta 100% con Google Sheets en Pagos Adicionales (Agosto 2026 = $540.000)
  const pagosAgo = getPaymentsReport(7, 2026);
  assert.strictEqual(
    pagosAgo.granTotalDinero,
    540000,
    `Agosto 2026 debe cuadrar exacto con Google Sheets ($540.000), obtuvo $${pagosAgo.granTotalDinero}`
  );
  console.log("   ✓ Paridad 100% exacta en Pagos Adicionales con Google Sheets (Agosto 2026 = $540.000) OK.");

  // 3. Agrupación de marcas en el Formulario Propio
  const meta = getFormMetadata();
  const brandIds = meta.brandGroups.map((g) => g.brandId);
  assert(brandIds.includes("movistar"), "Debe existir grupo Movistar");
  assert(brandIds.includes("entel"), "Debe existir grupo Entel");
  assert(brandIds.includes("claro-vtr"), "Debe existir grupo Claro / VTR");
  assert(brandIds.includes("wom"), "Debe existir grupo WOM");
  assert(brandIds.includes("aa-sales"), "Debe existir grupo A&A Sales");
  const movGroup = meta.brandGroups.find((g) => g.brandId === "movistar");
  assert.strictEqual(movGroup.variants.length, 4, "Movistar debe agrupar Con Tenencia, Sin Tenencia, Paquetización y Móvil");
  console.log("   ✓ Agrupación limpia por marcas en el Formulario (Movistar, Entel, Claro/VTR, WOM, A&A) OK.");

  // 4. Ficha Móvil con Número Principal + múltiples Números Adicionales
  const fichaMovil = `RUT: 8313437-2
NOMBRE CLIENTE: ENRIQUE DOMINGO REYES
DIRECCIÓN: LOS ALAMOS 7161
COMUNA: LO PRADO
CORREO: ereyes@prodelap.cl
NÚMERO A PORTAR: +56 9 8500 3215
NÚMEROS ADICIONALES:
+56 9 7711 2233
966554433, +56955443322
PLAN: Plan Libre Full 5G`;

  const parsedMov = parsearFichaCompleta(fichaMovil, "08/11/2026");
  assert.strictEqual(parsedMov.numeroPrincipal, "985003215", "Debe detectar el Número Principal (Titular)");
  assert.strictEqual(parsedMov.adicionales, "977112233 | 966554433 | 955443322", "Debe detectar los 3 Números Adicionales");
  assert.strictEqual(parsedMov.cantTitular, 1);
  assert.strictEqual(parsedMov.cantAdicional, 3);

  const saleMov = submitFormSale({
    operador: "Entel Movil",
    ejecutivo: "Alan Muñoz",
    supervisor: "Francisca",
    fecha: "2026-11-08",
    ficha: fichaMovil,
    // Probando también edición manual de adicionales desde la vista previa en vivo
    numero_principal: "985003215",
    adicional: "977112233\n966554433\n955443322\n944332211",
  });
  assert(saleMov.ok, "Venta móvil con números adicionales debe registrarse OK");
  assert.strictEqual(saleMov.sale.numero_principal, "985003215");
  assert.strictEqual(saleMov.sale.cant_titular, 1);
  assert.strictEqual(saleMov.sale.cant_adicional, 4, "Debe recalcular cant_adicional = 4 tras edición en vista previa");
  console.log("   ✓ Lectura y edición de Número Principal + Números Adicionales en Móviles OK.");

  // 5. Ficha Con Tenencia con DIRECCION LIMPIA + typo DIRECCION DE INATALACION
  const fichaTenencia = `TNE
CÓDIGO DE BIOMETRÍA:   BO N°W4111
DIRECCION LIMPIA:  :   PASAJE LA FORTALEZA, 203 valparaiso
COMUNA: viña del mar
RUT CLIENTE:  17645584-5
DIRECCION DE INATALACION:   PASAJE LA FORTALEZA, 205, CASA, VALPARAISO,
COMUNA: valparaiso
NOMBRE COMPLETO DEL CLIENTE:  LEÓN RAMÍREZ VALENTINA PAZ
TELÉFONOS CONTACTO: +56 9 6661 3096
SERVICIOS A CONTRATAR:  600 Megas Fibra Dúo`;

  const parsed = parsearFichaCompleta(fichaTenencia, "08/11/2026");
  assert.strictEqual(parsed.rut, "17645584-5");
  assert(parsed.direccion.includes("205"), "Debe extraer #205 (Instalación) y no #203 (Limpia)");
  assert.strictEqual(parsed.comuna.toLowerCase(), "valparaiso");
  assert.strictEqual(parsed.telefonoContacto, "966613096");
  assert.strictEqual(parsed.codigoBiometria, "BON°W4111");

  assert.strictEqual(sonDireccionesIguales("PASAJE LA FORTALEZA 203", "PASAJE LA FORTALEZA 205"), false);
  assert.strictEqual(sonDireccionesIguales("", ""), false);

  const r1 = submitFormSale({
    operador: "Movistar Fijo",
    tipo_venta: "Instalacion con tenencia",
    ejecutivo: "Emily León",
    supervisor: "Francisca",
    fecha: "2026-11-08",
    ficha: fichaTenencia,
  });
  assert(r1.ok, "Primera venta tenencia debe registrarse OK");

  const rDup = submitFormSale({
    operador: "Movistar Fijo",
    tipo_venta: "Instalacion con tenencia",
    ejecutivo: "Emily León",
    supervisor: "Francisca",
    fecha: "2026-11-08",
    ficha: fichaTenencia,
  });
  assert.strictEqual(rDup.duplicate, true, "Envío idéntico mismo día+dirección debe bloquearse como duplicada");

  const r2 = submitFormSale({
    operador: "Movistar Fijo",
    tipo_venta: "Instalacion con tenencia",
    ejecutivo: "Emily León",
    supervisor: "Francisca",
    fecha: "2026-11-08",
    ficha: fichaTenencia.replace("BO N°W4111", "BO N°W4112").replace("205", "209"),
  });
  assert(r2.ok, "Segunda venta del mismo cliente en distinta dirección (#209) debe permitirse");
  console.log("   ✓ Extractor Tenencia y anti-duplicados inteligente por dirección OK.");

  // 6. Bloqueos estrictos por Rol (Supervisor = Solo lectura total | Espejo Móviles = Solo Notas/Seguimiento)
  assert.throws(
    () => updateSaleFields(r1.sale.id, { estado: "Instalado" }, { role: "supervisor" }),
    (err) => err.statusCode === 403,
    "Supervisor NO debe poder editar ventas (403)"
  );
  assert.throws(
    () => deleteSale(r1.sale.id, { role: "supervisor" }),
    (err) => err.statusCode === 403,
    "Supervisor NO debe poder eliminar ventas (403)"
  );
  assert.throws(
    () => updateSaleFields(saleMov.sale.id, { estado: "Portado" }, { role: "moviles" }),
    (err) => err.statusCode === 403,
    "Espejo Móviles NO debe poder cambiar el estado ni datos del cliente (403)"
  );
  const movNotasOk = updateSaleFields(
    saleMov.sale.id,
    { notas_movil: "Llamar a las 15:00", seguimiento_movil: "En validación" },
    { role: "moviles" }
  );
  assert.strictEqual(movNotasOk.notas_movil, "Llamar a las 15:00");
  assert.strictEqual(movNotasOk.seguimiento_movil, "En validación");

  const adminOk = updateSaleFields(r1.sale.id, { estado: "Instalado" }, { role: "admin" });
  assert.strictEqual(adminOk.estado, "Instalado");

  // Ventas Fenix (subadmin): puede editar ventas existentes
  const subAdminEdit = updateSaleFields(r1.sale.id, { observacion: "Validado por Gestión" }, { role: "subadmin" });
  assert.strictEqual(subAdminEdit.observacion, "Validado por Gestión");
  console.log("   ✓ Permisos estrictos por rol (Admin / Ventas Fenix / Móviles / Supervisor) OK.");

  // 6b. Control de Acceso por Correo Electrónico (Estilo Google Sheets)
  assert.strictEqual(verifyViewEmailAccess("formulario").allowed, true, "Formulario debe ser libre");
  updateViewEmails("subadmin", "gestion1@gmail.com, gestion2@empresa.cl");
  assert.strictEqual(verifyViewEmailAccess("subadmin", "", "gestion1@gmail.com").allowed, true);
  assert.strictEqual(verifyViewEmailAccess("subadmin", "", "intruso@gmail.com").allowed, false);
  updateViewEmails("subadmin", "");

  const supFrancisca = getAllSupervisors().find((s) => s.nombre === "Francisca");
  if (supFrancisca) {
    updateSupervisorEmails(supFrancisca.id, "francisca.sup@gmail.com");
    assert.strictEqual(
      verifyViewEmailAccess("supervisor", supFrancisca.token_acceso, "francisca.sup@gmail.com").allowed,
      true
    );
    assert.strictEqual(
      verifyViewEmailAccess("supervisor", supFrancisca.token_acceso, "otro@gmail.com").allowed,
      false
    );
    updateSupervisorEmails(supFrancisca.id, "");
  }
  console.log("   ✓ Control de acceso por correo electrónico (Estilo Google Sheets) OK.");

  // 7. Endpoints / motor de n8n + Telegram + Sesiones Bot
  const n8nRes = querySalesForN8n({ desde: "2026-11-08", hasta: "2026-11-08", supervisor: "Francisca" });
  assert(n8nRes.total >= 3, "Consulta n8n debe encontrar las ventas recién ingresadas");
  assert(n8nRes.texto_telegram.includes("Consulta de Ventas Fenix"), "Debe generar texto formateado para Telegram");

  const testChatId = "__test_tg_999999__";
  const ses1 = upsertBotSession({ chat_id: testChatId, estado: "ESPERANDO_HOJA", temp_fecha_inicio: "01/11/2026" });
  assert.strictEqual(ses1.estado, "ESPERANDO_HOJA");
  const ses2 = getBotSession(testChatId);
  assert.strictEqual(ses2.temp_fecha_inicio, "01/11/2026");
  db.prepare("DELETE FROM bot_sessions WHERE telefono = ?").run(testChatId);
  console.log("   ✓ Motor n8n + resumen Telegram + Sesiones Bot OK.");

  // 8. Verificación de lector nativo .xlsx disponible
  assert.strictEqual(typeof parseXlsxBuffer, "function");

  // 9. Limpiar ventas de prueba para dejar la base 100% limpia con las 8.702 reales
  deleteSale(saleMov.sale.id, { role: "admin" });
  deleteSale(r1.sale.id, { role: "admin" });
  deleteSale(r2.sale.id, { role: "admin" });

  const totalFinal = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
  assert.strictEqual(totalFinal, seed.total, "La base de datos debe quedar intacta tras limpiar las pruebas");
  console.log(`✅ TODAS LAS PRUEBAS PASARON CON ÉXITO. Base lista con ${totalFinal} ventas reales.`);
}

runTests();
