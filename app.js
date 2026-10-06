'use strict';
// Atlas Journal v7.3 - default MapTiler key + responsive mobile

let maplibregl = null;
let mapGeocoderControl = null;
let currentMapKey = '';

const ETHERCALC = 'https://ethercalc.net';
// Linkul efectiv furnizat în mesaj pentru calendar/jurnal.
const TRIP_ROOM = 'idlh3t7xmrfq';
const PHOTO_ROOM = 'omiucxs2cxf4';
const SYNC_MS = 15000;
const APP_TIMEZONE = 'Europe/Bucharest';
const MAX_PHOTO_WIDTH = 1200;
const JPEG_QUALITY = 0.72;

const state = { trips: [], photos: [], calendarMonth: new Date(), syncing:false, saving:false, markers:[], map:null, projection:'globe', pickerMap:null, pickerMarker:null, editLocations:[], activeStopId:null, mapReady:false };
const $ = s => document.querySelector(s);
const el = {
  syncStatus:$('#syncStatus'), syncButton:$('#syncButton'), statTrips:$('#statTrips'), statCountries:$('#statCountries'), statDays:$('#statDays'), statPhotos:$('#statPhotos'),
  openTripDialog:$('#openTripDialog'), heroAdd:$('#heroAdd'), emptyAdd:$('#emptyAdd'), jumpToGlobe:$('#jumpToGlobe'),
  calendarTitle:$('#calendarTitle'), calendarGrid:$('#calendarGrid'), prevMonth:$('#prevMonth'), nextMonth:$('#nextMonth'), todayButton:$('#todayButton'),
  fitTrips:$('#fitTrips'), toggleProjection:$('#toggleProjection'), changeMapKey:$('#changeMapKey'), tripSearch:$('#tripSearch'), tripList:$('#tripList'), emptyTrips:$('#emptyTrips'), timeline:$('#timeline'),
  tripDialog:$('#tripDialog'), tripForm:$('#tripForm'), tripDialogTitle:$('#tripDialogTitle'), closeTripDialog:$('#closeTripDialog'), cancelTrip:$('#cancelTrip'), deleteTrip:$('#deleteTrip'),
  tripId:$('#tripId'), tripTitle:$('#tripTitle'), city:$('#city'), country:$('#country'), startDate:$('#startDate'), endDate:$('#endDate'), lat:$('#lat'), lng:$('#lng'), addStop:$('#addStop'), stopList:$('#stopList'), locationPicker:$('#locationPicker'), locationStatus:$('#locationStatus'), pickerTitle:$('#pickerTitle'), pickerSearch:$('#pickerSearch'), pickerSearchButton:$('#pickerSearchButton'), mapKeyOverlay:$('#mapKeyOverlay'), mapKeyInput:$('#mapKeyInput'), saveMapKey:$('#saveMapKey'), cancelMapKey:$('#cancelMapKey'), clearMapKey:$('#clearMapKey'), accommodation:$('#accommodation'), opinion:$('#opinion'), rating:$('#rating'), mood:$('#mood'), highlights:$('#highlights'), food:$('#food'), music:$('#music'), companions:$('#companions'), cost:$('#cost'), currency:$('#currency'), tags:$('#tags'), notes:$('#notes'), photoInput:$('#photoInput'), photoEditor:$('#photoEditor'), saveTripButton:$('#saveTripButton'), toast:$('#toast')
};

