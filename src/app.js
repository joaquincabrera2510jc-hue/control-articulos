"use strict";
/* Control de Artículos — app de escritorio (Supabase) */

const CATS=["Motor","Frenos","Suspensión y dirección","Eléctrico","Filtros","Lubricantes y fluidos","Transmisión","Refrigeración","Carrocería","Neumáticos","Otros"];
const ESTADOS={
  cliente:["Pendiente","En preparación","Listo para retirar","Entregado","Cancelado"],
  proveedor:["Solicitado","Confirmado","En camino","Recibido","Cancelado"]
};
const FINAL={cliente:"Entregado",proveedor:"Recibido"};
const PILL={"Pendiente":"p-open","Solicitado":"p-open","En preparación":"p-prog","Confirmado":"p-prog","En camino":"p-prog","Listo para retirar":"p-ready","Entregado":"p-done","Recibido":"p-done","Cancelado":"p-cancel"};
const ROLES={admin:"Administrador",operador:"Operador",taller:"Taller",lectura:"Solo consulta"};
const TIPO={entrada:"Entrada",salida:"Salida",ajuste:"Ajuste",anulacion:"Anulación"};
const VEH_MARCAS=["Audi","BMW","BYD","Chery","Chevrolet","Citroën","DFSK","Dodge","Fiat","Ford","Geely","Great Wall","Haval","Honda","Hyundai","Isuzu","JAC","Jeep","Kia","Lifan","Mahindra","Mazda","Mercedes-Benz","Mitsubishi","Nissan","Peugeot","RAM","Renault","Subaru","Suzuki","Toyota","Volkswagen","Volvo"];
const MOV_LIMITE=3000;

const CFG=window.CONFIG||{};
let sb=null;                // cliente de Supabase
let ses=null;               // {id, usuario, nombre, rol}
let me=null;                // id del usuario conectado
let canWrite=false;
let articulos=[], pedidos=[], movimientos=[], perfiles=[];

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtD=iso=>iso?new Date(iso).toLocaleDateString("es-UY",{day:"2-digit",month:"2-digit",year:"numeric"}):"";
const fmtDT=iso=>iso?new Date(iso).toLocaleString("es-UY",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const esTaller=()=>!!ses&&ses.rol==="taller";
const esAdmin=()=>!!ses&&ses.rol==="admin";
const abierto=o=>o.estado!==FINAL[o.tipo]&&o.estado!=="Cancelado";
const quien=id=>{const p=perfiles.find(x=>x.id===id);return p?p.nombre:""};
const artDe=id=>articulos.find(a=>a.id===id);
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3000)}
function banner(msg){const b=$("#banner");b.textContent=msg||"";b.hidden=!msg}

function errMsg(e){
  if(!e)return"Algo salió mal.";
  const m=String(e.message||e.error_description||e.error||e);
  if(/Failed to fetch|NetworkError|network|ERR_INTERNET|Load failed/i.test(m))return"Sin conexión con el servidor. Revisá internet y probá de nuevo.";
  if(/permission denied|row-level security/i.test(m))return"No tenés permiso para hacer eso.";
  if(/articulos_codigo_unico|duplicate key/i.test(m))return"Ya existe un artículo con ese código.";
  if(/JWT expired|invalid JWT/i.test(m))return"Tu sesión venció. Volvé a ingresar.";
  return m;
}
async function q(promise){const {data,error}=await promise;if(error)throw error;return data}

/* ---------------- conexión a internet ---------------- */
let online=false, lastNet=0;
async function comprobarConexion(){
  if(!navigator.onLine){online=false;return false}
  try{
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),7000);
    const r=await fetch(CFG.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/health",{headers:{apikey:CFG.SUPABASE_ANON_KEY},cache:"no-store",signal:ctl.signal});
    clearTimeout(t);online=r.ok;
  }catch(e){online=false}
  lastNet=Date.now();return online;
}
function pintarConexion(){
  const n=$("#authNet");n.classList.toggle("on",online);n.classList.toggle("off",!online);
  $("#authNetTxt").textContent=online?"Conectado a internet":"Sin conexión a internet: no se puede ingresar";
  $("#authBtn").disabled=!online||!sb;
}
let offlineShown=false;
async function vigilarConexion(){
  const ok=await comprobarConexion();pintarConexion();
  if(ses){
    if(!ok&&!offlineShown){offlineShown=true;$("#offline").hidden=false;document.querySelectorAll("dialog[open]").forEach(d=>d.close())}
    else if(ok&&offlineShown){offlineShown=false;$("#offline").hidden=true;await recargarTodo();toast("Conexión recuperada")}
  }
  $("#offRetry").textContent="Último intento: "+new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
addEventListener("offline",vigilarConexion);
addEventListener("online",vigilarConexion);
setInterval(vigilarConexion,15000);

/* ---------------- pestañas y filtros ---------------- */
let tab="stock";
function setTab(t){tab=t;document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  ["stock","pedidos","movs","usuarios"].forEach(p=>$("#pane-"+p).hidden=p!==t)}
document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
function chipGroup(sel,cb){const g=$(sel);g.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{g.querySelectorAll(".chip").forEach(x=>x.setAttribute("aria-pressed",x===c));cb(c.dataset.v)})}
let fTipo="todos",fMov="todos";
chipGroup("#fTipo",v=>{fTipo=v;renderPedidos()});
chipGroup("#fMov",v=>{fMov=v;renderMovs()});
$("#fCat").innerHTML='<option value="">Todas las categorías</option>'+CATS.map(c=>`<option>${esc(c)}</option>`).join("");
$("#pCat").innerHTML=CATS.map(c=>`<option>${esc(c)}</option>`).join("");
["#qStock","#fCat","#fVeh"].forEach(s=>$(s).addEventListener("input",renderStock));
["#qPed","#fAbiertos"].forEach(s=>$(s).addEventListener("input",renderPedidos));
$("#qMov").addEventListener("input",renderMovs);
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());

