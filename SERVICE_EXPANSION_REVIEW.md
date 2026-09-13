# 서비스 확장 검토

이 앱은 백엔드가 없는 정적 웹앱이므로 여기서 "서비스 확장"은 시나리오 규모(위성 수·챔버 수·시뮬레이션 기간)가
커질 때 (1) Web Worker 구조와 24개 결과 캐시가 잘 버티는지, (2) README가 주장하는 JS/Python 결과 일치가
실제로 자동 검증되는지를 뜻합니다. 코드(`dist/model.mjs`, `dist/simulation-client.mjs`,
`dist/simulation.worker.mjs`, `python/engine.py`)를 직접 읽고 실행해 확인했습니다.

## 1. 입력 상한과 계산 안전장치

`dist/model.mjs`의 `LIMITS`가 실제 상한입니다.

| 항목 | 범위 |
|---|---|
| demand (연간 발주량) | 16~256 |
| lines (조립 셀) | 1~10 |
| workers (조립인력) | 4~40 |
| chambers (시험챔버) | 1~6 |
| batch (챔버당 동시 시험) | 1~8 |
| rework (재작업 확률 %) | 0~30 |
| assemblyDays / functionDays / environmentDays | 1~30 / 1~15 / 1~30 |

시뮬레이션 기간은 250가동일 고정이며, 계산 루프 자체는 무한 backlog를 막기 위해 `t<=20000`(가동일)에서
강제 종료하고 그때까지 전 물량이 출하되지 않으면 예외를 던집니다(`계산 한도를 초과했습니다`). LIMITS 안에서
병목이 가장 심한 조합(발주 256기, 조립 셀·인력·챔버·배치 모두 최소, 재작업 30%, 조립·환경시험 각 30일)으로
직접 실행해 확인한 결과 `finish`(전체 발주분 완료 시점)는 약 9,700가동일로 20,000 한도의 절반 수준입니다.
즉 현재 LIMITS 범위 안에서는 안전장치에 걸리지 않지만 여유가 2배 정도뿐이라, 향후 LIMITS를 넓히거나
모델 상수를 바꾸면 조용히 예외가 나기 시작할 수 있습니다. → 이 여유를 지키는 회귀 테스트를 추가했습니다(3항 참고).

## 2. Worker·캐시·요청 교체

- **Worker 위임**: `simulation.worker.mjs`는 `simulate()`를 그대로 감싸 메시지 왕복만 처리합니다. Worker
  생성 실패·런타임 에러·messageerror 시 `SimulationClient.fallback()`이 즉시 동기 계산으로 전환합니다.
- **24개 캐시**: `SimulationClient.remember()`가 Map을 LRU처럼 다루어 24개를 넘으면 가장 오래된 항목을
  버립니다. 키는 `BASE`의 모든 필드 값을 배열로 직렬화한 문자열이라 슬라이더 조합이 늘어도 정확히 동일 조건만
  캐시 히트합니다. 시나리오가 커져도(위성 수↑) 캐시 자체의 메모리 비용은 "24개 × 결과 크기"로 고정되어
  문제는 없습니다.
- **요청 교체**: 계산 중(`active`) 새 입력이 오면 대기 중이던 `queued` 요청 하나만 최신 조건으로 교체하고
  이전 대기 요청은 `AbortError`로 reject됩니다. 화면(`dist/app.mjs`)은 별도로 `requestVersion` 카운터로
  구버전 응답을 무시하므로 이중 안전장치가 걸려 있습니다.
- **발견한 실제 낭비**: 기존 코드는 "이미 계산 중이거나 대기 중인 것과 정확히 같은 조건"으로 또 `compute()`를
  호출해도 이를 감지하지 않고 매번 새 Worker 왕복을 만들었습니다. 빠르게 같은 값을 두 번 트리거하는 UI
  이벤트(예: 프리셋 버튼 연타, 재시도)나 향후 여러 위젯이 같은 조건을 동시에 요청하는 확장 시나리오에서
  계산량이 커질수록 이 중복 비용이 커집니다.

## 3. 변경 사항

