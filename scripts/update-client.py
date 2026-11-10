from pathlib import Path
p=Path('public/app.js'); s=p.read_text(encoding='utf-8')
s=s.replace('  const headers = {\n    "Content-Type": "application/json",','  const headers = {\n    ...requestHeaders(),\n    "Content-Type": "application/json",',1)
s=s.replace('        email,\n      }),','        email,\n        password: document.getElementById("gatePassword").value,\n      }),',1)
s=s.replace('      state.userEmail = email;', '      sessionStorage.setItem("fenix_session", data.token);\n      document.getElementById("gatePassword").value = "";\n      state.userEmail = email;',1)
s=s.replace('      await loadBootstrap();\n      switchTab("hojas");', '      await loadBootstrap();\n      setupSSE();\n      switchTab("hojas");',1)
s=s.replace('async function logoutEmailSession() {', '''async function logoutEmailSession() {
  await fetch('/api/auth/logout', { method: 'POST', headers: requestHeaders() });
  sessionStorage.removeItem('fenix_session');
  state.eventSource?.close();''')
a=s.index('  // --- INICIO DEL FILTRO PARA EL FORMULARIO ---'); b=s.index('  if (data.requiresEmailGate)',a);s=s[:a]+s[b:]
s=s.replace('  const isRealSuperAdmin = state.lockedRole === "admin";', '  const isRealSuperAdmin = ["admin", "subadmin"].includes(state.lockedRole);')
s=s.replace('  if (!sel || !state.meta || state.lockedRole !== "admin") return;', '  if (!sel || !state.meta || !["admin", "subadmin"].includes(state.lockedRole)) return;')
s=s.replace('    <option value="admin">👑 Admin Principal (Control Total)</option>\n    <option value="subadmin">📊 Ventas Fenix</option>\n    <option value="moviles">📱 Espejo Móviles (Solo Notas/Seguimiento)</option>', '''    ${state.lockedRole === 'admin' ? '<option value="admin">👑 Admin Principal (Control Total)</option>' : ''}
    <option value="subadmin">📊 Todas las ventas · Fenix</option>
    ${state.lockedRole === 'admin' ? '<option value="moviles">📱 Espejo Móviles</option>' : ''}''')
s=s.replace('    const v = sel.value;\n    if (v === "admin")', '    const v = sel.value;\n    if (state.lockedRole === "subadmin" && v !== "subadmin" && !v.startsWith("sup:")) return;\n    state.sheetPage = 1;\n    if (v === "admin")',1)
a=s.index('function setupSSE() {');b=s.index('\nfunction switchTab(',a)
s=s[:a]+'''function setupSSE() {
  state.eventSource?.close();
  if (!state.meta || state.meta.requiresEmailGate || state.vista === 'formulario') return;
  const token = sessionStorage.getItem('fenix_session') || '';
  const evtSource = new EventSource('/api/events?session=' + encodeURIComponent(token));
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
  state.sharedRefreshTimer = setTimeout(async () => {
    if (state.editingCell) { state.pendingSharedRefresh = true; return; }
    try { await loadBootstrap(); refreshCurrentTab(); }
    catch (error) { toast('No se pudo actualizar: ' + error.message); }
  }, 250);
}
'''+s[b:]
s=s.replace('const companiasActivas = state.meta.companiesVisibles.filter(c => c.totalVentas > 0);', 'const companiasActivas = state.meta.companiesVisibles;')
s=s.replace('async function loadActiveSheet() {', '''async function loadActiveSheet() {
  if (state.editingCell) { state.pendingSharedRefresh = true; return; }
  try { await loadActiveSheetData(); }
  catch (error) { document.getElementById('sheetLoadStatus').textContent = 'No se pudo cargar. Pulsa Actualizar.'; toast(error.message); }
}
async function loadActiveSheetData() {''')
s=s.replace('  if (!state.activeCompanySlug) return;\n  const qs = new URLSearchParams();', '''  if (!state.activeCompanySlug) { document.getElementById('sheetTbody').innerHTML = ''; return; }
  const requestId = state.sheetRequestId = (state.sheetRequestId || 0) + 1;
  document.getElementById('sheetLoadStatus').textContent = 'Cargando ventas…';
  const qs = new URLSearchParams();
  qs.set('page', state.sheetPage);
  qs.set('pageSize', state.sheetPageSize);
  qs.set('sort', state.sheetSort || 'fecha_orden');
  qs.set('direction', state.sheetDirection || 'desc');''',1)
