"""Parity-first CPython reference for local batch analysis; not a web backend."""
import argparse
import json
import math
from pathlib import Path

BASE = dict(demand=128, lines=4, workers=16, chambers=1, batch=4,
            rework=12, automatic=False, assemblyDays=7, functionDays=4,
            environmentDays=10, materialCost=8, laborCost=.9)
LIMITS = dict(demand=(16,256), lines=(1,10), workers=(4,40), chambers=(1,6),
              batch=(1,8), rework=(0,30), assemblyDays=(1,30),
              functionDays=(1,15), environmentDays=(1,30),
              materialCost=(.1,100), laborCost=(.1,3))

def validate(values=None):
    c = {**BASE, **(values or {})}
    for key, (low, high) in LIMITS.items():
        v = c[key]
        if isinstance(v, bool) or not isinstance(v, (int,float)) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError(f'{key}: {low}~{high} 범위의 수치가 필요합니다.')
        if key not in ('materialCost','laborCost'):
            if v != int(v):
                raise ValueError(f'{key}: 정수가 필요합니다.')
            c[key] = int(v)
    if not isinstance(c['automatic'], bool):
        raise ValueError('automatic: bool 값이 필요합니다.')
    return c

def random_for(i):
    # Match JavaScript's signed bitwise operations and double multiplication.
    x = ((i + 13) * 374761393) & 0xffffffff
    x = x ^ (x >> 13)
    if x >= 0x80000000:
        x -= 0x100000000
    x = int(float(x) * 1274126177) & 0xffffffff
    return (x ^ (x >> 16)) / 4294967296

def simulate(values=None):
    c = validate(values)
    year, step = 250, .25
    capacity = [3, min(c['lines'], c['workers']//4), 3, c['chambers'], 2]
    duration = [2, c['assemblyDays'], c['functionDays']*(.7 if c['automatic'] else 1), c['environmentDays'], 2]
    probability = c['rework']/100*(.55 if c['automatic'] else 1)
    jobs = [dict(id=i+1, release=math.floor(i*year/c['demand']/step)*step,
                 segments=[], queues=[], reworked=False, done=None) for i in range(c['demand'])]
    queues, running = [[] for _ in range(5)], [[] for _ in range(5)]
    busy, wait_sum, visits = [0]*5, [0]*5, [0]*5
    next_job, complete, t = 0, 0, 0

    def enqueue(job, stage, at, retry=False):
        queues[stage].append(dict(job=job, at=at, retry=retry))

    while t <= 20000 and complete < c['demand']:
        while next_job < len(jobs) and jobs[next_job]['release'] <= t:
            enqueue(jobs[next_job], 0, t)
            next_job += 1
        for s in range(4,-1,-1):
            ended = [g for g in running[s] if g['end'] <= t]
            running[s] = [g for g in running[s] if g['end'] > t]
            for group in ended:
                for entry in group['entries']:
                    j = entry['job']
                    if s == 4:
                        j['done'] = t
                        complete += 1
                    elif s == 2 and not j['reworked'] and random_for(j['id']) < probability:
                        j['reworked'] = True
                        enqueue(j, 1, t, True)
                    else:
                        enqueue(j, s+1, t, entry['retry'] and s == 1)
        for s in range(5):
            while len(running[s]) < capacity[s] and queues[s]:
                q = queues[s]
                size = c['batch'] if s == 3 else 1
                if s == 3 and len(q) < size and t-q[0]['at'] < 3:
                    break
                entries = q[:size]
                del q[:size]
                d = math.ceil(duration[s]*(.35 if s == 1 and entries[0]['retry'] else 1)/step)*step
                end = t+d
                for e in entries:
                    e['job']['queues'].append(dict(stage=s,start=e['at'],end=t))
                    e['job']['segments'].append(dict(stage=s,start=t,end=end,retry=e['retry']))
                    wait_sum[s] += t-e['at']
                    visits[s] += 1
                running[s].append(dict(entries=entries,start=t,end=end))
                busy[s] += max(0,min(end,year)-t)
        t += step
    if complete != c['demand']:
        raise ValueError('계산 한도 초과')
    annual = [j for j in jobs if j['done'] <= year]
    shipments = len(annual)
    lead = sum(j['done']-j['release'] for j in annual)/shipments if shipments else 0
    avg_wait = [v/(visits[i] or 1) for i,v in enumerate(wait_sum)]
    util = [v/(year*capacity[i]) for i,v in enumerate(busy)]
    fixed = c['workers']*c['laborCost']+c['lines']*2+c['chambers']*4+10+(3 if c['automatic'] else 0)
    extra = sum(j['reworked'] for j in annual)*.15
    cost = c['materialCost']+(fixed+extra)/shipments if shipments else None
    monthly = [sum(j['done'] <= (i+1)*year/12 for j in jobs) for i in range(12)]
    return dict(config=c,jobs=jobs,shipments=shipments,lead=lead,cost=cost,fixed=fixed,
                monthly=monthly,avgWait=avg_wait,util=util,bottleneck=avg_wait.index(max(avg_wait)),
                capacity=capacity,duration=duration,finish=max(j['done'] for j in jobs),
                year=year,reworkCount=sum(j['reworked'] for j in jobs))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='위성 양산 모델 · Python 로컬 분석')
    parser.add_argument('--config', type=Path, help='입력 JSON 객체 또는 시나리오 객체 배열')
    parser.add_argument('--output', type=Path, help='결과 JSON 파일 (생략하면 표준출력)')
    args = parser.parse_args()
    configs = json.loads(args.config.read_text(encoding='utf-8')) if args.config else {}
    output = [simulate(c) for c in configs] if isinstance(configs,list) else simulate(configs)
    data = json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        args.output.write_text(data+'\n',encoding='utf-8')
    else:
        print(data)
