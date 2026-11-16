const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.FENIX_IS_TEST = '1';
process.env.FENIX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fenix-test-'));
process.env.FENIX_ADMIN_EMAIL = 'owner@example.invalid';
process.env.FENIX_ADMIN_PASSWORD = 'test-only-owner-password';
delete process.env.FENIX_LOCAL_PREVIEW;
const { server } = require('./index');
const { db, updateViewEmails, updateSupervisorEmails, getAllSupervisors, getCompanySales } = require('./db');
const auth = require('./auth');
const { parsearFichaCompleta } = require('./fichaParser');

async function main() {
  const sup = getAllSupervisors().find(s => s.nombre === 'Francisca');
  updateViewEmails('subadmin', 'fenix@example.invalid');
  updateSupervisorEmails(sup.id, 'supervisor@example.invalid');
  const fenixKey = auth.issueCredential('fenix@example.invalid').password;
  const supKey = auth.issueCredential('supervisor@example.invalid').password;
  const insert = db.prepare('INSERT INTO sales (company_slug, fecha,fecha_orden,mes,anio,ejecutivo,supervisor,nombre_cliente,estado) VALUES (?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 2050; i++) insert.run('movistar-con-tenencia', '10/11/2026', 20261110, 10, 2026, 'Ejecutivo Prueba', i < 1600 ? 'Francisca' : 'Emmanuel Rodriguez', 'Prueba ' + i, i === 0 ? 'No Realizado' : 'Instalado');
  db.exec('COMMIT');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, {role='admin', token='', sup='', method='GET', body, headers={}}={}) => fetch(base + route, {method, headers:{'Content-Type':'application/json','x-fenix-role':role,'x-fenix-sup':sup,Authorization:'Bearer '+token,...headers}, ...(body ? {body:JSON.stringify(body)} : {})});
  const json = async (route, options) => { const r = await request(route, options); const body = await r.json(); assert.equal(r.status,200,JSON.stringify(body)); return body; };
  const login = async (vista,email,password,sup='') => json('/api/auth/verify-email',{method:'POST',body:{vista,email,password,sup}});
  const admin = (await login('admin',process.env.FENIX_ADMIN_EMAIL,process.env.FENIX_ADMIN_PASSWORD)).token;
  const fenix = (await login('subadmin','fenix@example.invalid',fenixKey)).token;
  const supervisor = (await login('supervisor','supervisor@example.invalid',supKey,sup.token_acceso)).token;
  assert(admin && fenix && supervisor);
  assert.equal((await login('admin','fenix@example.invalid',fenixKey)).allowed,false);
  const a={token:admin}, f={role:'subadmin',token:fenix}, v={role:'supervisor',sup:sup.token_acceso,token:supervisor};
  const route='/api/companies/movistar-con-tenencia/sales';
  const all = await json(route,a);
  assert.equal(all.total,2050); assert.equal(all.sales.length,150); assert.equal(all.totalPages,14);
  const ids = new Set();
  for(let page=1;page<=14;page++) for(const sale of (await json(route+'?page='+page,f)).sales) { assert(!ids.has(sale.id)); ids.add(sale.id); }
  assert.equal(ids.size,2050);
  assert.equal((await json(route+'?page=999',f)).page,14);
  assert.equal((await json(route+'?pageSize=99999',f)).sales.length,400);
  assert.equal((await json(route+'?estado=no%20realizado',f)).total,1);
  assert.equal((await json(route+'?estado=realizado',f)).total,0);
  assert.equal((await json(route+'?supervisor=Emmanuel%20Rodriguez',v)).total,1600);
  assert.equal((await json(route,{...f,role:'supervisor',sup:'Francisca'})).total,1600);
  const meta = await json('/api/bootstrap?vista=supervisor',v);
  assert.equal(meta.companiesVisibles.find(c=>c.slug==='movistar-con-tenencia').totalVentas,1600);
  assert.equal((await json('/api/bootstrap?vista=admin',f)).vista,'subadmin');
  assert((await json('/api/bootstrap',f)).companiesVisibles.some(c=>c.slug==='aa-sales'));
  assert.equal((await request('/api/access',{...f,role:'admin',headers:{'x-fenix-admin-preview':'1'}})).status,403);
  assert.equal((await request(route,{...v,sup:'Emmanuel Rodriguez'})).status,403);
  assert.equal((await request('/api/access',{headers:{'x-fenix-email':process.env.FENIX_ADMIN_EMAIL,'x-fenix-admin-preview':'1'}})).status,403);
  assert.equal((await request('/api/backup',f)).status,403);
  assert.equal((await request('/data/fenix.db',a)).status,404);
  assert.equal((await request('/api/n8n/hojas')).status,403);
  const publicForm = await json('/api/bootstrap?vista=formulario',{role:'formulario'});
  assert(publicForm.supervisors.every(s=>!('correos_autorizados' in s)));
  const csv = await request('/api/export/movistar-con-tenencia.csv',f);
  assert.equal((await csv.text()).trim().split('\r\n').length,2051);
  const scopedCsv = await request('/api/export/movistar-con-tenencia.csv',v);
  assert.equal((await scopedCsv.text()).trim().split('\r\n').length,1601);
  console.log('✓ Paginación completa, exportación, filtros y permisos');
  // Two connected clients receive deletion notices without personal sale fields.
  const stream = await fetch(base+'/api/events?session='+encodeURIComponent(supervisor));
  const reader = stream.body.getReader(); await reader.read();
  const saleId = db.prepare("SELECT id FROM sales WHERE supervisor='Francisca' LIMIT 1").get().id;
  await json('/api/sales/'+saleId,{...f,method:'PATCH',body:{observacion:'Cambio compartido'}});
  assert.equal(db.prepare('SELECT observacion FROM sales WHERE id=?').get(saleId).observacion,'Cambio compartido');
  assert.equal((await request('/api/sales/'+saleId,{...v,method:'DELETE'})).status,403);
  await json('/api/sales/'+saleId,{...f,method:'DELETE'});
  assert.equal((await json(route,a)).total,2049);
  assert.equal((await json(route,v)).total,1599);
  const event = new TextDecoder().decode((await reader.read()).value);
  assert(event.includes('sale_updated') || event.includes('sale_deleted'));
  assert(!event.includes('Cambio compartido'));
  await reader.cancel();
  const nextId = db.prepare("SELECT id FROM sales WHERE supervisor='Francisca' LIMIT 1").get().id;
  await json('/api/sales/'+nextId,{...a,method:'DELETE'});
  assert.equal((await json(route,f)).total,2048);
  assert.equal((await json(route,v)).total,1598);
  console.log('✓ Edición y borrado compartidos en ambos sentidos, avisos en vivo');
  const backup=await json('/api/backup',a);
  const before=backup.tables.sales.length;
  await json('/api/restore',{...a,method:'POST',body:{confirm:'RESTAURAR',backup}});
  assert.equal((await json(route,a)).total,before);
  const bad=structuredClone(backup);bad.tables.sales[0].company_slug='does-not-exist';
  assert.equal((await request('/api/restore',{...a,method:'POST',body:{confirm:'RESTAURAR',backup:bad}})).status,500);
  assert.equal((await json(route,a)).total,before);
  assert(fs.readdirSync(path.join(process.env.FENIX_DATA_DIR,'backups')).length>=3);
  assert.equal(getCompanySales('movistar-con-tenencia',{pageSize:1}).sales.length,1);
  assert(parsearFichaCompleta('NOMBRE CLIENTE: Cliente Prueba\nRUT: 12345678-5','10/11/2026'));
  console.log('✓ Respaldo, restauración y reversión ante respaldo inválido');

  // Espejo Móviles oculta A&A Sales y permite Movistar/Claro/Entel Móvil (Admin/Ventas Fenix siguen viendo A&A)
  updateViewEmails('moviles', 'moviles@example.invalid');
  const movKey = auth.issueCredential('moviles@example.invalid').password;
  const movToken = (await login('moviles', 'moviles@example.invalid', movKey)).token;
  const m = { role: 'moviles', token: movToken };
  const movBoot = await json('/api/bootstrap?vista=moviles', m);
  const movSlugs = movBoot.companiesVisibles.map(c => c.slug);
  assert(!movSlugs.includes('aa-sales'), 'Espejo Móviles no debe incluir aa-sales');
  assert(!movSlugs.includes('ventas-entel-pyme-movil'), 'Espejo Móviles no debe incluir ventas-entel-pyme-movil');
  assert(movSlugs.includes('ventas-entel-movil'), 'Espejo Móviles debe incluir ventas-entel-movil');
  assert(movSlugs.includes('ventas-claro-movil'), 'Espejo Móviles debe incluir ventas-claro-movil');
  assert(movSlugs.includes('ventas-moviles-movistar'), 'Espejo Móviles debe incluir ventas-moviles-movistar');
  assert((await json('/api/bootstrap', a)).companiesVisibles.some(c => c.slug === 'aa-sales'), 'Admin debe seguir viendo aa-sales');
  assert((await json('/api/bootstrap', f)).companiesVisibles.some(c => c.slug === 'aa-sales'), 'Ventas Fenix debe seguir viendo aa-sales');
  assert.equal((await request('/api/companies/aa-sales/sales?vista=moviles', m)).status, 403);
  assert.equal((await request('/api/export/aa-sales.csv?vista=moviles', m)).status, 403);
  const aaIns = db.prepare('INSERT INTO sales (company_slug, fecha, fecha_orden, mes, anio, ejecutivo, supervisor, nombre_cliente, estado) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('aa-sales', '10/11/2026', 20261110, 10, 2026, 'Ejecutivo Prueba', 'Francisca', 'Cliente AA Oculto', 'Pendiente');
  const emIns = db.prepare('INSERT INTO sales (company_slug, fecha, fecha_orden, mes, anio, ejecutivo, supervisor, nombre_cliente, estado) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('ventas-entel-movil', '10/11/2026', 20261110, 10, 2026, 'Ejecutivo Prueba', 'Francisca', 'Cliente Entel Movil Visible', 'Pendiente');
  assert.equal((await request('/api/sales/' + aaIns.lastInsertRowid, { ...m, method: 'PATCH', body: { notas_movil: 'No permitido' } })).status, 403);
  await json('/api/sales/' + emIns.lastInsertRowid, { ...m, method: 'PATCH', body: { notas_movil: 'Seguimiento ok' } });
  const movSearch = await json('/api/search?q=Cliente&vista=moviles', m);
  assert(!movSearch.results.some(r => r.company_slug === 'aa-sales'), 'Búsqueda en Móviles no debe devolver A&A Sales');
  assert(movSearch.results.some(r => r.company_slug === 'ventas-entel-movil'), 'Búsqueda en Móviles debe devolver Entel Móvil');
  const movSummary = await json('/api/summary/daily?fecha=2026-11-10&vista=moviles', m);
  assert(!JSON.stringify(movSummary.bloques || []).includes('A&A'), 'Resumen del día en Móviles no debe incluir A&A Sales');
  console.log('✓ Espejo Móviles oculta A&A Sales y mantiene Movistar/Claro/Entel Móvil');

  // 6. Ventas Diarias: Móviles contadas por cantidad (titular + adicional)
  db.prepare('INSERT INTO sales (company_slug, fecha, fecha_orden, mes, anio, ejecutivo, supervisor, nombre_cliente, estado, numero_principal, adicional, cant_titular, cant_adicional) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ventas-entel-movil', '16/11/2026', 20261116, 10, 2026, 'Ejecutiva Movil Test', 'Francisca', 'Cliente Con Adicional', 'Pendiente', '911111111', '922222222', 1, 1);
  const dailyTest = await json('/api/summary/daily?fecha=2026-11-16', a);
  const supFran = (dailyTest.bloques || []).find(b => b.supervisor === 'Francisca');
  assert(supFran, 'Supervisor Francisca debe aparecer en resumen del día');
  const campMov = supFran.campanias.find(c => c.slug === 'ventas-entel-movil');
  assert(campMov, 'Campaña ventas-entel-movil debe aparecer');
  assert.equal(campMov.esMovil, true, 'campMov.esMovil debe ser true');
  assert(campMov.total >= 2, 'Campaña móvil debe contar titulares + adicionales (mínimo 2)');
  const ejTest = campMov.listaEjecutivos.find(e => e.nombre === 'Ejecutiva Movil Test');
  assert(ejTest, 'Ejecutiva Movil Test debe estar en la lista');
  assert.equal(ejTest.cantidad, 2, 'Ejecutiva con 1 titular y 1 adicional debe sumar cantidad 2');
  assert.equal(ejTest.titulares, 1, 'Debe registrar 1 titular');
  assert.equal(ejTest.adicionales, 1, 'Debe registrar 1 adicional');
  console.log('✓ Ventas diarias cuenta móviles por cantidad desglosando titulares y adicionales');

  // 7. Pagos Adicionales: Fila de totales por supervisor
  const payTest = await json('/api/payments?mes=10&anio=2026', a);
  assert(payTest.tarjetasSupervisores.length > 0, 'Debe haber tarjetas de supervisores');
  for (const s of payTest.tarjetasSupervisores) {
    assert(s.totales, 'Cada tarjeta debe incluir objeto totales');
    assert.equal(typeof s.totales.fib, 'number', 'totales.fib debe ser número');
    assert.equal(typeof s.totales.paq, 'number', 'totales.paq debe ser número');
    assert.equal(s.totales.dineroTotal, s.subtotalDinero, 'totales.dineroTotal debe ser igual a subtotalDinero');
  }
  console.log('✓ Pagos Adicionales incluye fila de totales con suma de instalaciones y montos');

  console.log('Todas las pruebas de la base central pasaron. Se usaron exclusivamente datos de prueba.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server.closeAllConnections();server.close();db.close();});