s=s.replace('  const comp = data.company;\n  const cols = comp.columnas;', '''  if (requestId !== state.sheetRequestId) return;
  state.sheetPage = data.page;
  state.sheetColumns = data.company.columnas;
  document.getElementById('sheetLoadStatus').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
  const comp = data.company;
  const cols = comp.columnas;''',1)
s=s.replace('<span>Ficha</span>', '<span># · Ficha</span>',1)
s=s.replace('${cols.map((c) => `<th style="width:${c.width || 130}px">${esc(c.label)}</th>`).join("")}', '${cols.map((c, i) => `<th style="width:${c.width || 130}px"><span class="column-letter">${columnLetter(i)}</span>${esc(c.label)}</th>`).join("")}',1)
a=s.index('  if (data.sales.length === 0) {',s.index('async function loadActiveSheetData'));b=s.index('  const estadosOpciones',a);s=s[:a]+s[b:]
a=s.index('  const pageSize = state.sheetPageSize || 150;');b=s.index('  const pageInfoEl',a)
s=s[:a]+'''  const pageSize = data.pageSize;
  const totalPages = data.totalPages;
  const startIdx = data.offset;
  const visibleSales = data.sales;
'''+s[b:]
s=s.replace('`${state.sheetPage} / ${totalPages}`','`Página ${state.sheetPage} de ${totalPages} · ${data.total ? startIdx + 1 : 0}–${startIdx + data.sales.length} de ${data.total}`',1)
s=s.replace('  let html = "";\n  let ultimoMesClave', '''  state.currentSheetSalesMap.clear();
  if (data.sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-sheet">No hay ventas con estos filtros. Prueba otro mes o limpia los filtros.</td></tr>`;
    fitGridHeight(); return;
  }
  let html = "";
  let ultimoMesClave''',1)
s=s.replace('  for (const row of visibleSales) {', '  for (const [rowIndex, row] of visibleSales.entries()) {',1)
s=s.replace('<td class="row-actions-cell" style="white-space:nowrap; text-align:center;">', '<td class="row-actions-cell" style="white-space:nowrap; text-align:center;"><span class="row-number">${startIdx + rowIndex + 1}</span>',1)
s=s.replace('            class="editable-cell${extraCls}"', '            tabindex="0" data-field="${c.key}" data-sale="${row.id}"\n            class="editable-cell${extraCls}"',1)
s=s.replace('html += `<td title="${esc(val)}">${esc(val)}</td>`;', 'html += `<td tabindex="0" data-field="${c.key}" data-sale="${row.id}" title="${esc(val)}">${esc(val)}</td>`;',1)
s=s.replace('  if (td.querySelector("input")) return;', '  if (td.querySelector("input") || state.editingCell) return;\n  state.editingCell = true;',1)
s=s.replace('    if (newVal === oldVal) return;', '    if (newVal === oldVal) { finishCellEdit(); return; }',1)
s=s.replace('      toast("Error: " + e.message);\n    }\n  };', '      toast("Error: " + e.message);\n    } finally { finishCellEdit(); }\n  };',1)
s=s.replace('      td.textContent = oldVal;\n    }\n  });', '      td.textContent = oldVal;\n      finishCellEdit();\n    }\n  });',1)
s=s.replace('¿Eliminar este registro permanentemente?', '¿Eliminar esta venta de la maestra, Ventas Fenix y su supervisor? Se guardará un respaldo antes del cambio.')
s=s.replace('pero oculta el selector de vistas, crear compañías, borrar filas y tarifas.', 'y eliminarlas para todos. Incluye las vistas de supervisores en solo lectura; no permite abrir el panel maestro ni cambiar tarifas o accesos.')
# auth CSV + visible filters
s=s.replace('    const resp = await fetch(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`);', '''    for (const [key, id] of [['mes','sheetMonthFilter'],['anio','sheetYearFilter'],['estado','sheetStatusFilter'],['q','sheetSearchInput']]) qs.set(key, document.getElementById(id).value);
    const resp = await fetch(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`, { headers: requestHeaders() });
    if (!resp.ok) throw new Error('No se pudo exportar esta hoja.');''')
s=s.replace('  } catch {\n    window.open(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`, "_blank");\n  }', '  } catch (error) { toast(error.message); }')
# prevent accidental reset imports and permit exact backups
s=s.replace('  const isJson = file.name.toLowerCase().endsWith(".json");', '''  if (!confirm('Esta importación reemplaza el historial compartido para todos. Se guardará un respaldo automático. ¿Continuar?')) return;
  const isJson = file.name.toLowerCase().endsWith(".json");''')
