// ============================================================================
// FENIX CRM - SINCRONIZACIÓN EN TIEMPO REAL Y DISEÑO VISUAL GOOGLE SHEETS
// ============================================================================
const {
  db,
  getAllCompanies,
  getDailySummary,
  getPaymentsReport,
} = require("./db");

const N8N_SHEETS_WEBHOOK_URL =
  process.env.N8N_SHEETS_WEBHOOK_URL ||
  "https://bot-n8n.7lshe4.easypanel.host/webhook/fenix-sheets-sync";

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_ID ||
  "1cI2W9OV72iRsTyya3CJ59MOCrSeqs9Mf5wGwRGyhRaw";

const VENTAS_DEL_DIA_SHEET_ID = 826315814;
const PAGOS_ADICIONALES_SHEET_ID = 306344660;

const COMPANY_SHEET_IDS = {
  "Paquetizacion Movistar": 168672033,
  "Instalaciones Movistar sin Tenencia": 239443191,
  "Instalacion Movistar Con tenencia": 1957422259,
  "Ventas Entel": 1434483724,
  "Claro y Vtr Hogar": 1930094120,
  "Ventas Wom Hogar": 187403730,
  "Ventas Entel Pyme": 309435463,
  "Ventas Entel Movil": 198137494,
  "Ventas Entel Pyme Movil": 1646801027,
  "Ventas Claro Movil": 2022804934,
  "Ventas Moviles Movistar": 1128225536,
  "A&A Sales": 463286172,
};

