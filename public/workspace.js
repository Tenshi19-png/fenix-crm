function apiUrl(route) { return String(window.FENIX_API_BASE || '').replace(/\/$/, '') + route; }
function requestHeaders() {
  return {
    Authorization: 'Bearer ' + (sessionStorage.getItem('fenix_session') || ''),
    'x-fenix-role': state.vista,
    'x-fenix-sup': state.supervisorFiltro || '',
  };
}
function columnLetter(index) {
  let label = '';
  for (index++; index; index = Math.floor((index - 1) / 26)) label = String.fromCharCode(65 + (index - 1) % 26) + label;
  return label;
}
function finishCellEdit() {
  state.editingCell = false;
  if (state.pendingSharedRefresh) { state.pendingSharedRefresh = false; scheduleSharedRefresh(); }
}
function clearSheetFilters() {
  document.getElementById('sheetSearchInput').value = '';
  for (const id of ['sheetMonthFilter','sheetYearFilter','sheetStatusFilter']) document.getElementById(id).value = 'all';
  state.sheetPage = 1;
  loadActiveSheet();
}
function changeSheetSort(value) {
  [state.sheetSort, state.sheetDirection] = value.split(':');
  state.sheetPage = 1; loadActiveSheet();
}
function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type:'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function downloadBackup() {
  try { const { data } = await api('/api/backup'); downloadJson(data, 'fenix-respaldo-' + todayISO() + '.json'); }
  catch (error) { toast(error.message); }
}
async function createAccessKey() {
  const email = prompt('Correo autorizado al que quieres generar o renovar la clave:');
  if (!email) return;
  if (!confirm('Se generará una clave nueva para este correo y se cerrarán sus sesiones anteriores. ¿Continuar?')) return;
  try {
    const { data } = await api('/api/access/credential', { method:'POST', body:JSON.stringify({email}) });
    document.getElementById('modalSearchTitle').textContent = 'Clave personal de acceso';
    document.getElementById('modalSearchBody').innerHTML = `<p>Entrega esta clave únicamente a <strong>${esc(data.email)}</strong>.</p><p>Se muestra una sola vez. Puedes generar otra si se pierde.</p><input readonly aria-label="Clave generada" value="${esc(data.password)}" style="width:100%;margin-top:16px;font:18px monospace" />`;
    document.getElementById('modalSearch').classList.remove('hidden');
  } catch (error) { toast(error.message); }
}
Object.assign(window.app, { clearSheetFilters, changeSheetSort, downloadBackup, createAccessKey });

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('sheetGrid');
  grid.addEventListener('focusin', ev => {
    const cell = ev.target.closest('td[data-field]');
    if (!cell) return;
    grid.querySelector('.selected-cell')?.classList.remove('selected-cell');
    cell.classList.add('selected-cell');
    const col = (state.sheetColumns || []).findIndex(c => c.key === cell.dataset.field);
    const row = cell.closest('tr').querySelector('.row-number')?.textContent || '';
    document.getElementById('cellAddress').textContent = columnLetter(col) + row;
    document.getElementById('cellValue').textContent = cell.querySelector('input')?.value ?? cell.textContent;
  });
  grid.addEventListener('keydown', ev => {
    if (ev.target.matches('input, select, textarea, button')) return;
    const cell = ev.target.closest('td[data-field]');
    if (!cell) return;
    if (ev.key === 'Enter' || ev.key === 'F2') {
      if (canEditColumnInCurrentView(cell.dataset.field)) { ev.preventDefault(); startInlineEdit(cell, Number(cell.dataset.sale), cell.dataset.field); }
      return;
    }
    const offsets = {ArrowLeft:[0,-1], ArrowRight:[0,1], ArrowUp:[-1,0], ArrowDown:[1,0]};
    if (!offsets[ev.key]) return;
    const rows = [...grid.querySelectorAll('tr.data-row')], row = cell.closest('tr');
    const [dy,dx] = offsets[ev.key], targetRow = rows[rows.indexOf(row) + dy];
    const target = targetRow?.children[cell.cellIndex + dx];
    if (target?.hasAttribute('tabindex')) { ev.preventDefault(); target.focus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.meta && !state.meta.requiresEmailGate && state.vista !== 'formulario') scheduleSharedRefresh();
  });
});
