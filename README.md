# 위성 양산공장 시뮬레이터 · Render 배포본

공정 흐름 재생, 병목 표시, 조건 조정, 시나리오 비교, 출하·대기 그래프, CSV 내보내기를 제공하는 한국어 웹앱입니다.

**권장 방식: Render Static Site.** 계산은 브라우저의 JavaScript Web Worker에서 수행합니다. 데이터베이스·API 키·Python 서버는 필요하지 않습니다. 이 패키지는 배포 준비본이며 사용자의 Render 계정에 실제 배포한 상태는 아닙니다.

## 배포: Blueprint

1. ZIP을 풀고 `satellite-factory-render` 폴더 **안의 파일·폴더 전체**를 새 GitHub 저장소 최상위에 올립니다. 저장소 첫 화면에서 `render.yaml`, `package.json`, `dist`, `scripts`, `tests`가 보여야 합니다. ZIP 자체를 올리는 방식은 아닙니다.
2. [Render 대시보드](https://dashboard.render.com/)에서 **New → Blueprint**를 선택하고 저장소를 연결합니다.
3. `render.yaml`을 선택하고 서비스 이름을 확인한 뒤 배포합니다. 이름 `satellite-factory-lab`이 기존 서비스와 겹치면 YAML의 `name`을 고유한 이름으로 바꿉니다.
4. 완료 후 Render가 표시하는 URL을 엽니다. 이후 연결된 GitHub 브랜치에 변경 사항을 올리면 자동으로 다시 배포됩니다.

설정은 [Render Blueprint 공식 문서](https://render.com/docs/blueprint-spec)를 기준으로 작성했습니다.

## 직접 설정: New → Static Site

| 항목 | 입력값 |
|---|---|
| Root Directory | 저장소 최상위에 파일을 올렸다면 비워 둠 |
| Build Command | `node scripts/verify-static.mjs` |
| Publish Directory | `dist` |
| 환경변수 `NODE_VERSION` | `24` |
| 환경변수 `SKIP_INSTALL_DEPS` | `true` |
| Start Command | 정적 사이트이므로 없음 |

상위 폴더를 통째로 올렸다면 Root Directory를 해당 폴더 이름으로 지정합니다. `dist`만 올리면 위 검증 명령에 필요한 파일이 없어서 실패합니다. 직접 Static Site를 만드는 경우에는 위 값을 수동 입력합니다. `render.yaml`은 Blueprint 연결 시 적용됩니다. MIME을 수동 관리하는 호스트에서는 `.mjs`가 JavaScript로 제공되어야 합니다.

이 정적 배포본에는 자체 로그인 기능이 없습니다. 입력값과 비교 기준은 열린 페이지 메모리에 있고 새로고침하면 초기화됩니다. 시뮬레이션 데이터를 서버로 전송하지 않습니다. Google Fonts 연결이 안 되면 시스템 글꼴을 사용합니다.

## 성능과 Python 검토

같은 계산을 이식해 측정한 결과, 이번 구현에서는 JavaScript가 빨랐습니다.

| 조건 | JavaScript 중앙값 | Python 중앙값 |
|---|---:|---:|
| 기본 128기 | 0.88 ms | 2.89 ms |
| 발주 256기 | 0.78 ms | 5.62 ms |
| 장기 병목 256기 | 6.32 ms | 40.34 ms |

같은 Linux 환경에서 Node.js 24.19.0 / CPython 3.12.14, 예열 10회·측정 50회로 비교했습니다. **계산 함수만 측정했으며 브라우저 표시·Worker 전송·네트워크·프로세스 시작은 제외**했습니다. 사용자 PC나 Render의 응답시간 보장값이 아닙니다. 짧은 실행시간의 JIT·측정 변동 때문에 256기 중앙값이 일부 작게 나타났으며, 위성이 많아지면 빨라진다는 뜻은 아닙니다.

웹앱은 JS를 유지하고 다음을 적용했습니다.

- 조건 변경 계산을 Worker에서 실행해 화면 처리와 분리. 첫 기본 결과만 즉시 동기 계산.
- 빠른 연속 입력은 대기 요청을 최신 조건 하나로 교체. 이전 결과의 화면 덮어쓰기 방지.
- 최근 24개 조건의 계산 결과를 페이지 메모리에서 재사용.
- 계산 중에는 기준 저장·CSV를 잠시 비활성화해 입력과 결과가 섞이지 않게 처리.
- Worker 로딩 실패나 미지원 환경에서는 기존 브라우저 계산으로 동작. 이때 계산은 화면을 잠시 점유할 수 있음.

Worker는 계산 자체의 속도보다 화면 반응성을 위한 변경입니다. [MDN Web Workers 설명](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

Python 모듈은 로컬 반복분석용으로 포함했습니다. 현재 웹앱에서 Python 서버를 호출하지 않습니다. 상세 판단은 `PERFORMANCE.md`, 실측 결과는 `benchmarks/results.json`을 참고하세요.

## 로컬 실행

설치할 npm 패키지가 없습니다. Node.js 22 이상 또는 24를 사용합니다.

```bash
npm test
npm run build
python -m http.server 8000 --directory dist
```

브라우저에서 `http://localhost:8000`을 엽니다. ES 모듈과 Worker를 사용하므로 HTML을 더블클릭하는 방식은 사용하지 않습니다. Windows에서는 환경에 따라 `python` 대신 `py`를 사용합니다.

## Python 분석

Python 3.12에서 검증했으며 외부 패키지가 필요하지 않습니다.

```bash
python python/engine.py --output result.json
```

다음 내용을 `scenarios.json`에 저장하면 여러 설정을 일괄 계산할 수 있습니다. 입력 파일은 객체 하나 또는 설정 객체 배열입니다.

```json
[
  {"demand": 128, "chambers": 1},
  {"demand": 128, "chambers": 2},
  {"demand": 256, "automatic": true}
]
```

```bash
python python/engine.py --config scenarios.json --output results.json
python benchmarks/compare.py
```

마지막 명령은 JS/Python 결과 일치 여부를 검증하고 성능을 재측정해 `benchmarks/results.json`을 갱신합니다. 결과에는 입력·지표·위성별 작업·대기 이력이 포함됩니다.

## 파일과 검증

| 경로 | 역할 |
|---|---|
| `render.yaml` | Render Blueprint |
| `dist/` | 배포 웹앱·계산 Worker |
| `python/engine.py` | Python 로컬 계산 |
| `scripts/verify-static.mjs` | 정적 파일·문법·모델·Worker 검증 |
| `tests/` | 시간·수량 보존, 설비 수용량, Worker·캐시·요청 교체 테스트 |
| `benchmarks/` | 시나리오·측정 코드·실측 결과 |
| `PERFORMANCE.md` | Python 전환 검토 |

JS/Python 8개 시나리오의 전체 결과 일치와 모델 보존법칙, 실제 Node Worker를 통한 메시지 왕복, 캐시 재사용, 대기 요청 교체, Worker 사용 불가 시 동작을 검증했습니다. 실제 Render 계정 배포와 실기기 브라우저 화면 검증은 수행하지 않았습니다.

모델은 250가동일 균등 투입·빈 공장 시작·0.25가동일 계산 간격·위성당 최대 1회 재작업을 가정합니다. 수치는 실제 기업 생산능력이나 확정 사업비가 아닙니다. 상세 계산식은 앱의 ‘계산 기준’에 표시했습니다.