const NOMBRES_MESES_CAP = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const NOMBRES_MESES_UPPER = [
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

const COLORES_MESES = [
  "#fce5cd", // 0: Enero
  "#d9ead3", // 1: Febrero
  "#c9daf8", // 2: Marzo
  "#fff2cc", // 3: Abril
  "#ead1dc", // 4: Mayo
  "#d0e0e3", // 5: Junio
  "#f9cb9c", // 6: Julio
  "#b6d7a8", // 7: Agosto
  "#a4c2f4", // 8: Septiembre
  "#ffe599", // 9: Octubre
  "#d9d2e9", // 10: Noviembre
  "#a2c4c9", // 11: Diciembre
];

function hexToRgb(hex) {
  const clean = String(hex || "#ffffff").replace("#", "").trim();
  const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  if (Number.isNaN(num)) return { red: 1, green: 1, blue: 1 };
  return {
    red: ((num >> 16) & 255) / 255,
    green: ((num >> 8) & 255) / 255,
    blue: (num & 255) / 255,
  };
}

function makeCell(val, opts = {}) {
  const cell = {};
  if (val !== undefined && val !== null && val !== "") {
    if (opts.isNumber && typeof val === "number" && !Number.isNaN(val)) {
      cell.userEnteredValue = { numberValue: val };
    } else {
      cell.userEnteredValue = { stringValue: String(val) };
    }
  } else {
    cell.userEnteredValue = { stringValue: "" };
  }

  const fmt = {
    fontFamily: opts.fontFamily || "Roboto",
    fontSize: opts.fontSize || 10,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
    foregroundColor: hexToRgb(opts.fg || "#212121"),
  };

  const uef = {
    textFormat: fmt,
    verticalAlignment: opts.vAlign || "MIDDLE",
    horizontalAlignment: opts.align || "LEFT",
  };

  if (opts.bg) {
    uef.backgroundColor = hexToRgb(opts.bg);
  }
  if (opts.numberFormat) {
    uef.numberFormat = opts.numberFormat;
  }
  if (opts.borders) {
    uef.borders = opts.borders;
  }

  cell.userEnteredFormat = uef;
  return cell;
}

function solidBorder(hex = "#E0E0E0", style = "SOLID") {
  return { style, color: hexToRgb(hex) };
}

function buildSaleRowForSheets(sale, company) {
  if (!sale || !company || !Array.isArray(company.columnas)) return {};
  const row = {};
  for (const col of company.columnas) {
    if (!col || !col.key || !col.label || col.key === "hoja_origen") continue;
    const rawVal = sale[col.key];
    row[col.label] = rawVal === null || rawVal === undefined ? "" : String(rawVal);
  }
  return row;
}

function buildPaymentsSnapshot(mes = null, anio = null) {
  const report = getPaymentsReport(mes, anio);
  const periodo = `${report.anio}-${String(Number(report.mes) + 1).padStart(2, "0")}`;
  const rows = [];
  for (const sup of report.tarjetasSupervisores || []) {
    for (const ej of sup.ejecutivos || []) {
      rows.push({
        Periodo: periodo,
        Supervisor: sup.supervisor,
        Ejecutiva: ej.nombre,
        "Mínimo Meta": ej.minimo,
        Paquetización: ej.paq,
        Fibra: ej.fib,
        "Claro/VTR": ej.claroVtr,
        Pyme: ej.pyme,
        "Móvil Titular": ej.emTit,
        "Móvil Adicional": ej.emAdi,
        "Pyme Móvil Titular": ej.pmTit,
        "Pyme Móvil Adicional": ej.pmAdi,
        "A&A": ej.aa,
        "Pago Paquetización ($)": ej.dineroPaq,
        "Pago Fibra ($)": ej.dineroFib,
        "Pago Claro ($)": ej.dineroClaro,
        "Total Pagos ($)": ej.dineroTotal,
      });
    }
  }
  return {
    mes: report.mes,
    anio: report.anio,
    periodo,
    granTotalDinero: report.granTotalDinero,
    rows,
    report,
  };
}

/**
 * Construye los requests de Google Sheets batchUpdate para dibujar
 * la pestaña visual "Ventas del dia" idéntica al Google Sheet original.
 */
function buildVisualDailyRequests(summaryInput = null, sheetId = VENTAS_DEL_DIA_SHEET_ID) {
  let summary = summaryInput || getDailySummary(null);
  if ((!summary.bloques || summary.bloques.length === 0) && Array.isArray(summary.ultimasFechas) && summary.ultimasFechas.length > 0) {
    summary = getDailySummary(summary.ultimasFechas[0].fecha);
  }

  const MAX_COLS = 22;
  const grid = [];
  const ensureRow = (r) => {
    while (grid.length <= r) {
      const row = [];
      for (let c = 0; c < MAX_COLS; c++) row.push({});
      grid.push(row);
    }
  };
  const setCell = (r, c, val, opts) => {
    ensureRow(r);
    if (c < MAX_COLS) grid[r][c] = makeCell(val, opts);
  };
  const fillRect = (r0, r1, c0, c1, opts) => {
    for (let r = r0; r < r1; r++) {
      ensureRow(r);
      for (let c = c0; c < c1; c++) {
        grid[r][c] = makeCell(r === r0 && c === c0 ? opts.val ?? "" : "", opts);
      }
    }
  };

  const merges = [];
  const borderReqs = [];

  // Título B2:M3 (0-based r:1..3, c:1..13)
  const titulo = `🗓️ Reporte de Ventas: ${summary.fecha}  (Total: ${summary.granTotal || 0})`;
  fillRect(1, 3, 1, 13, {
    val: titulo,
    fontSize: 18,
    bold: true,
    fg: "#202124",
    bg: "#FFFFFF",
    align: "LEFT",
  });
  merges.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 13 },
      mergeType: "MERGE_ALL",
    },
  });

  let filaActual = 4; // 0-based (Fila 5)
  const bloques = summary.bloques || [];

  if (bloques.length === 0) {
    setCell(filaActual, 1, `Sin ventas registradas el ${summary.fecha}.`, {
      italic: true,
      fg: "#64748B",
      bg: "#FFFFFF",
      fontSize: 11,
    });
    filaActual += 3;
  } else {
    for (const b of bloques) {
      // Barra Supervisor B..M (c: 1..13) y Total O..Q (c: 14..17)
      fillRect(filaActual, filaActual + 1, 1, 13, {
        val: `👤 Resumen: ${b.supervisor}`,
        bg: "#E8F0FE",
        fg: "#1A73E8",
        fontSize: 13,
        bold: true,
        align: "LEFT",
      });
      merges.push({
        mergeCells: {
          range: { sheetId, startRowIndex: filaActual, endRowIndex: filaActual + 1, startColumnIndex: 1, endColumnIndex: 13 },
          mergeType: "MERGE_ALL",
        },
      });
      borderReqs.push({
        updateBorders: {
          range: { sheetId, startRowIndex: filaActual, endRowIndex: filaActual + 1, startColumnIndex: 1, endColumnIndex: 13 },
          bottom: solidBorder("#1A73E8", "SOLID_MEDIUM"),
        },
      });

      fillRect(filaActual, filaActual + 1, 14, 17, {
        val: `⭐ TOTAL: ${b.total}`,
        bg: "#34A853",
        fg: "#FFFFFF",
        fontSize: 11,
        bold: true,
        align: "CENTER",
      });
      merges.push({
        mergeCells: {
          range: { sheetId, startRowIndex: filaActual, endRowIndex: filaActual + 1, startColumnIndex: 14, endColumnIndex: 17 },
          mergeType: "MERGE_ALL",
        },
      });

      filaActual += 2;
      let colActual = 1; // Col B
      let maxFilaEnBloque = filaActual;

      const campanias = b.campanias || [];
      campanias.forEach((camp, idx) => {
        if (idx > 0 && idx % 4 === 0) {
          colActual = 1;
          filaActual = maxFilaEnBloque + 2;
        }

        const cardStartRow = filaActual;
        const cardColor = camp.color || "#1976D2";

        // Cabecera de campaña (3 cols: colActual .. colActual+3)
        fillRect(cardStartRow, cardStartRow + 1, colActual, colActual + 3, {
          val: camp.titulo,
          bg: cardColor,
          fg: "#FFFFFF",
          bold: true,
          fontSize: 10,
          align: "CENTER",
        });
        merges.push({
          mergeCells: {
            range: { sheetId, startRowIndex: cardStartRow, endRowIndex: cardStartRow + 1, startColumnIndex: colActual, endColumnIndex: colActual + 3 },
            mergeType: "MERGE_ALL",
          },
        });

        // Subcabecera supervisor
        let filaInt = cardStartRow + 1;
        fillRect(filaInt, filaInt + 1, colActual, colActual + 3, {
          val: b.supervisor,
          bg: "#F1F3F4",
          fg: "#475569",
          italic: true,
          fontSize: 8,
          align: "CENTER",
        });
        merges.push({
          mergeCells: {
            range: { sheetId, startRowIndex: filaInt, endRowIndex: filaInt + 1, startColumnIndex: colActual, endColumnIndex: colActual + 3 },
            mergeType: "MERGE_ALL",
          },
        });
        filaInt++;

        // Lista de ejecutivos
        const lista = camp.listaEjecutivos || [];
        for (const ej of lista) {
          const labelEj = camp.esMovil
            ? `${ej.nombre} (${ej.titulares || 0} Tit · ${ej.adicionales || 0} Adi)`
            : ej.nombre;
          fillRect(filaInt, filaInt + 1, colActual, colActual + 2, {
            val: labelEj,
            bg: "#FFFFFF",
            fg: "#202124",
            fontSize: 10,
            align: "LEFT",
          });
          merges.push({
            mergeCells: {
              range: { sheetId, startRowIndex: filaInt, endRowIndex: filaInt + 1, startColumnIndex: colActual, endColumnIndex: colActual + 2 },
              mergeType: "MERGE_ALL",
            },
          });
          setCell(filaInt, colActual + 2, ej.cantidad, {
            isNumber: true,
            bg: "#FFFFFF",
            fg: "#202124",
            bold: true,
            fontSize: 10,
            align: "RIGHT",
          });
          filaInt++;
        }

        // Pie de tarjeta con TOTAL (y desglose Tit · Adi si es móvil)
        const footerTxt = camp.esMovil
          ? `TOTAL: ${camp.total} (${camp.totalTitulares || 0} Tit · ${camp.totalAdicionales || 0} Adi)`
          : `TOTAL: ${camp.total}`;
        fillRect(filaInt, filaInt + 1, colActual, colActual + 3, {
          val: footerTxt,
          bg: cardColor,
          fg: "#FFFFFF",
          bold: true,
          fontSize: 10,
          align: "RIGHT",
        });
        merges.push({
          mergeCells: {
            range: { sheetId, startRowIndex: filaInt, endRowIndex: filaInt + 1, startColumnIndex: colActual, endColumnIndex: colActual + 3 },
            mergeType: "MERGE_ALL",
          },
        });

        borderReqs.push({
          updateBorders: {
            range: { sheetId, startRowIndex: cardStartRow, endRowIndex: filaInt + 1, startColumnIndex: colActual, endColumnIndex: colActual + 3 },
            top: solidBorder("#DADCE0"),
            bottom: solidBorder("#DADCE0"),
            left: solidBorder("#DADCE0"),
            right: solidBorder("#DADCE0"),
          },
        });

        if (filaInt + 1 > maxFilaEnBloque) maxFilaEnBloque = filaInt + 1;
        colActual += 4;
      });

      filaActual = maxFilaEnBloque + 2;
    }
  }

  ensureRow(Math.max(filaActual + 5, 40));
  const totalRows = Math.max(grid.length + 10, 120);

  return [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            hideGridlines: true,
            frozenRowCount: 0,
            rowCount: totalRows,
            columnCount: MAX_COLS,
          },
        },
        fields: "gridProperties.hideGridlines,gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    {
      unmergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: MAX_COLS },
      },
    },
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: MAX_COLS },
        fields: "userEnteredValue,userEnteredFormat,dataValidation",
      },
    },
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: grid.map((r) => ({ values: r })),
        fields: "userEnteredValue,userEnteredFormat",
      },
    },
    ...merges,
    ...borderReqs,
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 18 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 18 },
        properties: { pixelSize: 105 },
        fields: "pixelSize",
      },
    },
  ];
}

