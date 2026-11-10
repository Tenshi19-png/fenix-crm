from pathlib import Path
p=Path('public/index.html');s=p.read_text(encoding='utf-8').replace('  <script src="/app.js"></script>','  <script src="/connection.js"></script>\n  <script src="/app.js"></script>');p.write_text(s,encoding='utf-8')
p=Path('public/app.js');s=p.read_text(encoding='utf-8').replace('await fetch(url, { ...options, headers })','await fetch(apiUrl(url), { ...options, headers })').replace('fetch("/api/auth/verify-email",','fetch(apiUrl("/api/auth/verify-email"),').replace("fetch('/api/auth/logout',", "fetch(apiUrl('/api/auth/logout'),").replace("new EventSource('/api/events?session=' + encodeURIComponent(token))", "new EventSource(apiUrl('/api/events?session=' + encodeURIComponent(token)))").replace('fetch(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`,','fetch(apiUrl(`/api/export/${state.activeCompanySlug}.csv?${qs.toString()}`),');p.write_text(s,encoding='utf-8')
p=Path('public/workspace.js');s=p.read_text(encoding='utf-8');s="function apiUrl(route) { return String(window.FENIX_API_BASE || '').replace(/\\/$/, '') + route; }\n"+s;p.write_text(s,encoding='utf-8')
p=Path('server/db.js');s=p.read_text(encoding='utf-8').replace('  return rows.map((r) => ({\n    ...r,\n    es_movil_espejo:', '  return rows.filter(r => !r.hoja.toLowerCase().includes("debug")).map((r) => ({\n    ...r,\n    es_movil_espejo:',1);p.write_text(s,encoding='utf-8')
p=Path('server/index.js');s=p.read_text(encoding='utf-8');s=s.replace('  try {\n    if (req.method === "OPTIONS")', '''  try {
    const origin = req.headers.origin;
    const allowedOrigins = String(process.env.FENIX_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (origin) {
      const ownOrigin = origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`;
      if (!ownOrigin && !allowedOrigins.includes(origin)) return sendJson(res, 403, {ok:false,message:'Origen no autorizado.'});
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === "OPTIONS")''',1)
# Remove obsolete client-side preview trust helpers and redundant checks.
import re
s=re.sub(r'      const access = \(\{ allowed: true, email: reqEmail \}\);\n      if \(!access.allowed\) \{[\s\S]*?\n      \}\n','',s)
s=s.replace('      req.on("close", () => sseClients.delete(res));', '''      const heartbeat = setInterval(() => res.write(': keepalive\\n\\n'), 25000);
      req.on("close", () => { clearInterval(heartbeat); sseClients.delete(res); });''')
p.write_text(s,encoding='utf-8')
# Prevent accidental regeneration of the obsolete static database engine.
p=Path('server/build-static.js');s=p.read_text(encoding='utf-8');s='throw new Error("El motor local fue retirado: usa node scripts/package-release.js para preparar la interfaz estática conectada al servidor central.");\n'+s;p.write_text(s,encoding='utf-8')
