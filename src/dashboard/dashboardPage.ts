// Self-contained HTML for the QLC+ MCP dashboard (Control + Docs tabs).
// Served as a string by registerDashboard so no static-asset copy step is needed
// in the tsc build or the Docker image. The inline front-end script deliberately
// avoids backticks/${} so it stays valid inside this outer template literal.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QLC+ MCP Dashboard</title>
<style>
  :root{
    --bg:#0b0e14; --panel:#121722; --panel2:#0e131c; --line:#1f2738;
    --txt:#e6ebf5; --muted:#8a97ad; --accent:#5b9cff; --accent2:#36d399;
    --warn:#f7b955; --err:#ff6b6b; --chip:#1a2233; --radius:12px;
    --mono:"SFMono-Regular",ui-monospace,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,#16203a 0,var(--bg) 60%);
    color:var(--txt);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  header{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line);
    position:sticky;top:0;background:rgba(11,14,20,.85);backdrop-filter:blur(8px);z-index:5}
  .logo{font-weight:700;letter-spacing:.3px;font-size:16px}
  .logo b{color:var(--accent)}
  .dot{width:10px;height:10px;border-radius:50%;background:var(--muted);box-shadow:0 0 0 0 rgba(0,0,0,0)}
  .dot.ok{background:var(--accent2);box-shadow:0 0 10px var(--accent2)}
  .dot.bad{background:var(--err);box-shadow:0 0 10px var(--err)}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;align-items:center}
  .badge{font-size:11px;padding:3px 9px;border-radius:999px;background:var(--chip);color:var(--muted);
    border:1px solid var(--line);white-space:nowrap}
  .badge.live{color:var(--accent2);border-color:#1d4} .badge.warn{color:var(--warn)} .badge.err{color:var(--err)}
  .tabs{display:flex;gap:6px;padding:10px 20px 0}
  .tab{padding:8px 16px;border:1px solid var(--line);border-bottom:none;border-radius:10px 10px 0 0;
    background:var(--panel2);color:var(--muted);cursor:pointer;font-weight:600}
  .tab.active{background:var(--panel);color:var(--txt)}
  main{padding:16px 20px 60px;max-width:1400px;margin:0 auto}
  .grid{display:grid;grid-template-columns:1.1fr 1.3fr;gap:16px}
  @media(max-width:980px){.grid{grid-template-columns:1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
  .card h2{margin:0;padding:12px 16px;font-size:13px;letter-spacing:.4px;text-transform:uppercase;
    color:var(--muted);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
  .card h2 .sp{margin-left:auto;display:flex;gap:8px;align-items:center}
  .card .body{padding:14px 16px}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
  .kv div:nth-child(odd){color:var(--muted)}
  .kv .mono,.mono{font-family:var(--mono)}
  .btn{border:1px solid var(--line);background:var(--chip);color:var(--txt);padding:7px 12px;border-radius:9px;
    cursor:pointer;font-weight:600;font-size:12px}
  .btn:hover{border-color:var(--accent)} .btn:active{transform:translateY(1px)}
  .btn.accent{background:linear-gradient(180deg,#2b5fd0,#234fb0);border-color:#356;color:#fff}
  .btn.sm{padding:5px 9px;font-size:11px}
  .btn:disabled{opacity:.45;cursor:not-allowed}
  input,select,textarea{background:var(--panel2);border:1px solid var(--line);color:var(--txt);
    border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;width:100%}
  textarea{font-family:var(--mono);resize:vertical}
  .row{display:flex;gap:8px;align-items:center}
  .row>*{flex:0 0 auto} .row .grow{flex:1 1 auto}
  label.lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;display:block;margin:10px 0 4px}
  .wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;max-height:420px;overflow:auto}
  .wcard{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--panel2);display:flex;flex-direction:column;gap:8px}
  .wcard .nm{font-weight:600;font-size:13px;word-break:break-word}
  .wcard .pa{font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-all}
  .wcard .tp{font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--accent);align-self:flex-start;
    background:var(--chip);padding:2px 7px;border-radius:999px}
  .feed{max-height:180px;overflow:auto;font-family:var(--mono);font-size:11px;display:flex;flex-direction:column;gap:4px}
  .feed .f{padding:5px 8px;background:var(--panel2);border:1px solid var(--line);border-radius:7px}
  .log{max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:6px}
  .le{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--panel2);padding:8px 10px}
  .le.err{border-left-color:var(--err)} .le.ok{border-left-color:var(--accent2)}
  .le .h{display:flex;gap:8px;align-items:center;font-size:12px}
  .le .h .nm{font-weight:700} .le .h .t{margin-left:auto;color:var(--muted);font-size:11px}
  .le pre{margin:6px 0 0;font-family:var(--mono);font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto}
  .note{font-size:12px;color:var(--warn);background:rgba(247,185,85,.08);border:1px solid rgba(247,185,85,.25);
    border-radius:8px;padding:8px 10px;margin-top:8px}
  .auth{display:none;align-items:center;gap:8px;padding:10px 20px;background:rgba(247,185,85,.07);border-bottom:1px solid var(--line)}
  .auth.show{display:flex}
  .muted{color:var(--muted)} .small{font-size:12px}
  /* docs */
  .docs{display:flex;flex-direction:column;gap:16px}
  .arch{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;padding:10px}
  .node{border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:12px 16px;text-align:center;min-width:120px}
  .node b{display:block;color:var(--accent)} .node small{color:var(--muted)}
  .arrow{color:var(--muted);font-size:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.4px}
  td.mono,code{font-family:var(--mono)}
  code{background:var(--chip);padding:1px 6px;border-radius:6px;font-size:12px}
  pre.code{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;
    font-family:var(--mono);font-size:12px;color:#cdd7ea}
  .tool{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2)}
  .tool h3{margin:0 0 4px;font-family:var(--mono);font-size:14px;color:var(--accent2)}
  .pill{display:inline-block;font-size:11px;color:var(--muted);background:var(--chip);border:1px solid var(--line);
    padding:1px 8px;border-radius:999px;margin:2px 4px 2px 0;font-family:var(--mono)}
  .hidden{display:none !important}
</style>
</head>
<body>
<header>
  <span class="dot" id="health-dot"></span>
  <span class="logo"><b>QLC+</b> MCP Dashboard</span>
  <div class="badges" id="badges"></div>
</header>

<div class="auth" id="authbar">
  <span class="small">Bearer auth is enabled. Paste the MCP token to control the server:</span>
  <input id="token" type="password" placeholder="MCP_AUTH_TOKEN" style="max-width:320px" />
  <button class="btn sm accent" id="token-save">Save</button>
  <span class="small muted" id="auth-msg"></span>
</div>

<div class="tabs">
  <div class="tab active" data-tab="control">Control</div>
  <div class="tab" data-tab="docs">Integration &amp; Docs</div>
</div>

<main>
  <!-- CONTROL -->
  <section id="control">
    <div class="grid">
      <div class="card">
        <h2>OSC Runtime State
          <span class="sp">
            <label class="small muted"><input type="checkbox" id="auto" style="width:auto" /> auto</label>
            <button class="btn sm" id="refresh-state">Refresh</button>
          </span>
        </h2>
        <div class="body">
          <div id="state-summary" class="small muted">Not loaded.</div>
          <div class="kv" id="state-kv" style="margin-top:10px"></div>
          <label class="lbl">Recent feedback (from QLC+)</label>
          <div class="feed" id="feed"><div class="muted small">No feedback yet.</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Widgets
          <span class="sp">
            <button class="btn sm" id="reload-widgets">Reload</button>
          </span>
        </h2>
        <div class="body">
          <div class="row">
            <input id="w-query" class="grow" placeholder="filter by name / path / description" />
            <select id="w-type" style="width:130px">
              <option value="">all types</option>
              <option>button</option><option>slider</option><option>speed</option>
              <option>cuelist</option><option>chaser</option><option>frame</option>
              <option>label</option><option>unknown</option>
            </select>
          </div>
          <div class="wgrid" id="widgets" style="margin-top:12px"><div class="muted small">Loading...</div></div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px">
      <div class="card">
        <h2>Raw OSC Console</h2>
        <div class="body">
          <label class="lbl">OSC Path</label>
          <input id="osc-path" class="mono" placeholder="/0/dmx/0" />
          <label class="lbl">Arguments (comma / JSON, e.g. 255 or "go", 1)</label>
          <input id="osc-args" class="mono" placeholder="255" />
          <div class="row" style="margin-top:10px">
            <label class="small muted"><input type="checkbox" id="osc-dry" style="width:auto" /> dry run</label>
            <button class="btn accent" id="osc-send" style="margin-left:auto">Send OSC</button>
          </div>
          <div class="note hidden" id="osc-note">Raw OSC is disabled (QLC_ALLOW_RAW_OSC=false). Enable it in the server env to use this console and slider widgets.</div>
        </div>
      </div>

      <div class="card">
        <h2>MCP Activity Log
          <span class="sp"><button class="btn sm" id="log-clear">Clear</button></span>
        </h2>
        <div class="body"><div class="log" id="log"><div class="muted small">Tool calls appear here.</div></div></div>
      </div>
    </div>
  </section>

  <!-- DOCS -->
  <section id="docs" class="hidden">
    <div class="docs">
      <div class="card"><h2>This Show &mdash; Patch Chart &amp; Launchpad Map</h2><div class="body">
        <pre class="code" id="patch-chart" style="white-space:pre;overflow:auto;max-height:520px">Loading patch chart&hellip;</pre>
        <p class="small muted" style="margin-bottom:0">Generated by <code>scripts/build-show.ts</code>. The looks above appear as live buttons on the <b>Control</b> tab.</p>
      </div></div>

      <div class="card"><h2>Architecture</h2><div class="body">
        <div class="arch">
          <div class="node"><b>MCP Client</b><small>Claude / agent</small></div>
          <span class="arrow">&rarr;</span>
          <div class="node"><b>QLC+ MCP</b><small>this server (Hono)</small></div>
          <span class="arrow">&rarr;</span>
          <div class="node"><b>OSC / UDP</b><small>:7700 in &middot; :9000 fb</small></div>
          <span class="arrow">&rarr;</span>
          <div class="node"><b>QLC+ 4</b><small>Virtual Console</small></div>
        </div>
        <p class="small muted" style="text-align:center;margin:4px 0 0">
          Tools call OSC paths mapped from <code>config/widgets.json</code>. QLC+ feedback returns on the output port and is surfaced via <code>qlc_get_state</code>.
          This dashboard talks to the same tools over a thin REST proxy on <code>/dashboard/api/*</code>.</p>
      </div></div>

      <div class="card"><h2>MCP Tools</h2><div class="body" id="tool-catalog"></div></div>

      <div class="card"><h2>Live Configuration</h2><div class="body">
        <table id="cfg-table"><tbody></tbody></table>
      </div></div>

      <div class="card"><h2>Client Connection (streamable-http)</h2><div class="body">
        <p class="small muted">Point an MCP client at the HTTP endpoint:</p>
        <pre class="code" id="client-cfg">...</pre>
        <p class="small muted">STDIO clients (e.g. Claude Desktop) instead launch <code>node dist/src/index.js</code> with <code>MCP_TRANSPORT=stdio</code>.</p>
      </div></div>

      <div class="card"><h2>OSC Reference</h2><div class="body">
        <table>
          <thead><tr><th>Control</th><th>Range</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>DMX channel</td><td class="mono">0&ndash;255</td><td>Path <code>/&lt;univ-1&gt;/dmx/&lt;chan-1&gt;</code>, e.g. U1 ch1 &rarr; <code>/0/dmx/0</code></td></tr>
            <tr><td>Slider / master</td><td class="mono">0&ndash;1</td><td>Normalized float</td></tr>
            <tr><td>Speed dial</td><td class="mono">10&ndash;240 BPM</td><td>Sent normalized 0&ndash;1</td></tr>
            <tr><td>Button / toggle</td><td class="mono">1</td><td>Value 1 to the mapped widget path</td></tr>
          </tbody>
        </table>
        <p class="small muted" style="margin-bottom:0">UDP OSC has no ACK &mdash; a successful send only means the local socket accepted it. Recent feedback in <code>qlc_get_state</code> is the real proof QLC+ responded.</p>
      </div></div>
    </div>
  </section>
</main>

<script>
(function(){
  "use strict";
  var $ = function(s){ return document.querySelector(s); };
  var META = null;
  var TOKEN = localStorage.getItem("qlc_token") || "";
  var autoTimer = null, healthTimer = null;

  function h(tag, props, kids){
    var e = document.createElement(tag);
    if(props) for(var k in props){
      if(k==="class") e.className = props[k];
      else if(k==="text") e.textContent = props[k];
      else if(k==="html") e.innerHTML = props[k];
      else if(k.slice(0,2)==="on" && typeof props[k]==="function") e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if(props[k]!=null) e.setAttribute(k, props[k]);
    }
    if(kids!=null){ (Array.isArray(kids)?kids:[kids]).forEach(function(c){
      if(c==null) return; e.appendChild(typeof c==="string"?document.createTextNode(c):c);
    }); }
    return e;
  }
  function headers(){
    var hd = {"Content-Type":"application/json"};
    if(TOKEN) hd["Authorization"] = "Bearer " + TOKEN;
    return hd;
  }
  function fmt(o){ try{ return JSON.stringify(o,null,2); }catch(e){ return String(o); } }

  // ---- MCP activity log ----
  var logEl = $("#log");
  function pushLog(name, req, body, ms){
    if(logEl.querySelector(".muted")) logEl.innerHTML = "";
    var err = !!(body && body.isError);
    var txt = body && body.content && body.content[0] ? body.content[0].text : fmt(body);
    var entry = h("div",{class:"le " + (err?"err":"ok")},[
      h("div",{class:"h"},[
        h("span",{class:"nm mono",text:name}),
        h("span",{class:"badge "+(err?"err":"live"),text:err?"error":"ok"}),
        h("span",{class:"t",text:(ms!=null?ms+"ms":"")})
      ]),
      h("pre",{text:"→ " + fmt(req) + "\\n← " + txt})
    ]);
    logEl.insertBefore(entry, logEl.firstChild);
    while(logEl.children.length>200) logEl.removeChild(logEl.lastChild);
  }

  // ---- core tool call via proxy ----
  function call(name, input){
    var t0 = Date.now();
    return fetch("/dashboard/api/call",{method:"POST",headers:headers(),body:JSON.stringify({name:name,input:input||{}})})
      .then(function(r){
        if(r.status===401||r.status===403){ showAuth("Token required or invalid."); }
        return r.json().catch(function(){ return {isError:true,content:[{type:"text",text:"HTTP "+r.status}]}; });
      })
      .then(function(body){ pushLog(name, input||{}, body, Date.now()-t0); return body; })
      .catch(function(e){ var b={isError:true,content:[{type:"text",text:String(e)}]}; pushLog(name,input||{},b,Date.now()-t0); return b; });
  }
  function textOf(body){ return body && body.content && body.content[0] ? body.content[0].text : ""; }
  function jsonFrom(body){
    var t = textOf(body); var i = t.indexOf("{");
    if(i<0){ var a=t.indexOf("["); if(a>=0){ try{return JSON.parse(t.slice(a));}catch(e){} } return null; }
    try{ return JSON.parse(t.slice(i)); }catch(e){ return null; }
  }

  // ---- auth bar ----
  function showAuth(msg){ $("#authbar").classList.add("show"); if(msg) $("#auth-msg").textContent = msg; }
  $("#token-save").addEventListener("click", function(){
    TOKEN = $("#token").value.trim(); localStorage.setItem("qlc_token", TOKEN);
    $("#auth-msg").textContent = "Saved. Reloading data..."; boot();
  });

  // ---- health ----
  function pollHealth(){
    fetch("/health").then(function(r){ return r.ok?r.json():null; }).then(function(j){
      var dot = $("#health-dot");
      if(j && j.status==="ok"){ dot.className="dot ok"; renderBadges(j); }
      else { dot.className="dot bad"; }
    }).catch(function(){ $("#health-dot").className="dot bad"; });
  }
  function renderBadges(health){
    var b = $("#badges"); b.innerHTML="";
    var c = META ? META.config : {};
    function add(cls,t){ b.appendChild(h("span",{class:"badge "+(cls||""),text:t})); }
    if(health) add("live","health: ok");
    if(health && health.version) add("","v"+health.version);
    if(health && health.uptime!=null) add("","up "+Math.round(health.uptime)+"s");
    if(c.transport) add("", c.transport+" :"+c.httpPort+c.httpMcpPath);
    if(c.qlcHost) add("", "QLC "+c.qlcHost+":"+c.qlcOscInputPort);
    if(c.authMode) add(c.authMode==="bearer"?"warn":"", "auth "+c.authMode);
    if(c.qlcDryRun) add("warn","DRY RUN");
    add(c.qlcAllowRawOsc?"live":"", "raw OSC "+(c.qlcAllowRawOsc?"on":"off"));
  }

  // ---- state ----
  function refreshState(){
    return call("qlc_get_state",{freshnessSeconds:10}).then(function(body){
      $("#state-summary").textContent = textOf(body).split("\\n")[0] || "(no summary)";
      var s = jsonFrom(body); if(!s) return;
      var kv = $("#state-kv"); kv.innerHTML="";
      var rows = [
        ["initialized", String(s.initialized)],
        ["command target", (s.commandSendHost||"?")+":"+(s.commandSendPort||"?")],
        ["dry run", String(s.dryRun)],
        ["sends", String(s.sendCount)],
        ["last sent", (s.lastSentPath||"-")+(s.lastSentAt?"  ("+s.lastSentAt+")":"")],
        ["feedback listening", String(s.feedbackListening)+(s.feedbackListenPort?" :"+s.feedbackListenPort:"")],
        ["feedback recent", String(s.feedbackSeenRecently)],
        ["feedback count", String(s.feedbackCount)],
        ["last feedback", (s.lastFeedbackPath||"-")+(s.lastFeedbackAt?"  ("+s.lastFeedbackAt+")":"")]
      ];
      if(s.lastSendError) rows.push(["last send error", s.lastSendError]);
      if(s.lastFeedbackError) rows.push(["feedback error", s.lastFeedbackError]);
      rows.forEach(function(r){ kv.appendChild(h("div",{text:r[0]})); kv.appendChild(h("div",{class:"mono",text:r[1]})); });
      var feed = $("#feed"); feed.innerHTML="";
      var rf = (s.recentFeedback||[]).slice().reverse();
      if(!rf.length){ feed.appendChild(h("div",{class:"muted small",text:"No feedback yet."})); }
      rf.forEach(function(f){ feed.appendChild(h("div",{class:"f",text:(f.at||"")+"  "+(f.path||"?")+"  "+fmt(f.args||[])})); });
    });
  }

  // ---- widgets ----
  function rawAllowed(){ return META && META.config && META.config.qlcAllowRawOsc; }
  function reloadWidgets(){
    var input = {limit:200};
    var q = $("#w-query").value.trim(); if(q) input.query=q;
    var t = $("#w-type").value; if(t) input.type=t;
    var box = $("#widgets"); box.innerHTML='<div class="muted small">Loading...</div>';
    call("qlc_list_widgets", input).then(function(body){
      var data = jsonFrom(body); box.innerHTML="";
      if(!data || !data.widgets || !data.widgets.length){ box.appendChild(h("div",{class:"muted small",text:"No widgets matched."})); return; }
      data.widgets.forEach(function(w){ box.appendChild(widgetCard(w)); });
    });
  }
  function widgetCard(w){
    var ctrl;
    var sliderish = (w.type==="slider"||w.type==="speed");
    if(sliderish){
      var range = h("input",{type:"range",min:"0",max:"1",step:"0.01",value:"0"});
      var val = h("span",{class:"mono small muted",text:"0.00"});
      range.addEventListener("input", function(){ val.textContent = Number(range.value).toFixed(2); });
      range.addEventListener("change", function(){
        if(!rawAllowed()) return;
        call("qlc_send_osc",{path:w.path,args:[Number(range.value)]});
      });
      range.disabled = !rawAllowed();
      ctrl = h("div",{class:"row"},[range, val]);
      if(!rawAllowed()) ctrl.appendChild(h("span",{class:"small",text:"(raw OSC off)",style:"color:var(--warn)"}));
    } else {
      var btn = h("button",{class:"btn accent sm",text:"Trigger"});
      btn.addEventListener("click", function(){ call("qlc_button_press",{widgetName:w.name}); });
      if(w.type==="frame"||w.type==="label"){ btn.disabled=true; btn.textContent="(display)"; }
      ctrl = btn;
    }
    return h("div",{class:"wcard"},[
      h("span",{class:"tp",text:w.type||"unknown"}),
      h("div",{class:"nm",text:w.name||w.id}),
      h("div",{class:"pa",text:w.path}),
      w.description?h("div",{class:"small muted",text:w.description}):null,
      ctrl
    ]);
  }

  // ---- raw osc console ----
  function parseArgs(raw){
    raw = (raw||"").trim(); if(!raw) return [];
    try{ var v = JSON.parse("["+raw+"]"); return v; }catch(e){}
    return raw.split(",").map(function(s){ s=s.trim(); var n=Number(s); return s!=="" && !isNaN(n)?n:s.replace(/^["']|["']$/g,""); });
  }
  $("#osc-send").addEventListener("click", function(){
    var path = $("#osc-path").value.trim(); if(!path){ $("#osc-path").focus(); return; }
    call("qlc_send_osc",{path:path,args:parseArgs($("#osc-args").value),dryRun:$("#osc-dry").checked});
  });

  // ---- docs ----
  var TOOL_DOCS = {
    qlc_get_state:{ params:["freshnessSeconds?: int 1-300"], ex:"how recent QLC+ feedback must be to count as live" },
    qlc_list_widgets:{ params:["type?: enum","query?: string","limit?: int 1-200"], ex:"discover mapped widgets before controlling them" },
    qlc_button_press:{ params:["widgetName?: string","oscPath?: string"], ex:"sends value 1 to a mapped button widget" },
    qlc_send_osc:{ params:["path: string","args: (num|str|bool)[]","dryRun?: bool"], ex:"low-level OSC; disabled unless QLC_ALLOW_RAW_OSC=true" }
  };
  function renderDocs(){
    var cat = $("#tool-catalog"); cat.innerHTML="";
    var grid = h("div",{style:"display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"});
    (META?META.tools:[]).forEach(function(t){
      var d = TOOL_DOCS[t.name] || {params:[],ex:""};
      var pills = d.params.map(function(p){ return h("span",{class:"pill",text:p}); });
      grid.appendChild(h("div",{class:"tool"},[
        h("h3",{text:t.name}),
        h("div",{class:"small muted",text:t.description||d.ex||""}),
        h("div",{style:"margin-top:6px"}, pills.length?pills:[h("span",{class:"small muted",text:"no parameters"})])
      ]));
    });
    cat.appendChild(grid);

    var c = META?META.config:{};
    var tb = $("#cfg-table").querySelector("tbody"); tb.innerHTML="";
    Object.keys(c).forEach(function(k){
      tb.appendChild(h("tr",{},[h("td",{class:"mono",text:k}),h("td",{class:"mono",text:String(c[k])})]));
    });

    var host = (c.httpHost==="0.0.0.0"||c.httpHost==="::"||!c.httpHost)?"127.0.0.1":c.httpHost;
    var cfg = { mcpServers:{ qlcplus:{ type:"streamable-http",
      url:"http://"+host+":"+(c.httpPort||8788)+(c.httpMcpPath||"/mcp"),
      headers: c.authMode==="bearer"?{Authorization:"Bearer <MCP_AUTH_TOKEN>"}:{} } } };
    $("#client-cfg").textContent = fmt(cfg);

    fetch("/dashboard/api/patch-chart",{headers:headers()})
      .then(function(r){ return r.ok?r.text():null; })
      .then(function(t){ if(t!=null) $("#patch-chart").textContent = t; })
      .catch(function(){});
  }

  // ---- tabs ----
  document.querySelectorAll(".tab").forEach(function(t){
    t.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(function(x){ x.classList.remove("active"); });
      t.classList.add("active");
      var name = t.getAttribute("data-tab");
      $("#control").classList.toggle("hidden", name!=="control");
      $("#docs").classList.toggle("hidden", name!=="docs");
    });
  });
  $("#refresh-state").addEventListener("click", refreshState);
  $("#reload-widgets").addEventListener("click", reloadWidgets);
  $("#w-query").addEventListener("keydown", function(e){ if(e.key==="Enter") reloadWidgets(); });
  $("#w-type").addEventListener("change", reloadWidgets);
  $("#log-clear").addEventListener("click", function(){ logEl.innerHTML='<div class="muted small">Tool calls appear here.</div>'; });
  $("#auto").addEventListener("change", function(){
    if(this.checked){ autoTimer=setInterval(refreshState,4000); refreshState(); }
    else { clearInterval(autoTimer); autoTimer=null; }
  });

  // ---- boot ----
  function applyMeta(){
    renderBadges(null);
    renderDocs();
    var off = !rawAllowed();
    $("#osc-note").classList.toggle("hidden", !off);
    $("#osc-send").disabled = off; $("#osc-path").disabled = off; $("#osc-args").disabled = off;
  }
  function boot(){
    fetch("/dashboard/api/meta",{headers:headers()}).then(function(r){
      if(r.status===401||r.status===403){ showAuth("Enter the bearer token to load data."); return null; }
      return r.json();
    }).then(function(m){
      if(!m) return;
      META = m; $("#authbar").classList.remove("show");
      if(m.config && m.config.authMode==="bearer" && TOKEN) $("#token").value = TOKEN;
      applyMeta(); refreshState(); reloadWidgets();
    }).catch(function(e){ showAuth("Could not reach server: "+e); });
  }

  if(TOKEN) $("#token").value = TOKEN;
  pollHealth(); healthTimer=setInterval(pollHealth,5000);
  boot();
})();
</script>
</body>
</html>`;