/**
 * Construye los requests de Google Sheets batchUpdate para dibujar
 * la pestaña visual "Pagos Adicionales" en tarjetas de 2 columnas por supervisor
 * e incluyendo la fila de "Totales" debajo del último ejecutivo.
 */
function buildVisualPaymentsRequests(reportInput = null, sheetId = PAGOS_ADICIONALES_SHEET_ID) {
  const report = reportInput || getPaymentsReport();
  const nombreMes = NOMBRES_MESES_CAP[report.mes] || "";
  const tituloMes = `${nombreMes} ${report.anio}`;

  const customSet = new Set();
  for (const s of report.tarjetasSupervisores || []) {
    for (const ini of s.customInitials || []) customSet.add(ini);
  }
  const anchoBloque = 13 + customSet.size;
  const MAX_COLS = Math.max(32, 4 + 2 * anchoBloque);

  const grid = [];
  const ensureRow = (r) => {
    while (grid.length <= r) {
      const row = [];
      for (let c = 0; c < MAX_COLS; c++) row.push({});
      grid.push(row);
    }
  };
  const setCell = (r, c, val, opts) => {
    ensureRow(r);
    if (c < MAX_COLS) grid[r][c] = makeCell(val, opts);
  };
  const fillRect = (r0, r1, c0, c1, opts) => {
    for (let r = r0; r < r1; r++) {
      ensureRow(r);
      for (let c = c0; c < c1; c++) {
        grid[r][c] = makeCell(r === r0 && c === c0 ? opts.val ?? "" : "", opts);
      }
    }
  };

  const merges = [];
  const borderReqs = [];

  // Título B2:L3 (0-based r: 1..3, c: 1..12)
  fillRect(1, 3, 1, 12, {
    val: `💰 Reporte de Pagos: ${tituloMes}`,
    fontSize: 20,
    bold: true,
    fg: "#333333",
    bg: "#FFFFFF",
    align: "LEFT",
  });
  merges.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 12 },
      mergeType: "MERGE_ALL",
    },
  });

  // Resumen global a la derecha
  const colRightStart = 2 + anchoBloque;
  fillRect(1, 3, colRightStart, colRightStart + 8, {
    val: `🌟 Total Pagos del Mes: $${Number(report.granTotalDinero || 0).toLocaleString("es-CL")}   |   Supervisores: ${(report.tarjetasSupervisores || []).length}`,
    fontSize: 11,
    bold: true,
    fg: "#1565C0",
    bg: "#F8FAFC",
    align: "CENTER",
  });
  merges.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: colRightStart, endColumnIndex: colRightStart + 8 },
      mergeType: "MERGE_ALL",
    },
  });
  borderReqs.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: colRightStart, endColumnIndex: colRightStart + 8 },
      top: solidBorder("#CBD5E1"),
      bottom: solidBorder("#CBD5E1"),
      left: solidBorder("#CBD5E1"),
      right: solidBorder("#CBD5E1"),
    },
  });

  let filaBase = 4; // 0-based (Fila 5)
  let alturaMaximaEnFila = 0;

  const sups = report.tarjetasSupervisores || [];
  sups.forEach((sup, index) => {
    const esColumnaIzquierda = index % 2 === 0;
    if (index > 0 && esColumnaIzquierda) {
      filaBase += alturaMaximaEnFila + 3;
      alturaMaximaEnFila = 0;
    }

    const colActual = esColumnaIzquierda ? 1 : 2 + anchoBloque; // 0-based: Col B (1) o Col P/Q (2 + anchoBloque)
    let filaLocal = filaBase;

    const columnas = [];
    columnas.push({ h: "Ejecutiva", v: (e) => e.nombre, t: () => "Totales", isNum: false, fmt: "@", align: "LEFT" });
    columnas.push({ h: "Paq", v: (e) => e.paq || 0, t: (tot) => tot.paq || 0, isNum: true, fmt: "0", align: "CENTER" });
    columnas.push({ h: "Fib", v: (e) => e.fib || 0, t: (tot) => tot.fib || 0, isNum: true, fmt: "0", align: "CENTER" });
    if (sup.mostrarClaro) {
      columnas.push({ h: "C/V", v: (e) => e.claroVtr || 0, t: (tot) => tot.claroVtr || 0, isNum: true, fmt: "0", align: "CENTER" });
    }
    if (sup.mostrarMovil) {
      columnas.push({ h: "E.M. Tit", v: (e) => e.emTit || 0, t: (tot) => tot.emTit || 0, isNum: true, fmt: "0", align: "CENTER" });
      columnas.push({ h: "E.M. Adi", v: (e) => e.emAdi || 0, t: (tot) => tot.emAdi || 0, isNum: true, fmt: "0", align: "CENTER" });
    }
    if (sup.mostrarPyme) {
      columnas.push({ h: "Pyme", v: (e) => e.pyme || 0, t: (tot) => tot.pyme || 0, isNum: true, fmt: "0", align: "CENTER" });
    }
    if (sup.mostrarPymeMovil) {
      columnas.push({ h: "P.M. Tit", v: (e) => e.pmTit || 0, t: (tot) => tot.pmTit || 0, isNum: true, fmt: "0", align: "CENTER" });
      columnas.push({ h: "P.M. Adi", v: (e) => e.pmAdi || 0, t: (tot) => tot.pmAdi || 0, isNum: true, fmt: "0", align: "CENTER" });
    }
    if (sup.mostrarAA) {
      columnas.push({ h: "A&A", v: (e) => e.aa || 0, t: (tot) => tot.aa || 0, isNum: true, fmt: "0", align: "CENTER" });
    }
    for (const ini of sup.customInitials || []) {
      columnas.push({
        h: ini,
        v: (e) => (e.customCounts && e.customCounts[ini]) || 0,
        t: (tot) => (tot.customCounts && tot.customCounts[ini]) || 0,
        isNum: true,
        fmt: "0",
        align: "CENTER",
      });
    }
    columnas.push({ h: "$ Paq", v: (e) => e.dineroPaq || 0, t: (tot) => tot.dineroPaq || 0, isNum: true, fmt: "$#,##0", align: "RIGHT" });
    columnas.push({ h: "$ Fib", v: (e) => e.dineroFib || 0, t: (tot) => tot.dineroFib || 0, isNum: true, fmt: "$#,##0", align: "RIGHT" });
    if (sup.mostrarClaro) {
      columnas.push({ h: "$ C/V", v: (e) => e.dineroClaro || 0, t: (tot) => tot.dineroClaro || 0, isNum: true, fmt: "$#,##0", align: "RIGHT" });
    }
    columnas.push({
      h: "$ Total",
      v: (e) => e.dineroTotal || 0,
      t: (tot) => tot.dineroTotal || 0,
      isNum: true,
      fmt: "$#,##0",
      align: "RIGHT",
      destacar: true,
    });

    const totalCols = columnas.length;

    // 1. Encabezado Azul de la Tarjeta del Supervisor
    fillRect(filaLocal, filaLocal + 1, colActual, colActual + totalCols, {
      val: `👤  ${sup.supervisor}`,
      bg: "#1976D2",
      fg: "#FFFFFF",
      bold: true,
      fontSize: 12,
      align: "LEFT",
    });
    merges.push({
      mergeCells: {
        range: { sheetId, startRowIndex: filaLocal, endRowIndex: filaLocal + 1, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
        mergeType: "MERGE_ALL",
      },
    });
    borderReqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: filaLocal, endRowIndex: filaLocal + 1, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
        top: solidBorder("#1565C0", "SOLID_MEDIUM"),
        bottom: solidBorder("#1565C0", "SOLID_MEDIUM"),
        left: solidBorder("#1565C0", "SOLID_MEDIUM"),
        right: solidBorder("#1565C0", "SOLID_MEDIUM"),
      },
    });
    filaLocal++;

    // 2. Cabeceras de columna (#ECEFF1)
    columnas.forEach((c, ci) => {
      setCell(filaLocal, colActual + ci, c.h, {
        bg: "#ECEFF1",
        fg: "#37474F",
        bold: true,
        fontSize: 10,
        align: "CENTER",
      });
    });
    borderReqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: filaLocal, endRowIndex: filaLocal + 1, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
        bottom: solidBorder("#CFD8DC", "SOLID"),
      },
    });
    filaLocal++;

    // 3. Filas de Ejecutivos
    const ejecutivos = sup.ejecutivos || [];
    const dataStartRow = filaLocal;
    ejecutivos.forEach((exec, rowIdx) => {
      const bg = rowIdx % 2 !== 0 ? "#FAFAFA" : "#FFFFFF";
      columnas.forEach((c, ci) => {
        const val = c.v(exec);
        setCell(filaLocal, colActual + ci, val, {
          isNumber: c.isNum,
          bg,
          fg: c.destacar ? "#1565C0" : "#212121",
          bold: Boolean(c.destacar),
          fontSize: 10,
          align: c.align,
          numberFormat: c.isNum ? { type: c.fmt.includes("$") ? "CURRENCY" : "NUMBER", pattern: c.fmt } : undefined,
        });
      });
      filaLocal++;
    });

    if (ejecutivos.length > 0) {
      borderReqs.push({
        updateBorders: {
          range: { sheetId, startRowIndex: dataStartRow, endRowIndex: filaLocal, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
          innerHorizontal: solidBorder("#F0F0F0", "SOLID"),
          innerVertical: solidBorder("#F0F0F0", "SOLID"),
        },
      });
    }

    // 4. Fila de Totales abajo del último ejecutivo
    const tot = sup.totales || {
      paq: ejecutivos.reduce((a, e) => a + (e.paq || 0), 0),
      fib: ejecutivos.reduce((a, e) => a + (e.fib || 0), 0),
      claroVtr: ejecutivos.reduce((a, e) => a + (e.claroVtr || 0), 0),
      emTit: ejecutivos.reduce((a, e) => a + (e.emTit || 0), 0),
      emAdi: ejecutivos.reduce((a, e) => a + (e.emAdi || 0), 0),
      pyme: ejecutivos.reduce((a, e) => a + (e.pyme || 0), 0),
      pmTit: ejecutivos.reduce((a, e) => a + (e.pmTit || 0), 0),
      pmAdi: ejecutivos.reduce((a, e) => a + (e.pmAdi || 0), 0),
      aa: ejecutivos.reduce((a, e) => a + (e.aa || 0), 0),
      customCounts: {},
      dineroPaq: ejecutivos.reduce((a, e) => a + (e.dineroPaq || 0), 0),
      dineroFib: ejecutivos.reduce((a, e) => a + (e.dineroFib || 0), 0),
      dineroClaro: ejecutivos.reduce((a, e) => a + (e.dineroClaro || 0), 0),
      dineroTotal: sup.subtotalDinero || ejecutivos.reduce((a, e) => a + (e.dineroTotal || 0), 0),
    };

    columnas.forEach((c, ci) => {
      const val = c.t(tot);
      setCell(filaLocal, colActual + ci, val, {
        isNumber: c.isNum,
        bg: "#E3F2FD",
        fg: c.fmt.includes("$") ? "#1565C0" : "#0F172A",
        bold: true,
        fontSize: 10,
        align: c.align,
        numberFormat: c.isNum ? { type: c.fmt.includes("$") ? "CURRENCY" : "NUMBER", pattern: c.fmt } : undefined,
      });
    });
    borderReqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: filaLocal, endRowIndex: filaLocal + 1, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
        top: solidBorder("#90A4AE", "SOLID_MEDIUM"),
        bottom: solidBorder("#1565C0", "SOLID_MEDIUM"),
        innerVertical: solidBorder("#CFD8DC", "SOLID"),
      },
    });
    filaLocal++;

    // Borde exterior de la tabla de ejecutivos + totales
    borderReqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: filaBase + 1, endRowIndex: filaLocal, startColumnIndex: colActual, endColumnIndex: colActual + totalCols },
        top: solidBorder("#E0E0E0", "SOLID"),
        bottom: solidBorder("#1565C0", "SOLID_MEDIUM"),
        left: solidBorder("#E0E0E0", "SOLID"),
        right: solidBorder("#E0E0E0", "SOLID"),
      },
    });

    const alturaBloque = filaLocal - filaBase;
    if (alturaBloque > alturaMaximaEnFila) {
      alturaMaximaEnFila = alturaBloque;
    }
  });

  ensureRow(Math.max(filaBase + alturaMaximaEnFila + 6, 45));
  const totalRows = Math.max(grid.length + 10, 120);

  return [
    {
      clearBasicFilter: { sheetId },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            hideGridlines: true,
            frozenRowCount: 3,
            rowCount: totalRows,
            columnCount: MAX_COLS,
          },
        },
        fields: "gridProperties.hideGridlines,gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    {
      unmergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: MAX_COLS },
      },
    },
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: MAX_COLS },
        fields: "userEnteredValue,userEnteredFormat,dataValidation",
      },
    },
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: grid.map((r) => ({ values: r })),
        fields: "userEnteredValue,userEnteredFormat",
      },
    },
    ...merges,
    ...borderReqs,
    // Anchos de columna (A: margen 15px, B: Ejecutiva 150px, C..: 72px, margen central 18px, Ejecutiva der 150px, resto 72px)
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 16 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 155 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 1 + anchoBloque },
        properties: { pixelSize: 72 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1 + anchoBloque, endIndex: 2 + anchoBloque },
        properties: { pixelSize: 18 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 2 + anchoBloque, endIndex: 3 + anchoBloque },
        properties: { pixelSize: 155 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 3 + anchoBloque, endIndex: 2 + 2 * anchoBloque },
        properties: { pixelSize: 72 },
        fields: "pixelSize",
      },
    },
  ];
}