/* ---------------- datos ---------------- */
async function traerTodo(tabla,orden,asc=true){
  const out=[];for(let desde=0;;desde+=1000){
    const filas=await q(sb.from(tabla).select("*").order(orden,{ascending:asc}).range(desde,desde+999));
    out.push(...filas);if(filas.length<1000)break;
  }return out;
}
async function cargar(tabla){
  if(tabla==="articulos")articulos=await traerTodo("articulos","nombre");
  if(tabla==="perfiles")perfiles=await traerTodo("perfiles","nombre");
  if(tabla==="pedidos"&&!esTaller())pedidos=await traerTodo("pedidos","creado",false);
  if(tabla==="movimientos"){
    let qm=sb.from("movimientos").select("*").order("fecha",{ascending:false});
    if(esTaller())qm=qm.eq("por",me).gte("fecha",new Date(Date.now()-48*3600e3).toISOString());
    movimientos=[];for(let d=0;d<MOV_LIMITE;d+=1000){const f=await q(qm.range(d,d+999));movimientos.push(...f);if(f.length<1000)break}
  }
}
async function recargarTodo(){
  try{await Promise.all(["articulos","perfiles","pedidos","movimientos"].map(cargar));renderAll();banner("")}
  catch(e){banner("No se pudieron cargar los datos: "+errMsg(e))}
}
const pendientes=new Set();let recTimer=null;
function programarRecarga(tabla){pendientes.add(tabla);clearTimeout(recTimer);recTimer=setTimeout(async()=>{
  const ts=[...pendientes];pendientes.clear();
  try{await Promise.all(ts.map(cargar));renderAll();verificarMiPerfil()}catch(e){}
},250)}
let canal=null;
function suscribir(){
  if(canal)sb.removeChannel(canal);
  canal=sb.channel("cambios");
  ["articulos","pedidos","movimientos","perfiles"].forEach(t=>canal.on("postgres_changes",{event:"*",schema:"public",table:t},()=>programarRecarga(t)));
  canal.subscribe();
}
setInterval(()=>{if(ses&&online&&!offlineShown)programarRecarga("articulos"),programarRecarga("movimientos"),programarRecarga("pedidos")},120000);

