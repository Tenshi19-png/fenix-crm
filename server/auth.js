const crypto = require('node:crypto');
const { db, verifyViewEmailAccess, getAllSupervisors } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS access_credentials (
  email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL
);`);
const sessions = new Map();
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
  let valid = false;
  if (role === 'admin' && process.env.FENIX_ADMIN_PASSWORD) {
    valid = equals(digest(body.password, 'fenix-admin'), digest(process.env.FENIX_ADMIN_PASSWORD, 'fenix-admin'));
  } else {
    const row = db.prepare('SELECT * FROM access_credentials WHERE email = ?').get(email);
    if (row) valid = equals(digest(body.password, row.salt), Buffer.from(row.hash, 'hex'));
  }
  if (!valid || !permitted(role, sup, email)) return { allowed: false, reason: 'Revisa el correo, la clave y los permisos de este acceso.' };
  attempts.delete(key);
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, role, sup, expires: now + 12 * 60 * 60_000 });
  return { allowed: true, email, token };
}
function tokenFrom(req, url) { return String(req.headers.authorization || '').replace(/^Bearer /i, '') || url.searchParams.get('session') || ''; }
function principal(req, url) {
  if (isLocal(req)) return { email: 'preview@localhost', role: 'admin', sup: '' };
  const session = sessions.get(tokenFrom(req, url));
  if (!session || session.expires < Date.now() || !permitted(session.role, session.sup, session.email)) return null;
  return session;
}
function canView(session, role, sup) {
  if (!session || !['admin','subadmin','supervisor','moviles'].includes(role)) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'subadmin') return role === 'subadmin' || (role === 'supervisor' && !!sup);
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
  for (const [token, session] of sessions) if (session.email === email) sessions.delete(token);
  return { email, password };
}
function logout(req, url) { sessions.delete(tokenFrom(req, url)); }
module.exports = { login, principal, canView, issueCredential, logout };