function buildVisualSheetsBatchRequests(opts = {}) {
  const dailySummary = getDailySummary(opts.fecha || null);
  const paymentsSnap = buildPaymentsSnapshot(opts.mes ?? null, opts.anio ?? null);
  return {
    dailySummary,
    paymentsSnap,
    requests: [
      ...buildVisualDailyRequests(dailySummary, VENTAS_DEL_DIA_SHEET_ID),
      ...buildVisualPaymentsRequests(paymentsSnap.report, PAGOS_ADICIONALES_SHEET_ID),
    ],
  };
}

function notificarSheetsN8n(eventType, data = {}) {
  const targetUrl =
    process.env.FENIX_IS_TEST === "1"
      ? process.env.FENIX_TEST_SHEETS_WEBHOOK_URL || ""
      : N8N_SHEETS_WEBHOOK_URL;
  if (!targetUrl) return;

  try {
    const companies = getAllCompanies();
    const company =
      data.company ||
      (data.sale && companies.find((c) => c.slug === data.sale.company_slug)) ||
      null;

    const sale = data.sale || null;
    const prevSale = data.prevSale || sale || {};
    const matchKey = data.matchKey || {
      id_orden: String(prevSale.id_orden || sale?.id_orden || "").trim(),
      rut: String(prevSale.rut || sale?.rut || "").trim(),
      fecha: String(prevSale.fecha || sale?.fecha || "").trim(),
    };

    const row =
      sale && company && eventType !== "sale.deleted"
        ? buildSaleRowForSheets(sale, company)
        : null;

    const visual = buildVisualSheetsBatchRequests({
      fecha: sale?.fecha || null,
    });

    const payload = {
      source: "fenix_crm",
      event: eventType,
      timestamp: new Date().toISOString(),
      spreadsheetId: SPREADSHEET_ID,
      company: company
        ? {
            slug: company.slug,
            nombre: company.nombre,
            hoja: company.hoja,
            sheetId: COMPANY_SHEET_IDS[company.hoja] || null,
            columnas: (company.columnas || [])
              .filter((c) => c && c.key !== "hoja_origen")
              .map((c) => ({ key: c.key, label: c.label, type: c.type || "text" })),
          }
        : null,
      sale: sale || null,
      matchKey,
      row,
      payments: {
        mes: visual.paymentsSnap.mes,
        anio: visual.paymentsSnap.anio,
        periodo: visual.paymentsSnap.periodo,
        granTotalDinero: visual.paymentsSnap.granTotalDinero,
        rows: visual.paymentsSnap.rows,
      },
      visualBatchRequests: visual.requests,
    };

    fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.warn("Aviso: no se pudo sincronizar con Google Sheets n8n:", err.message);
    });
  } catch (err) {
    console.warn("Aviso al preparar payload para Google Sheets n8n:", err.message);
  }
}

module.exports = {
  SPREADSHEET_ID,
  VENTAS_DEL_DIA_SHEET_ID,
  PAGOS_ADICIONALES_SHEET_ID,
  COMPANY_SHEET_IDS,
  NOMBRES_MESES_CAP,
  NOMBRES_MESES_UPPER,
  COLORES_MESES,
  hexToRgb,
  makeCell,
  solidBorder,
  buildSaleRowForSheets,
  buildPaymentsSnapshot,
  buildVisualDailyRequests,
  buildVisualPaymentsRequests,
  buildVisualSheetsBatchRequests,
  notificarSheetsN8n,
};
