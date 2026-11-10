const crypto = require('node:crypto');
const { db, verifyViewEmailAccess, getAllSupervisors } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS access_credentials (
  email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL
);`);

db.exec(`CREATE TABLE IF NOT EXISTS active_sessions (
  token TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, sup TEXT, expires INTEGER NOT NULL
);`);

const attempts = new Map();
const normalize = value => String(value || '').trim().toLowerCase();
function digest(password, salt) { return crypto.scryptSync(String(password || ''), salt, 32); }
function equals(a, b) { return a.length === b.length && crypto.timingSafeEqual(a, b); }
function isLocal(req) {
  return process.env.FENIX_LOCAL_PREVIEW === '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function permitted(role, sup, email) {
  if (role === 'admin') return email === normalize(process.env.FENIX_ADMIN_EMAIL) && !!email;
  if (!['subadmin', 'supervisor', 'moviles'].includes(role)) return false;
  if (role === 'supervisor' && !getAllSupervisors().some(s => s.activo && (s.nombre === sup || s.token_acceso === sup))) return false;
  return verifyViewEmailAccess(role, sup, email, false).allowed;
}
function login(req, body) {
  const email = normalize(body.email), role = body.vista, sup = String(body.sup || '');
  const key = req.socket.remoteAddress + ':' + email;
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
  if (attempt.count >= 10) return { allowed: false, reason: 'Demasiados intentos. Espera 15 minutos.' };
  attempt.count++; attempts.set(key, attempt);

  if (!permitted(role, sup, email)) {
    return { allowed: false, reason: 'Revisa el correo y los permisos de este acceso.' };
  }

  // Si es admin y hay contraseña configurada en el servidor, se valida
  if (role === 'admin') {
    if (process.env.FENIX_ADMIN_PASSWORD) {
      const valid = equals(digest(body.password, 'fenix-admin'), digest(process.env.FENIX_ADMIN_PASSWORD, 'fenix-admin'));
      if (!valid) return { allowed: false, reason: 'Clave de administrador incorrecta.' };
    }
  }
  // Para los demás accesos (subadmin, supervisor, moviles), NO se exige contraseña:
  // el correo autorizado es suficiente para entrar directamente.

  attempts.delete(key);

  // Limpiar sesiones expiradas
  db.prepare('DELETE FROM active_sessions WHERE expires < ?').run(now);

  const token = crypto.randomBytes(32).toString('hex');
  // Sesión de larga duración: 365 días (1 año) guardada en SQLite persistente
  const ONE_YEAR_MS = 365 * 24 * 60 * 60_000;
  const expires = now + ONE_YEAR_MS;

  db.prepare('INSERT INTO active_sessions (token, email, role, sup, expires) VALUES (?, ?, ?, ?, ?)')
    .run(token, email, role, sup, expires);

  return { allowed: true, email, token, expires };
}
function tokenFrom(req, url) { return String(req.headers?.authorization || '').replace(/^Bearer /i, '') || url.searchParams.get('session') || ''; }
function principal(req, url) {
  if (isLocal(req)) return { email: 'preview@localhost', role: 'admin', sup: '' };
  const token = tokenFrom(req, url);
  if (!token) return null;
  const now = Date.now();
  const session = db.prepare('SELECT * FROM active_sessions WHERE token = ?').get(token);
  if (!session || session.expires < now || !permitted(session.role, session.sup, session.email)) {
    if (session) db.prepare('DELETE FROM active_sessions WHERE token = ?').run(token);
    return null;
  }
  const verify = verifyViewEmailAccess(session.role, session.sup, session.email, false);
  session.readOnly = Boolean(verify.readOnly);
  return session;
}
function canView(session, role, sup) {
  if (!session || !['admin','subadmin','supervisor','moviles'].includes(role)) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'subadmin') return role === 'subadmin' || (!session.readOnly && role === 'supervisor' && !!sup);
  return session.role === role && (role !== 'supervisor' || session.sup === sup || getAllSupervisors().some(s => s.token_acceso === session.sup && s.nombre === sup));
}
function issueCredential(emailInput) {
  const email = normalize(emailInput);
  const views = db.prepare('SELECT correos_autorizados FROM view_permissions').all();
  const supers = getAllSupervisors();
  const authorized = [...views, ...supers].some(row => String(row.correos_autorizados).split(/[,;\s]+/).map(normalize).includes(email));
  if (!email.includes('@') || !authorized) throw new Error('Agrega primero ese correo a un acceso autorizado.');
  const password = crypto.randomBytes(12).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO access_credentials VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt, hash=excluded.hash')
    .run(email, salt, digest(password, salt).toString('hex'));
  return { email, password };
}
function logout(req, url) {
  const token = tokenFrom(req, url);
  if (token) db.prepare('DELETE FROM active_sessions WHERE token = ?').run(token);
}
module.exports = { login, principal, canView, issueCredential, logout };
