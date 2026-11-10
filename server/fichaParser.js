// ============================================================================
// FENIX CRM - MOTOR INTELIGENTE DE FICHAS, DIRECCIONES, FECHAS Y ANTI-DUPLICADOS
// ============================================================================

function normalizarTexto(txt) {
  return String(txt || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function darFormatoNombre(nombre) {
  if (!nombre) return "";
  return String(nombre)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
    .join(" ");
}

function formatearRut(rut) {
  if (!rut) return "";
  const valor = String(rut).replace(/[^0-9kK]/g, "").toUpperCase();
  if (valor.length <= 1) return valor;
  const cuerpo = valor.slice(0, -1);
  const dv = valor.slice(-1);
  return `${cuerpo}-${dv}`;
}

function limpiarRutComparacion(rut) {
  return String(rut || "").toUpperCase().replace(/[^0-9K]/g, "");
}

function limpiarValorCampoFicha(val) {
  if (!val) return "";
  let v = String(val)
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s:"'\-]+|[\s,"'\-]+$/g, "")
    .replace(/^(?:de\s+|a\s+)?in(?:st|at|t|s)?al?aci[oó]n\s*[:\-]+\s*/i, "")
    .replace(/^limpia\s*[:\-]+\s*/i, "")
    .trim();
  v = v
    .replace(
      /\s+(?:comuna|regi[oó]n|rut(?:\s+cliente)?|nombre(?:\s+completo)?|correo(?:\s+electr[oó]nico)?|tel[eé]fonos?(?:\s+contacto)?|servicios?\s+a\s+contratar|c[oó]digo\s+de\s+biometr[ií]a)\s*:.*$/i,
      ""
    )
    .trim();
  return v.replace(/^[\s:"'\-]+|[\s,"'\-]+$/g, "").trim();
}

function extraerTelefonosSeguro(rawText) {
  if (!rawText) return [];
  let text = String(rawText).replace(/\+56/g, " ");
  text = text
    .replace(/[\/|,\n\r;]/g, "|")
    .replace(/\by\b/gi, "|")
    .replace(/[A-Za-zÁÉÍÓÚÑáéíóúñ:()\-]+/g, "|");
  const parts = text.split("|");
  let phones = [];
  for (const p of parts) {
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 16) {
      const chunks = digits.match(/\d{8,9}/g) || [];
      phones = phones.concat(chunks);
    } else if (digits.length >= 8 && digits.length <= 11) {
      phones.push(digits.length === 11 && digits.startsWith("56") ? digits.slice(2) : digits);
    }
  }
  return [...new Set(phones)];
}

/**
 * Extrae dirección priorizando:
 *  1) DIRECCIÓN DE INSTALACIÓN (incluye typos como INATALACION, INSTALCION, A INSTALAR)
 *  2) DIRECCIÓN / DOMICILIO general (excluyendo DIRECCIÓN LIMPIA / DONANTE / TENENCIA)
 *  3) DIRECCIÓN LIMPIA (último recurso)
 */
function extraerDireccionDeFicha(fichaText, datosExtra = null) {
  const blobs = Array.isArray(fichaText) ? fichaText : fichaText ? [String(fichaText)] : [];
  let dirInstalacion = "";
  let dirGeneral = "";
  let dirLimpia = "";

  for (const blob of blobs) {
    if (!blob) continue;
    const lineas = String(blob).split(/\r?\n/);
    for (let idx = 0; idx < lineas.length; idx++) {
      const linea = lineas[idx].trim();
      if (!linea) continue;

      const mInst = linea.match(
        /^(?:[\*\-•]\s*)?(?:direcci[oó]n|dir\.?|domicilio)\s*(?:de\s*|a\s*)?(?:in(?:st|at|t|s)?al?aci[oó]n|instalar|final|cliente|hogar)\s*[:\-]+(.*)$/i
      );
      if (mInst) {
        let cand = limpiarValorCampoFicha(mInst[1]);
        if (!cand && idx + 1 < lineas.length && !/^[A-ZÁÉÍÓÚÑ\s]{3,30}:/.test(lineas[idx + 1].trim())) {
          cand = limpiarValorCampoFicha(lineas[idx + 1]);
        }
        if (cand && !dirInstalacion) dirInstalacion = cand;
        continue;
      }

      const mLimpia = linea.match(
        /^(?:[\*\-•]\s*)?(?:direcci[oó]n|dir\.?)\s*(?:limpia|tenencia|donante)\s*[:\-]+(.*)$/i
      );
      if (mLimpia) {
        let cand = limpiarValorCampoFicha(mLimpia[1]);
        if (!cand && idx + 1 < lineas.length && !/^[A-ZÁÉÍÓÚÑ\s]{3,30}:/.test(lineas[idx + 1].trim())) {
          cand = limpiarValorCampoFicha(lineas[idx + 1]);
        }
        if (cand && !dirLimpia) dirLimpia = cand;
        continue;
      }

      const mGen = linea.match(
        /^(?:[\*\-•]\s*)?(?:direcci[oó]n|domicilio|calle(?:\s+y\s+n[uú]mero)?)\s*[:\-]+(.*)$/i
      );
      if (mGen) {
        const rawRest = String(mGen[1] || "").trim();
        if (/^(?:de\s+|a\s+)?in(?:st|at|t|s)?al?aci[oó]n\s*[:\-]/i.test(rawRest)) {
          const candInst = limpiarValorCampoFicha(rawRest);
          if (candInst && !dirInstalacion) dirInstalacion = candInst;
          continue;
        }
        if (/^(?:limpia|tenencia|donante)\s*[:\-]/i.test(rawRest)) {
          const candLimpia = limpiarValorCampoFicha(rawRest);
          if (candLimpia && !dirLimpia) dirLimpia = candLimpia;
          continue;
        }
        let cand = limpiarValorCampoFicha(rawRest);
        if (!cand && idx + 1 < lineas.length && !/^[A-ZÁÉÍÓÚÑ\s]{3,30}:/.test(lineas[idx + 1].trim())) {
          cand = limpiarValorCampoFicha(lineas[idx + 1]);
        }
        if (cand && !dirGeneral) dirGeneral = cand;
      }
    }
  }

  if (dirInstalacion) return { direccion: dirInstalacion, direccionLimpia: dirLimpia, fuente: "instalacion" };
  if (dirGeneral) return { direccion: dirGeneral, direccionLimpia: dirLimpia, fuente: "general" };

  if (datosExtra) {
    for (const k of ["direccion", "direccion_instalacion", "domicilio"]) {
      if (datosExtra[k] && !String(datosExtra[k]).includes("\n")) {
        const cand = limpiarValorCampoFicha(datosExtra[k]);
        if (cand) return { direccion: cand, direccionLimpia: dirLimpia, fuente: "campo" };
      }
    }
  }

  return { direccion: dirLimpia || "", direccionLimpia: dirLimpia || "", fuente: dirLimpia ? "limpia" : "vacia" };
}

function normalizarDireccionComparacion(dir) {
  if (!dir) return "";
  return normalizarTexto(limpiarValorCampoFicha(dir))
    .replace(/\b(n°|nro|num|numero)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sonDireccionesIguales(dirA, dirB) {
  const normA = normalizarDireccionComparacion(dirA);
  const normB = normalizarDireccionComparacion(dirB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const numsA = (normA.match(/\d+/g) || []).join("|");
  const numsB = (normB.match(/\d+/g) || []).join("|");
  if (numsA && numsB && numsA !== numsB) return false;

  const limpiarVia = (s) =>
    s
      .replace(
        /\b(calle|pasaje|psje|pje|avenida|avda|av|casa|depto|departamento|block|villa|poblacion|sector|parcela|sitio)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
  const baseA = limpiarVia(normA);
  const baseB = limpiarVia(normB);
  return !!(baseA && baseB && baseA === baseB);
}

function extraerCodigoBiometriaDeFicha(fichaText) {
  if (!fichaText) return "";
  const texto = Array.isArray(fichaText) ? fichaText.join("\n") : String(fichaText);
  const mBio = texto.match(
    /(?:c[oó]digo\s*(?:de\s*)?biometr[ií]a|biometr[ií]a|id\s*(?:de\s*)?orden|n[uú]mero\s*(?:de\s*)?petici[oó]n|n[°º]\s*petici[oó]n)\s*[:\-]+\s*([^\r\n]+)/i
  );
  if (mBio && mBio[1]) {
    const limpio = limpiarValorCampoFicha(mBio[1]).toUpperCase().replace(/\s+/g, "");
    if (limpio.length >= 3 && !/^(SI|NO|OK|PENDIENTE|SIN|N\/A)$/i.test(limpio)) return limpio;
  }
  const mBo = texto.match(/\bBO\s*N[°º]?\s*[A-Z0-9\-]{3,}/i);
  if (mBo) return mBo[0].toUpperCase().replace(/\s+/g, "");
  return "";
}

function extraerFechaSegura(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return { dia: val.getDate(), mes: val.getMonth(), anio: val.getFullYear() };
  }
  const str = String(val).trim();
  const mIso = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (mIso) {
    return { dia: parseInt(mIso[3], 10), mes: parseInt(mIso[2], 10) - 1, anio: parseInt(mIso[1], 10) };
  }
  const mLat = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mLat) {
    let anio = parseInt(mLat[3], 10);
    if (anio < 100) anio += 2000;
    return { dia: parseInt(mLat[1], 10), mes: parseInt(mLat[2], 10) - 1, anio };
  }
  return null;
}

function formatearFechaISOaLatina(val) {
  const f = extraerFechaSegura(val);
  if (!f) {
    const hoy = new Date();
    return (
      String(hoy.getDate()).padStart(2, "0") +
      "/" +
      String(hoy.getMonth() + 1).padStart(2, "0") +
      "/" +
      hoy.getFullYear()
    );
  }
  return String(f.dia).padStart(2, "0") + "/" + String(f.mes + 1).padStart(2, "0") + "/" + f.anio;
}

function fechaAClaveOrden(val) {
  const f = extraerFechaSegura(val);
  if (!f) return 0;
  return f.anio * 10000 + (f.mes + 1) * 100 + f.dia;
}

function extraerFechaVentaDeFicha(fichaText, fechaDefault) {
  if (!fichaText) return fechaDefault;
  const lineas = String(fichaText).split(/\r?\n/);
  for (const linea of lineas) {
    const l = linea.trim();
    if (!l) continue;
    if (/ciclo|instalaci[oó]n|horario|nacimiento|entrega|agenda|vencimiento|pago/i.test(l)) continue;
    const m = l.match(
      /^(?:[\*\-•]\s*)?fecha(?:\s+de\s+venta|\s+venta|\s+ingreso|\s+real)?\s*[:\-]+\s*(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/i
    );
    if (m) {
      const d = parseInt(m[1], 10);
      const mes = parseInt(m[2], 10);
      let anio = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      if (anio < 100) anio += 2000;
      if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && anio >= 2020 && anio <= 2035) {
        return `${String(d).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${anio}`;
      }
    }
  }
  return fechaDefault;
}

/**
 * Extrae teléfonos distinguiendo explícitamente:
 *  - Número Principal (Titular)
 *  - Números Adicionales (líneas adicionales en portabilidad / venta móvil, incluso en múltiples líneas)
 */
function extraerTelefonosDetalladosDeFicha(texto) {
  let blobPrincipal = "";
  let blobAdicional = "";

  // Captura bloques etiquetados (incluyendo listas multi-línea debajo de ADICIONALES:)
  const regexBloques =
    /(?:^|\n)\s*(?:[\*\-•]\s*)?((?:tel[eé]fonos?|celular(?:es)?|fono|n[uú]meros?|l[ií]neas?|portar|titular|principal|adicional(?:es)?)[^:\r\n]{0,35}):\s*([\s\S]*?)(?=\n\s*(?:[\*\-•]\s*)?[A-Za-zÁÉÍÓÚÑáéíóúñ\s\.°º]{2,38}:|\n*$)/gi;

  let m;
  while ((m = regexBloques.exec(texto)) !== null) {
    const labelNorm = normalizarTexto(m[1] || "");
    const valorRaw = String(m[2] || "").trim();
    if (!valorRaw) continue;
    // Ignorar etiquetas que no son teléfonos (ej. "Número de petición", "Nombre titular")
    if (
      labelNorm.includes("peticion") ||
      labelNorm.includes("orden") ||
      labelNorm.includes("biometria") ||
      labelNorm.includes("nombre") ||
      labelNorm.includes("rut") ||
      labelNorm.includes("serie") ||
      labelNorm.includes("carnet")
    ) {
      continue;
    }
    if (labelNorm.includes("adicional")) {
      blobAdicional += " | " + valorRaw;
    } else {
      blobPrincipal += " | " + valorRaw;
    }
  }

  let telsPrin = extraerTelefonosSeguro(blobPrincipal);
  let telsAdic = extraerTelefonosSeguro(blobAdicional);

  if (telsPrin.length === 0 && telsAdic.length === 0) {
    const posiblesCel = texto.match(/(?:\+?56\s*)?9[\s\d]{7,10}/g) || [];
    telsPrin = extraerTelefonosSeguro(posiblesCel.join(" | "));
  }

  let numeroPrincipal = "";
  let listaAdicionales = [];

  if (telsPrin.length > 0) {
    numeroPrincipal = telsPrin[0];
    // Cualquier segundo/tercer número en teléfonos generales + los etiquetados como adicionales
    listaAdicionales = [...telsPrin.slice(1), ...telsAdic].filter((n) => n && n !== numeroPrincipal);
  } else if (telsAdic.length > 0) {
    numeroPrincipal = telsAdic[0];
    listaAdicionales = telsAdic.slice(1);
  }

  listaAdicionales = [...new Set(listaAdicionales)];
  const todos = [numeroPrincipal, ...listaAdicionales].filter(Boolean);

  return {
    todos,
    numeroPrincipal,
    listaAdicionales,
    adicionales: listaAdicionales.join(" | "),
    telefonoContacto: todos.join(" / "),
    cantTitular: numeroPrincipal ? 1 : 0,
    cantAdicional: listaAdicionales.length,
  };
}

/**
 * Extrae absolutamente todos los campos clave de una ficha de texto libre (Hogar, Tenencia, Pyme o Móvil).
 * Se usa tanto en el servidor como en la vista previa en vivo del Formulario Propio.
 */
function parsearFichaCompleta(fichaText, fechaDefault = null) {
  // Normaliza etiquetas escritas con punto en vez de dos puntos ("Direccion. X", "Comuna. X")
  const texto = String(fichaText || "").replace(
    /^(\s*(?:[\*\-•]\s*)?(?:direcci[oó]n(?:\s+de\s+instalaci[oó]n)?|comuna|ciudad|rut(?:\s+cliente)?|nombre(?:\s+del\s+cliente)?|correo|plan(?:\s+que\s+solicita)?))\s*\.\s+(?=\S)/gim,
    "$1: "
  );
  const dirInfo = extraerDireccionDeFicha([texto], null);
  const codigoBiometria = extraerCodigoBiometriaDeFicha(texto);
  const fechaDetectada = extraerFechaVentaDeFicha(texto, fechaDefault || formatearFechaISOaLatina(new Date()));

  const buscarCampo = (regexEtiquetas, modo = "primero") => {
    const regex = new RegExp(
      `(?:^|\\n)\\s*(?:[\\*\\-•]\\s*)?(${regexEtiquetas})[^:\\r\\n]*:\\s*([\\s\\S]*?)(?=\\n\\s*[^:\\n]{2,40}:|\\n*$)`,
      "ig"
    );
    const matches = [];
    let m;
    while ((m = regex.exec(texto)) !== null) {
      const label = String(m[1] || "").trim().toUpperCase();
      const val = limpiarValorCampoFicha(m[2]);
      const pareceOtro = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,35}:\s*\S/.test(val);
      if (val && !pareceOtro) {
        matches.push({ label, val });
      }
    }
    if (matches.length === 0) return "";
    if (modo === "ultimo") return matches[matches.length - 1].val;
    return matches[0].val;
  };

  // RUT
  let rut = buscarCampo("rut(?:\\s+cliente|\\s+titular|\\s+empresa)?|run", "primero");
  if (!rut) {
    const mRutLibre = texto.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}[\-][0-9kK]|\d{7,8}[\-][0-9kK])\b/);
    if (mRutLibre) rut = mRutLibre[1];
  }
  rut = formatearRut(rut);

  // Nombre del cliente (ignorando Nombre Ejecutivo / Vendedor / Número Titular)
  let nombreCliente = "";
  {
    const regexNom =
      /(?:^|\n)\s*(?:[\*\-•]\s*)?(nombre\s+completo\s+del\s+cliente|nombre\s+del\s+cliente|nombre\s+cliente|nombre\s+completo|raz[oó]n\s+social|cliente|nombre)[^:\r\n]*:\s*([^\r\n]+)/gi;
    let m;
    while ((m = regexNom.exec(texto)) !== null) {
      const lbl = String(m[1] || "");
      if (/ejecutiv|vendedor|supervisor|asesor/i.test(lbl)) continue;
      const v = limpiarValorCampoFicha(m[2]);
      if (v && !/^[A-ZÁÉÍÓÚÑ\s]{3,30}:/.test(v) && !/^\+?\d[\d\s\-]{6,}$/.test(v)) {
        nombreCliente = v;
        break;
      }
    }
  }

  // Comuna (última ocurrencia para respetar la comuna de instalación en Con Tenencia)
  const comuna = buscarCampo("comuna|ciudad", "ultimo");
  const region = buscarCampo("regi[oó]n", "ultimo");

  // Correo
  let correo = buscarCampo("correo(?:\\s+electr[oó]nico)?|e-?mail|mail", "primero");
  if (!correo) {
    const mMail = texto.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (mMail) correo = mMail[0];
  }

  // Teléfonos detallados (Titular + Adicionales separados)
  const telInfo = extraerTelefonosDetalladosDeFicha(texto);

  // Servicio / Plan
  let servicio = buscarCampo(
    "servicios?(?:\\s+a\\s+contratar)?|plan(?:\\s+solicitado|\\s+a\\s+contratar)?|velocidad|paquete|promoci[oó]n",
    "primero"
  );
  servicio = servicio.replace(/^S\s*:\s*["']?/i, "").trim();

  return {
    fecha: fechaDetectada,
    rut,
    nombreCliente,
    direccion: dirInfo.direccion,
    direccionLimpia: dirInfo.direccionLimpia,
    fuenteDireccion: dirInfo.fuente,
    comuna,
    region,
    correo,
    telefonoContacto: telInfo.telefonoContacto,
    numeroPrincipal: telInfo.numeroPrincipal,
    adicionales: telInfo.adicionales,
    cantTitular: telInfo.cantTitular,
    cantAdicional: telInfo.cantAdicional,
    servicio,
    codigoBiometria,
  };
}

module.exports = {
  normalizarTexto,
  darFormatoNombre,
  formatearRut,
  limpiarRutComparacion,
  limpiarValorCampoFicha,
  extraerTelefonosSeguro,
  extraerTelefonosDetalladosDeFicha,
  extraerDireccionDeFicha,
  normalizarDireccionComparacion,
  sonDireccionesIguales,
  extraerCodigoBiometriaDeFicha,
  extraerFechaSegura,
  formatearFechaISOaLatina,
  fechaAClaveOrden,
  extraerFechaVentaDeFicha,
  parsearFichaCompleta,
};