/* ---------------- render ---------------- */
function label(a){return (a.codigo?a.codigo+" · ":"")+a.nombre+(a.marca?" ("+a.marca+")":"")}
function syncVehMarcas(){
  const seen=new Map();[...VEH_MARCAS,...articulos.map(a=>a.veh_marca)].forEach(m=>{m=String(m||"").trim();if(m&&!seen.has(norm(m)))seen.set(norm(m),m)});
  $("#dlVehMarcas").innerHTML=[...seen.values()].sort((a,b)=>a.localeCompare(b)).map(m=>`<option value="${esc(m)}"></option>`).join("");
  const used=new Map();articulos.forEach(a=>{const m=String(a.veh_marca||"").trim();if(m&&!used.has(norm(m)))used.set(norm(m),m)});
  const sel=$("#fVeh"),cur=sel.value;
  sel.innerHTML='<option value="">Todas las marcas de vehículo</option>'+[...used.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([k,m])=>`<option value="${esc(k)}">${esc(m)}</option>`).join("");
  sel.value=used.has(cur)?cur:"";sel.hidden=!used.size;
}
function renderAll(){
  if(!ses)return;
  syncVehMarcas();renderStats();renderStock();renderPedidos();renderMovs();renderUsuarios();
  $("#dlProductos").innerHTML=articulos.map(a=>`<option value="${esc(label(a))}"></option>`).join("");
}
function renderStats(){
  $("#stProd").textContent=articulos.length;
  $("#stUnid").textContent=articulos.reduce((s,a)=>s+(+a.stock||0),0).toLocaleString("es-UY");
  const sin=articulos.filter(a=>(+a.stock||0)<=0).length;$("#stSin").textContent=sin;$("#stSinBox").classList.toggle("alert",sin>0);
  $("#stCli").textContent=pedidos.filter(o=>o.tipo==="cliente"&&abierto(o)).length;
  $("#stProv").textContent=pedidos.filter(o=>o.tipo==="proveedor"&&abierto(o)).length;
}
function renderStock(){
  renderMisSalidas();
  const q=norm($("#qStock").value),cat=$("#fCat").value,vm=$("#fVeh").value;
  const list=articulos.filter(a=>(!cat||a.categoria===cat)&&(!vm||norm(a.veh_marca)===vm)&&(!q||norm([a.codigo,a.nombre,a.marca,a.veh_marca,a.veh_modelo,a.ubicacion].join(" ")).includes(q)))
    .sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
  const box=$("#stockBody");
  if(!articulos.length){box.innerHTML=`<div class="empty"><strong>Todavía no hay artículos cargados</strong>${esTaller()?"Cuando se carguen artículos, vas a poder buscarlos acá.":"Tocá “+ Nuevo artículo” para agregar el primero. Cada entrada o salida queda registrada en Movimientos."}</div>`;return}
  if(!list.length){box.innerHTML=`<div class="empty"><strong>Sin resultados</strong>Probá con otro código, marca o vehículo.</div>`;return}
  box.innerHTML=`<div class="tablebox"><table><thead><tr><th>Código</th><th>Artículo</th><th>Marca artículo</th><th>Marca vehículo</th><th>Modelo</th><th>Categoría</th><th>Ubicación</th><th class="num">Stock</th><th></th></tr></thead><tbody>${
    list.map(a=>`<tr><td class="code">${esc(a.codigo)||"—"}</td><td><b>${esc(a.nombre)}</b></td><td>${esc(a.marca)}</td><td>${esc(a.veh_marca)}</td><td>${esc(a.veh_modelo)}</td><td>${esc(a.categoria)}</td><td>${esc(a.ubicacion)}</td>
    <td class="num"><span class="qty ${(+a.stock||0)<=0?"zero":""}">${+a.stock||0}</span></td>
    <td><div class="acts">${!canWrite?"":esTaller()?`<button class="btn sm" data-mv="${a.id}" data-t="salida" ${(+a.stock||0)<=0?"disabled":""}>− Dar salida</button>`:`<button class="btn sm" data-mv="${a.id}" data-t="entrada">+ Entrada</button><button class="btn sm" data-mv="${a.id}" data-t="salida">− Salida</button><button class="btn sm" data-ed="${a.id}">Editar</button>`}</div></td></tr>`).join("")
  }</tbody></table></div>`;
  box.querySelectorAll("[data-mv]").forEach(b=>b.onclick=()=>openMov(b.dataset.mv,b.dataset.t));
  box.querySelectorAll("[data-ed]").forEach(b=>b.onclick=()=>openProd(b.dataset.ed));
}
function renderPedidos(){
  const q=norm($("#qPed").value),soloAb=$("#fAbiertos").checked;
  const list=pedidos.filter(o=>(fTipo==="todos"||o.tipo===fTipo)&&(!soloAb||abierto(o))&&(!q||norm([o.numero,o.contacto,o.telefono,o.notas,...(o.items||[]).map(i=>i.nombre)].join(" ")).includes(q)))
    .sort((a,b)=>(abierto(b)-abierto(a))||String(b.creado).localeCompare(String(a.creado)));
  const box=$("#pedBody");
  if(!pedidos.length){box.innerHTML=`<div class="empty"><strong>No hay pedidos todavía</strong>Creá un pedido de cliente o una compra a proveedor con “+ Nuevo pedido”. Al marcarlo como Entregado o Recibido, el stock se descuenta o se suma solo.</div>`;return}
  if(!list.length){box.innerHTML=`<div class="empty"><strong>Nada que mostrar con estos filtros</strong>Desmarcá “Solo abiertos” para ver los pedidos cerrados.</div>`;return}
  const hoy=new Date().toISOString().slice(0,10);
  box.innerHTML=`<div class="orders">${list.map(o=>{
    const late=abierto(o)&&o.fecha_estimada&&o.fecha_estimada<hoy;
    const est=ESTADOS[o.tipo],i=est.indexOf(o.estado),next=abierto(o)&&i<est.length-2?est[i+1]:null;
    return `<article class="order" data-o="${o.id}" tabindex="0">
      <div class="hd"><div><div class="tag">${o.tipo==="cliente"?"Cliente":"Proveedor"} · <span class="no">${esc(o.numero)}</span></div><div class="who">${esc(o.contacto)}</div></div><span class="pill ${PILL[o.estado]||""}">${esc(o.estado)}</span></div>
      <ul>${(o.items||[]).slice(0,4).map(it=>`<li>${+it.cantidad||0} × ${esc(it.nombre)}</li>`).join("")}${(o.items||[]).length>4?`<li>y ${o.items.length-4} más…</li>`:""}</ul>
      <div class="ft"><span>Creado ${fmtD(o.creado)}${o.fecha_estimada?` · <span class="${late?"late":""}">${late?"Atrasado: ":"Estimado: "}${fmtD(o.fecha_estimada+"T12:00")}</span>`:""}</span>
      ${next&&canWrite?`<button class="btn sm" data-next="${o.id}" data-e="${esc(next)}">→ ${esc(next)}</button>`:""}</div></article>`}).join("")}</div>`;
  box.querySelectorAll(".order").forEach(c=>{c.onclick=e=>{if(e.target.closest("[data-next]"))return;openPed(c.dataset.o)};c.onkeydown=e=>{if(e.key==="Enter")openPed(c.dataset.o)}});
  box.querySelectorAll("[data-next]").forEach(b=>b.onclick=async()=>{b.disabled=true;await cambiarEstado(b.dataset.next,b.dataset.e);b.disabled=false});
}
function movsConArticulo(){return movimientos.map(m=>({...m,art:artDe(m.articulo_id)||{nombre:"(artículo borrado)",codigo:""}}))}
function puedeAnular(m){
  if(m.tipo!=="salida"||m.pedido||m.anulado_fecha||!canWrite||!ses)return false;
  if(esAdmin())return true;
  return m.por===me&&Date.now()-Date.parse(m.fecha)<24*3600e3;
}
function renderMovs(){
  if(esTaller())return;
  const q=norm($("#qMov").value);
  const list=movsConArticulo().filter(m=>(fMov==="todos"||m.tipo===fMov)&&(!q||norm([m.art.nombre,m.art.codigo,m.motivo,m.pedido,quien(m.por)].join(" ")).includes(q))).slice(0,500);
  const box=$("#movBody");
  if(!list.length){box.innerHTML=`<div class="empty"><strong>Sin movimientos para mostrar</strong>Las entradas, salidas y ajustes de stock aparecen acá con fecha, motivo y quién los hizo.</div>`;return}
  const cls={entrada:"mv-in",salida:"mv-out",ajuste:"mv-adj",anulacion:"mv-in"};
  const sign=m=>m.tipo==="entrada"||m.tipo==="anulacion"?"+"+m.cantidad:m.tipo==="salida"?"−"+m.cantidad:"= "+m.despues;
  box.innerHTML=`<div class="tablebox"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th class="num">Cant.</th><th class="num">Stock</th><th>Motivo</th><th>Por</th><th></th></tr></thead><tbody>${
    list.map(m=>`<tr class="${m.anulado_fecha?"anulado":""}"><td style="white-space:nowrap">${fmtDT(m.fecha)}</td><td><b>${esc(m.art.nombre)}</b> <span class="code">${esc(m.art.codigo)}</span></td>
    <td class="${cls[m.tipo]||""}">${TIPO[m.tipo]||esc(m.tipo)}</td><td class="num ${cls[m.tipo]||""}">${sign(m)}</td>
    <td class="num">${m.antes} → ${m.despues}</td><td>${esc(m.motivo)}${m.pedido?` <span class="code">${esc(m.pedido)}</span>`:""}</td><td>${esc(quien(m.por))}</td>
    <td>${m.anulado_fecha?`<span class="tag" title="Anulada por ${esc(quien(m.anulado_por))}">Anulada</span>`:puedeAnular(m)?`<button class="btn sm" data-undo="${m.id}">Deshacer</button>`:""}</td></tr>`).join("")
  }</tbody></table></div>`;
  bindUndo(box);
}
function renderMisSalidas(){
  const box=$("#misSal");
  if(!esTaller()){box.innerHTML="";return}
  const desde=Date.now()-24*3600e3;
  const list=movsConArticulo().filter(m=>m.tipo==="salida"&&m.por===me&&Date.parse(m.fecha)>=desde);
  box.innerHTML=`<div class="missal"><h3>Mis salidas de las últimas 24 horas</h3>${
    list.length?list.map(m=>`<div class="it ${m.anulado_fecha?"anul":""}"><div class="tx"><b>${m.cantidad} × ${esc(m.art.nombre)}</b> <span class="code">${esc(m.art.codigo)}</span><br><span class="hint">${fmtDT(m.fecha)}${m.motivo?" · "+esc(m.motivo):""}</span></div>${
      m.anulado_fecha?'<span class="tag">Deshecha</span>':puedeAnular(m)?`<button class="btn sm" data-undo="${m.id}">Deshacer</button>`:""}</div>`).join("")
    :'<p class="hint">Todavía no diste salida a ningún artículo. Si te equivocás de pieza, la vas a poder deshacer desde acá.</p>'}</div>`;
  bindUndo(box);
}
function bindUndo(box){
  box.querySelectorAll("[data-undo]").forEach(b=>b.onclick=async()=>{
    if(b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent="Confirmar";setTimeout(()=>{if(b.isConnected&&!b.disabled){b.dataset.armed="";b.textContent="Deshacer"}},4000);return}
    b.disabled=true;
    try{await q(sb.rpc("anular_salida",{p_movimiento:b.dataset.undo}));await Promise.all([cargar("articulos"),cargar("movimientos")]);renderAll();toast("Salida deshecha: el stock se repuso")}
    catch(e){toast(errMsg(e));b.disabled=false}
  });
}

