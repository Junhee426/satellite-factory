import {BASE,LABELS,LIMITS,MC_LIMITS,validate,simulate,snapshot,monteCarlo} from './model.mjs';
import {SimulationClient} from './simulation-client.mjs';
import {serializeState,importState} from './persistence.mjs';
const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
let config={...BASE},baseline={...BASE},result=simulate(config),baseResult=result,day=125,playing=false,speed=1,activePreset='base',toastTimer;
const client=new SimulationClient();client.seed(result);
let requestVersion=0,pending=Promise.resolve(result),computing=false;
const fields=[['demand','연간 발주량','기',16,256,8],['lines','조립 셀','개',1,10,1],['workers','조립인력','명',4,40,4],['chambers','시험챔버','개',1,6,1],['batch','챔버당 동시 시험','기',1,8,1],['rework','재작업 확률','%',0,30,1]];
const sat3d=extra=>`<div class="sat3d ${extra}"><i class="face front"></i><i class="face back"></i><i class="face left"></i><i class="face right"></i><i class="panel left"></i><i class="panel right"></i></div>`;
const STAGE_MODELS=[
 `<div class="model-scene stage-icon-0" aria-hidden="true">${sat3d('')}<div class="crate"></div><span class="scan-beam"></span></div>`,
 `<div class="model-scene stage-icon-1" aria-hidden="true">${sat3d('')}<span class="tool-orbit"></span></div>`,
 `<div class="model-scene stage-icon-2" aria-hidden="true">${sat3d('')}<span class="signal-ring"></span><span class="signal-ring delay"></span></div>`,
 `<div class="model-scene stage-icon-3" aria-hidden="true"><div class="chamber-ring"></div>${sat3d('small')}</div>`,
 `<div class="model-scene stage-icon-4" aria-hidden="true">${sat3d('deployed')}<span class="launch-glow"></span></div>`
];
const advanced=[['assemblyDays','조립시간 / 가동일',1,30,1],['functionDays','기능시험 / 가동일',1,15,1],['environmentDays','환경시험 / 가동일',1,30,1],['materialCost','기당 재료비 / 억원',.1,100,.1],['laborCost','인당 연간비용 / 억원',.1,3,.1]];
$('control-fields').innerHTML=fields.map(([key,label,unit,min,max,step])=>`<div class="control-field"><div class="control-label"><label for="${key}">${label}</label><output for="${key}" id="value-${key}">${config[key]}<small>${unit}</small></output></div><input type="range" id="${key}" min="${min}" max="${max}" step="${step}" value="${config[key]}"><div class="range-ends"><span>${min}${unit}</span><span>${max}${unit}</span></div></div>`).join('');
$('advanced-fields').innerHTML=advanced.map(([key,label,min,max,step])=>`<div class="number-field"><label for="${key}">${label}</label><input id="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${config[key]}" inputmode="decimal"></div>`).join('');
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function syncControls(){
 for(const [key,,unit,min,max]of fields){$(key).value=config[key];$('value-'+key).innerHTML=`${config[key]}<small>${unit}</small>`;$(key).style.background=`linear-gradient(to right, #2265e8 ${(config[key]-min)/(max-min)*100}%, #dce5ef 0%)`;}
 for(const [key]of advanced)$(key).value=config[key];
 $('automatic').checked=config.automatic;
 document.querySelectorAll('[data-preset]').forEach(b=>{const active=b.dataset.preset===activePreset;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
function busy(value){
 computing=value;
 $('save-baseline').disabled=value;$('download').disabled=value;
 $('save-state').disabled=value;$('load-state').disabled=value;$('mc-run').disabled=value;
 $('calculation-status').textContent=value?'계산 중…':'';
 $('metrics').setAttribute('aria-busy',String(value));
}
function update(next,{preset=null}={}){
 config=validate(next);activePreset=preset;syncControls();
 const version=++requestVersion;busy(true);
 pending=client.compute(config).then(value=>{
  if(version!==requestVersion)return null;
  result=value;busy(false);render();return result;
 }).catch(error=>{
  if(version!==requestVersion||error.name==='AbortError')return null;
  busy(false);config={...result.config};activePreset=null;syncControls();render();
  toast('계산하지 못했습니다. 마지막 결과로 돌아갑니다.');
  throw error;
 });
 // UI handlers do not await requests; WebMCP callers can await the same promise.
 pending.catch(()=>{});
 return pending;
}
function metric(label,value,unit,sub,cls=''){return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-sub ${cls}">${sub}</div></article>`;}
function deltaText(delta,unit,lower=false,d=0){if(Math.abs(delta)<.005)return {text:'기준 시나리오와 동일',cls:''};const good=lower?delta<0:delta>0;return {text:`기준 대비 ${delta>0?'+':'−'}${fmt(Math.abs(delta),d)}${unit}`,cls:good?'improve':'worse'};}
function renderMetrics(){
 const d1=deltaText(result.shipments-baseResult.shipments,'기'),d2=deltaText(result.lead-baseResult.lead,'일',true,1),d3=deltaText((result.cost??0)-(baseResult.cost??0),'억원',true,2);
 $('metrics').innerHTML=metric('연간 출하량',fmt(result.shipments),'기',d1.text,d1.cls)+metric('평균 제작기간',result.shipments?fmt(result.lead,1):'—','가동일',result.shipments?d2.text:'연내 출하분 없음',d2.cls)+metric('기당 추정비용',result.cost?fmt(result.cost,2):'—','억원',result.cost?d3.text:'연내 출하분 없음',d3.cls)+metric('연내 발주분 출하율',fmt(result.shipments/config.demand*100,1),'%',`${config.demand}기 중 ${result.shipments}기 출하`);
}
function renderFlow(){
 const shot=snapshot(result,day),flowConfig=result.config;
 $('flow-stages').innerHTML=shot.stages.map((stage,s)=>{
  const hot=s===result.bottleneck&&result.avgWait[s]>.25;
  const cap=s===1?`${result.capacity[s]} / ${flowConfig.lines}셀 가동`:s===3?`${flowConfig.chambers}챔버 × ${flowConfig.batch}기`:`${result.capacity[s]}개 작업대`;
  const tokens=stage.active.slice(0,12).map(j=>`<i class="sat-token ${j.retry?'retry':''}" style="opacity:${.55+j.progress*.45}" title="위성 ${String(j.id).padStart(3,'0')} · ${j.retry?'재작업 · ':''}${fmt(j.progress*100)}% 진행"></i>`).join('');
  return `<article class="stage ${hot?'bottleneck':''}" aria-label="${stage.name}, 작업 중 ${stage.active.length}기, 대기 ${stage.queue.length}기"><div class="stage-top"><span class="stage-number">0${s+1}</span>${hot?'<span class="stage-badge">병목</span>':''}</div><h3>${stage.name}</h3><p class="stage-capacity">${cap}</p>${STAGE_MODELS[s]}<div class="stage-work" aria-hidden="true">${tokens||'<span class="idle-label">작업 대기</span>'}${stage.active.length>12?`<span class="extra-token">+${stage.active.length-12}</span>`:''}</div><div class="stage-state"><span>작업<strong>${stage.active.length}</strong></span><span class="queued">대기<strong>${stage.queue.length}</strong></span></div><div class="util-track"><i style="width:${Math.min(100,result.util[s]*100)}%"></i></div><div class="stage-util">연간 가동률 ${fmt(result.util[s]*100)}%</div></article>`;
 }).join('');
 $('day-label').textContent=`${fmt(day)} / 250 가동일`;
 $('day-summary').textContent=`투입 ${shot.released}기 · 공정 내 ${shot.wip}기 · 출하 ${shot.completed}기`;
 $('day').value=day;
 const b=result.bottleneck;
 $('bottleneck-note').innerHTML=result.avgWait[b]>.25?`<strong>${LABELS[b]} 대기가 가장 깁니다.</strong> 평균 ${fmt(result.avgWait[b],1)}가동일 대기 · ${b===1&&result.capacity[1]<flowConfig.lines?`인력 부족으로 조립 셀 ${flowConfig.lines-result.capacity[1]}개가 가동되지 않습니다.`:b===3?'챔버 수와 동시 시험 수량을 조정해 효과를 확인하세요.':b===1?'조립 셀 수와 셀당 필요한 인력을 함께 확인하세요.':'다른 공정의 증설보다 이 공정의 처리조건을 먼저 확인하세요.'}`:'<strong>현재 발주량에서 대기가 거의 없습니다.</strong> 설비를 늘리기 전에 발주량과 공정시간을 함께 확인하세요.';
}
function chart(){
 const W=530,H=230,L=39,R=16,T=12,B=31,max=Math.ceil(Math.max(config.demand,baseline.demand,result.shipments,baseResult.shipments)/40)*40;
 const x=i=>L+i*(W-L-R)/12,y=v=>H-B-v/max*(H-T-B);
 const line=data=>[0,...data].map((v,i)=>`${x(i)},${y(v)}`).join(' ');
 const current=line(result.monthly),base=line(baseResult.monthly),area=`${L},${H-B} ${current} ${x(12)},${H-B}`;
 let svg=`<svg class="output-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="누적 출하량: 현재 연간 ${result.shipments}기, 기준 ${baseResult.shipments}기"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#4c8ff2" stop-opacity=".15"/><stop offset="1" stop-color="#4c8ff2" stop-opacity=".01"/></linearGradient></defs>`;
 for(let i=0;i<=4;i++){const v=max*i/4;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#e7edf4" stroke-dasharray="3 4"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end">${v}</text>`;}
 for(let i=0;i<=12;i+=3)svg+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${i===0?'시작':i+'월'}</text>`;
 svg+=`<polygon points="${area}" fill="url(#area)"/><polyline points="${base}" fill="none" stroke="#a1b0c5" stroke-width="2.5" stroke-dasharray="5 5"/><polyline points="${current}" fill="none" stroke="#2670e7" stroke-width="3" stroke-linejoin="round"/>`;
 result.monthly.forEach((v,i)=>{svg+=`<circle cx="${x(i+1)}" cy="${y(v)}" r="3.5" fill="#2670e7" stroke="white" stroke-width="2"><title>${i+1}월 · 현재 ${v}기 / 기준 ${baseResult.monthly[i]}기</title></circle>`;});
 svg+=`<text x="${x(12)-7}" y="${Math.max(16,y(result.shipments)-12)}" text-anchor="end" style="fill:#2364ce;font-weight:700">${result.shipments}기</text></svg>`;
 $('output-chart').innerHTML=svg;
 const scale=Math.max(...result.avgWait,1);
 $('wait-chart').innerHTML='<div class="wait-bars">'+LABELS.map((label,i)=>`<div class="wait-row ${i===result.bottleneck?'hot':''}"><span>${label}</span><div class="wait-bar"><i style="width:${result.avgWait[i]/scale*100}%"></i></div><strong>${fmt(result.avgWait[i],1)}</strong></div>`).join('')+'</div>';
}
function comparison(){
 const d=result.shipments-baseResult.shipments,l=result.lead-baseResult.lead,c=result.cost!==null&&baseResult.cost!==null?result.cost-baseResult.cost:0;
 const changed=Object.keys(BASE).filter(k=>config[k]!==baseline[k]);
 let message='설비·인력·검사 방식을 바꾸며 기준 시나리오와 비교해 보세요.';
 if(changed.length){
  if(d>0)message=`같은 250가동일 동안 <strong>${d}기를 더 출하</strong>합니다. 전체 발주분의 마지막 출하는 <strong>${fmt(result.finish,1)}가동일</strong>입니다.`;
  else if(d<0)message=`연내 출하가 <strong>${Math.abs(d)}기 감소</strong>합니다. 대기시간이 늘어난 공정을 확인하세요.`;
  else if(activePreset==='staff'&&baseline.workers>=baseline.lines*4)message='기준 인력으로 모든 조립 셀이 가동 중입니다. <strong>인력만 늘려서는 생산량이 증가하지 않습니다.</strong>';
  else message='연내 출하량은 같습니다. <strong>제작기간과 비용 변화</strong>를 함께 확인하세요.';
 }
 const sign=(v,digit=0)=>(Math.abs(v)<.005?'':v>0?'+':'−')+fmt(Math.abs(v),digit);
 $('comparison').innerHTML=`<div class="comparison-text">${message}</div><div class="comparison-values"><div><small>출하 변화</small><strong class="${d<0?'negative':''}">${sign(d)}기</strong></div><div><small>제작기간 변화</small><strong class="${l>0?'negative':''}">${result.shipments&&baseResult.shipments?sign(l,1)+'일':'—'}</strong></div><div><small>기당 비용 변화</small><strong class="${c>0?'negative':''}">${result.cost!==null&&baseResult.cost!==null?sign(c,2)+'억':'—'}</strong></div></div>`;
 $('model-summary').textContent=`전체 발주분 완료 ${fmt(result.finish,1)}가동일 · 재작업 ${result.reworkCount}기 · 기준 발주 ${baseline.demand}기 / 현재 ${config.demand}기`;
}
function render(){renderMetrics();renderFlow();comparison();chart();}
for(const[key]of fields)$(key).addEventListener('input',()=>{update({...config,[key]:Number($(key).value)});});
for(const[key]of advanced)$(key).addEventListener('change',()=>{try{update({...config,[key]:Number($(key).value)});}catch(e){$(key).value=config[key];toast(e.message);}});
$('automatic').addEventListener('change',()=>update({...config,automatic:$('automatic').checked}));
$('day').addEventListener('input',()=>{setPlaying(false);day=Number($('day').value);renderFlow();});
function setPlaying(value){playing=value;$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'생산 흐름 일시정지':'생산 흐름 재생');}
$('play').addEventListener('click',()=>{if(day>=250)day=0;setPlaying(!playing);renderFlow();});
$('speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;$('speed').textContent=speed+'×';});
setInterval(()=>{if(!playing||document.hidden||computing)return;day=Math.min(250,day+speed);renderFlow();if(day>=250)setPlaying(false);},160);
function applyPreset(name){
 const next={...baseline};
 if(name==='chamber'){next.chambers=Math.min(6,next.chambers+1);if(next.chambers===baseline.chambers)toast('이미 최대 시험챔버 수입니다.');}
 if(name==='staff'){next.workers=Math.min(40,next.workers+4);if(next.workers===baseline.workers)toast('이미 최대 조립인력입니다.');}
 if(name==='auto'){next.automatic=true;if(baseline.automatic)toast('기준 시나리오에 자동검사가 이미 적용되어 있습니다.');}
 if(!['base','chamber','staff','auto'].includes(name))throw new Error('지원하지 않는 시나리오입니다.');
 return update(next,{preset:name});
}
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
$('save-baseline').addEventListener('click',()=>{if(computing)return;baseline={...result.config};baseResult=result;activePreset='base';syncControls();render();toast('현재 조건을 비교 기준으로 설정했습니다.');});
$('reset').addEventListener('click',()=>{baseline={...BASE};baseResult=simulate(BASE);day=125;setPlaying(false);update({...BASE},{preset:'base'});toast('초기 공장 구성으로 돌아왔습니다.');});
const dialog=$('method-dialog');$('method-button').addEventListener('click',()=>dialog.showModal());$('close-method').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function exportCSV(){
 if(computing)return;
 const rows=[['위성 양산공장 시뮬레이터','가정 기반 시나리오 비교'],['항목','기준','현재','단위'],['연간 출하량',baseResult.shipments,result.shipments,'기'],['연내 발주분 출하율',baseResult.shipments/baseline.demand*100,result.shipments/config.demand*100,'%'],['평균 제작기간',baseResult.shipments?baseResult.lead:'',result.shipments?result.lead:'','가동일 / 연내 출하분'],['기당 추정비용',baseResult.cost??'',result.cost??'','억원'],['전체 발주분 완료',baseResult.finish,result.finish,'가동일'],['재작업 위성 수',baseResult.reworkCount,result.reworkCount,'기 / 전체 발주분'],[],['입력 조건','기준','현재']];
 for(const [key,label,unit]of fields)rows.push([label,baseline[key],config[key],unit]);
 for(const [key,label]of advanced)rows.push([label,baseline[key],config[key]]);
 rows.push(['자동검사',baseline.automatic?'도입':'미도입',config.automatic?'도입':'미도입'],[],['공정','기준 평균 대기','현재 평균 대기','기준 연간 가동률(%)','현재 연간 가동률(%)']);
 LABELS.forEach((label,i)=>rows.push([label,baseResult.avgWait[i],result.avgWait[i],baseResult.util[i]*100,result.util[i]*100]));
 rows.push([],['월 구간 / 250가동일을 12등분','기준 누적 출하','현재 누적 출하']);result.monthly.forEach((n,i)=>rows.push([i+1,baseResult.monthly[i],n]));
 rows.push([],['모델 기준','빈 공장 시작, 연간 250가동일 균등 투입, 0.25가동일 간격'],['인력','조립 셀당 4명, 기능시험 작업대 3개 고정'],['환경시험','배치 정원 충족 또는 첫 위성 대기 3일 후 착수'],['품질','위성당 최대 1회 재작업, 재조립 시간 35%'],['자동검사 효과 가정','기능시험시간 30% 감소, 재작업 확률 45% 감소'],['연간 고정비(억원)','인력×인당비용 + 조립 셀×2 + 챔버×4 + 10 + 자동검사 도입시 3'],['기당 비용','재료비 + (연간 고정비 + 연내 출하분 재작업수×0.15) / 연간 출하량'],['주의','실제 기업 실적·확정 사업비가 아닌 시나리오 가정']);
 const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(typeof v==='number'?Math.round(v*10000)/10000:v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='satellite-factory-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('입력 조건과 비교 결과를 CSV로 내보냈습니다.');
}
$('download').addEventListener('click',exportCSV);
function exportState(){
 if(computing)return;
 const data=serializeState({config,baseline,day});
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='satellite-factory-state.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('공장 구성·기준·조회 가동일을 저장했습니다.');
}
$('save-state').addEventListener('click',exportState);
$('load-state').addEventListener('click',()=>{if(!computing)$('load-state-input').click();});
$('load-state-input').addEventListener('change',async e=>{
 const file=e.target.files[0];e.target.value='';
 if(!file)return;
 try{
  const text=await file.text();
  // importState() validates config/baseline/day through model.mjs's existing `validate` and
  // throws before computing anything if the file is malformed or out of range; only a fully
  // valid import reaches the assignments below, so a bad file can never overwrite the results
  // currently on screen.
  const next=importState(text);
  setPlaying(false);
  config=next.config;baseline=next.baseline;day=next.day;result=next.result;baseResult=next.baseResult;
  activePreset=null;requestVersion++;client.seed(result);client.seed(baseResult);
  syncControls();render();
  toast('저장 파일을 불러왔습니다.');
 }catch(error){
  toast(`불러오기 실패: ${error.message}`);
 }
});
$('mc-seed').min=MC_LIMITS.seed[0];$('mc-seed').max=MC_LIMITS.seed[1];
$('mc-iterations').min=MC_LIMITS.iterations[0];$('mc-iterations').max=MC_LIMITS.iterations[1];
function mcRow(label,digits,unit,base,current){
 const cell=v=>v==null?'—':fmt(v,digits)+(unit?` ${unit}`:'');
 return `<tr><th>${label}</th><td>${cell(base.p10)}</td><td>${cell(base.p50)}</td><td>${cell(base.p90)}</td><td>${cell(current.p10)}</td><td>${cell(current.p50)}</td><td>${cell(current.p90)}</td></tr>`;
}
async function runMonteCarlo(){
 if(computing)return;
 const seed=Number($('mc-seed').value),iterations=Number($('mc-iterations').value);
 $('mc-run').disabled=true;$('mc-status').textContent='몬테카를로 계산 중…';$('mc-results').innerHTML='';
 // Let the browser paint the "계산 중" status before the synchronous Monte Carlo loop runs.
 await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 try{
  // Baseline and current scenario share the same seed, so they draw the same random sequence
  // (see monteCarlo()'s common-random-numbers note in model.mjs) — differences below reflect the
  // scenario change itself, not independent RNG noise between the two runs.
  const baseSummary=monteCarlo(baseline,{seed,iterations});
  const curSummary=monteCarlo(config,{seed,iterations});
  $('mc-results').innerHTML=`<table class="mc-table"><thead><tr><th>지표</th><th colspan="3">기준 (P10 · P50 · P90)</th><th colspan="3">현재 (P10 · P50 · P90)</th></tr></thead><tbody>`+
   mcRow('연간 출하량',0,'기',baseSummary.shipments,curSummary.shipments)+
   mcRow('평균 제작기간',1,'가동일',baseSummary.lead,curSummary.lead)+
   mcRow('기당 추정비용',2,'억원',baseSummary.cost,curSummary.cost)+
   '</tbody></table>'+
   `<p class="mc-note">기준·현재 시나리오 모두 시드 ${seed}에서 시작하는 동일한 난수열을 위성 번호 기준으로 공유하며, 반복 ${iterations}회의 결과를 집계했습니다. 두 시나리오의 차이는 난수 변동이 아닌 조건 차이에서 발생합니다.</p>`;
  $('mc-status').textContent=`시드 ${seed} · ${iterations}회 반복 계산 완료`;
 }catch(error){
  $('mc-results').innerHTML='';$('mc-status').textContent='';
  toast(error.message);
 }finally{
  $('mc-run').disabled=false;
 }
}
$('mc-run').addEventListener('click',runMonteCarlo);
function resultSummary(){return {config:{...config},baseline:{...baseline},annualShipments:result.shipments,averageLeadDays:result.shipments?result.lead:null,unitCostBillionKRW:result.cost===null?null:result.cost/10,lastShipmentWorkingDay:result.finish,bottleneck:LABELS[result.bottleneck],snapshot:snapshot(result,day)};}
async function readLatestResult(){let observed;do{observed=pending;await observed;}while(observed!==pending);return resultSummary();}
syncControls();render();
const context=document.modelContext;
if(context?.registerTool){
 const lifecycle=new AbortController();
 const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_factory_scenario',description:'Read current factory assumptions, production results and displayed production snapshot.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:readLatestResult});
 register({name:'configure_factory_scenario',description:'Change factory assumptions and recompute the visible simulation. Baseline remains unchanged.',inputSchema:{type:'object',properties:Object.fromEntries([...Object.entries(LIMITS).map(([k,[min,max]])=>[k,{type:['materialCost','laborCost'].includes(k)?'number':'integer',minimum:min,maximum:max}]),['automatic',{type:'boolean'}]]),additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('설정 객체가 필요합니다.');for(const k of Object.keys(input))if(!Object.hasOwn(BASE,k))throw new Error('알 수 없는 설정입니다.');const value=await update({...config,...input});if(!value)throw new Error('더 최근의 설정으로 대체되었습니다.');return resultSummary();}});
 register({name:'apply_factory_comparison',description:'Apply a preset relative to the saved comparison baseline and update visible results.',inputSchema:{type:'object',properties:{preset:{type:'string',enum:['base','chamber','staff','auto']}},required:['preset'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{const value=await applyPreset(input?.preset);if(!value)throw new Error('더 최근의 설정으로 대체되었습니다.');return resultSummary();}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
