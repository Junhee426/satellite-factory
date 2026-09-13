"""Verify full result parity, then measure warm in-process model calls."""
import json
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'python'))
from engine import simulate
scenarios = json.loads((ROOT/'benchmarks/scenarios.json').read_text())
js = json.loads(subprocess.check_output(['node','benchmarks/measure.mjs'], cwd=ROOT))
fixtures = [s['config'] for s in scenarios]+[dict(rework=0),dict(chambers=2),dict(automatic=True),dict(demand=16),dict(demand=256,workers=40,lines=10,chambers=6,batch=8,assemblyDays=1,functionDays=1,environmentDays=1)]
code = "import {simulate} from './dist/model.mjs'; let s='';for await(const chunk of process.stdin)s+=chunk;console.log(JSON.stringify(JSON.parse(s).map(simulate)));"
expected = json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps(fixtures).encode(),cwd=ROOT))
for c,e in zip(fixtures,expected):
    assert simulate(c) == e, f'Python/JS mismatch: {c}'
results=[]
for spec in scenarios:
    for _ in range(10):
        simulate(spec['config'])
    samples=[]
    for _ in range(50):
        start=time.perf_counter()
        simulate(spec['config'])
        samples.append((time.perf_counter()-start)*1000)
    samples.sort()
    results.append(dict(name=spec['name'],medianMs=statistics.median(samples),p95Ms=samples[47],runs=len(samples)))
report=dict(measuredAt=datetime.now(timezone.utc).isoformat(),platform=platform.platform(),
            method='Same fixed-step algorithm and full result objects; 10 warmups and 50 calls per scenario; excludes browser rendering, worker message transfer, network and process startup.',
            parityScenarios=len(fixtures),javascript=js,python=dict(runtime=platform.python_version(),results=results))
path=ROOT/'benchmarks/results.json'
path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