/* ---------------- artículos ---------------- */
let editProd=null,delArm=false;
function openProd(id){
  editProd=id?artDe(id):null;const a=editProd||{};
  $("#prodTitle").textContent=id?"Editar artículo":"Nuevo artículo";
  $("#pCodigo").value=a.codigo||"";$("#pNombre").value=a.nombre||"";$("#pMarca").value=a.marca||"";
  $("#pVehMarca").value=a.veh_marca||"";$("#pVehModelo").value=a.veh_modelo||"";
  $("#pUbic").value=a.ubicacion||"";$("#pCat").value=a.categoria||"Otros";$("#pStock").value=0;
  $("#pStockWrap").hidden=!!id;$("#prodDel").hidden=!id;$("#prodDel").textContent="Eliminar";delArm=false;$("#prodErr").textContent="";
  $("#dlgProd").showModal();$("#pNombre").focus();
}
$("#btnNuevo").onclick=()=>openProd(null);
$("#prodDel").onclick=async()=>{
  if(!delArm){delArm=true;$("#prodDel").textContent="Se borra con su historial. Tocá de nuevo";return}
  try{await q(sb.from("articulos").delete().eq("id",editProd.id));$("#dlgProd").close();await Promise.all([cargar("articulos"),cargar("movimientos")]);renderAll();toast("Artículo eliminado")}
  catch(e){$("#prodErr").textContent=errMsg(e)}
};
$("#formProd").onsubmit=async e=>{
  e.preventDefault();const err=$("#prodErr");err.textContent="";
  const nombre=$("#pNombre").value.trim(),codigo=$("#pCodigo").value.trim();
  if(!nombre){err.textContent="Escribí el nombre del artículo.";return}
  if(codigo&&articulos.some(a=>a.id!==editProd?.id&&norm(a.codigo)===norm(codigo))){err.textContent="Ya existe un artículo con ese código.";return}
  const d={codigo,nombre,marca:$("#pMarca").value.trim(),veh_marca:$("#pVehMarca").value.trim(),veh_modelo:$("#pVehModelo").value.trim(),categoria:$("#pCat").value,ubicacion:$("#pUbic").value.trim()};
  $("#prodSave").disabled=true;
  try{
    if(editProd){await q(sb.from("articulos").update(d).eq("id",editProd.id));toast("Cambios guardados")}
    else{
      await q(sb.rpc("crear_articulo",{p_codigo:d.codigo,p_nombre:d.nombre,p_marca:d.marca,p_veh_marca:d.veh_marca,p_veh_modelo:d.veh_modelo,p_categoria:d.categoria,p_ubicacion:d.ubicacion,p_stock:Math.max(0,Math.floor(+$("#pStock").value||0))}));
      toast("Artículo agregado");
    }
    $("#dlgProd").close();await Promise.all([cargar("articulos"),cargar("movimientos")]);renderAll();
  }catch(x){err.textContent=errMsg(x)}finally{$("#prodSave").disabled=false}
};

