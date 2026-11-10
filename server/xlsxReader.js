// ============================================================================
// FENIX CRM - LECTOR NATIVO DE ARCHIVOS EXCEL (.XLSX) MULTI-HOJA (CERO DEPS)
// Soporta directamente "Archivo -> Descargar -> Microsoft Excel (.xlsx)" de Google Sheets
// ============================================================================
const zlib = require("node:zlib");

function decodeXmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unzipBufferEntries(buf) {
  // Buscar End of Central Directory (0x06054b50) desde el final
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("El archivo no es un Excel (.xlsx) válido.");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const files = new Map();

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const fileName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");

    if (localHeaderOffset + 30 <= buf.length && buf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const rawSlice = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) {
        files.set(fileName, rawSlice);
      } else if (method === 8) {
        files.set(fileName, zlib.inflateRawSync(rawSlice));
      }
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

function colLettersToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function excelSerialToDateString(serial) {
  const days = Math.floor(serial);
  if (days < 20000 || days > 65000) return String(serial);
  // Excel epoch: 1899-12-30 UTC
  const utcMs = Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(utcMs);
  return (
    String(d.getUTCDate()).padStart(2, "0") +
    "/" +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    "/" +
    d.getUTCFullYear()
  );
}

function parseDateStyles(stylesXml) {
  const dateStyleIndexes = new Set();
  if (!stylesXml) return dateStyleIndexes;

  const customNumFmts = new Map();
  const numFmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m;
  while ((m = numFmtRe.exec(stylesXml)) !== null) {
    customNumFmts.set(Number(m[1]), decodeXmlEntities(m[2]));
  }

  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsMatch) return dateStyleIndexes;

  const xfRe = /<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g;
  let idx = 0;
  while ((m = xfRe.exec(cellXfsMatch[1])) !== null) {
    const attrs = m[1];
    const idMatch = attrs.match(/numFmtId="(\d+)"/);
    const fmtId = idMatch ? Number(idMatch[1]) : 0;
    const isBuiltInDate = (fmtId >= 14 && fmtId <= 22) || (fmtId >= 45 && fmtId <= 47);
    let isCustomDate = false;
    if (customNumFmts.has(fmtId)) {
      const code = customNumFmts.get(fmtId).replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
      if (/[dmyDMY]/.test(code) && !/[#0]/.test(code)) {
        isCustomDate = true;
      }
    }
    if (isBuiltInDate || isCustomDate) {
      dateStyleIndexes.add(idx);
    }
    idx++;
  }
  return dateStyleIndexes;
}

function parseSharedStrings(xml) {
  const strings = [];
  if (!xml) return strings;
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let parts = "";
    let tm;
    while ((tm = tRe.exec(inner)) !== null) {
      parts += decodeXmlEntities(tm[1]);
    }
    strings.push(parts);
  }
  return strings;
}

function parseWorksheetXml(xml, sharedStrings, dateStyles) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowContent = rm[1];
    const rowArr = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let nextCol = 0;
    while ((cm = cellRe.exec(rowContent)) !== null) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);

      // Si existe la referencia de la letra (ej. L2, M2), usamos esa columna exacta.
      // Si no existe, usamos nextCol.
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextCol;

      // Asegurar que nextCol avanza correctamente basado en la celda actual
      nextCol = colIdx + 1;

      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const styleMatch = attrs.match(/\bs="(\d+)"/);
      const cellType = typeMatch ? typeMatch[1] : "";
      const styleIdx = styleMatch ? Number(styleMatch[1]) : -1;

      let val = "";
      if (cellType === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRe.exec(inner)) !== null) val += decodeXmlEntities(tm[1]);
      } else {
        const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : "";
        if (cellType === "s") {
          val = sharedStrings[Number(rawV)] ?? "";
        } else if (cellType === "b") {
          val = rawV === "1" ? "TRUE" : "FALSE";
        } else if (cellType === "str" || cellType === "e") {
          val = rawV;
        } else if (rawV !== "") {
          const num = Number(rawV);
          if (!Number.isNaN(num) && dateStyles.has(styleIdx)) {
            val = excelSerialToDateString(num);
          } else {
            val = rawV;
          }
        }
      }

      // Rellenamos el array con strings vacíos hasta llegar a la posición exacta de esta celda
      while (rowArr.length < colIdx) rowArr.push("");
      rowArr[colIdx] = val;
    }
    rows.push(rowArr);
  }
  return rows;
}

function parseXlsxBuffer(buffer) {
  const files = unzipBufferEntries(buffer);
  const getText = (p) => (files.has(p) ? files.get(p).toString("utf8") : "");

  const workbookXml = getText("xl/workbook.xml");
  const relsXml = getText("xl/_rels/workbook.xml.rels");
  if (!workbookXml) throw new Error("No se encontró xl/workbook.xml dentro del archivo .xlsx.");

  const relMap = new Map();
  const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = relRe.exec(relsXml)) !== null) {
    let target = m[2].replace(/^\/+/, "");
    if (!target.startsWith("xl/")) target = "xl/" + target;
    relMap.set(m[1], target);
  }

  const sharedStrings = parseSharedStrings(getText("xl/sharedStrings.xml"));
  const dateStyles = parseDateStyles(getText("xl/styles.xml"));

  const sheets = {};
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  while ((m = sheetRe.exec(workbookXml)) !== null) {
    const attrs = m[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const rIdMatch = attrs.match(/\br:id="([^"]+)"/);
    if (!nameMatch || !rIdMatch) continue;
    const sheetName = decodeXmlEntities(nameMatch[1]);
    const targetPath = relMap.get(rIdMatch[1]);
    if (targetPath && files.has(targetPath)) {
      sheets[sheetName] = parseWorksheetXml(getText(targetPath), sharedStrings, dateStyles);
    }
  }

  return sheets;
}

module.exports = { parseXlsxBuffer };

