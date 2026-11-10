// Preview uses an isolated copy. It never edits the original database.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { spawn } = require('node:child_process');
async function main() {
  const root = path.resolve(__dirname, '..');
  const dir = path.join(root, '.preview-data');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'fenix.db');
  if (!fs.existsSync(target)) {
    const source = new DatabaseSync(path.join(root, 'data', 'fenix.db'), { readOnly: true });
    await backup(source, target); source.close();
  }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd:root, stdio:'inherit', windowsHide:true,
    env:{...process.env,FENIX_DATA_DIR:dir,FENIX_LOCAL_PREVIEW:'1',HOST:'127.0.0.1',PORT:process.env.PORT || '3457',NODE_ENV:'development'},
  });
  child.on('exit', code => { process.exitCode = code; });
  process.on('SIGINT', () => child.kill());
  process.on('SIGTERM', () => child.kill());
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