/* ---------------- movimientos manuales ---------------- */
let movPid=null;
function openMov(id,tipo){
  movPid=id;const a=artDe(id);
  $("#movInfo").textContent=`${label(a)} — stock actual: ${+a.stock||0}`;
  if(esTaller())tipo="salida";
  document.querySelectorAll("input[name=mtipo]").forEach(r=>r.closest("label").hidden=esTaller()&&r.value!=="salida");
  $("#mMotivo").placeholder=esTaller()?"Ej. Vehículo, matrícula u orden de trabajo":"Ej. Compra mostrador, uso en taller…";
  document.querySelector(`input[name=mtipo][value=${tipo}]`).checked=true;syncMovLbl();
  $("#mCant").value=1;$("#mMotivo").value="";$("#movErr").textContent="";$("#dlgMov").showModal();$("#mCant").select();
}
function syncMovLbl(){const t=document.querySelector("input[name=mtipo]:checked").value;$("#mCantLbl").firstChild.textContent=t==="ajuste"?"Stock contado":"Cantidad"}
document.querySelectorAll("input[name=mtipo]").forEach(r=>r.onchange=syncMovLbl);
$("#formMov").onsubmit=async e=>{
  e.preventDefault();const tipo=esTaller()?"salida":document.querySelector("input[name=mtipo]:checked").value;const cant=Math.floor(+$("#mCant").value);
  if(!(cant>=0)||(tipo!=="ajuste"&&cant<1)){$("#movErr").textContent="Ingresá una cantidad válida.";return}
  $("#movSave").disabled=true;
  try{await q(sb.rpc("mover_stock",{p_articulo:movPid,p_tipo:tipo,p_cantidad:cant,p_motivo:$("#mMotivo").value.trim()}));
    $("#dlgMov").close();await Promise.all([cargar("articulos"),cargar("movimientos")]);renderAll();toast("Movimiento registrado")}
  catch(x){$("#movErr").textContent=errMsg(x)}finally{$("#movSave").disabled=false}
};

/* ---------------- pedidos ---------------- */
let editPed=null,pedArm=false;
const tipoSel=()=>document.querySelector("input[name=ptipo]:checked").value;
function syncPedTipo(){
  const t=tipoSel();$("#lblContacto").textContent=t==="cliente"?"Cliente *":"Proveedor *";
  $("#oEstado").innerHTML=ESTADOS[t].map(s=>`<option>${esc(s)}</option>`).join("");
  $("#oHint").textContent=t==="cliente"?"Al pasar a “Entregado”, se descuenta del stock cada artículo elegido de la lista.":"Al pasar a “Recibido”, se suma al stock cada artículo elegido de la lista.";
}
document.querySelectorAll("input[name=ptipo]").forEach(r=>r.onchange=syncPedTipo);
function itemRow(it={}){
  const d=document.createElement("div");d.className="itemrow";
  const a=it.articulo_id&&artDe(it.articulo_id);
  d.innerHTML=`<input list="dlProductos" class="iNom" placeholder="Buscá un artículo o escribí uno nuevo" value="${esc(a?label(a):it.nombre||"")}"><input class="iCant" type="number" min="1" step="1" value="${+it.cantidad||1}" aria-label="Cantidad"><button type="button" class="btn sm" aria-label="Quitar">✕</button>`;
  d.querySelector("button").onclick=()=>d.remove();$("#oItems").appendChild(d);
}
$("#oAddItem").onclick=()=>{itemRow();$("#oItems").lastChild.querySelector("input").focus()};
function openPed(id){
  editPed=id?pedidos.find(o=>o.id===id):null;const o=editPed||{tipo:"cliente"};
  $("#pedTitle").textContent=id?`Pedido ${o.numero}`:"Nuevo pedido";
  document.querySelector(`input[name=ptipo][value=${o.tipo}]`).checked=true;
  document.querySelectorAll("input[name=ptipo]").forEach(r=>r.disabled=!!id);
  syncPedTipo();if(o.estado)$("#oEstado").value=o.estado;
  $("#oEstado").disabled=!!(id&&!abierto(o))||!canWrite;
  $("#oContacto").value=o.contacto||"";$("#oTel").value=o.telefono||"";$("#oFecha").value=o.fecha_estimada||"";$("#oNotas").value=o.notas||"";
  $("#oItems").innerHTML="";(o.items&&o.items.length?o.items:[{}]).forEach(itemRow);
  const lock=!!(id&&o.stock_aplicado)||!canWrite;$("#oItems").querySelectorAll("input,button").forEach(x=>x.disabled=lock);$("#oAddItem").disabled=lock;
  $("#oTimeline").innerHTML=(o.historial_estados||[]).map(h=>`<li>${fmtDT(h.fecha)} — ${esc(h.estado)}${h.por&&quien(h.por)?` · ${esc(quien(h.por))}`:""}</li>`).join("");
  $("#pedDel").hidden=!id||!canWrite;$("#pedDel").textContent="Eliminar";pedArm=false;$("#pedErr").textContent="";$("#pedSave").hidden=!canWrite;
  $("#dlgPed").showModal();
}
$("#btnPedido").onclick=()=>openPed(null);
$("#pedDel").onclick=async()=>{
  if(!pedArm){pedArm=true;$("#pedDel").textContent="Tocá de nuevo para confirmar";return}
  try{await q(sb.from("pedidos").delete().eq("id",editPed.id));$("#dlgPed").close();await cargar("pedidos");renderAll();toast("Pedido eliminado")}catch(e){$("#pedErr").textContent=errMsg(e)}
};
function readItems(){
  return [...$("#oItems").children].map(r=>{const txt=r.querySelector(".iNom").value.trim(),c=Math.floor(+r.querySelector(".iCant").value||0);
    if(!txt)return null;const a=articulos.find(x=>label(x)===txt)||articulos.find(x=>x.codigo&&norm(x.codigo)===norm(txt));
    return a?{articulo_id:a.id,nombre:a.nombre,codigo:a.codigo||"",cantidad:c}:{articulo_id:"",nombre:txt,codigo:"",cantidad:c}}).filter(Boolean);
}
async function cambiarEstado(id,estado){
  try{const p=await q(sb.rpc("cambiar_estado_pedido",{p_pedido:id,p_estado:estado}));
    await Promise.all([cargar("pedidos"),cargar("articulos"),cargar("movimientos")]);renderAll();toast(`${p.numero}: ${estado}`);return true}
  catch(e){toast(errMsg(e));return e}
}
$("#formPed").onsubmit=async e=>{
  e.preventDefault();const err=$("#pedErr");err.textContent="";
  const tipo=tipoSel(),contacto=$("#oContacto").value.trim();
  if(!contacto){err.textContent=tipo==="cliente"?"Escribí el nombre del cliente.":"Escribí el nombre del proveedor.";return}
  const items=readItems();
  if(!items.length){err.textContent="Agregá al menos un artículo.";return}
  if(items.some(i=>i.cantidad<1)){err.textContent="Cada artículo necesita una cantidad de 1 o más.";return}
  const estado=$("#oEstado").value;
  const base={contacto,telefono:$("#oTel").value.trim(),fecha_estimada:$("#oFecha").value||null,notas:$("#oNotas").value.trim()};
  if(!(editPed&&editPed.stock_aplicado))base.items=items;
  $("#pedSave").disabled=true;
  try{
    let id,numero;
    if(editPed){await q(sb.from("pedidos").update(base).eq("id",editPed.id));id=editPed.id;numero=editPed.numero}
    else{const r=await q(sb.from("pedidos").insert({...base,tipo}).select("id,numero,estado").single());id=r.id;numero=r.numero}
    const actual=editPed?editPed.estado:ESTADOS[tipo][0];
    if(estado!==actual){
      try{await q(sb.rpc("cambiar_estado_pedido",{p_pedido:id,p_estado:estado}))}
      catch(x){await cargar("pedidos");renderAll();err.textContent=(editPed?"":`Pedido ${numero} creado, pero: `)+errMsg(x);if(!editPed)editPed=pedidos.find(o=>o.id===id);return}
    }
    $("#dlgPed").close();await Promise.all([cargar("pedidos"),cargar("articulos"),cargar("movimientos")]);renderAll();
    toast(editPed?"Pedido actualizado":`Pedido ${numero} creado`);
  }catch(x){err.textContent=errMsg(x)}finally{$("#pedSave").disabled=false}
};

