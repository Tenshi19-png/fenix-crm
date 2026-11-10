from pathlib import Path
import difflib
for x,y in [('backups/pre-central-20261110/public/app.js','C:/Users/angel/Downloads/app (1).js'),('backups/pre-central-20261110/public/browser-backend.js','C:/Users/angel/Downloads/browser-backend (1).js')]:
 a=[''.join(l.split()) for l in Path(x).read_text(encoding='utf-8').splitlines() if l.strip()]; b=[''.join(l.split()) for l in Path(y).read_text(encoding='utf-8').splitlines() if l.strip()]
 print(x)
 print('\n'.join(difflib.unified_diff(a,b,n=2))[:6000])
