import {BASE,LABELS,LIMITS,validate,simulate,snapshot,monthlyUtilization} from './model.mjs';
import {SimulationClient} from './simulation-client.mjs';
import {satelliteStatus,trackingSteps,cumulativeWait,stationStatus,pickTracked,satName} from './twin-state.mjs';
const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});
let config={...BASE},baseline={...BASE},result=simulate(config),baseResult=result,day=125,playing=false,speed=1,activePreset='base',toastTimer;
const client=new SimulationClient();client.seed(result);
let requestVersion=0,pending=Promise.resolve(result),computing=false;
const fields=[['demand','연간 발주량','기',16,256,8],['lines','조립 셀','개',1,10,1],['workers','조립인력','명',4,40,4],['chambers','시험챔버','개',1,6,1],['batch','챔버당 동시 시험','기',1,8,1],['rework','재작업 확률','%',0,30,1]];
const sat3d=extra=>`<div class="sat3d ${extra}"><i class="face front"></i><i class="face back"></i><i class="face left"></i><i class="face right"></i><i class="panel left"></i><i class="panel right"></i></div>`;
const STAGE_MODELS=[
 `<div class="model-scene stage-icon-0" aria-hidden="true">${sat3d('bare')}<div class="crate"></div><span class="scan-beam"></span><span class="loose-panel lp-left"></span><span class="loose-panel lp-right"></span></div>`,
 `<div class="model-scene stage-icon-1" aria-hidden="true">${sat3d('assembling')}<span class="tool-orbit"></span></div>`,
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
const capText=s=>s===1?`${result.capacity[s]} / ${result.config.lines}셀 가동`:s===3?`${result.config.chambers}챔버 × ${result.config.batch}기`:`${result.capacity[s]}개 작업대`;
let stagesBuilt=false;
function renderFlow(){
 const shot=snapshot(result,day);
 if(!stagesBuilt){
  // Built once so CSS animations on the static 3D model markup keep running instead of
  // restarting every 160ms playback tick (a full innerHTML replace recreates the DOM nodes).
  $('flow-stages').innerHTML=LABELS.map((name,s)=>`<article class="stage" data-stage="${s}" tabindex="0" role="button"><div class="stage-top"><span class="stage-number">0${s+1}</span><span class="stage-badge" hidden>병목</span></div><h3>${name}</h3><p class="stage-capacity"></p>${STAGE_MODELS[s]}<div class="stage-work" aria-hidden="true"></div><div class="stage-state"><span>작업<strong class="active-count">0</strong></span><span class="queued">대기<strong class="queue-count">0</strong></span></div><div class="util-track"><i></i></div><div class="stage-util"></div></article>`).join('');
  stagesBuilt=true;
 }
 $('flow-stages').querySelectorAll('.stage').forEach((article,s)=>{
  const stage=shot.stages[s],hot=s===result.bottleneck&&result.avgWait[s]>.25;
  const cap=capText(s);
  const tokens=stage.active.slice(0,12).map(j=>`<i class="sat-token ${j.retry?'retry':''}" style="opacity:${.55+j.progress*.45}" title="위성 ${String(j.id).padStart(3,'0')} · ${j.retry?'재작업 · ':''}${fmt(j.progress*100)}% 진행"></i>`).join('');
  article.classList.toggle('bottleneck',hot);
  article.classList.toggle('selected',selection.type==='station'&&selectedStation()===s);
  article.setAttribute('aria-label',`${stage.name}, 작업 중 ${stage.active.length}기, 대기 ${stage.queue.length}기. 3D 화면에서 보기`);
  article.querySelector('.stage-badge').hidden=!hot;
  article.querySelector('.stage-capacity').textContent=cap;
  article.querySelector('.stage-work').innerHTML=(tokens||'<span class="idle-label">작업 대기</span>')+(stage.active.length>12?`<span class="extra-token">+${stage.active.length-12}</span>`:'');
  article.querySelector('.active-count').textContent=stage.active.length;
  article.querySelector('.queue-count').textContent=stage.queue.length;
  article.querySelector('.util-track i').style.width=`${Math.min(100,result.util[s]*100)}%`;
  article.querySelector('.stage-util').textContent=`연간 가동률 ${fmt(result.util[s]*100)}%`;
 });
 $('day-label').textContent=`${fmt(day)} / 250 가동일`;
 $('day-summary').textContent=`투입 ${shot.released}기 · 공정 내 ${shot.wip}기 · 출하 ${shot.completed}기`;
 $('day').value=day;
 const b=result.bottleneck;
 $('bottleneck-note').innerHTML=result.avgWait[b]>.25?`<strong>${LABELS[b]} 대기가 가장 깁니다.</strong> 평균 ${fmt(result.avgWait[b],1)}가동일 대기 · ${b===1&&result.capacity[1]<result.config.lines?`인력 부족으로 조립 셀 ${result.config.lines-result.capacity[1]}개가 가동되지 않습니다.`:b===3?'챔버 수와 동시 시험 수량을 조정해 효과를 확인하세요.':b===1?'조립 셀 수와 셀당 필요한 인력을 함께 확인하세요.':'다른 공정의 증설보다 이 공정의 처리조건을 먼저 확인하세요.'}`:'<strong>현재 발주량에서 대기가 거의 없습니다.</strong> 설비를 늘리기 전에 발주량과 공정시간을 함께 확인하세요.';
 renderTwin(shot);
}

// ---- Digital twin overlays: what is selected, which spacecraft the tracker follows, and the glass cards. ----
let twin=null,selection={type:'station',s:null},trackedId=null,trackedPinned=false,listTab='stations',lastTwinDay=day;
const STATUS={bottleneck:'병목',full:'풀가동',running:'가동 중',idle:'유휴'};
const svg=d=>`<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON={
 clock:svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),inbox:svg('<path d="M12 3v11m0 0-4-4m4 4 4-4"/><path d="M4 14v5h16v-5"/>'),
 cycle:svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>'),rocket:svg('<path d="M12 2c3 2.2 5 6 5 10l-2 4H9l-2-4c0-4 2-7.8 5-10z"/><circle cx="12" cy="10" r="2"/><path d="M9 16l-2 4m8-4 2 4"/>'),
 sat:svg('<rect x="9" y="9" width="6" height="6" rx="1"/><path d="M3 10h5v4H3zM16 10h5v4h-5zM12 9V5"/>'),
 stage:[svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),svg('<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>'),svg('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),svg('<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/>'),svg('<path d="M12 2c3 2.2 5 6 5 10l-2 4H9l-2-4c0-4 2-7.8 5-10z"/><path d="M9 16l-2 4m8-4 2 4"/>')]
};
const setHTML=(el,html)=>{if(el._html!==html){el.innerHTML=html;el._html=html;}};
const dayText=d=>`D+${fmt(d,1)}`;
const defaultStation=()=>result.avgWait[result.bottleneck]>.25?result.bottleneck:1;
const selectedStation=()=>selection.s??defaultStation();
function select(sel,{fly=true}={}){
 if(sel.type==='sat'){
  if(!(sel.id>=1&&sel.id<=result.jobs.length))return toast('해당 번호의 위성이 없습니다.');
  trackedId=sel.id;trackedPinned=true;
 }
 selection=sel;
 twin?.select(sel.type==='station'?{type:'station',s:selectedStation()}:sel,{fly});
 renderFlow();
}
function satRow(id){
 const st=satelliteStatus(result.jobs[id-1],day);
 const right=st.phase==='active'?`<span class="mini-bar"><b style="width:${st.progress*100}%"></b></span><span class="pill ${st.retry?'bottleneck':'running'}">${Math.round(st.progress*100)}%</span>`:`<span class="pill ${day-st.since>10?'bottleneck':'wait'}">대기 ${fmt(day-st.since,1)}일</span>`;
 return `<button type="button" class="sat-row" data-sat="${id}"><span class="sat-ico ${st.phase}">${ICON.sat}</span><span class="sat-id">${satName(id)}${st.retry?'<em class="tag">재작업</em>':''}<small>${LABELS[st.stage]}</small></span>${right}</button>`;
}
function stationPanel(s,shot){
 const st=shot.stages[s],status=stationStatus(result,shot,s),seats=s===3?result.config.chambers*result.config.batch:result.capacity[s];
 const ids=[...st.active.map(a=>a.id),...st.queue].slice(0,6);
 return `<div class="panel-head"><span class="panel-ico">${ICON.stage[s]}</span><div><small>STATION 0${s+1}</small><h3>${LABELS[s]}</h3></div><span class="pill ${status}">${STATUS[status]}</span></div>
<p class="panel-sub">${capText(s)}</p>
<div class="kpis"><div><small>작업 중</small><strong>${st.active.length}<em>/ ${seats}</em></strong><i class="bar"><b style="width:${Math.min(100,st.active.length/Math.max(1,seats)*100)}%"></b></i></div><div><small>대기</small><strong>${st.queue.length}<em>기</em></strong><i class="bar warn"><b style="width:${Math.min(100,st.queue.length/12*100)}%"></b></i></div><div><small>연간 가동률</small><strong>${fmt(result.util[s]*100)}<em>%</em></strong></div><div><small>평균 대기</small><strong>${fmt(result.avgWait[s],1)}<em>일</em></strong></div></div>
<div class="list-head"><span>현재 위성</span><span>${st.active.length+st.queue.length}기</span></div>
${ids.length?ids.map(satRow).join(''):'<p class="empty">지금 이 공정에 있는 위성이 없습니다.</p>'}`;
}
function satPanel(id){
 const job=result.jobs[id-1],st=satelliteStatus(job,day);
 const [label,cls]=st.phase==='pending'?['투입 전','idle']:st.phase==='shipped'?['출하 완료','done']:st.phase==='queue'?['대기 중','wait']:st.retry?['재작업 중','bottleneck']:['작업 중','running'];
 const where=st.phase==='pending'?`${dayText(job.release)} 투입 예정`:st.phase==='shipped'?`${dayText(job.done)} 출하`:`${LABELS[st.stage]} · ${st.phase==='active'?'처리 중':'대기열'}`;
 const progress=st.phase==='active'?`<div class="progress"><div><span>공정 진행</span><strong>${Math.round(st.progress*100)}%</strong></div><i class="bar"><b style="width:${st.progress*100}%"></b></i><small>남은 ${fmt(st.end-day,1)}가동일</small></div>`:'';
 const late=job.done>result.year;
 const kv=[['투입',dayText(job.release)],[st.phase==='queue'?'대기 시작':'공정 시작',st.phase==='active'?dayText(st.start):st.phase==='queue'?dayText(st.since):'—'],['누적 대기',`${fmt(cumulativeWait(job,day),1)}일`],[st.phase==='shipped'?'출하':'출하 예정',`${dayText(job.done)}${late?' <em class="tag warn">연말 이월</em>':''}`],['재작업',job.segments.some(s=>s.retry&&s.start<=day)||st.retry?'<em class="tag">조립 재작업 1회</em>':'없음']];
 return `<div class="panel-head"><span class="panel-ico">${ICON.sat}</span><div><small>SATELLITE</small><h3>${satName(id)}</h3></div><span class="pill ${cls}">${label}</span></div>
<p class="panel-sub">${where}</p>${progress}
<dl class="kv">${kv.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
<button type="button" class="text-link" data-station="${st.stage??0}">← ${LABELS[st.stage??0]} 공정 보기</button>`;
}
function trackerShell(){
 return `<div class="tracker-head"><span class="panel-ico">${ICON.sat}</span><strong>위성 추적</strong><button type="button" class="tracker-id" data-sat=""></button><span class="tracker-mode"></span><button type="button" class="text-link tracker-unpin" hidden>자동 추적으로</button></div>
<div class="tracker-body"><ol class="steps">${LABELS.map((label,s)=>`<li class="step" data-state="upcoming"><span class="step-dot">${ICON.stage[s]}</span><span class="step-label">${label}</span><span class="step-time"></span><em class="step-tag" hidden>재작업</em></li>`).join('')}</ol><div class="tracker-eta"></div></div><p class="empty tracker-empty" hidden>모든 위성이 출하되었습니다.</p>`;
}
function renderTracker(){
 const el=$('twin-tracker');
 if(!el.firstChild)el.innerHTML=trackerShell();
 const empty=!trackedId;
 el.querySelector('.tracker-body').hidden=empty;el.querySelector('.tracker-empty').hidden=!empty;
 el.querySelector('.tracker-unpin').hidden=!trackedPinned;
 el.querySelector('.tracker-mode').textContent=trackedPinned?'선택 고정':'자동 추적';
 if(empty)return;
 const job=result.jobs[trackedId-1],{status,steps}=trackingSteps(job,day);
 const idBtn=el.querySelector('.tracker-id');idBtn.textContent=satName(trackedId);idBtn.dataset.sat=trackedId;
 el.querySelectorAll('.step').forEach((li,i)=>{
  const step=steps[i];
  if(li.dataset.state!==step.state)li.dataset.state=step.state;
  li.querySelector('.step-time').textContent=step.state==='done'?dayText(step.time):step.state==='current'?(status.phase==='active'?`진행 ${Math.round(status.progress*100)}%`:`대기 ${fmt(day-status.since,1)}일`):`예정 ${dayText(step.time)}`;
  li.querySelector('.step-tag').hidden=!step.rework;
 });
 const shipped=status.phase==='shipped',pend=status.phase==='pending';
 setHTML(el.querySelector('.tracker-eta'),`<small>${shipped?'출하 완료':pend?'투입 예정':'예정 출하'}</small><strong>${dayText(pend?job.release:job.done)}</strong><span>${shipped?`제작기간 ${fmt(job.done-job.release,1)}일`:pend?`출하 예정 ${dayText(job.done)}`:`남은 ${fmt(job.done-day,1)}일`}</span>${job.done>result.year&&!shipped?'<em class="tag warn">연말 이월</em>':''}`);
}
function renderList(shot){
 const active=[],queued=[];
 shot.stages.forEach(st=>{active.push(...st.active.map(a=>a.id));queued.push(...st.queue);});
 const since=id=>satelliteStatus(result.jobs[id-1],day).since;
 const tabs=[['stations','공정',5],['active','작업 중',active.length],['queue','대기',queued.length]];
 const rows=listTab==='stations'?LABELS.map((label,s)=>{
  const st=shot.stages[s],status=stationStatus(result,shot,s);
  return `<button type="button" class="list-row" data-station="${s}"><span class="num">0${s+1}</span><span class="name">${label}<small>작업 ${st.active.length} · 대기 ${st.queue.length}</small></span><span class="pill ${status}">${STATUS[status]}</span></button>`;
 }).join(''):(listTab==='active'?active.sort((a,b)=>satelliteStatus(result.jobs[b-1],day).progress-satelliteStatus(result.jobs[a-1],day).progress):queued.sort((a,b)=>since(a)-since(b))).slice(0,6).map(satRow).join('')||'<p class="empty">해당하는 위성이 없습니다.</p>';
 setHTML($('twin-list'),`<div class="tabs" role="tablist" aria-label="공장 현황 목록">${tabs.map(([key,label,n])=>`<button type="button" role="tab" data-tab="${key}" aria-selected="${listTab===key}">${label}<b>${n}</b></button>`).join('')}</div><div class="tab-body" role="tabpanel">${rows}</div>`);
}
function renderTwin(shot){
 if(trackedPinned&&trackedId>result.jobs.length)trackedPinned=false;
 if(selection.type==='sat'&&selection.id>result.jobs.length)selection={type:'station',s:null};
 if(!trackedPinned)trackedId=pickTracked(result,day,trackedId);
 const pct=shot.completed/result.config.demand*100;
 setHTML($('twin-chips'),`<div class="chip"><span class="chip-ico">${ICON.clock}</span><div><small>가동일</small><strong>D+${fmt(day)}</strong><em>/ 250</em></div></div><div class="chip"><span class="chip-ico">${ICON.inbox}</span><div><small>투입</small><strong>${shot.released}</strong><em>기</em></div></div><div class="chip"><span class="chip-ico">${ICON.cycle}</span><div><small>공정 내</small><strong>${shot.wip}</strong><em>기</em></div></div><div class="chip"><span class="chip-ico">${ICON.rocket}</span><div><small>출하</small><strong>${shot.completed}</strong><em>/ ${result.config.demand}</em><i class="chip-bar"><b style="width:${pct}%"></b></i></div></div>`);
 setHTML($('twin-panel'),selection.type==='sat'?satPanel(selection.id):stationPanel(selectedStation(),shot));
 renderTracker();renderList(shot);
 const live=$('live-pill');live.querySelector('span').textContent=`D+${fmt(day)}`;live.classList.toggle('playing',playing);
 // Small steps glide; scrubbing the timeline or reloading a scenario jumps.
 twin?.update({result,shot,day,snap:Math.abs(day-lastTwinDay)>4.5,station:selection.type==='station'?selectedStation():null});
 lastTwinDay=day;
}
$('twin').addEventListener('click',e=>{
 const t=e.target.closest('[data-sat],[data-station],[data-tab],[data-action],.tracker-unpin');
 if(!t)return;
 if(t.classList.contains('tracker-unpin')){trackedPinned=false;if(selection.type==='sat')selection={type:'station',s:null};twin?.select({type:'station',s:selectedStation()},{fly:false});renderFlow();return;}
 if(t.dataset.sat)return select({type:'sat',id:Number(t.dataset.sat)});
 if(t.dataset.station)return select({type:'station',s:Number(t.dataset.station)});
 if(t.dataset.tab){listTab=t.dataset.tab;return renderFlow();}
 const action=t.dataset.action;
 if(action==='zoom-in')twin?.zoom(.72);
 if(action==='zoom-out')twin?.zoom(1.38);
 if(action==='reset'){twin?.resetView();}
 if(action==='rotate'&&twin)t.setAttribute('aria-pressed',String(twin.toggleRotate()));
 if(action==='fullscreen'){if(document.fullscreenElement)document.exitFullscreen();else $('twin').requestFullscreen?.().catch(()=>toast('전체 화면을 사용할 수 없습니다.'));}
});
const pickStage=e=>{const card=e.target.closest('.stage');if(card)select({type:'station',s:Number(card.dataset.stage)});};
$('flow-stages').addEventListener('click',pickStage);
$('flow-stages').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pickStage(e);}});
$('sat-search').addEventListener('submit',e=>{
 e.preventDefault();
 const id=Number(($('sat-search-input').value.match(/\d+/)||[])[0]);
 if(!id||id>result.jobs.length)return toast(`1~${result.jobs.length} 사이 위성 번호를 입력하세요.`);
 select({type:'sat',id});
 const r=$('twin').getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)$('twin').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
});
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
 const scale=Math.max(...result.avgWait,...baseResult.avgWait,1);
 $('wait-chart').innerHTML='<div class="wait-bars">'+LABELS.map((label,i)=>`<div class="wait-row ${i===result.bottleneck?'hot':''}"><span>${label}</span><div class="wait-bar"><i class="base" style="width:${baseResult.avgWait[i]/scale*100}%"></i><i class="current" style="width:${result.avgWait[i]/scale*100}%"></i></div><strong>${fmt(result.avgWait[i],1)}<small>기준 ${fmt(baseResult.avgWait[i],1)}</small></strong></div>`).join('')+'</div>';
}
const STAGE_COLORS=['#63deca','#4a9bff','#f0b650','#a78bfa','#e2806e'];
function costChart(){
 const el=$('cost-chart');
 if(!result.cost){el.innerHTML='<p class="chart-empty">연내 출하분이 없어 비용을 계산할 수 없습니다.</p>';return;}
 const c=result.config,shipments=result.shipments,annualReworked=result.jobs.filter(j=>j.done<=result.year&&j.reworked).length;
 const segs=[['재료비',c.materialCost,STAGE_COLORS[0]],['인건비',c.workers*c.laborCost/shipments,STAGE_COLORS[1]],['조립 셀',c.lines*2/shipments,'#8aa0c2'],['시험챔버',c.chambers*4/shipments,STAGE_COLORS[2]],['기타 고정비',10/shipments,'#c3ccd8'],...(c.automatic?[['자동검사',3/shipments,STAGE_COLORS[3]]]:[]),['재작업비',annualReworked*.15/shipments,STAGE_COLORS[4]]];
 const total=segs.reduce((s,[,v])=>s+v,0);
 el.innerHTML=`<div class="cost-bar">${segs.map(([label,v,color])=>`<i style="width:${v/total*100}%;background:${color}" title="${label} ${fmt(v,2)}억원"></i>`).join('')}</div><div class="mini-legend">${segs.map(([label,v,color])=>`<span><i style="background:${color}"></i>${label}<strong>${fmt(v,2)}억</strong></span>`).join('')}</div>`;
}
function utilChart(){
 const data=monthlyUtilization(result),W=530,H=190,L=34,R=12,T=10,B=22;
 const x=i=>L+i*(W-L-R)/11,y=v=>H-B-v*(H-T-B);
 let svg=`<svg class="output-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 설비 가동률 추이">`;
 for(let i=0;i<=4;i++){const v=i/4;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#e7edf4" stroke-dasharray="3 4"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${fmt(v*100)}%</text>`;}
 for(let i=0;i<12;i+=3)svg+=`<text x="${x(i)}" y="${H-6}" text-anchor="middle">${i+1}월</text>`;
 LABELS.forEach((label,s)=>{svg+=`<polyline points="${data.map((row,m)=>`${x(m)},${y(row[s])}`).join(' ')}" fill="none" stroke="${STAGE_COLORS[s]}" stroke-width="2.3" stroke-linejoin="round"/>`;});
 $('util-chart').innerHTML=svg+'</svg>';
 $('util-legend').innerHTML=LABELS.map((label,s)=>`<span><i style="background:${STAGE_COLORS[s]}"></i>${label}</span>`).join('');
}
function ganttSample(res){
 const jobs=res.jobs,n=Math.min(10,jobs.length);
 if(n<=1)return jobs.slice(0,n);
 const idx=Array.from({length:n},(_,k)=>Math.round(k*(jobs.length-1)/(n-1)));
 const reworkIdx=jobs.findIndex(j=>j.reworked);
 if(reworkIdx>=0&&!idx.includes(reworkIdx))idx[Math.floor(n/2)]=reworkIdx;
 return [...new Set(idx)].sort((a,b)=>a-b).map(i=>jobs[i]);
}
function ganttChart(){
 const domain=Math.max(result.finish,result.year,1),pct=v=>Math.min(100,Math.max(0,v/domain*100));
 const rows=ganttSample(result).map(j=>{
  const wait=j.queues.map(q=>`<i class="gantt-wait" style="left:${pct(q.start)}%;width:${Math.max(pct(q.end-q.start),.4)}%"></i>`).join('');
  const segs=j.segments.map(seg=>`<i class="gantt-seg" style="left:${pct(seg.start)}%;width:${Math.max(pct(seg.end-seg.start),.6)}%;background:${STAGE_COLORS[seg.stage]}" title="${LABELS[seg.stage]} · ${fmt(seg.start,1)}~${fmt(seg.end,1)}가동일${seg.retry?' · 재작업':''}"></i>`).join('');
  const done=j.done!=null&&j.done<=domain?`<i class="gantt-marker done" style="left:${pct(j.done)}%" title="출하 ${fmt(j.done,1)}가동일"></i>`:'';
  return `<div class="gantt-row"><span class="gantt-label">#${String(j.id).padStart(3,'0')}${j.reworked?'<i class="rework-dot" title="재작업 발생"></i>':''}</span><div class="gantt-track">${wait}${segs}<i class="gantt-marker" style="left:${pct(j.release)}%" title="투입 ${fmt(j.release,1)}가동일"></i>${done}</div></div>`;
 }).join('');
 $('gantt-chart').innerHTML=`<div class="gantt">${rows}</div><div class="gantt-axis">${Array.from({length:5},(_,i)=>`<span style="left:${i/4*100}%">${fmt(domain*i/4)}일</span>`).join('')}</div>`;
 $('gantt-legend').innerHTML=LABELS.map((label,s)=>`<span><i style="background:${STAGE_COLORS[s]}"></i>${label}</span>`).join('')+'<span><i class="wait-swatch"></i>대기</span>';
}
function reworkFlow(){
 const visits=LABELS.map((_,s)=>result.jobs.reduce((n,j)=>n+j.segments.filter(seg=>seg.stage===s).length,0));
 const max=Math.max(...visits,1);
 const rows=LABELS.map((label,s)=>`<div class="wait-row"><span>${label}</span><div class="wait-bar"><i style="width:${visits[s]/max*100}%;background:${STAGE_COLORS[s]}"></i></div><strong>${visits[s]}건</strong></div>`).join('');
 const extra=visits[1]-config.demand;
 $('rework-flow').innerHTML=`<div class="wait-bars">${rows}</div><div class="control-note">${extra>0?`<strong>↺ 재작업 ${result.reworkCount}기</strong>가 기능시험에서 조립으로 되돌아가 다시 처리됩니다. 조립 처리 건수(${visits[1]}건)가 발주량(${config.demand}기)보다 ${extra}건 많은 이유입니다.`:'현재 조건에서는 재작업이 발생하지 않아 모든 공정이 발주량만큼만 처리합니다.'}</div>`;
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
function render(){renderMetrics();renderFlow();comparison();chart();costChart();utilChart();ganttChart();reworkFlow();}
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
function resultSummary(){return {config:{...config},baseline:{...baseline},annualShipments:result.shipments,averageLeadDays:result.shipments?result.lead:null,unitCostBillionKRW:result.cost===null?null:result.cost/10,lastShipmentWorkingDay:result.finish,bottleneck:LABELS[result.bottleneck],snapshot:snapshot(result,day)};}
async function readLatestResult(){let observed;do{observed=pending;await observed;}while(observed!==pending);return resultSummary();}
syncControls();render();
// The 3D view is optional: if WebGL or the module is unavailable the overlays and stage cards still work.
import('./twin.mjs').then(({createTwin})=>{
 twin=createTwin($('twin-stage'),{onSelect:select});
 twin.select({type:'station',s:selectedStation()},{fly:false});
 lastTwinDay=Infinity;renderFlow();
}).catch(error=>{
 console.warn('3D digital twin unavailable:',error);
 $('twin').classList.add('no-webgl');$('twin-fallback').hidden=false;
});
const context=document.modelContext;
if(context?.registerTool){
 const lifecycle=new AbortController();
 const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_factory_scenario',description:'Read current factory assumptions, production results and displayed production snapshot.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:readLatestResult});
 register({name:'configure_factory_scenario',description:'Change factory assumptions and recompute the visible simulation. Baseline remains unchanged.',inputSchema:{type:'object',properties:Object.fromEntries([...Object.entries(LIMITS).map(([k,[min,max]])=>[k,{type:['materialCost','laborCost'].includes(k)?'number':'integer',minimum:min,maximum:max}]),['automatic',{type:'boolean'}]]),additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('설정 객체가 필요합니다.');for(const k of Object.keys(input))if(!Object.hasOwn(BASE,k))throw new Error('알 수 없는 설정입니다.');const value=await update({...config,...input});if(!value)throw new Error('더 최근의 설정으로 대체되었습니다.');return resultSummary();}});
 register({name:'apply_factory_comparison',description:'Apply a preset relative to the saved comparison baseline and update visible results.',inputSchema:{type:'object',properties:{preset:{type:'string',enum:['base','chamber','staff','auto']}},required:['preset'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{const value=await applyPreset(input?.preset);if(!value)throw new Error('더 최근의 설정으로 대체되었습니다.');return resultSummary();}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
