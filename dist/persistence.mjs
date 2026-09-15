// Save/load for the displayed scenario (config, comparison baseline, and the currently viewed
// production day). Every value that leaves parseState()/importState() has already passed through
// model.mjs's existing `validate` — no parallel validator is implemented here. If anything about
// the file is malformed or out of range, parseState() throws *before* any derived simulation runs,
// so a caller that only assigns its own state after a successful call can never let a bad import
// clobber the currently displayed valid results.
import {validate, simulate} from './model.mjs';

export const SCHEMA_VERSION = 1;

function fail(message) {
 throw new Error(message);
}

// Build the plain, JSON-serializable snapshot that gets written to a save file.
export function serializeState({config, baseline, day}) {
 return {
  schemaVersion: SCHEMA_VERSION,
  savedAt: new Date().toISOString(),
  config: {...config},
  baseline: {...baseline},
  day
 };
}

// Parse + validate a save file's contents (a JSON string or an already-parsed object). Throws a
// descriptive Error on any malformed or invalid input; never returns a partial result.
export function parseState(raw) {
 let data = raw;
 if (typeof raw === 'string') {
  try {
   data = JSON.parse(raw);
  } catch {
   fail('올바른 JSON 파일이 아닙니다.');
  }
 }
 if (!data || typeof data !== 'object' || Array.isArray(data)) fail('저장 파일 형식이 올바르지 않습니다.');
 if (data.schemaVersion !== SCHEMA_VERSION) fail(`지원하지 않는 저장 형식입니다. (schemaVersion: ${data.schemaVersion ?? '없음'})`);
 if (!data.config || typeof data.config !== 'object' || Array.isArray(data.config)) fail('config 항목이 없습니다.');
 if (!data.baseline || typeof data.baseline !== 'object' || Array.isArray(data.baseline)) fail('baseline 항목이 없습니다.');
 if (!Number.isFinite(data.day)) fail('day 항목이 올바르지 않습니다.');
 const day = Math.round(data.day);
 if (day < 0 || day > 250) fail('day: 0~250 범위를 벗어났습니다.');
 let config, baseline;
 try {
  config = validate(data.config);
 } catch (e) {
  fail(`config.${e.message}`);
 }
 try {
  baseline = validate(data.baseline);
 } catch (e) {
  fail(`baseline.${e.message}`);
 }
 return {config, baseline, day};
}

// Parses + validates, then (only once that succeeds) recomputes the two simulation results the
// caller needs to redraw the page. Because parseState() throws first, a malformed file never
// reaches simulate() and never produces a half-applied state.
export function importState(raw) {
 const {config, baseline, day} = parseState(raw);
 return {config, baseline, day, result: simulate(config), baseResult: simulate(baseline)};
}
