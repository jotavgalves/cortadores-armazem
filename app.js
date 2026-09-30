(()=>{
'use strict';

const SPREADSHEET_ID='1o9JVEfpR03WCQfLYp8n2DLZe0VckLGWxKMsmxOtq6B8';
const SPREADSHEET_URL='https://docs.google.com/spreadsheets/d/'+SPREADSHEET_ID+'/edit?gid=0#gid=0';
const MAIN_SHEET='CORTES EM GERAL';
const MAIN_GID='0';
const AUTO_REFRESH_MS=60_000;
const MAIN_CUTTERS=[
  {id:'ednilson',label:'Ednilson'},
  {id:'veronica',label:'Verônica'},
  {id:'luana',label:'Luana'}
];
const HEADER_ALIASES={
  cutter:['QUEM CORTOU','CORTADOR','RESPONSAVEL PELO CORTE'],
  orderId:['ID_PEDIDO','ID PEDIDO','PEDIDO','ID DO PEDIDO'],
  cutType:['CORRIDO (1) OU LOCALIZADO(2)','CORRIDO 1 OU LOCALIZADO 2','TIPO DE CORTE','CORRIDO OU LOCALIZADO'],
  pieces:['TOTAL DE PEÇAS CORTADAS','TOTAL DE PECAS CORTADAS','PEÇAS CORTADAS','PECAS CORTADAS','TOTAL PEÇAS'],
  cutAt:['DATA DO CORTE','DATA CORTE','DATA/HORA DO CORTE']
};

const state={all:[],filtered:[],loaded:false,loading:false,lastSyncAt:0,quickRange:'month'};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const nf=new Intl.NumberFormat('pt-BR');

function stripMarks(value){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function normalizeHeader(value){
  return stripMarks(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function normalizeText(value){
  return stripMarks(value).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
function csvParse(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(quoted){
      if(c==='"'&&n==='"'){cell+='"';i++;}
      else if(c==='"')quoted=false;
      else cell+=c;
    }else{
      if(c==='"')quoted=true;
      else if(c===','){row.push(cell);cell='';}
      else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
      else if(c!=='\r')cell+=c;
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  const headers=(rows.shift()||[]);
  return rows
    .filter(r=>r.some(v=>String(v).trim()!==''))
    .map((r,index)=>({__row:index+2,...Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']))}));
}
function buildHeaderMap(row){
  const map=new Map();
  for(const key of Object.keys(row)){
    if(key==='__row')continue;
    map.set(normalizeHeader(key),key);
  }
  return map;
}
function rawField(row,aliases){
  const map=buildHeaderMap(row);
  for(const alias of aliases){
    const actual=map.get(normalizeHeader(alias));
    if(actual!==undefined)return row[actual];
  }
  return '';
}
function canonicalCutter(raw){
  const clean=normalizeText(raw);
  if(!clean)return {id:'nao-informado',label:'Não informado',known:false};
  if(clean.includes('EDNILSON'))return {id:'ednilson',label:'Ednilson',known:true};
  if(clean.includes('VERONICA'))return {id:'veronica',label:'Verônica',known:true};
  if(clean.includes('LUANA'))return {id:'luana',label:'Luana',known:true};
  const label=clean.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  return {id:'outro:'+clean,label,known:false};
}
function canonicalType(raw){
  const clean=normalizeText(raw);
  if(clean==='1'||clean.includes('CORRIDO'))return 'CORRIDO';
  if(clean==='2'||clean.includes('LOCALIZADO'))return 'LOCALIZADO';
  return 'NÃO INFORMADO';
}
function parsePieces(raw){
  const source=String(raw??'');
  const matches=[...source.matchAll(/\d+(?:[.,]\d+)?/g)].map(m=>m[0]);
  if(!matches.length)return {value:null,warning:source.trim()?'Sem número reconhecível':'Quantidade vazia',ambiguous:true};
  const value=Math.round(Number(matches[0].replace(',','.')));
  if(!Number.isFinite(value))return {value:null,warning:'Quantidade inválida',ambiguous:true};
  return {
    value,
    warning:matches.length>1?'Mais de um número na célula; usado o primeiro':'',
    ambiguous:matches.length>1
  };
}
function parseCutDate(raw){
  const text=String(raw??'').trim();
  let m=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));
  m=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));
  const d=new Date(text);
  return Number.isNaN(d.getTime())?null:d;
}
function canonicalRow(row,sourceSheet){
  const rawCutter=rawField(row,HEADER_ALIASES.cutter);
  const cutter=canonicalCutter(rawCutter);
  const rawPieces=rawField(row,HEADER_ALIASES.pieces);
  const pieces=parsePieces(rawPieces);
  const rawDate=rawField(row,HEADER_ALIASES.cutAt);
  const cutAt=parseCutDate(rawDate);
  return {
    sourceSheet,
    sourceRow:row.__row,
    cutterId:cutter.id,
    cutterName:cutter.label,
    cutterKnown:cutter.known,
    cutterRaw:String(rawCutter??''),
    orderId:String(rawField(row,HEADER_ALIASES.orderId)??''), // preservado como veio
    cutType:canonicalType(rawField(row,HEADER_ALIASES.cutType)),
    pieces:pieces.value,
    piecesRaw:String(rawPieces??''),
    warning:pieces.warning,
    ambiguousPieces:pieces.ambiguous,
    cutAt,
    cutAtRaw:String(rawDate??'')
  };
}
function endpoint(){
  return 'https://docs.google.com/spreadsheets/d/'+SPREADSHEET_ID+'/gviz/tq?tqx=out:csv&gid='+MAIN_GID+'&t='+Date.now();
}
function formatDate(d){
  if(!d)return 'Data inválida';
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function dateKey(d){
  return d?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):'';
}
function isoDate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function showBanner(text,type='error'){
  const el=$('#banner');el.textContent=text;el.className='banner show '+type;
}
function hideBanner(){ $('#banner').className='banner'; }

async function loadData(options={}){
  const silent=!!options.silent;
  if(state.loading)return;
  state.loading=true;
  const btn=$('#refreshBtn');
  if(!silent){
    btn.disabled=true;
    $('#syncText').textContent='Carregando cortes...';
  }
  hideBanner();
  try{
    const res=await fetch(endpoint(),{cache:'no-store'});
    if(!res.ok)throw new Error('Google Sheets respondeu HTTP '+res.status);
    const text=await res.text();
    const parsed=csvParse(text);
    if(!parsed.length)throw new Error('A aba '+MAIN_SHEET+' não retornou registros.');
    state.all=parsed.map(r=>canonicalRow(r,MAIN_SHEET));
    state.loaded=true;
    state.lastSyncAt=Date.now();
    populateCutters();

    if(state.quickRange) setQuickRange(state.quickRange,false);
    else establishInitialRange();

    applyFilters();
    $('#syncText').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' • automático a cada 1 min';

    const invalidDates=state.all.filter(x=>!x.cutAt).length;
    if(invalidDates)showBanner(invalidDates+' registro(s) têm data inválida e não entram nos filtros por período.');
  }catch(error){
    showBanner('Não consegui carregar a planilha: '+error.message+'. Confirme que ela permite leitura por link.');
    $('#syncText').textContent='Falha ao carregar dados';
  }finally{
    state.loading=false;
    btn.disabled=false;
  }
}
function establishInitialRange(){
  if($('#dateFrom').value&&$('#dateTo').value)return;
  const dates=state.all.map(x=>x.cutAt).filter(Boolean).sort((a,b)=>a-b);
  if(!dates.length)return;
  const latest=dates[dates.length-1];
  const first=new Date(latest.getFullYear(),latest.getMonth(),1);
  $('#dateFrom').value=isoDate(first);
  $('#dateTo').value=isoDate(latest);
}
function populateCutters(){
  const current=$('#cutterFilter').value;
  const map=new Map(state.all.map(x=>[x.cutterId,x.cutterName]));
  const options=[...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'));
  $('#cutterFilter').innerHTML='<option value="all">Todos</option>'+options.map(([id,label])=>'<option value="'+escapeHtml(id)+'">'+escapeHtml(label)+'</option>').join('');
  if(options.some(([id])=>id===current))$('#cutterFilter').value=current;
}
function applyFilters(){
  if(!state.loaded)return;
  const from=$('#dateFrom').value?new Date($('#dateFrom').value+'T00:00:00'):null;
  const to=$('#dateTo').value?new Date($('#dateTo').value+'T23:59:59'):null;
  const cutter=$('#cutterFilter').value,type=$('#typeFilter').value;
  const q=normalizeText($('#searchInput').value);
  state.filtered=state.all.filter(x=>{
    if(!x.cutAt)return false;
    if(from&&x.cutAt<from)return false;
    if(to&&x.cutAt>to)return false;
    if(cutter!=='all'&&x.cutterId!==cutter)return false;
    if(type!=='all'&&x.cutType!==type)return false;
    if(q&&!normalizeText(x.orderId+' '+x.cutterName+' '+x.cutterRaw).includes(q))return false;
    return true;
  });
  render();
}
function render(){
  const rows=state.filtered;
  const validPieces=rows.filter(x=>Number.isFinite(x.pieces));
  const totalPieces=validPieces.reduce((s,x)=>s+x.pieces,0);
  const uniqueOrders=new Set(rows.map(x=>x.orderId).filter(x=>String(x).trim()!==''));
  const active=new Set(rows.map(x=>x.cutterId).filter(x=>x!=='nao-informado'));

  $('#totalPieces').textContent=nf.format(totalPieces);
  $('#totalEvents').textContent=nf.format(rows.length);
  $('#uniqueOrders').textContent=nf.format(uniqueOrders.size);
  $('#activeCutters').textContent=nf.format(active.size);

  renderMainCutters(rows,totalPieces);
  renderTypes(rows);
  renderQuality(rows);
  renderTable(rows);
  renderChart(rows);
}
function renderMainCutters(rows,totalPieces){
  for(const cutter of MAIN_CUTTERS){
    const items=rows.filter(x=>x.cutterId===cutter.id);
    const pieces=items.reduce((s,x)=>s+(Number.isFinite(x.pieces)?x.pieces:0),0);
    const share=totalPieces?pieces/totalPieces*100:0;
    $('#'+cutter.id+'Pieces').textContent=nf.format(pieces)+' peças';
    $('#'+cutter.id+'Events').textContent=nf.format(items.length)+' eventos';
    $('#'+cutter.id+'Share').textContent=share.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  }
}
function renderTypes(rows){
  const groups=[
    ['CORRIDO','continuous'],
    ['LOCALIZADO','localized'],
    ['NÃO INFORMADO','unknown']
  ];
  for(const [type,prefix] of groups){
    const items=rows.filter(x=>x.cutType===type);
    const pieces=items.reduce((s,x)=>s+(Number.isFinite(x.pieces)?x.pieces:0),0);
    $('#'+prefix+'Pieces').textContent=nf.format(pieces)+' peças';
    $('#'+prefix+'Events').textContent=nf.format(items.length)+' eventos';
  }
}
function renderQuality(rows){
  const ambiguous=rows.filter(x=>x.ambiguousPieces).length;
  const noPieces=rows.filter(x=>!Number.isFinite(x.pieces)).length;
  const unknownType=rows.filter(x=>x.cutType==='NÃO INFORMADO').length;
  const unknownCutter=rows.filter(x=>!x.cutterKnown).length;
  const problems=ambiguous+noPieces+unknownType+unknownCutter;
  $('#qualityText').textContent=problems?nf.format(problems)+' ocorrências para revisar':'Sem alertas no período';
  $('#qualityHint').textContent='Peças ambíguas: '+ambiguous+' • sem quantidade: '+noPieces+' • tipo não informado: '+unknownType+' • cortador fora dos 3 principais: '+unknownCutter;
}
function renderTable(rows){
  const sorted=[...rows].sort((a,b)=>(b.cutAt||0)-(a.cutAt||0));
  $('#eventsBody').innerHTML=sorted.length?sorted.slice(0,500).map(x=>{
    const cls=x.cutType==='CORRIDO'?'corrido':x.cutType==='LOCALIZADO'?'localizado':'unknown';
    return '<tr>'+
      '<td>'+escapeHtml(formatDate(x.cutAt))+'</td>'+
      '<td><b>'+escapeHtml(x.cutterName)+'</b></td>'+
      '<td><b>'+escapeHtml(x.orderId||'—')+'</b></td>'+
      '<td><span class="pill '+cls+'">'+escapeHtml(x.cutType)+'</span></td>'+
      '<td>'+escapeHtml(Number.isFinite(x.pieces)?nf.format(x.pieces):'—')+'</td>'+
      '<td>'+escapeHtml(x.sourceSheet)+'</td>'+
      '<td class="'+(x.warning?'warning':'')+'">'+escapeHtml(x.warning||x.piecesRaw||'OK')+'</td>'+
    '</tr>';
  }).join(''):'<tr><td class="empty" colspan="7">Nenhum registro no período/filtro selecionado.</td></tr>';
}
function renderChart(rows){
  const canvas=$('#dailyChart'),ctx=canvas.getContext('2d');
  const ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const width=Math.max(320,canvas.clientWidth||800),height=Math.max(230,canvas.clientHeight||270);
  canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);
  const by=new Map();
  rows.forEach(x=>{if(x.cutAt&&Number.isFinite(x.pieces)){const k=dateKey(x.cutAt);by.set(k,(by.get(k)||0)+x.pieces);}});
  const data=[...by.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  if(!data.length){ctx.fillStyle='#6f7d93';ctx.font='11px DM Sans';ctx.fillText('Sem dados para o período.',20,36);$('#chartCaption').textContent='—';return;}
  const max=Math.max(...data.map(x=>x[1]),1),pad={l:45,r:15,t:15,b:34},gw=width-pad.l-pad.r,gh=height-pad.t-pad.b;
  ctx.font='9px DM Sans';ctx.lineWidth=1;
  for(let i=0;i<4;i++){
    const y=pad.t+gh*i/3;
    ctx.strokeStyle='#222c3a';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();
    ctx.fillStyle='#67758c';ctx.fillText(nf.format(Math.round(max*(1-i/3))),4,y+3);
  }
  const step=gw/Math.max(1,data.length),bar=Math.max(3,Math.min(18,step*.62));
  data.forEach(([k,v],i)=>{
    const x=pad.l+i*step+(step-bar)/2,y=pad.t+gh-(v/max)*gh;
    ctx.fillStyle='#9472ef';ctx.fillRect(x,y,bar,pad.t+gh-y);
    if(data.length<=14||i%Math.ceil(data.length/10)===0){
      const [,m,d]=k.split('-');ctx.fillStyle='#6d7a90';ctx.fillText(d+'/'+m,x-2,height-12);
    }
  });
  const total=data.reduce((s,x)=>s+x[1],0);
  $('#chartCaption').textContent=data.length+' dia(s) • '+nf.format(total)+' peças';
}
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function setQuickRange(mode,renderNow=true){
  state.quickRange=mode;
  $$('.quick-periods button').forEach(b=>b.classList.toggle('active',b.dataset.range===mode));
  const dates=state.all.map(x=>x.cutAt).filter(Boolean).sort((a,b)=>a-b);
  if(!dates.length)return;
  const latest=dates[dates.length-1];
  if(mode==='today'){
    $('#dateFrom').value=isoDate(latest);$('#dateTo').value=isoDate(latest);
  }else if(mode==='month'){
    $('#dateFrom').value=isoDate(new Date(latest.getFullYear(),latest.getMonth(),1));$('#dateTo').value=isoDate(latest);
  }else{
    $('#dateFrom').value=isoDate(dates[0]);$('#dateTo').value=isoDate(latest);
  }
  if(renderNow)applyFilters();
}

function clearQuickRange(){
  state.quickRange=null;
  $$('.quick-periods button').forEach(b=>b.classList.remove('active'));
}

$('#openSheet').addEventListener('click',()=>window.open(SPREADSHEET_URL,'_blank','noopener,noreferrer'));
$('#refreshBtn').addEventListener('click',()=>loadData());
['dateFrom','dateTo'].forEach(id=>$('#'+id).addEventListener('change',()=>{clearQuickRange();applyFilters();}));
['cutterFilter','typeFilter'].forEach(id=>$('#'+id).addEventListener('change',applyFilters));
$('#searchInput').addEventListener('input',applyFilters);
$$('[data-range]').forEach(b=>b.addEventListener('click',()=>setQuickRange(b.dataset.range)));
window.addEventListener('resize',()=>{if(state.loaded)renderChart(state.filtered);});
window.addEventListener('focus',()=>{if(Date.now()-state.lastSyncAt>30_000)loadData({silent:true});});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-state.lastSyncAt>30_000)loadData({silent:true});});
setInterval(()=>loadData({silent:true}),AUTO_REFRESH_MS);

loadData();

})();