/* ---------------- usuarios ---------------- */
function renderUsuarios(){
  const box=$("#usrBody");if(!esAdmin())return;
  const list=[...perfiles].sort((a,b)=>(b.activo-a.activo)||norm(a.nombre).localeCompare(norm(b.nombre)));
  box.innerHTML=`<div class="tablebox"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody>${
    list.map(u=>`<tr><td><b>${esc(u.nombre)}</b>${u.id===me?' <span class="tag">(vos)</span>':""}</td><td class="code">${esc(u.usuario)}</td><td>${esc(ROLES[u.rol]||u.rol)}</td>
    <td>${u.activo?'<span class="pill p-done">Activo</span>':'<span class="pill p-cancel">Inactivo</span>'}</td><td>${fmtDT(u.ultimo_ingreso)||"—"}</td>
    <td><div class="acts"><button class="btn sm" data-usr="${u.id}">Editar</button></div></td></tr>`).join("")}</tbody></table></div>`;
  box.querySelectorAll("[data-usr]").forEach(b=>b.onclick=()=>openUsr(b.dataset.usr));
}
let editUsr=null;
function openUsr(id){
  editUsr=id?perfiles.find(u=>u.id===id):null;const u=editUsr||{rol:"operador",activo:true};
  $("#usrTitle").textContent=id?"Editar usuario":"Nuevo usuario";
  $("#uNombre").value=u.nombre||"";$("#uUser").value=u.usuario||"";$("#uUser").disabled=!!id;$("#uRol").value=u.rol;
  $("#uActivo").checked=u.activo!==false;$("#uActivoWrap").hidden=!id;
  $("#uPass").value="";$("#uPass2").value="";$("#uPassLbl").textContent=id?"Nueva contraseña (vacío = no cambiar)":"Contraseña *";
  $("#usrErr").textContent="";$("#dlgUsr").showModal();$("#uNombre").focus();
}
$("#btnUsr").onclick=()=>openUsr(null);
async function llamarAdmin(body){
  const {data,error}=await sb.functions.invoke("admin-usuarios",{body});
  if(error){let m=error.message;try{const j=await error.context.json();if(j&&j.error)m=j.error}catch(x){}throw new Error(m)}
  if(data&&data.error)throw new Error(data.error);
  return data;
}
$("#formUsr").onsubmit=async e=>{
  e.preventDefault();const err=$("#usrErr");err.textContent="";
  const nombre=$("#uNombre").value.trim(),usuario=editUsr?editUsr.usuario:$("#uUser").value.trim().toLowerCase(),rol=$("#uRol").value,activo=editUsr?$("#uActivo").checked:true,pw=$("#uPass").value;
  if(!nombre){err.textContent="Escribí el nombre.";return}
  if(!editUsr){if(!/^[a-z0-9._-]{3,30}$/.test(usuario)){err.textContent="El usuario lleva de 3 a 30 letras minúsculas, números, punto o guion.";return}
    if(perfiles.some(u=>u.usuario===usuario)){err.textContent="Ese usuario ya existe.";return}}
  if(!editUsr||pw){if(pw.length<6){err.textContent="La contraseña tiene que tener al menos 6 caracteres.";return}if(pw!==$("#uPass2").value){err.textContent="Las contraseñas no coinciden.";return}}
  if(editUsr&&editUsr.id===me&&(rol!=="admin"||!activo)){err.textContent="No podés quitarte el rol de administrador ni desactivarte a vos mismo.";return}
  $("#usrSave").disabled=true;
  try{
    await llamarAdmin(editUsr?{accion:"editar",id:editUsr.id,nombre,rol,activo,password:pw||null}:{accion:"crear",usuario,nombre,rol,password:pw});
    $("#dlgUsr").close();await cargar("perfiles");renderAll();toast(editUsr?"Usuario actualizado":`Usuario ${usuario} creado`);
  }catch(x){err.textContent=errMsg(x)}finally{$("#usrSave").disabled=false}
};
$("#btnUser").onclick=()=>{["#pwOld","#pwNew","#pwNew2"].forEach(s=>$(s).value="");$("#pwErr").textContent="";$("#dlgPw").showModal();$("#pwOld").focus()};
$("#formPw").onsubmit=async e=>{
  e.preventDefault();const err=$("#pwErr");err.textContent="";
  const nueva=$("#pwNew").value;
  if(nueva.length<6){err.textContent="La contraseña tiene que tener al menos 6 caracteres.";return}
  if(nueva!==$("#pwNew2").value){err.textContent="Las contraseñas no coinciden.";return}
  $("#pwSave").disabled=true;
  try{
    const {error:e1}=await sb.auth.signInWithPassword({email:emailDe(ses.usuario),password:$("#pwOld").value});
    if(e1){err.textContent="La contraseña actual no es correcta.";return}
    await q(sb.auth.updateUser({password:nueva}));
    $("#dlgPw").close();toast("Contraseña cambiada");
  }catch(x){err.textContent=errMsg(x)}finally{$("#pwSave").disabled=false}
};

