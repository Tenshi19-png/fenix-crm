from pathlib import Path
p=Path('server/index.js');s=p.read_text(encoding='utf-8');a=s.index('// Auto-importar el historial real');b=s.index('const PUBLIC_DIR',a);s=s[:a]+'// La base central se carga únicamente mediante restauración o importación explícita.\n\n'+s[b:];p.write_text(s,encoding='utf-8')
p=Path('package.json');import json;j=json.loads(p.read_text(encoding='utf-8'));j['scripts']['test']='node server/test-central.js';j['scripts']['preview']='node scripts/preview.js';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
