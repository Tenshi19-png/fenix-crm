from pathlib import Path
p=Path('server/db.js'); s=p.read_text(encoding='utf-8')
a=s.index('  let rows = db\n',s.index('function getCompanySales(')); b=s.index('  let columnas = ',a)
s=s[:a]+'''  const where = ['company_slug = ?'];
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

'''+s[b:]
s=s.replace('    total: totalMatching,\n    sales: rows,','    total: totalMatching,\n    page, pageSize, totalPages, offset,\n    sales: rows,')
s=s.replace('function getFormMetadata() {','function getFormMetadata(options = {}) {')
s=s.replace('  const countsRows = db.prepare("SELECT company_slug, COUNT(*) as total FROM sales GROUP BY company_slug").all();\n  const countsMap = Object.fromEntries(countsRows.map((x) => [x.company_slug, x.total]));', '''  const countsRows = db.prepare("SELECT company_slug, supervisor, COUNT(*) as total FROM sales GROUP BY company_slug, supervisor").all();
  const countsMap = {};
  for (const row of countsRows) {
    if (!options.supervisor || supervisorMatchesFilter(row.supervisor, options.supervisor, supsCache)) {
      countsMap[row.company_slug] = (countsMap[row.company_slug] || 0) + row.total;
    }
  }''')
p.write_text(s,encoding='utf-8')
p=Path('server/index.js');s=p.read_text(encoding='utf-8')
s=s.replace('const http = require("node:http");','const http = require("node:http");\nconst auth = require("./auth");\nconst { snapshot, backupBeforeChange, restoreSnapshot } = require("./backups");')
s=s.replace('  const msg = `data: ${JSON.stringify({ type, payload, ts: Date.now() })}', '  const safePayload = { company_slug: payload.company_slug || payload.sale?.company_slug };\n  const msg = `data: ${JSON.stringify({ type, payload: safePayload, ts: Date.now() })}')
s=s.replace('  "Access-Control-Allow-Origin": "*",','')
s=s.replace('  if (!N8N_API_KEY) return true;','  if (!N8N_API_KEY) return false;')
s=s.replace('    const role = getRequestRole(req, urlObj);\n    const reqEmail = getRequestEmail(req, urlObj);\n    const reqSup = getRequestSup(req, urlObj);\n    const adminPreview = isRequestAdminPreview(req);','''    let role = getRequestRole(req, urlObj);
    let reqEmail = getRequestEmail(req, urlObj);
    let reqSup = getRequestSup(req, urlObj);
    let adminPreview = false;
    const session = auth.principal(req, urlObj);
    const isPublicForm = role === 'formulario' && (
      (method === 'GET' && pathname === '/api/bootstrap') ||
      (method === 'POST' && ['/api/sales','/api/ficha/preview'].includes(pathname)));
    const isIntegration = pathname.startsWith('/api/n8n/') || pathname === '/api/webhook/tally';
    if (pathname.startsWith('/api/') && !['/api/health','/api/auth/verify-email','/api/auth/logout'].includes(pathname) && !isPublicForm) {
      if (isIntegration) {
        if (!checkN8nAuth(req, urlObj)) return sendJson(res, 403, { ok: false, message: 'Clave de integración requerida.' });
      } else {
        if (session && pathname === '/api/events') { role = session.role; reqSup = session.sup; }
        if (!auth.canView(session, role, reqSup)) {
          const access = { reason: 'Ingresa con tu correo y clave para abrir este acceso.', requiresEmail: true };
          if (pathname === '/api/bootstrap') return sendJson(res, 200, { ok: true, requiresEmailGate: true, access });
          return sendJson(res, 403, { ok: false, requiresEmailGate: true, message: access.reason });
        }
        reqEmail = session.email;
        adminPreview = true; // Authorization already checked against the server session.
        // A supervisor cannot override the scoped query with another supervisor name.
        if (role === 'supervisor') urlObj.searchParams.set('supervisor', reqSup);
        if (role === 'moviles') urlObj.searchParams.set('vista', 'moviles');
      }
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      auth.logout(req, urlObj); return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/access/credential' && method === 'POST') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede generar claves.' });
      return sendJson(res, 200, { ok: true, ...auth.issueCredential((await readJsonBody(req)).email) });
    }
    if (pathname === '/api/backup' && method === 'GET') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede respaldar.' });
      return sendJson(res, 200, snapshot());
    }
    if (pathname === '/api/restore' && method === 'POST') {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede restaurar.' });
      const body = await readJsonBody(req);
      if (body.confirm !== 'RESTAURAR') return sendJson(res, 400, { ok: false, message: 'Confirma la restauración.' });
      const result = restoreSnapshot(body.backup);
      broadcastEvent('config_updated');
      return sendJson(res, 200, result);
    }
    if (pathname.startsWith('/api/import/')) {
      if (role !== 'admin') return sendJson(res, 403, { ok: false, message: 'Solo el administrador puede importar.' });
      if (method === 'POST') backupBeforeChange();
    }
    if (method === 'DELETE' || pathname === '/api/sales/bulk-delete') backupBeforeChange();''')