1. **`dist/simulation-client.mjs`**: `compute()`가 이미 진행 중(`active`)이거나 대기 중(`queued`)인 요청과
   정확히 같은 조건이면 새 Worker 메시지를 보내지 않고 그 요청의 결과를 함께 기다리도록(`waiters` 배열)
   수정했습니다. 기존의 "다른 조건이면 대기 요청을 즉시 교체" 동작은 그대로 유지했습니다.
   `tests/simulation-client.test.mjs`에 동시 동일 요청(계산 중/대기 중 각각) 테스트를 추가해 Worker 호출
   수가 늘지 않는지 검증합니다.
2. **`tests/model.test.mjs`**: LIMITS 안에서 가장 병목이 심한 조합을 실행해 `finish`가 20,000가동일 한도의
   90% 미만인지(현재 약 49%) 확인하는 회귀 테스트를 추가했습니다. 이 여유가 줄어드는 모델·LIMITS 변경이
   생기면 조용히 실패하지 않고 여기서 바로 드러납니다.
3. **JS/Python 결과 일치 자동화**: 기존에는 README·PERFORMANCE.md가 "8개 시나리오에서 JS/Python 결과가
   일치했다"고 주장하지만, 이를 검증하는 코드는 `tests/`가 아니라 사람이 수동으로 실행하는
   `benchmarks/compare.py`뿐이었습니다. `npm test`는 이를 전혀 확인하지 않아, JS(`dist/model.mjs`)와
   Python(`python/engine.py`)이 각자 수정되면서 조용히 어긋나도 아무 테스트도 실패하지 않는 실제 회귀
   위험이 있었습니다. `tests/js-python-parity.test.mjs`를 새로 추가해 `benchmarks/compare.py`와 동일한
   8개 시나리오로 두 구현의 전체 결과(JSON 직렬화 후 비교)를 대조하고, `package.json`의 `test` 스크립트에
   포함해 `npm test` 한 번으로 같이 검증되게 했습니다. Python 인터프리터가 없는 환경(예: 순수 Node만 있는
   CI)에서는 실패 대신 안내 메시지를 출력하고 통과 처리해, 이 앱이 배포 시 필요로 하지 않는 Python 의존을
   테스트가 강제하지 않도록 했습니다. `npm run build`(`scripts/verify-static.mjs`, Render 정적 배포 빌드
   경로)에는 의도적으로 포함하지 않았습니다 — 배포 빌드 환경에 Python이 없다고 명시(README)되어 있어
   배포 경로는 Python-free로 유지했습니다.

## 4. 보류(범위 밖으로 남긴 것)

- **20,000가동일 캡을 사용자에게 노출**: 현재는 캡에 걸리면 일반 예외 메시지만 뜹니다. LIMITS를 넓히는
  후속 작업이 생기면 더 친절한 안내(예상 완료 시점 사전 계산 등)가 필요할 수 있지만, 이번 검토에서는
  모델 로직 변경 없이 여유를 지키는 테스트만 추가했습니다.
- **Python 성능 벤치마크 결과 자동 재측정**: `benchmarks/compare.py`의 타이밍 측정(관대한 웜업·50회 반복,
  `benchmarks/results.json` 갱신)은 그대로 수동 실행 대상으로 남겼습니다. 매 `npm test`마다 벤치마크를
  다시 재는 것은 과도하고 결과 파일이 계속 갱신되는 부작용이 있어, 이번에는 "결과 일치" 부분만 자동화하고
  성능 측정은 기존 방식(`python benchmarks/compare.py`)을 유지합니다.
- 백엔드 도입, 모델 상수(250가동일, 0.25가동일 스텝, 재작업 1회 제한 등) 변경은 과제 범위 밖이라 손대지
  않았습니다.

## 5. 검증

- `npm test` — `tests/model.test.mjs`, `tests/simulation-client.test.mjs`,
  `tests/js-python-parity.test.mjs` 모두 통과.
- `npm run build` — `scripts/verify-static.mjs` 통과(정적 자산·모듈 참조·기존 두 테스트 검증 포함).
- `python benchmarks/compare.py` — 기존 수동 경로도 그대로 통과(참고용, 실측 결과 파일은 커밋하지 않음).
