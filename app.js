(()=>{
'use strict';

const SPREADSHEET_ID='1o9JVEfpR03WCQfLYp8n2DLZe0VckLGWxKMsmxOtq6B8';
const SPREADSHEET_URL='https://docs.google.com/spreadsheets/d/'+SPREADSHEET_ID+'/edit?gid=1211266709#gid=1211266709';
const MAIN_SHEET='CORTES EM GERAL';
const MAIN_GID='1211266709';
const AUTO_REFRESH_MS=60_000;

const PREFERRED_CUTTER_ORDER=['ednilson','luana','veronica','deygleison'];
const CUTTER_COLORS={
  ednilson:'#9c78ff',
  luana:'#6ca5ff',
  veronica:'#5fd0b4',
  deygleison:'#e6ba58',
  'nao-informado':'#7f8a9d'
};
const EXTRA_CUTTER_COLORS=['#d98cff','#62c8e5','#ef8d72','#8bd17c','#d6a8ff','#f2c96d','#68d3c1','#9db1ff'];

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
function displayCutterName(raw){
  const cleaned=String(raw??'')
    .replace(/[^\p{L}\p{N}\s.'-]/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!cleaned)return 'Não informado';
  return cleaned
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s'-])(\p{L})/gu,(m,prefix,letter)=>prefix+letter.toLocaleUpperCase('pt-BR'));
}
function canonicalCutter(raw){
  const clean=normalizeText(raw);
  if(!clean)return {id:'nao-informado',label:'Não informado',known:false};
  if(clean.includes('EDNILSON'))return {id:'ednilson',label:'Ednilson',known:true};
  if(clean.includes('LUANA'))return {id:'luana',label:'Luana',known:true};
  if(clean.includes('VERONICA'))return {id:'veronica',label:'Verônica',known:true};
  if(clean.includes('DEYGLEISON')||clean.includes('DEIGLEISON'))return {id:'deygleison',label:'Deygleison',known:true};
  return {
    id:'cutter-'+clean.toLowerCase().replace(/\s+/g,'-'),
    label:displayCutterName(raw),
    known:true
  };
}
function cutterColor(id){
  if(CUTTER_COLORS[id])return CUTTER_COLORS[id];
  let hash=0;
  for(const ch of id)hash=((hash<<5)-hash)+ch.charCodeAt(0);
  return EXTRA_CUTTER_COLORS[Math.abs(hash)%EXTRA_CUTTER_COLORS.length];
}
function cuttersFromRows(rows){
  const map=new Map();
  for(const row of rows){
    if(!map.has(row.cutterId))map.set(row.cutterId,{id:row.cutterId,label:row.cutterName,color:cutterColor(row.cutterId)});
  }
  const priority=id=>{
    if(id==='nao-informado')return 9999;
    const index=PREFERRED_CUTTER_ORDER.indexOf(id);
    return index>=0?index:100;
  };
  return [...map.values()].sort((a,b)=>{
    const pa=priority(a.id),pb=priority(b.id);
    if(pa!==pb)return pa-pb;
    return a.label.localeCompare(b.label,'pt-BR');
  });
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
  if(!matches.length)return {value:null,warning:source.trim()?'Sem número reconhecível':'Quantidade vazia',ambiguous:false};
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
    orderId:String(rawField(row,HEADER_ALIASES.orderId)??''),
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
function validOrderId(value){return String(value??'').trim()!=='';}
function rowIssues(row){
  const issues=[];
  if(row.ambiguousPieces)issues.push('Quantidade ambígua');
  if(!Number.isFinite(row.pieces))issues.push(row.warning||'Sem quantidade');
  if(row.cutType==='NÃO INFORMADO')issues.push('Tipo não informado');
  if(row.cutterId==='nao-informado')issues.push(row.cutterRaw.trim()?'Cortador não mapeado: '+row.cutterRaw:'Cortador não informado');
  return issues;
}

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
    if(state.quickRange)setQuickRange(state.quickRange,false);
    else establishInitialRange();

    applyFilters();
    $('#syncText').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' • automático a cada 1 min';

    const invalidDates=state.all.filter(x=>!x.cutAt).length;
    if(invalidDates)showBanner(invalidDates+' registro(s) têm data inválida e não entram nos filtros por período.');
  }catch(error){
    showBanner('Não consegui carregar a planilha: '+error.message+'.');
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
  $('#dateFrom').value=isoDate(new Date(latest.getFullYear(),latest.getMonth(),1));
  $('#dateTo').value=isoDate(latest);
}
function populateCuttersForPeriod(from,to){
  const select=$('#cutterFilter');
  const current=select.value;
  const periodRows=state.all.filter(x=>{
    if(!x.cutAt)return false;
    if(from&&x.cutAt<from)return false;
    if(to&&x.cutAt>to)return false;
    return true;
  });
  const cutters=cuttersFromRows(periodRows);
  select.innerHTML='<option value="all">Todos</option>'+
    cutters.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.label)+'</option>').join('');
  select.value=cutters.some(x=>x.id===current)?current:'all';
}
function applyFilters(){
  if(!state.loaded)return;
  const from=$('#dateFrom').value?new Date($('#dateFrom').value+'T00:00:00'):null;
  const to=$('#dateTo').value?new Date($('#dateTo').value+'T23:59:59'):null;
  populateCuttersForPeriod(from,to);
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
  const uniqueOrders=new Set(rows.map(x=>x.orderId).filter(validOrderId));
  const activeDays=new Set(validPieces.map(x=>dateKey(x.cutAt)).filter(Boolean));
  const dailyAverage=activeDays.size?totalPieces/activeDays.size:0;

  $('#totalPieces').textContent=nf.format(totalPieces);
  $('#uniqueOrders').textContent=nf.format(uniqueOrders.size);
  $('#dailyAverage').textContent=nf.format(Math.round(dailyAverage));
  $('#dailyAverageHint').textContent=nf.format(activeDays.size)+' dia'+(activeDays.size===1?'':'s')+' com produção';
  $('#totalEvents').textContent=nf.format(rows.length);

  renderMainCutters(rows,totalPieces);
  renderTypes(rows);
  renderQuality(rows);
  renderTable(rows);
  renderChart(rows);
}
function renderMainCutters(rows,totalPieces){
  const cutters=cuttersFromRows(rows);
  const container=$('#cutterCards');
  container.innerHTML=cutters.map(cutter=>{
    const items=rows.filter(x=>x.cutterId===cutter.id);
    const pieces=items.reduce((s,x)=>s+(Number.isFinite(x.pieces)?x.pieces:0),0);
    const orders=new Set(items.map(x=>x.orderId).filter(validOrderId)).size;
    const share=totalPieces?pieces/totalPieces*100:0;
    const shareText=share.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
    return '<article class="cutter-card panel" style="--cutter-color:'+cutter.color+'">'+
      '<div class="cutter-head"><span>'+escapeHtml(cutter.label.toLocaleUpperCase('pt-BR'))+'</span><b>'+escapeHtml(shareText)+'</b></div>'+
      '<strong>'+escapeHtml(nf.format(pieces))+' peças</strong>'+
      '<div class="share-track"><i style="width:'+Math.max(0,Math.min(100,share))+'%"></i></div>'+
      '<div class="cutter-meta"><span>'+escapeHtml(nf.format(orders))+' pedido'+(orders===1?'':'s')+'</span><span>'+escapeHtml(nf.format(items.length))+' evento'+(items.length===1?'':'s')+'</span></div>'+
    '</article>';
  }).join('');
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
    $('#'+prefix+'Events').textContent=nf.format(items.length)+' evento'+(items.length===1?'':'s');
  }
}
function renderQuality(rows){
  const ambiguous=rows.filter(x=>x.ambiguousPieces).length;
  const noPieces=rows.filter(x=>!Number.isFinite(x.pieces)).length;
  const unknownType=rows.filter(x=>x.cutType==='NÃO INFORMADO').length;
  const unknownCutter=rows.filter(x=>x.cutterId==='nao-informado').length;
  const problemRows=rows.filter(x=>rowIssues(x).length>0);
  $('#qualityText').textContent=nf.format(problemRows.length);
  $('#qualityHint').textContent=problemRows.length
    ? 'Precisam de revisão • peças ambíguas: '+ambiguous+' • sem quantidade: '+noPieces+' • tipo não informado: '+unknownType+' • cortador não informado: '+unknownCutter
    : 'Sem alertas no período.';
}
function renderTable(rows){
  const sorted=[...rows].sort((a,b)=>(b.cutAt||0)-(a.cutAt||0));
  $('#eventsBody').innerHTML=sorted.length?sorted.slice(0,500).map(x=>{
    const cls=x.cutType==='CORRIDO'?'corrido':x.cutType==='LOCALIZADO'?'localizado':'unknown';
    const issues=rowIssues(x);
    return '<tr>'+
      '<td>'+escapeHtml(formatDate(x.cutAt))+'</td>'+
      '<td><b>'+escapeHtml(x.cutterName)+'</b></td>'+
      '<td><b>'+escapeHtml(x.orderId||'—')+'</b></td>'+
      '<td>'+escapeHtml(Number.isFinite(x.pieces)?nf.format(x.pieces):'—')+'</td>'+
      '<td><span class="pill '+cls+'">'+escapeHtml(x.cutType)+'</span></td>'+
      '<td class="'+(issues.length?'warning':'ok')+'">'+escapeHtml(issues.join(' • ')||'OK')+'</td>'+
    '</tr>';
  }).join(''):'<tr><td class="empty" colspan="6">Nenhum registro no período/filtro selecionado.</td></tr>';
}
function renderChart(rows){
  const canvas=$('#dailyChart'),ctx=canvas.getContext('2d');
  const ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const width=Math.max(320,canvas.clientWidth||1000),height=Math.max(240,canvas.clientHeight||300);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);

  const cutters=cuttersFromRows(rows);
  const keys=[...new Set(rows.filter(x=>x.cutAt&&Number.isFinite(x.pieces)).map(x=>dateKey(x.cutAt)))].sort();
  $('#chartLegend').innerHTML=cutters.map(x=>'<span><i style="background:'+x.color+'"></i>'+escapeHtml(x.label)+'</span>').join('');
  if(!keys.length){
    ctx.fillStyle='#6f7d93';ctx.font='11px DM Sans';ctx.fillText('Sem dados para o período.',20,40);
    $('#chartCaption').textContent='—';
    return;
  }

  const byCutter=new Map(cutters.map(c=>[c.id,new Map()]));
  rows.forEach(x=>{
    if(!x.cutAt||!Number.isFinite(x.pieces)||!byCutter.has(x.cutterId))return;
    const k=dateKey(x.cutAt),map=byCutter.get(x.cutterId);
    map.set(k,(map.get(k)||0)+x.pieces);
  });

  let max=1;
  for(const map of byCutter.values())for(const value of map.values())max=Math.max(max,value);
  const pad={l:52,r:18,t:20,b:38},gw=width-pad.l-pad.r,gh=height-pad.t-pad.b;
  ctx.font='9px DM Sans';ctx.lineWidth=1;

  for(let i=0;i<5;i++){
    const y=pad.t+gh*i/4;
    ctx.strokeStyle='#222c3a';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();
    ctx.fillStyle='#67758c';ctx.fillText(nf.format(Math.round(max*(1-i/4))),5,y+3);
  }

  const xAt=i=>keys.length===1?pad.l+gw/2:pad.l+gw*i/(keys.length-1);
  const yAt=value=>pad.t+gh-(value/max)*gh;

  cutters.forEach(cutter=>{
    const map=byCutter.get(cutter.id);
    ctx.strokeStyle=cutter.color;
    ctx.lineWidth=2.2;
    ctx.beginPath();
    keys.forEach((key,i)=>{
      const x=xAt(i),y=yAt(map.get(key)||0);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.stroke();

    keys.forEach((key,i)=>{
      const value=map.get(key)||0;
      if(!value)return;
      ctx.fillStyle=cutter.color;
      ctx.beginPath();ctx.arc(xAt(i),yAt(value),2.8,0,Math.PI*2);ctx.fill();
    });
  });

  const step=Math.max(1,Math.ceil(keys.length/10));
  keys.forEach((k,i)=>{
    if(i%step!==0&&i!==keys.length-1)return;
    const [,m,d]=k.split('-');
    ctx.fillStyle='#6d7a90';ctx.font='9px DM Sans';ctx.fillText(d+'/'+m,xAt(i)-11,height-13);
  });

  const total=rows.reduce((s,x)=>s+(Number.isFinite(x.pieces)?x.pieces:0),0);
  $('#chartCaption').textContent=keys.length+' dia'+(keys.length===1?'':'s')+' • '+nf.format(total)+' peças';
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
  }else if(mode==='7days'){
    const first=new Date(latest);first.setDate(first.getDate()-6);
    $('#dateFrom').value=isoDate(first);$('#dateTo').value=isoDate(latest);
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