s=s.replace('        const parsed = JSON.parse(reader.result);\n        const { data }', '''        const parsed = JSON.parse(reader.result);
        if (parsed.format === 'fenix-backup-v1') {
          const { data: restored } = await api('/api/restore', { method:'POST', body:JSON.stringify({confirm:'RESTAURAR',backup:parsed}) });
          if (statusBox) statusBox.textContent = `Respaldo restaurado: ${restored.total} ventas compartidas.`;
          await loadBootstrap(); refreshCurrentTab(); return;
        }
        const { data }''')
p.write_text(s,encoding='utf-8')
p=Path('public/index.html');s=p.read_text(encoding='utf-8')
s=s.replace('        <div id="gateErrorBanner"', '''        <label class="field-label" for="gatePassword" style="margin-top:12px">Clave de acceso</label>
        <input id="gatePassword" type="password" required autocomplete="current-password" placeholder="Tu clave personal" />
        <div id="gateErrorBanner"''')
s=s.replace('  <script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js"></script>\n  <script src="https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"></script>\n  <script src="/browser-backend.js"></script>\n', '')
s=s.replace('  <script src="/app.js"></script>', '  <script src="/app.js"></script>\n  <script src="/workspace.js"></script>')
s=s.replace('<option value="1500">Todas</option>', '<option value="400">Exporta CSV para obtener todas</option>') # removed below duplicate selection
s=s.replace('                <option value="400">Exporta CSV para obtener todas</option>\n','')
s=s.replace('id="sheetMonthFilter" onchange="window.app.loadActiveSheet()"','id="sheetMonthFilter" aria-label="Mes" onchange="window.app.debouncedLoadSheet()"')
s=s.replace('id="sheetYearFilter" onchange="window.app.loadActiveSheet()"','id="sheetYearFilter" aria-label="Año" onchange="window.app.debouncedLoadSheet()"')
s=s.replace('id="sheetStatusFilter" onchange="window.app.loadActiveSheet()"','id="sheetStatusFilter" aria-label="Estado" onchange="window.app.debouncedLoadSheet()"')
s=s.replace('      <div class="company-tabs-bar" id="companyTabsBar"></div>','')
s=s.replace('        <div class="grid-wrapper" id="sheetGridWrapper">', '''        <div class="sheet-tools">
          <span class="sheet-tip">Doble clic o Enter para editar · Flechas para moverte · Esc para cancelar</span>
          <label>Ordenar <select id="sheetSort" onchange="window.app.changeSheetSort(this.value)"><option value="fecha_orden:desc">Más recientes</option><option value="fecha_orden:asc">Más antiguas</option><option value="ejecutivo:asc">Ejecutivo A–Z</option><option value="nombre_cliente:asc">Cliente A–Z</option><option value="estado:asc">Estado A–Z</option></select></label>
          <button class="btn btn-outline btn-sm" onclick="window.app.clearSheetFilters()">Limpiar filtros</button>
          <button class="btn btn-outline btn-sm" onclick="window.app.loadActiveSheet()">Actualizar</button>
          <span id="sheetLoadStatus" role="status">Conectando…</span>
        </div>
        <div class="cell-inspector"><span id="cellAddress">Celda</span><span class="fx">fx</span><span id="cellValue">Selecciona una celda para ver su contenido completo</span></div>
        <div class="grid-wrapper" id="sheetGridWrapper">''')
s=s.replace('    <!-- ==================== 3. VENTAS DEL DÍA', '''    <div class="company-tabs-bar sheet-tabs-bottom" id="companyTabsBar" aria-label="Hojas de ventas"></div>
    <!-- ==================== 3. VENTAS DEL DÍA''')
# place tab bar inside the sheet section
s=s.replace('    </section>\n\n    <div class="company-tabs-bar sheet-tabs-bottom" id="companyTabsBar" aria-label="Hojas de ventas"></div>', '      <div class="company-tabs-bar sheet-tabs-bottom" id="companyTabsBar" aria-label="Hojas de ventas"></div>\n    </section>')
s=s.replace('<div id="generalViewsAccessGrid"', '''<div class="access-utilities"><button class="btn btn-outline" onclick="window.app.downloadBackup()">Descargar respaldo completo</button><button class="btn btn-outline" onclick="window.app.createAccessKey()">Generar clave personal</button><span>Agrega primero el correo a su acceso. La clave se muestra una sola vez.</span></div>
      <div id="generalViewsAccessGrid"''')
p.write_text(s,encoding='utf-8')
