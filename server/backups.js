const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR } = require('./db');
const TABLES = ['companies','supervisors','view_permissions','executive_goals','payment_settings','bot_sessions','sales'];
function snapshot() {
  return { format: 'fenix-backup-v1', exportedAt: new Date().toISOString(), tables: Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
}
function backupBeforeChange() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fenix-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  return path.basename(file);
}
function restoreSnapshot(data) {
  if (data?.format !== 'fenix-backup-v1' || !data.tables || !TABLES.every(t => Array.isArray(data.tables[t]))) throw new Error('Respaldo Fenix inválido o incompleto.');
  const backup = backupBeforeChange();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM sales');
    for (const table of TABLES.filter(t => t !== 'sales')) db.exec(`DELETE FROM ${table}`);
    for (const table of TABLES) {
      const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const row of data.tables[table]) {
        const keys = Object.keys(row).filter(k => allowed.has(k));
        if (!keys.length) throw new Error('Fila de respaldo inválida.');
        db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('El respaldo tiene ventas sin compañía.');
    db.exec('COMMIT');
    return { ok: true, backup, total: data.tables.sales.length };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { snapshot, backupBeforeChange, restoreSnapshot };