function todayISO(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:APP_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p={}; parts.forEach(x=>{if(x.type!=='literal')p[x.type]=x.value}); return `${p.year}-${p.month}-${p.day}`;
}
function localISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function fromISO(s){const [y,m,d]=String(s||'').split('-').map(Number);return new Date(y,m-1,d)}
function addDays(iso,n){const d=fromISO(iso);d.setDate(d.getDate()+n);return localISO(d)}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''))}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function csvEscape(v){const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function rowsToCsv(rows){return rows.map(r=>r.map(csvEscape).join(',')).join('\n')}
function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')q=false;else field+=c}else if(c==='"')q=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}return rows}
function setSync(text,type=''){el.syncStatus.textContent=text;el.syncStatus.dataset.type=type}
function toast(msg){el.toast.textContent=msg;el.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.toast.classList.remove('show'),3200)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function headerIndex(h,n){return h.findIndex(x=>String(x||'').trim().toLowerCase()===n)}

async function fetchWithTimeout(url,options={},ms=17000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(t)}}
async function getCsv(room){
  const id=encodeURIComponent(room); const urls=[`${ETHERCALC}/_/${id}/csv?t=${Date.now()}`,`${ETHERCALC}/=${id}.csv?t=${Date.now()}`]; let last;
  for(const u of urls){try{const r=await fetchWithTimeout(u,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}catch(e){last=e}}
  throw new Error(`Citire EtherCalc eșuată: ${last?.message||'eroare'}`);
}
async function putCsv(room,csv){
  const r=await fetchWithTimeout(`${ETHERCALC}/_/${encodeURIComponent(room)}`,{method:'PUT',cache:'no-store',headers:{'Content-Type':'text/csv;charset=UTF-8'},body:csv},22000);
  if(!r.ok)throw new Error(`Scriere EtherCalc: HTTP ${r.status}`); return r.text().catch(()=> '');
}

const TRIP_HEADERS=['id','start_date','end_date','city','country','lat','lng','accommodation','opinion','music','highlights','food','companions','rating','cost','currency','mood','tags','notes','cover_photo_id','title','locations_json','updated_at'];
const PHOTO_HEADERS=['id','trip_id','name','mime','data_url','caption','is_cover','updated_at'];
function normalizeLocations(raw,fallback={}){
  let arr=[];
  try{if(raw)arr=JSON.parse(raw)}catch(e){arr=[]}
  if(!Array.isArray(arr))arr=[];
  arr=arr.map((x,i)=>({id:String(x.id||crypto.randomUUID()),name:String(x.name||x.city||''),country:String(x.country||''),date:String(x.date||fallback.startDate||''),lat:num(x.lat),lng:num(x.lng),notes:String(x.notes||''),accommodation:String(x.accommodation||'')})).filter(x=>x.name||x.country||x.lat||x.lng);
  if(!arr.length && (fallback.city||fallback.country||fallback.lat||fallback.lng))arr=[{id:crypto.randomUUID(),name:fallback.city||'',country:fallback.country||'',date:fallback.startDate||'',lat:num(fallback.lat),lng:num(fallback.lng),notes:'',accommodation:fallback.accommodation||''}];
  return arr;
}
function parseTrips(csv){const rows=parseCsv(csv).filter(r=>r.some(x=>String(x).trim()));if(!rows.length)return[];const h=rows[0].map(x=>String(x).trim().toLowerCase());if(!h.includes('id'))return[];const ix=n=>headerIndex(h,n);return rows.slice(1).map(r=>{const base={id:r[ix('id')]||crypto.randomUUID(),startDate:r[ix('start_date')]||'',endDate:r[ix('end_date')]||r[ix('start_date')]||'',city:r[ix('city')]||'',country:r[ix('country')]||'',lat:num(r[ix('lat')]),lng:num(r[ix('lng')]),accommodation:r[ix('accommodation')]||'',opinion:r[ix('opinion')]||'',music:r[ix('music')]||'',highlights:r[ix('highlights')]||'',food:r[ix('food')]||'',companions:r[ix('companions')]||'',rating:Math.max(1,Math.min(5,num(r[ix('rating')])||5)),cost:num(r[ix('cost')]),currency:r[ix('currency')]||'EUR',mood:r[ix('mood')]||'✨ Inspirat',tags:r[ix('tags')]||'',notes:r[ix('notes')]||'',coverPhotoId:r[ix('cover_photo_id')]||'',title:ix('title')>=0?(r[ix('title')]||''):'',updatedAt:r[ix('updated_at')]||''};base.locations=normalizeLocations(ix('locations_json')>=0?r[ix('locations_json')]:'',base);if(!base.title)base.title=base.locations.length>1?`${base.locations[0]?.name||base.city} + ${base.locations.length-1} opriri`:[base.city,base.country].filter(Boolean).join(', ');const p=base.locations[0];if(p){base.city=p.name||base.city;base.country=p.country||base.country;base.lat=p.lat;base.lng=p.lng}return base}).filter(t=>t.title||t.city)}
function tripsCsv(){return rowsToCsv([TRIP_HEADERS,...state.trips.map(t=>{const locs=normalizeLocations(JSON.stringify(t.locations||[]),t);const p=locs[0]||{};return[t.id,t.startDate,t.endDate,p.name||t.city,p.country||t.country,p.lat||t.lat,p.lng||t.lng,t.accommodation,t.opinion,t.music,t.highlights,t.food,t.companions,t.rating,t.cost,t.currency,t.mood,t.tags,t.notes,t.coverPhotoId,t.title||'',JSON.stringify(locs),t.updatedAt]})])}
function parsePhotos(csv){const rows=parseCsv(csv).filter(r=>r.some(x=>String(x).trim()));if(!rows.length)return[];const h=rows[0].map(x=>String(x).trim().toLowerCase());if(!h.includes('id'))return[];const ix=n=>headerIndex(h,n);return rows.slice(1).map(r=>({id:r[ix('id')]||crypto.randomUUID(),tripId:r[ix('trip_id')]||'',name:r[ix('name')]||'',mime:r[ix('mime')]||'image/jpeg',dataUrl:r[ix('data_url')]||'',caption:r[ix('caption')]||'',isCover:String(r[ix('is_cover')]||'').toLowerCase()==='true'||r[ix('is_cover')]==='1',updatedAt:r[ix('updated_at')]||''})).filter(p=>p.tripId&&p.dataUrl)}
function photosCsv(){return rowsToCsv([PHOTO_HEADERS,...state.photos.map(p=>[p.id,p.tripId,p.name,p.mime,p.dataUrl,p.caption,p.isCover?'true':'false',p.updatedAt])])}
async function verifyTripSaved(expected){
  const waits=[350,800,1500,2600];
  let lastError;
  for(const wait of waits){
    await new Promise(r=>setTimeout(r,wait));
    try{
      const remote=parseTrips(await getCsv(TRIP_ROOM));
      const found=remote.find(x=>x.id===expected.id);
      if(found && String(found.updatedAt||'')===String(expected.updatedAt||'')) return found;
      lastError=new Error('EtherCalc nu a confirmat încă modificarea.');
    }catch(e){lastError=e}
  }
  throw lastError||new Error('Salvarea nu a putut fi verificată.');
}
async function saveTripsOnly(expectedTrip=null){
  state.saving=true;setSync('Se salvează jurnalul…');
  try{
    await putCsv(TRIP_ROOM,tripsCsv());
    if(expectedTrip) await verifyTripSaved(expectedTrip);
    setSync('Salvat și verificat','ok');
    return true;
  }catch(e){
    console.error(e);setSync('Eroare la salvare','error');
    throw e;
  }finally{state.saving=false}
}
async function savePhotosOnly(){
  state.saving=true;setSync('Se salvează fotografiile…');
  try{await putCsv(PHOTO_ROOM,photosCsv());setSync('Fotografii salvate','ok');return true}
  catch(e){console.error(e);setSync('Eroare fotografii','error');throw e}
  finally{state.saving=false}
}
async function saveAll(){await saveTripsOnly();await savePhotosOnly();toast('Salvat în EtherCalc.')}
async function syncAll(manual=false){if(state.syncing||state.saving)return;state.syncing=true;setSync('Sincronizare…');try{const [tc,pc]=await Promise.all([getCsv(TRIP_ROOM),getCsv(PHOTO_ROOM)]);state.trips=parseTrips(tc);state.photos=parsePhotos(pc);renderAll();setSync('Sincronizat','ok');if(manual)toast('Datele au fost sincronizate.')}catch(e){console.error(e);setSync('Offline / eroare','error');if(manual)toast('Nu am putut citi EtherCalc.')}finally{state.syncing=false}}

function getTripPhotos(id){return state.photos.filter(p=>p.tripId===id)}
function coverFor(t){const ps=getTripPhotos(t.id);return ps.find(p=>p.id===t.coverPhotoId)||ps.find(p=>p.isCover)||ps[0]||null}
function dateRangeDays(a,b){if(!validDate(a)||!validDate(b))return 0;const start=fromISO(a),end=fromISO(b);return Math.max(1,Math.round((end-start)/86400000)+1)}
function fmtRange(t){const opts={day:'numeric',month:'short',year:'numeric'};const a=validDate(t.startDate)?fromISO(t.startDate).toLocaleDateString('ro-RO',opts):'—';const b=validDate(t.endDate)?fromISO(t.endDate).toLocaleDateString('ro-RO',opts):'';return t.startDate===t.endDate?a:`${a} — ${b}`}
function starText(r){return '★'.repeat(Math.round(r))+'☆'.repeat(5-Math.round(r))}
function activeOn(t,iso){return validDate(t.startDate)&&validDate(t.endDate)&&iso>=t.startDate&&iso<=t.endDate}
function allLocations(){return state.trips.flatMap(t=>(t.locations||[]).map(l=>({...l,tripId:t.id,tripTitle:t.title||t.city}))).filter(l=>Number.isFinite(l.lat)&&Number.isFinite(l.lng)&&!(l.lat===0&&l.lng===0))}
function renderStats(){el.statTrips.textContent=state.trips.length;el.statCountries.textContent=new Set(state.trips.flatMap(t=>(t.locations||[]).map(l=>String(l.country||'').trim().toLowerCase())).filter(Boolean)).size;el.statDays.textContent=state.trips.reduce((a,t)=>a+dateRangeDays(t.startDate,t.endDate),0);el.statPhotos.textContent=state.photos.length}
function renderCalendar(){
  const d=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth(),1);const y=d.getFullYear(),m=d.getMonth();el.calendarTitle.textContent=d.toLocaleDateString('ro-RO',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  const mondayOffset=(d.getDay()+6)%7;const start=new Date(y,m,1-mondayOffset);let html='';const today=todayISO();
  for(let i=0;i<42;i++){const x=new Date(start);x.setDate(start.getDate()+i);const iso=localISO(x);const trips=state.trips.filter(t=>activeOn(t,iso));const outside=x.getMonth()!==m;html+=`<button class="calendar-day ${outside?'is-outside':''} ${iso===today?'is-today':''} ${trips.length?'has-trip':''}" data-date="${iso}" type="button"><span class="calendar-day__number">${x.getDate()}</span>${trips.length?'<i class="calendar-day__badge"></i>':''}<div class="calendar-day__trips">${trips.slice(0,2).map(t=>`<span class="calendar-trip" data-trip="${esc(t.id)}">${esc(t.title||t.city)}</span>`).join('')}${trips.length>2?`<span class="calendar-more">+${trips.length-2} altele</span>`:''}</div></button>`}
  el.calendarGrid.innerHTML=html;
}
function renderTripList(){
  const q=el.tripSearch.value.trim().toLowerCase();const trips=[...state.trips].sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate))).filter(t=>!q||[t.title,t.city,t.country,t.tags,t.opinion,...(t.locations||[]).flatMap(l=>[l.name,l.country])].join(' ').toLowerCase().includes(q));
  el.emptyTrips.hidden=state.trips.length>0;el.tripList.hidden=state.trips.length===0;
  el.tripList.innerHTML=trips.map(t=>{const c=coverFor(t);const locs=t.locations||[];return `<article class="trip-card" data-trip="${esc(t.id)}"><${c?'img':'div'} class="trip-thumb" ${c?`src="${esc(c.dataUrl)}" alt=""`:'aria-hidden="true"'}>${c?'':'🌍'}</${c?'img':'div'}><div class="trip-card__main"><strong>${esc(t.title||t.city)}</strong><span>${esc(fmtRange(t))}</span><span>${locs.length} ${locs.length===1?'locație':'locații'} · ${esc(locs.map(x=>x.name).filter(Boolean).slice(0,3).join(' → '))}</span></div><div class="trip-rating">${starText(t.rating)}</div></article>`}).join('');
}
function renderTimeline(){const trips=[...state.trips].sort((a,b)=>String(b.startDate).localeCompare(String(a.startDate)));el.timeline.innerHTML=trips.map(t=>{const route=(t.locations||[]).map(l=>l.name).filter(Boolean).join(' → ');return `<article class="timeline-item" data-trip="${esc(t.id)}"><div class="timeline-date">${esc(fmtRange(t))}</div><div class="timeline-axis"></div><div class="timeline-story"><h3>${esc(t.title||t.city)} · ${starText(t.rating)}</h3><div class="route-summary"><b>${(t.locations||[]).length} opriri</b>${route?`<span>${esc(route)}</span>`:''}</div><p>${esc(t.opinion||t.highlights||'Fără notițe încă. Deschide călătoria și completează povestea.')}</p><div class="timeline-tags">${String(t.tags||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,6).map(x=>`<span>${esc(x)}</span>`).join('')}${t.music?`<span>♫ ${esc(t.music)}</span>`:''}</div></div></article>`}).join('')||'<div class="empty-state"><div>📓</div><h3>Jurnalul te așteaptă.</h3><p>Primele povești vor apărea aici după ce adaugi o călătorie.</p></div>'}