# Server-authorized requests need no second email/preview bypass; central middleware is authoritative.
s=s.replace('verifyViewEmailAccess(role, reqSup, reqEmail, adminPreview)', '({ allowed: true, email: reqEmail })')
s=s.replace('verifyViewEmailAccess(vista, supParam, reqEmail, adminPreview)', '({ allowed: true, email: reqEmail })')
a=s.index('      const vista = body.vista || role || "admin";',s.index('pathname === "/api/auth/verify-email"'));b=s.index('\n    }',a)
s=s[:a]+'''      const check = auth.login(req, body);
      return sendJson(res, 200, { ok: true, ...check });'''+s[b:]
s=s.replace('      const vista = urlObj.searchParams.get("vista") || role || "admin";', '      const vista = role;')
s=s.replace('      const meta = getFormMetadata();\n      let companiesVisibles', '      const meta = getFormMetadata({ supervisor: vista === "supervisor" ? supParam : "" });\n      if (vista === "supervisor") {\n        meta.supervisors = meta.supervisors.filter(s => s.token_acceso === supParam || s.nombre === supParam);\n        meta.ejecutivosPorSupervisor = {}; meta.todosEjecutivos = [];\n      }\n      if (vista !== "admin") meta.supervisors = meta.supervisors.map(({correos_autorizados, ...s}) => s);\n      let companiesVisibles')
s=s.replace('if (conVentas.length > 0) companiesVisibles = conVentas;', 'companiesVisibles = conVentas;')
s=s.replace('        limit: urlObj.searchParams.get("limit") || 1500,','        page: urlObj.searchParams.get("page"),\n        pageSize: urlObj.searchParams.get("pageSize"),\n        sort: urlObj.searchParams.get("sort"),\n        direction: urlObj.searchParams.get("direction"),')
s=s.replace('        limit: 50000,','        exportAll: true,\n        mes: urlObj.searchParams.get("mes") ?? "",\n        anio: urlObj.searchParams.get("anio") ?? "",\n        estado: urlObj.searchParams.get("estado") || "all",\n        q: urlObj.searchParams.get("q") || "",')
s=s.replace('    // 17. Archivos estáticos', '''    // Never serve the old public database or browser-local write engine.
    if (pathname.startsWith('/data/') || pathname === '/browser-backend.js' || pathname === '/README.md') {
      res.writeHead(404); res.end('No encontrado'); return;
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, message: 'Ruta no encontrada.' });
    // 17. Archivos estáticos''')
s=s.replace('if (!filePath.startsWith(PUBLIC_DIR))', 'if (!filePath.startsWith(PUBLIC_DIR + path.sep))')
s=s.replace('  server.listen(PORT, () => {', '''  if (process.env.NODE_ENV === 'production' && (!process.env.FENIX_ADMIN_EMAIL || String(process.env.FENIX_ADMIN_PASSWORD || '').length < 12 || !process.env.FENIX_DATA_DIR)) {
    throw new Error('Configura FENIX_ADMIN_EMAIL, FENIX_ADMIN_PASSWORD (12+ caracteres) y FENIX_DATA_DIR en almacenamiento persistente.');
  }
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => {''')
p.write_text(s,encoding='utf-8')