/* ---------------- ingreso / salida ---------------- */
const emailDe=u=>`${u}@${CFG.DOMINIO_USUARIOS||"control-articulos.local"}`;
let fails=0,lockUntil=0;
function mostrarIngreso(msg){
  $("#auth").hidden=false;$("#app").hidden=true;$("#offline").hidden=true;offlineShown=false;
  document.querySelectorAll("dialog[open]").forEach(d=>d.close());
  $("#aPass").value="";$("#authErr").textContent=msg||"";pintarConexion();
  setTimeout(()=>($("#aUser").value?$("#aPass"):$("#aUser")).focus(),30);
}
$("#formAuth").onsubmit=async e=>{
  e.preventDefault();const err=$("#authErr"),btn=$("#authBtn");err.textContent="";
  const usuario=$("#aUser").value.trim().toLowerCase(),pw=$("#aPass").value;
  if(Date.now()<lockUntil){err.textContent=`Demasiados intentos. Esperá ${Math.ceil((lockUntil-Date.now())/1000)} segundos.`;return}
  if(!usuario||!pw){err.textContent="Completá usuario y contraseña.";return}
  btn.disabled=true;$("#authBtn").textContent="Ingresando…";
  try{
    if(!await comprobarConexion()){pintarConexion();err.textContent="Sin conexión a internet. Conectate para ingresar.";return}
    const {error}=await sb.auth.signInWithPassword({email:emailDe(usuario),password:pw});
    if(error){
      if(/banned/i.test(error.message)){err.textContent="Este usuario está desactivado. Consultá con el administrador.";return}
      if(/Invalid login|invalid_credentials|Email not confirmed/i.test(error.message)){
        fails++;if(fails>=5){lockUntil=Date.now()+30000;fails=0}
        err.textContent="Usuario o contraseña incorrectos.";$("#aPass").value="";$("#aPass").focus();return}
      err.textContent=errMsg(error);return;
    }
    const p=await q(sb.rpc("registrar_ingreso"));
    if(!p||!p.id){await sb.auth.signOut();err.textContent="Este usuario está desactivado o no tiene permisos. Consultá con el administrador.";return}
    fails=0;await entrar(p);
  }catch(x){err.textContent=errMsg(x)}
  finally{$("#authBtn").textContent="Ingresar";pintarConexion()}
};
async function entrar(p){
  ses={id:p.id,usuario:p.usuario,nombre:p.nombre,rol:p.rol};me=p.id;
  $("#auth").hidden=true;$("#app").hidden=false;lastAct=Date.now();
  aplicarPermisos();
  $("#stockBody").innerHTML='<div class="empty"><strong>Cargando…</strong></div>';
  await recargarTodo();suscribir();
}
async function salir(msg){
  ses=null;me=null;articulos=[];pedidos=[];movimientos=[];perfiles=[];
  if(canal){try{sb.removeChannel(canal)}catch(e){}canal=null}
  try{await sb.auth.signOut()}catch(e){}
  mostrarIngreso(msg);
}
$("#btnSalir").onclick=()=>salir();
function verificarMiPerfil(){
  if(!ses)return;const p=perfiles.find(x=>x.id===me);
  if(!p||!p.activo){salir("Tu usuario fue desactivado. Consultá con el administrador.");return}
  if(p.rol!==ses.rol||p.nombre!==ses.nombre){const cambioTaller=(p.rol==="taller")!==(ses.rol==="taller");ses.rol=p.rol;ses.nombre=p.nombre;aplicarPermisos();if(cambioTaller)recargarTodo()}
}
function aplicarPermisos(){
  canWrite=!!ses&&ses.rol!=="lectura";
  const taller=esTaller(),admin=esAdmin();
  $("#btnNuevo").disabled=!canWrite;$("#btnPedido").disabled=!canWrite;$("#btnNuevo").hidden=taller||!canWrite;$("#btnPedido").hidden=!canWrite;
  $("#stats").hidden=taller;$("#tab-pedidos").hidden=taller;$("#tab-movs").hidden=taller;$("#tab-usuarios").hidden=!admin;$("#btnExcel").hidden=taller;
  $("#appSub").textContent=taller?"Buscá el artículo y dale salida. Si te equivocás de pieza, deshacela abajo.":"Stock, pedidos de clientes y compras a proveedores, compartido en tiempo real.";
  $("#whoName").textContent=ses.nombre;$("#whoRol").textContent=ROLES[ses.rol]||ses.rol;
  if((tab==="usuarios"&&!admin)||(taller&&tab!=="stock"))setTab("stock");else setTab(tab);
  renderAll();
}
let lastAct=Date.now();
["pointerdown","keydown"].forEach(ev=>addEventListener(ev,()=>lastAct=Date.now(),{passive:true}));
setInterval(()=>{if(ses&&Date.now()-lastAct>30*60*1000)salir("Se cerró la sesión por 30 minutos sin uso.")},30000);