async function avatarImageData(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const size=96,c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.clearRect(0,0,size,size);ctx.save();ctx.beginPath();ctx.arc(size/2,size/2,size/2-4,0,Math.PI*2);ctx.clip();const scale=Math.max(size/img.width,size/img.height),w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);ctx.restore();ctx.strokeStyle='white';ctx.lineWidth=7;ctx.beginPath();ctx.arc(size/2,size/2,size/2-5,0,Math.PI*2);ctx.stroke();resolve(ctx.getImageData(0,0,size,size))};img.onerror=reject;img.src=dataUrl})}
async function ensureAvatarImages(){if(!state.map)return;for(const t of state.trips){const c=coverFor(t);if(!c)continue;const key=`avatar-${t.id}`;if(state.map.hasImage(key))continue;try{state.map.addImage(key,await avatarImageData(c.dataUrl),{pixelRatio:2})}catch(e){console.warn('Avatar map image',e)}}}
function locationGeoJSON(){return {type:'FeatureCollection',features:state.trips.flatMap(t=>(t.locations||[]).filter(l=>Number.isFinite(l.lat)&&Number.isFinite(l.lng)&&!(l.lat===0&&l.lng===0)).map((l,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[l.lng,l.lat]},properties:{tripId:t.id,stopId:l.id,label:l.name||t.title||'Locație',tripTitle:t.title||t.city,order:i+1,icon:coverFor(t)?`avatar-${t.id}`:''}})))}}
function routeGeoJSON(){return {type:'FeatureCollection',features:state.trips.map(t=>{const pts=(t.locations||[]).filter(l=>Number.isFinite(l.lat)&&Number.isFinite(l.lng)&&!(l.lat===0&&l.lng===0));return pts.length>1?{type:'Feature',geometry:{type:'LineString',coordinates:pts.map(l=>[l.lng,l.lat])},properties:{tripId:t.id}}:null}).filter(Boolean)}}
async function renderMarkers(){
  if(!state.map||!maplibregl||!state.map.isStyleLoaded())return;
  await ensureAvatarImages();
  const pts=locationGeoJSON(), routes=routeGeoJSON();
  if(state.map.getSource('trip-locations')) state.map.getSource('trip-locations').setData(pts);
  else{
    state.map.addSource('trip-locations',{type:'geojson',data:pts});
    state.map.addLayer({id:'trip-pin-halo',type:'circle',source:'trip-locations',paint:{'circle-radius':['interpolate',['linear'],['zoom'],1.5,6,6,10,12,14],'circle-color':'#ffffff','circle-opacity':.96,'circle-stroke-width':2,'circle-stroke-color':'#183d34'}});
    state.map.addLayer({id:'trip-pin-core',type:'circle',source:'trip-locations',paint:{'circle-radius':['interpolate',['linear'],['zoom'],1.5,3.5,6,6,12,9],'circle-color':'#50c89b'}});
    state.map.addLayer({id:'trip-avatar',type:'symbol',source:'trip-locations',filter:['!=',['get','icon'],''],layout:{'icon-image':['get','icon'],'icon-size':['interpolate',['linear'],['zoom'],2,.36,7,.5,13,.7],'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'viewport','icon-pitch-alignment':'viewport'}});
    state.map.addLayer({id:'trip-stop-label',type:'symbol',source:'trip-locations',minzoom:2.2,layout:{'text-field':['get','label'],'text-size':['interpolate',['linear'],['zoom'],2.2,10,8,13,14,16],'text-offset':[0,2.2],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#153d32','text-halo-color':'#ffffff','text-halo-width':2}});
    for(const layer of ['trip-pin-halo','trip-pin-core','trip-avatar']){
      state.map.on('click',layer,e=>{const f=e.features?.[0];if(f)openTrip(f.properties.tripId)});
      state.map.on('mouseenter',layer,()=>state.map.getCanvas().style.cursor='pointer');
      state.map.on('mouseleave',layer,()=>state.map.getCanvas().style.cursor='');
    }
  }
  if(state.map.getSource('trip-routes')) state.map.getSource('trip-routes').setData(routes);
  else{
    state.map.addSource('trip-routes',{type:'geojson',data:routes});
    state.map.addLayer({id:'trip-routes-line',type:'line',source:'trip-routes',paint:{'line-color':'#3aaa84','line-width':['interpolate',['linear'],['zoom'],2,1.5,8,3.5,14,6],'line-opacity':.72,'line-dasharray':[2,2]}},'trip-pin-halo');
  }
}
function renderAll(){renderStats();renderCalendar();renderTripList();renderTimeline();void renderMarkers()}

function osmStyle(){return 'https://tiles.openfreemap.org/styles/liberty'}
function getBaseVectorSourceId(map){
  const sources=map?.getStyle?.()?.sources||{};
  const ids=Object.keys(sources);
  return ids.find(id=>sources[id]?.type==='vector')||ids.find(id=>/openmaptiles|openfree|tiles/i.test(id))||'';
}
function addWorldReferenceLayers(){
  if(!state.map||!state.map.isStyleLoaded())return;
  const source=getBaseVectorSourceId(state.map);
  if(!source)return;
  try{
    if(!state.map.getLayer('atlas-country-borders')){
      state.map.addLayer({
        id:'atlas-country-borders',type:'line',source,'source-layer':'boundary',
        filter:['all',['==',['get','admin_level'],2],['!=',['get','maritime'],1]],
        paint:{
          'line-color':'#334155',
          'line-opacity':['interpolate',['linear'],['zoom'],1.2,.78,5,.92,10,.98],
          'line-width':['interpolate',['linear'],['zoom'],1.2,1.15,3,1.65,6,2.1,10,2.7],
          'line-blur':0.1
        }
      });
    }
  }catch(e){console.warn('Country borders overlay',e)}
  try{
    if(!state.map.getLayer('atlas-major-cities')){
      state.map.addLayer({
        id:'atlas-major-cities',type:'symbol',source,'source-layer':'place',minzoom:1.2,maxzoom:24,
        filter:['in',['get','class'],['literal',['city','town']]],
        layout:{
          'text-field':['coalesce',['get','name:latin'],['get','name:en'],['get','name']],
          'text-size':['interpolate',['linear'],['zoom'],1.2,9.5,2.5,11,4,12.5,7,14,12,16],
          'text-font':['Noto Sans Regular'],
          'text-allow-overlap':false,
          'text-ignore-placement':false,
          'text-padding':2,
          'text-max-width':8
        },
        paint:{
          'text-color':'#172033',
          'text-halo-color':'rgba(255,255,255,0.96)',
          'text-halo-width':1.8,
          'text-halo-blur':0.25
        }
      });
    }
  }catch(e){
    console.warn('City labels overlay',e);
    try{
      if(!state.map.getLayer('atlas-major-cities')){
        state.map.addLayer({
          id:'atlas-major-cities',type:'symbol',source,'source-layer':'place',minzoom:1.2,maxzoom:24,
          filter:['in',['get','class'],['literal',['city','town']]],
          layout:{'text-field':['coalesce',['get','name:latin'],['get','name:en'],['get','name']],'text-size':['interpolate',['linear'],['zoom'],1.2,9.5,4,12.5,8,15],'text-allow-overlap':false},
          paint:{'text-color':'#172033','text-halo-color':'#ffffff','text-halo-width':2}
        });
      }
    }catch(e2){console.warn('City labels fallback',e2)}
  }
}
function activeEditStop(){return state.editLocations.find(x=>x.id===state.activeStopId)||null}
function updateLegacyPrimary(){const p=state.editLocations[0];el.city.value=p?.name||'';el.country.value=p?.country||'';el.lat.value=Number.isFinite(p?.lat)?p.lat:'';el.lng.value=Number.isFinite(p?.lng)?p.lng:''}
function renderStopEditor(){
  el.stopList.innerHTML=state.editLocations.map((l,i)=>`<article class="stop-card ${l.id===state.activeStopId?'is-active':''}" data-stop="${esc(l.id)}"><div class="stop-card__top"><div><strong>Oprirea ${i+1}${l.name?` · ${esc(l.name)}`:''}</strong> <span class="stop-location-state ${Number.isFinite(l.lat)&&Number.isFinite(l.lng)&&!(l.lat===0&&l.lng===0)?'is-set':''}">${Number.isFinite(l.lat)&&Number.isFinite(l.lng)&&!(l.lat===0&&l.lng===0)?'● poziție setată':'○ fără poziție'}</span></div><div class="stop-card__actions"><button class="button button--soft" type="button" data-pick-stop="${esc(l.id)}">⌖ Alege pe hartă</button>${state.editLocations.length>1?`<button class="button button--ghost" type="button" data-remove-stop="${esc(l.id)}">Șterge</button>`:''}</div></div><div class="stop-card__grid"><label class="field"><span>Loc / oraș *</span><input data-stop-name="${esc(l.id)}" maxlength="120" value="${esc(l.name||'')}" placeholder="Ex: Florența" /></label><label class="field"><span>Țară</span><input data-stop-country="${esc(l.id)}" maxlength="100" value="${esc(l.country||'')}" placeholder="Ex: Italia" /></label><label class="field"><span>Data opririi</span><input data-stop-date="${esc(l.id)}" type="date" value="${esc(l.date||'')}" /></label><label class="field stop-notes"><span>Notițe pentru această oprire</span><textarea data-stop-notes="${esc(l.id)}" maxlength="500" placeholder="Ce ai făcut aici, cazare, recomandări…">${esc(l.notes||'')}</textarea></label></div></article>`).join('');
  const a=activeEditStop();el.pickerTitle.textContent=a?`Alege poziția pentru: ${a.name||'oprirea selectată'}`:'Alege o locație din itinerar';el.locationStatus.textContent=a?(Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&!(a.lat===0&&a.lng===0)?'Poziție aleasă ✓':'Click pe hartă'):'Nicio oprire activă';el.locationStatus.classList.toggle('is-set',!!a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&!(a.lat===0&&a.lng===0));updateLegacyPrimary();
}
function addStopDraft(pref={}){const stop={id:crypto.randomUUID(),name:pref.name||'',country:pref.country||'',date:pref.date||el.startDate.value||todayISO(),lat:Number.isFinite(pref.lat)?pref.lat:0,lng:Number.isFinite(pref.lng)?pref.lng:0,notes:pref.notes||'',accommodation:pref.accommodation||''};state.editLocations.push(stop);state.activeStopId=stop.id;renderStopEditor();focusActiveStopOnMap();return stop}
function selectStop(id){state.activeStopId=id;renderStopEditor();focusActiveStopOnMap()}
const DEFAULT_MAPTILER_KEY='wR04Ry5AoaXtixELEHFx';
function mapKey(){return String(localStorage.getItem('atlas_maptiler_key')||DEFAULT_MAPTILER_KEY||'').trim()}
function showMapKeyDialog(){
  el.mapKeyInput.value=mapKey();
  el.mapKeyOverlay.classList.add('is-open');
  el.mapKeyOverlay.setAttribute('aria-hidden','false');
  setTimeout(()=>el.mapKeyInput.focus(),40);
}
function hideMapKeyDialog(){
  el.mapKeyOverlay.classList.remove('is-open');
  el.mapKeyOverlay.setAttribute('aria-hidden','true');
}
function configureMapTiler(key){
  currentMapKey=String(key||'').trim();
  if(!currentMapKey||!window.maptilersdk)return false;
  window.maptilersdk.config.apiKey=currentMapKey;
  maplibregl=window.maptilersdk; // compatibility with existing marker/bounds code
  return true;
}
function destroyMaps(){
  try{state.map?.remove()}catch(e){}
  try{state.pickerMap?.remove()}catch(e){}
  state.map=null;state.pickerMap=null;state.pickerMarker=null;state.mapReady=false;mapGeocoderControl=null;
}
async function reverseGeocode(lat,lng){
  if(!currentMapKey)return null;
  try{
    const r=await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?key=${encodeURIComponent(currentMapKey)}&limit=1&language=ro`);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json(); return d?.features?.[0]||null;
  }catch(e){console.warn('Reverse geocoding',e);return null}
}
async function geocodePickerQuery(){
  const q=String(el.pickerSearch?.value||'').trim();
  if(!q)return;
  if(!currentMapKey){showMapKeyDialog();return}
  if(!activeEditStop()){toast('Alege întâi o oprire din itinerar.');return}
  el.pickerSearchButton.disabled=true;el.pickerSearchButton.textContent='Caut…';
  try{
    const r=await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(currentMapKey)}&limit=1&language=ro`);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json(),f=d?.features?.[0];
    if(!f?.center){toast('Nu am găsit locația.');return}
    const [lng,lat]=f.center;
    const a=activeEditStop();
    if(a){
      if(!String(a.name||'').trim())a.name=f.text||q;
      const ctx=f.context||[];
      const country=ctx.find(x=>String(x.id||'').startsWith('country.'));
      if(!String(a.country||'').trim())a.country=country?.text||a.country||'';
    }
    setPickedLocation(lat,lng,true);
    renderStopEditor();
    toast(`Am găsit: ${f.place_name||f.text||q}`);
  }catch(e){console.error(e);toast('Căutarea MapTiler a eșuat.')}
  finally{el.pickerSearchButton.disabled=false;el.pickerSearchButton.textContent='Caută'}
}
function setPickedLocation(lat,lng,fly=false){
  const a=activeEditStop();if(!a||!Number.isFinite(lat)||!Number.isFinite(lng))return;
  a.lat=Number(lat.toFixed(6));a.lng=Number(lng.toFixed(6));updateLegacyPrimary();renderStopEditor();
  if(state.pickerMap&&maplibregl){
    if(!state.pickerMarker)state.pickerMarker=new maplibregl.Marker({color:'#ff6b68'}).setLngLat([lng,lat]).addTo(state.pickerMap);
    else state.pickerMarker.setLngLat([lng,lat]);
    if(fly)state.pickerMap.flyTo({center:[lng,lat],zoom:Math.max(state.pickerMap.getZoom(),13),duration:650});
  }
}
function focusActiveStopOnMap(){
  setTimeout(()=>{
    if(!state.pickerMap)return;
    state.pickerMap.resize();
    const a=activeEditStop();
    if(a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&!(a.lat===0&&a.lng===0)){
      if(!state.pickerMarker)state.pickerMarker=new maplibregl.Marker({color:'#ff6b68'}).setLngLat([a.lng,a.lat]).addTo(state.pickerMap);
      else state.pickerMarker.setLngLat([a.lng,a.lat]);
      state.pickerMap.flyTo({center:[a.lng,a.lat],zoom:Math.max(state.pickerMap.getZoom(),11),duration:450});
    }else{state.pickerMarker?.remove();state.pickerMarker=null}
  },80)
}
function initLocationPicker(){
  if(!el.locationPicker)return;
  if(!configureMapTiler(mapKey())){showMapKeyDialog();return}
  if(!state.pickerMap){
    state.pickerMap=new maptilersdk.Map({
      container:'locationPicker',
      style:maptilersdk.MapStyle.STREETS,
      center:[15,35],zoom:3,minZoom:1,maxZoom:22,
      projection:'mercator',
      terrain:true,
      navigationControl:true,
      terrainControl:true,
      scaleControl:false,
      geolocateControl:false,
      antialias:true
    });
    setTimeout(()=>{
      if(state.map && state.map.getCanvas && state.map.getCanvas()){
        clearMapLoadingOverlay();
        state.map.resize();
      }
    },2500);
    state.pickerMap.on('click',async e=>{
      if(!activeEditStop()){toast('Alege întâi o oprire din itinerar.');return}
      setPickedLocation(e.lngLat.lat,e.lngLat.lng);
      const f=await reverseGeocode(e.lngLat.lat,e.lngLat.lng),a=activeEditStop();
      if(a&&f){
        if(!String(a.name||'').trim())a.name=f.text||'';
        const country=(f.context||[]).find(x=>String(x.id||'').startsWith('country.'));
        if(!String(a.country||'').trim())a.country=country?.text||'';
        renderStopEditor();
      }
      toast('Poziția opririi a fost actualizată.');
    });
  }
  focusActiveStopOnMap();
}
function clearMapLoadingOverlay(){
  const mapNode=$('#map');
  mapNode?.classList.remove('is-loading');
  mapNode?.querySelector('.map-loader')?.remove();
}
async function initMap(){
  const mapNode=$('#map'),key=mapKey();
  if(!key){mapNode.innerHTML='<div class="map-error"><div>🗺️</div><strong>Conectează MapTiler</strong><p>Introdu aceeași cheie care a funcționat în testul de hartă.</p><button class="button button--soft" id="openMapKey" type="button">Introdu cheia MapTiler</button></div>';$('#openMapKey')?.addEventListener('click',showMapKeyDialog);showMapKeyDialog();return}
  if(!configureMapTiler(key)){showMapKeyDialog();return}
  try{
    mapNode.classList.add('is-loading');
    mapNode.innerHTML='<div class="map-loader"><span></span><strong>Pregătesc globul MapTiler…</strong><small>Orașe • granițe • drumuri • teren 3D • căutare</small></div>';
    state.map=new maptilersdk.Map({
      container:'map',
      style:maptilersdk.MapStyle.STREETS,
      center:[18.5,46.5],
      zoom:2.1,pitch:18,bearing:0,
      minZoom:1,maxZoom:22,maxPitch:85,
      projection:'globe',
      terrain:true,
      navigationControl:true,
      terrainControl:true,
      scaleControl:true,
      fullscreenControl:true,
      projectionControl:true,
      geolocateControl:false,
      antialias:true
    });
    let firstRenderCleared=false;
    state.map.on('render',()=>{
      if(!firstRenderCleared){
        firstRenderCleared=true;
        clearMapLoadingOverlay();
      }
    });
    state.map.on('style.load',()=>clearMapLoadingOverlay());
    state.map.on('load',()=>{
      state.mapReady=true;state.projection='globe';clearMapLoadingOverlay();
      try{
        mapGeocoderControl=new maptilerGeocoder.GeocodingControl({apiKey:currentMapKey,placeholder:'Caută oraș sau adresă…'});
        state.map.addControl(mapGeocoderControl,'top-left');
      }catch(e){console.warn('MapTiler geocoder control',e)}
      void renderMarkers();
      state.map.resize();
    });
    state.map.on('error',e=>{
      console.error('MapTiler:',e?.error||e);
      const m=e?.error?.message||e?.message||'eroare hartă';
      if(/401|403|key|unauthor/i.test(m))setSync('Cheie MapTiler invalidă','error');
    });
  }catch(err){
    console.error('Glob MapTiler',err);mapNode.classList.remove('is-loading');
    mapNode.innerHTML='<div class="map-error"><div>🌍</div><strong>Globul MapTiler nu s-a putut încărca</strong><p>Verifică cheia API și conexiunea.</p><button class="button button--soft" id="retryMap" type="button">Reîncearcă</button></div>';
    $('#retryMap')?.addEventListener('click',initMap)
  }
}
function fitTrips(){
  if(!state.map)return toast('Globul încă se încarcă.');
  const pts=allLocations();
  if(!pts.length){state.map.easeTo({center:[18.5,46.5],zoom:2.1,pitch:18});return}
  if(pts.length===1){state.map.flyTo({center:[pts[0].lng,pts[0].lat],zoom:11,pitch:45});return}
  const b=new maplibregl.LngLatBounds();pts.forEach(t=>b.extend([t.lng,t.lat]));
  state.map.fitBounds(b,{padding:90,maxZoom:8,duration:1000})
}
function toggleProjection(){
  if(!state.map)return toast('Globul încă se încarcă.');
  state.projection=state.projection==='globe'?'mercator':'globe';
  try{state.map.setProjection({type:state.projection})}catch(e){console.warn(e)}
}

function blankTrip(date=todayISO()){return{id:'',title:'',startDate:date,endDate:date,city:'',country:'',lat:'',lng:'',locations:[],accommodation:'',opinion:'',music:'',highlights:'',food:'',companions:'',rating:5,cost:'',currency:'EUR',mood:'✨ Inspirat',tags:'',notes:'',coverPhotoId:''}}
function fillForm(t){el.tripId.value=t.id||'';el.tripTitle.value=t.title||'';el.startDate.value=t.startDate||todayISO();el.endDate.value=t.endDate||t.startDate||todayISO();el.accommodation.value=t.accommodation||'';el.opinion.value=t.opinion||'';el.music.value=t.music||'';el.highlights.value=t.highlights||'';el.food.value=t.food||'';el.companions.value=t.companions||'';el.rating.value=t.rating||5;el.cost.value=t.cost||'';el.currency.value=t.currency||'EUR';el.mood.value=t.mood||'✨ Inspirat';el.tags.value=t.tags||'';el.notes.value=t.notes||'';state.editLocations=normalizeLocations(JSON.stringify(t.locations||[]),t).map(x=>({...x}));if(!state.editLocations.length)state.editLocations=[{id:crypto.randomUUID(),name:'',country:'',date:t.startDate||todayISO(),lat:0,lng:0,notes:'',accommodation:''}];state.activeStopId=state.editLocations[0].id;renderStopEditor();renderPhotoEditor(t.id)}
function openTrip(idOrDate=''){const t=state.trips.find(x=>x.id===idOrDate);const isExisting=!!t;const model=t||blankTrip(validDate(idOrDate)?idOrDate:todayISO());el.tripDialogTitle.textContent=isExisting?(t.title||t.city):'Călătorie nouă';el.deleteTrip.hidden=!isExisting;fillForm(model);el.tripDialog.showModal();initLocationPicker();setTimeout(()=>el.tripTitle.focus(),120)}
function closeTrip(){el.tripDialog.close();el.photoInput.value='';state.editLocations=[];state.activeStopId=null}
function formModel(){const id=el.tripId.value||crypto.randomUUID();const old=state.trips.find(t=>t.id===id);const locs=state.editLocations.map(l=>({...l,name:String(l.name||'').trim(),country:String(l.country||'').trim(),date:l.date||el.startDate.value,notes:String(l.notes||'').trim()}));const p=locs[0]||{};return{id,title:el.tripTitle.value.trim(),startDate:el.startDate.value,endDate:el.endDate.value,city:p.name||'',country:p.country||'',lat:num(p.lat),lng:num(p.lng),locations:locs,accommodation:el.accommodation.value.trim(),opinion:el.opinion.value.trim(),music:el.music.value.trim(),highlights:el.highlights.value.trim(),food:el.food.value.trim(),companions:el.companions.value.trim(),rating:num(el.rating.value)||5,cost:num(el.cost.value),currency:el.currency.value,mood:el.mood.value,tags:el.tags.value.trim(),notes:el.notes.value.trim(),coverPhotoId:old?.coverPhotoId||'',updatedAt:new Date().toISOString()}}
async function submitTrip(e){
  e.preventDefault();
  if(state.saving)return;
  const t=formModel();
  if(!t.title||!validDate(t.startDate)||!validDate(t.endDate)){toast('Completează numele călătoriei și datele.');return}
  if(!t.locations.length||t.locations.some(l=>!l.name)){toast('Completează numele fiecărei locații din itinerar.');return}
  if(t.endDate<t.startDate){toast('Data întoarcerii nu poate fi înainte de plecare.');return}
  if(t.locations.some(l=>!Number.isFinite(l.lat)||!Number.isFinite(l.lng)||(l.lat===0&&l.lng===0))){toast('Alege pe hartă poziția pentru fiecare locație din itinerar.');return}
  const i=state.trips.findIndex(x=>x.id===t.id);
  const previous=i>=0?{...state.trips[i]}:null;
  if(i>=0)state.trips[i]=t;else state.trips.push(t);
  const ps=getTripPhotos(t.id);
  if(ps.length&&!t.coverPhotoId){t.coverPhotoId=ps.find(p=>p.isCover)?.id||ps[0].id;ps.forEach(p=>p.isCover=p.id===t.coverPhotoId)}
  const btn=el.saveTripButton; const oldText=btn?.textContent||'Salvează în EtherCalc';
  if(btn){btn.disabled=true;btn.textContent='Se salvează…'}
  setSync('Se salvează…');
  try{
    await saveTripsOnly(t);
    renderAll();
    toast('Modificarea a fost salvată și confirmată de EtherCalc.');
    closeTrip();
  }catch(err){
    console.error(err);
    if(previous){const at=state.trips.findIndex(x=>x.id===t.id);if(at>=0)state.trips[at]=previous}else state.trips=state.trips.filter(x=>x.id!==t.id);
    renderAll();
    toast('Salvarea nu a fost confirmată. Formularul rămâne deschis — încearcă din nou.');
  }finally{if(btn){btn.disabled=false;btn.textContent=oldText}}
}
async function deleteTrip(){const id=el.tripId.value;if(!id)return;if(!confirm('Ștergi călătoria și toate fotografiile ei?'))return;state.trips=state.trips.filter(t=>t.id!==id);state.photos=state.photos.filter(p=>p.tripId!==id);renderAll();closeTrip();await saveAll()}

function renderPhotoEditor(tripId){if(!tripId){el.photoEditor.innerHTML='<p class="field-help">Salvează mai întâi călătoria; apoi poți adăuga fotografii la următoarea editare.</p>';return}const t=state.trips.find(x=>x.id===tripId);const ps=getTripPhotos(tripId);el.photoEditor.innerHTML=ps.map(p=>`<article class="photo-item ${(t?.coverPhotoId===p.id||p.isCover)?'is-cover':''}" data-photo="${esc(p.id)}">${(t?.coverPhotoId===p.id||p.isCover)?'<span class="cover-badge">AVATAR</span>':''}<img src="${esc(p.dataUrl)}" alt="${esc(p.caption||p.name)}"><div class="photo-item__bar"><button type="button" data-cover="${esc(p.id)}">Setează avatar</button><button type="button" data-delete-photo="${esc(p.id)}">Șterge</button></div></article>`).join('')||'<p class="field-help">Nicio fotografie încă. Adaugă una pentru avatarul markerului.</p>'}
function compressImage(file){return new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{let w=img.width,h=img.height;if(w>MAX_PHOTO_WIDTH){h=Math.round(h*MAX_PHOTO_WIDTH/w);w=MAX_PHOTO_WIDTH}const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);const dataUrl=c.toDataURL('image/jpeg',JPEG_QUALITY);URL.revokeObjectURL(url);resolve({dataUrl,mime:'image/jpeg'})};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Imagine invalidă'))};img.src=url})}
async function addPhotos(files){const tripId=el.tripId.value;if(!tripId){toast('Salvează întâi călătoria, apoi redeschide-o pentru fotografii.');return}const t=state.trips.find(x=>x.id===tripId);if(!t)return;setSync('Procesez pozele…');for(const f of [...files].slice(0,12)){try{const {dataUrl,mime}=await compressImage(f);const p={id:crypto.randomUUID(),tripId,name:f.name,mime,dataUrl,caption:'',isCover:false,updatedAt:new Date().toISOString()};state.photos.push(p);if(!t.coverPhotoId){t.coverPhotoId=p.id;p.isCover=true}}catch(e){console.error(e)}}renderPhotoEditor(tripId);renderAll();await savePhotosOnly();await saveTripsOnly()}
async function setCover(photoId){const p=state.photos.find(x=>x.id===photoId);if(!p)return;const t=state.trips.find(x=>x.id===p.tripId);if(!t)return;t.coverPhotoId=p.id;t.updatedAt=new Date().toISOString();state.photos.filter(x=>x.tripId===p.tripId).forEach(x=>{x.isCover=x.id===p.id;x.updatedAt=new Date().toISOString()});renderPhotoEditor(t.id);renderAll();await saveTripsOnly();await savePhotosOnly()}
async function deletePhoto(photoId){const p=state.photos.find(x=>x.id===photoId);if(!p)return;const t=state.trips.find(x=>x.id===p.tripId);state.photos=state.photos.filter(x=>x.id!==photoId);if(t&&t.coverPhotoId===photoId){const next=getTripPhotos(t.id)[0];t.coverPhotoId=next?.id||'';if(next)next.isCover=true}renderPhotoEditor(p.tripId);renderAll();await saveTripsOnly();await savePhotosOnly()}

el.addStop.onclick=()=>addStopDraft({date:el.startDate.value||todayISO()});
el.stopList.addEventListener('click',e=>{const pick=e.target.closest('[data-pick-stop]');if(pick){selectStop(pick.dataset.pickStop);return}const rem=e.target.closest('[data-remove-stop]');if(rem){state.editLocations=state.editLocations.filter(x=>x.id!==rem.dataset.removeStop);if(!state.editLocations.length)addStopDraft({date:el.startDate.value||todayISO()});else{if(state.activeStopId===rem.dataset.removeStop)state.activeStopId=state.editLocations[0].id;renderStopEditor();focusActiveStopOnMap()}return}});
el.stopList.addEventListener('input',e=>{const attrs=['name','country','date','notes'];for(const a of attrs){const id=e.target.dataset[`stop${a[0].toUpperCase()+a.slice(1)}`];if(id){const l=state.editLocations.find(x=>x.id===id);if(l){l[a]=e.target.value;updateLegacyPrimary();if(id===state.activeStopId&&a==='name')el.pickerTitle.textContent=`Alege poziția pentru: ${l.name||'oprirea selectată'}`}}}});
el.saveMapKey.onclick=()=>{
  const key=String(el.mapKeyInput.value||'').trim();
  if(!key){toast('Introdu cheia MapTiler.');return}
  localStorage.setItem('atlas_maptiler_key',key);
  hideMapKeyDialog();destroyMaps();initMap();
  if(el.tripDialog.open)initLocationPicker();
};
el.cancelMapKey.onclick=hideMapKeyDialog;
el.clearMapKey.onclick=()=>{localStorage.removeItem('atlas_maptiler_key');el.mapKeyInput.value=DEFAULT_MAPTILER_KEY;destroyMaps();initMap();toast('Am revenit la cheia MapTiler implicită.')};
el.changeMapKey.onclick=showMapKeyDialog;
el.mapKeyInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.saveMapKey.click()}});
el.pickerSearchButton.onclick=geocodePickerQuery;
el.pickerSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();geocodePickerQuery()}});
el.openTripDialog.onclick=()=>openTrip();el.heroAdd.onclick=()=>openTrip();el.emptyAdd.onclick=()=>openTrip();el.closeTripDialog.onclick=closeTrip;el.cancelTrip.onclick=closeTrip;el.tripForm.addEventListener('submit',submitTrip);el.deleteTrip.onclick=deleteTrip;el.syncButton.onclick=()=>syncAll(true);el.jumpToGlobe.onclick=()=>$('#globeSection').scrollIntoView({behavior:'smooth'});el.fitTrips.onclick=fitTrips;el.toggleProjection.onclick=toggleProjection;el.tripSearch.oninput=renderTripList;el.photoInput.onchange=e=>addPhotos(e.target.files);
el.prevMonth.onclick=()=>{state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()-1,1);renderCalendar()};el.nextMonth.onclick=()=>{state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()+1,1);renderCalendar()};el.todayButton.onclick=()=>{state.calendarMonth=new Date();renderCalendar()};
el.calendarGrid.addEventListener('click',e=>{const trip=e.target.closest('[data-trip]');if(trip){e.stopPropagation();openTrip(trip.dataset.trip);return}const day=e.target.closest('[data-date]');if(day)openTrip(day.dataset.date)});el.tripList.addEventListener('click',e=>{const c=e.target.closest('[data-trip]');if(c)openTrip(c.dataset.trip)});el.timeline.addEventListener('click',e=>{const c=e.target.closest('[data-trip]');if(c)openTrip(c.dataset.trip)});el.photoEditor.addEventListener('click',e=>{const c=e.target.closest('[data-cover]');if(c)setCover(c.dataset.cover);const d=e.target.closest('[data-delete-photo]');if(d)deletePhoto(d.dataset.deletePhoto)});
el.startDate.addEventListener('change',()=>{if(!el.endDate.value||el.endDate.value<el.startDate.value)el.endDate.value=el.startDate.value;if(state.editLocations.length===1&&!state.editLocations[0].date)state.editLocations[0].date=el.startDate.value;renderStopEditor()});

initMap();renderAll();syncAll();setInterval(()=>syncAll(false),SYNC_MS);