/* ---------------- Excel ---------------- */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function zip(files){
  const enc=new TextEncoder(),parts=[],central=[];let off=0;
  for(const f of files){const name=enc.encode(f.name),data=enc.encode(f.data),crc=crc32(data);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    parts.push(new Uint8Array(h.buffer),name,data);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,off,true);
    central.push(new Uint8Array(c.buffer),name);off+=30+name.length+data.length}
  const csize=central.reduce((a,b)=>a+b.length,0),e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,csize,true);e.setUint32(16,off,true);
  const all=[...parts,...central,new Uint8Array(e.buffer)],out=new Uint8Array(all.reduce((a,b)=>a+b.length,0));let p=0;for(const a of all){out.set(a,p);p+=a.length}return out;
}
const xesc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"");
function colName(i){let s="";i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s}
function sheetXml(cols,rows){
  const cell=(v,r,c,st)=>{const ref=colName(c)+r;return typeof v==="number"&&isFinite(v)?`<c r="${ref}"${st}><v>${v}</v></c>`:`<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`};
  const widths=cols.map((c,i)=>Math.min(60,Math.max(10,c.length+2,...rows.map(r=>String(r[i]??"").length+1))));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>`+
    `<row r="1">${cols.map((c,i)=>cell(c,1,i,' s="1"')).join("")}</row>`+rows.map((r,ri)=>`<row r="${ri+2}">${r.map((v,ci)=>cell(v,ri+2,ci,"")).join("")}</row>`).join("")+
    `</sheetData>${rows.length?`<autoFilter ref="A1:${colName(cols.length-1)}${rows.length+1}"/>`:""}</worksheet>`;
}
function makeXlsx(sheets){
  const f=[{name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`},
    {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xesc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`},
    {name:"xl/_rels/workbook.xml.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:"xl/styles.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`},
    ...sheets.map((s,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.cols,s.rows)}))];
  return zip(f);
}
function buildWorkbook(){
  const arts=[...articulos].sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre))).map(a=>[a.codigo||"",a.nombre,a.marca||"",a.veh_marca||"",a.veh_modelo||"",a.categoria||"",a.ubicacion||"",+a.stock||0,fmtDT(a.actualizado)]);
  const peds=[...pedidos].sort((a,b)=>String(b.creado).localeCompare(String(a.creado))).map(o=>[o.numero,o.tipo==="cliente"?"Cliente":"Proveedor",o.contacto,o.telefono||"",o.estado,fmtD(o.creado),o.fecha_estimada?fmtD(o.fecha_estimada+"T12:00"):"",(o.items||[]).map(i=>i.cantidad+" x "+i.nombre).join("; "),o.stock_aplicado?"Sí":"No",o.notas||""]);
  const movs=movsConArticulo().map(m=>[fmtDT(m.fecha),m.art.codigo||"",m.art.nombre,(TIPO[m.tipo]||m.tipo)+(m.anulado_fecha?" (anulada)":""),+m.cantidad||0,+m.antes||0,+m.despues||0,m.motivo||"",m.pedido||"",quien(m.por)]);
  return makeXlsx([
    {name:"Artículos",cols:["Código","Artículo","Marca artículo","Marca vehículo","Modelo vehículo","Categoría","Ubicación","Stock","Actualizado"],rows:arts},
    {name:"Pedidos",cols:["Número","Tipo","Cliente / Proveedor","Teléfono","Estado","Creado","Fecha estimada","Artículos","Stock aplicado","Notas"],rows:peds},
    {name:"Movimientos",cols:["Fecha","Código","Artículo","Tipo","Cantidad","Stock antes","Stock después","Motivo","Pedido","Por"],rows:movs}]);
}
$("#btnExcel").onclick=async()=>{
  const b=$("#btnExcel");b.disabled=true;
  try{
    const d=new Date(),f=`articulos-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.xlsx`;
    const bytes=buildWorkbook();
    if(window.desktop&&window.desktop.guardarArchivo){const r=await window.desktop.guardarArchivo(f,bytes);if(r&&r.guardado)toast("Excel guardado")}
    else{const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download=f;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
  }catch(e){toast("No se pudo guardar el Excel.")}
  finally{b.disabled=false}
};

/* ---------------- actualizaciones ---------------- */
if(window.desktop){
  window.desktop.version().then(v=>$("#authVer").textContent="Versión "+v).catch(()=>{});
  window.desktop.onUpdate(u=>{
    const bar=$("#updBar"),txt=$("#updTxt"),btn=$("#updBtn");
    if(u.estado==="descargando"){bar.hidden=false;btn.hidden=true;txt.textContent=`Descargando actualización ${u.version||""}… ${u.porcentaje!=null?Math.round(u.porcentaje)+"%":""}`}
    else if(u.estado==="lista"){bar.hidden=false;btn.hidden=false;txt.textContent=`Hay una versión nueva (${u.version}). Se instala al reiniciar.`}
    else if(u.estado==="error"){bar.hidden=true}
  });
  $("#updBtn").onclick=()=>window.desktop.instalarActualizacion();
}

/* ---------------- arranque ---------------- */
(async()=>{
  if(!window.supabase||!window.supabase.createClient){$("#authErr").textContent="Falta un componente de la app. Reinstalala.";$("#authBtn").disabled=true;return}
  if(!CFG.SUPABASE_URL||/TU-PROYECTO/.test(CFG.SUPABASE_URL)||/PEGAR/.test(CFG.SUPABASE_ANON_KEY||"")){$("#authErr").textContent="La app no está configurada: falta completar src/config.js con los datos de Supabase.";$("#authBtn").disabled=true;return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
  sb.auth.onAuthStateChange(ev=>{if(ev==="SIGNED_OUT"&&ses)salir("Tu sesión terminó. Volvé a ingresar.")});
  mostrarIngreso();await vigilarConexion();
})();
