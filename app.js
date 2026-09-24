/* Tres idiomas — app personal de Yudy
   Todo el texto que llega de un servidor se inserta con textContent.
   Nunca se usa innerHTML con contenido externo. */
(function(){
  "use strict";

  /* ============ idiomas ============ */
  var LANGS = [
    { code:"en", label:"Inglés",     short:"EN", accent:"#8C1D3F", tts:["en-US","en-GB","en"],      asr:"en-US" },
    { code:"no", label:"Noruego",    short:"NO", accent:"#14524A", tts:["nb-NO","no-NO","nb","no"], asr:"nb-NO" },
    { code:"nl", label:"Neerlandés", short:"NL", accent:"#9A5B08", tts:["nl-NL","nl-BE","nl"],      asr:"nl-NL" }
  ];
  var ES_TTS = ["es-CO","es-419","es-MX","es-US","es-ES","es"];
  function lang(code){
    for(var i=0;i<LANGS.length;i++){ if(LANGS[i].code===code) return LANGS[i]; }
    return LANGS[0];
  }

  /* ============ servidores ============ */
  var LINGVA = [
    "https://lingva.ml",
    "https://translate.plausibility.cloud",
    "https://lingva.lunar.icu",
    "https://translate.projectsegfau.lt",
    "https://lingva.garudalinux.org",
    "https://translate.dr460nf1r3.org"
  ];

  /* ============ estado ============ */
  var KEY = "tres-idiomas";
  var state = {
    mode:"traducir", current:null, history:[],
    convLang:"en", pracLang:"en", rate:0.85, server:null
  };

  function load(){
    try{
      var raw = localStorage.getItem(KEY);
      if(!raw) return;
      var d = JSON.parse(raw);
      if(d && Array.isArray(d.history)) state.history = d.history;
      if(d && typeof d.rate === "number") state.rate = d.rate;
      if(d && d.convLang) state.convLang = d.convLang;
      if(d && d.pracLang) state.pracLang = d.pracLang;
      if(d && typeof d.server === "string" && LINGVA.indexOf(d.server) !== -1) state.server = d.server;
    }catch(e){}
  }
  function save(){
    try{
      localStorage.setItem(KEY, JSON.stringify({
        history: state.history.slice(0,300),
        rate: state.rate, convLang: state.convLang,
        pracLang: state.pracLang, server: state.server
      }));
    }catch(e){}
  }
  function servers(){
    var list = LINGVA.slice();
    if(state.server){
      list = list.filter(function(s){ return s !== state.server; });
      list.unshift(state.server);
    }
    return list;
  }

  var $ = function(id){ return document.getElementById(id); };

  /* ============ iconos (contenido propio, nunca externo) ============ */
  var NS = "http://www.w3.org/2000/svg";
  var MIC_D = ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z","M19 10v2a7 7 0 0 1-14 0v-2","M12 19v3"];
  var SPK_D = ["M11 5 6 9H2v6h4l5 4V5z","M15.5 8.5a5 5 0 0 1 0 7"];
  function icon(paths){
    var s = document.createElementNS(NS,"svg");
    s.setAttribute("viewBox","0 0 24 24");
    s.setAttribute("fill","none");
    s.setAttribute("stroke","currentColor");
    s.setAttribute("stroke-width","1.8");
    s.setAttribute("stroke-linecap","round");
    s.setAttribute("stroke-linejoin","round");
    s.setAttribute("aria-hidden","true");
    for(var i=0;i<paths.length;i++){
      var p = document.createElementNS(NS,"path");
      p.setAttribute("d", paths[i]);
      s.appendChild(p);
    }
    return s;
  }

  /* ============ texto ============ */
  function tidy(t){
    var s = String(t == null ? "" : t);
    s = s.replace(/[\r\n\t\u000b\u000c\u0085\u00a0]+/g," ");
    s = s.replace(/\s+/g," ").trim();
    s = s.replace(/^[\s"'\u00ab\u00bb\u201c\u201d\u201e\u2018\u2019]+/,"");
    s = s.replace(/[\s"'\u00ab\u00bb\u201c\u201d\u201e\u2018\u2019]+$/,"");
    return s.trim();
  }
  function bare(s){
    return tidy(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9ñ ]/g," ").replace(/\s+/g," ").trim();
  }
  function words(s){ var n = bare(s); return n ? n.split(" ") : []; }

  /* ============ red ============ */
  function getJSON(url, ms){
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, ms || 9000);
    var opts = ctrl ? { signal: ctrl.signal, cache:"no-store" } : { cache:"no-store" };
    return fetch(url, opts).then(function(r){
      clearTimeout(timer);
      if(!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).catch(function(e){ clearTimeout(timer); throw e; });
  }

  /* --- Lingva --- */
  function lingvaOnce(base, text, from, to){
    var url = base + "/api/v1/" + from + "/" + to + "/" + encodeURIComponent(text);
    return getJSON(url, 9000).then(function(d){
      if(!d || d.error) throw new Error("respuesta inválida");
      var t = tidy(d.translation);
      if(!t) throw new Error("vacío");
      return t;
    });
  }
  function lingva(text, from, to){
    var list = servers();
    var i = 0;
    function attempt(){
      if(i >= list.length) return Promise.reject(new Error("ningún servidor respondió"));
      var base = list[i++];
      return lingvaOnce(base, text, from, to).then(function(t){
        if(state.server !== base){ state.server = base; save(); }
        return t;
      }, attempt);
    }
    return attempt();
  }

  /* --- MyMemory (respaldo) --- */
  function unescapeEntities(s){
    // decodificación controlada, sin innerHTML
    return String(s)
      .replace(/&#x0*d;/gi," ").replace(/&#0*13;/g," ")
      .replace(/&#x0*a;/gi," ").replace(/&#0*10;/g," ")
      .replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
      .replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
      .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&")
      .replace(/&#x?[0-9a-f]+;/gi," ");
  }
  function pickBest(data, original){
    var src = bare(original);
    var list = (data && Array.isArray(data.matches)) ? data.matches : [];
    var best = null;
    for(var i=0;i<list.length;i++){
      var m = list[i];
      var txt = tidy(unescapeEntities(m && m.translation));
      if(!txt) continue;
      var nb = bare(txt);
      if(!nb || nb === src) continue;          // registro que devuelve lo mismo que escribiste
      var mt = /^mt!?$/i.test(String(m["created-by"] || ""));
      var match = parseFloat(m.match);   if(isNaN(match)) match = 0;
      var qual  = parseFloat(m.quality); if(isNaN(qual))  qual  = 50;
      var use   = parseFloat(m["usage-count"]); if(isNaN(use)) use = 0;
      var score = (match*100) + (qual*0.5) + Math.min(use,50)*0.2 + (mt ? 8 : 0);
      if(!best || score > best.score) best = { text:txt, score:score };
    }
    if(best) return best.text;
    var fb = tidy(unescapeEntities(data && data.responseData && data.responseData.translatedText));
    if(fb && bare(fb) !== src) return fb;
    return "";
  }
  function myMemory(text, from, to){
    var url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) +
              "&langpair=" + encodeURIComponent(from + "|" + to) + "&mt=1";
    return getJSON(url, 9000).then(function(d){
      if(d && d.quotaFinished) throw new Error("cuota agotada");
      var best = pickBest(d, text);
      if(!best) throw new Error("sin traducción confiable");
      return best;
    });
  }

  var usedBackup = false;
  function translate(text, from, to){
    return lingva(text, from, to).catch(function(){
      usedBackup = true;
      return myMemory(text, from, to);
    });
  }

  /* ============ voz ============ */
  var voices = [];
  function refreshVoices(){
    try{ voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    catch(e){ voices = []; }
  }
  if(window.speechSynthesis){
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", function(){
      refreshVoices(); renderEngineNote();
    });
  }
  function voiceRank(v){
    var n = (v.name || "").toLowerCase();
    var s = 0;
    if(/natural|neural|premium|enhanced|siri/.test(n)) s += 6;
    if(/google/.test(n)) s += 4;
    if(/microsoft/.test(n)) s += 2;
    if(v.localService) s += 1;
    return s;
  }
  function pickVoice(tags){
    if(!voices.length) return null;
    for(var i=0;i<tags.length;i++){
      var tag = tags[i].toLowerCase();
      var root = tag.split("-")[0];
      var pool = voices.filter(function(v){
        var l = (v.lang || "").toLowerCase().replace("_","-");
        return l === tag || l.indexOf(tag + "-") === 0 || l.split("-")[0] === root;
      });
      if(pool.length){
        pool.sort(function(a,b){ return voiceRank(b) - voiceRank(a); });
        return pool[0];
      }
    }
    return null;
  }

  var audioCache = {};
  var audioKeys = [];
  var playing = null;

  function remoteAudio(code, text){
    var key = code + "|" + text;
    if(audioCache[key]) return Promise.resolve(audioCache[key]);
    var list = servers();
    var i = 0;
    function attempt(){
      if(i >= list.length) return Promise.reject(new Error("sin audio"));
      var base = list[i++];
      var url = base + "/api/v1/audio/" + code + "/" + encodeURIComponent(text);
      return getJSON(url, 12000).then(function(d){
        if(!d || !Array.isArray(d.audio) || !d.audio.length) throw new Error("audio vacío");
        var bytes = new Uint8Array(d.audio.length);
        for(var k=0;k<d.audio.length;k++) bytes[k] = d.audio[k] & 255;
        var blobUrl = URL.createObjectURL(new Blob([bytes], { type:"audio/mpeg" }));
        audioCache[key] = blobUrl;
        audioKeys.push(key);
        while(audioKeys.length > 40){
          var old = audioKeys.shift();
          try{ URL.revokeObjectURL(audioCache[old]); }catch(e){}
          delete audioCache[old];
        }
        return blobUrl;
      }, attempt);
    }
    return attempt();
  }

  function stopAudio(){
    try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){}
    if(playing){ try{ playing.pause(); }catch(e){} playing = null; }
  }

  function say(text, tags, code){
    text = tidy(text);
    if(!text) return Promise.resolve();
    stopAudio();
    var v = pickVoice(tags);
    if(v && window.speechSynthesis){
      return new Promise(function(resolve){
        var u = new SpeechSynthesisUtterance(text);
        u.voice = v; u.lang = v.lang; u.rate = state.rate; u.pitch = 1;
        u.onend = function(){ resolve(); };
        u.onerror = function(){ resolve(); };
        window.speechSynthesis.speak(u);
      });
    }
    if(!code) return Promise.resolve();
    return remoteAudio(code, text).then(function(url){
      return new Promise(function(resolve){
        var a = new Audio(url);
        a.playbackRate = Math.max(0.6, Math.min(1.2, state.rate + 0.1));
        playing = a;
        a.onended = function(){ playing = null; resolve(); };
        a.onerror = function(){ playing = null; resolve(); };
        var p = a.play();
        if(p && p.catch) p.catch(function(){ playing = null; resolve(); });
      });
    }).catch(function(){ /* sin audio disponible */ });
  }
  function sayLang(text, L){ return say(text, L.tts, L.code); }
  function sayEs(text){ return say(text, ES_TTS, "es"); }

  function sayChain(items, i){
    i = i || 0;
    if(i >= items.length) return Promise.resolve();
    return sayLang(items[i].text, items[i].L).then(function(){
      return new Promise(function(r){ setTimeout(r, 550); });
    }).then(function(){ return sayChain(items, i+1); });
  }

  function renderEngineNote(){
    var el = $("engineNote");
    var msgs = [];
    if(!window.speechSynthesis && !("Audio" in window)){
      msgs.push("Este navegador no puede reproducir voz. Usa Chrome o Safari.");
    }
    if(usedBackup){
      msgs.push("Los servidores principales no respondieron; se usó el traductor de respaldo, que es menos preciso.");
    }
    if(msgs.length){
      el.textContent = msgs.join(" ");
      el.className = "note show";
    } else {
      el.textContent = "";
      el.className = "note";
    }
  }

  /* ============ micrófono ============ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var activeRec = null;

  function listen(tag, onPartial){
    return new Promise(function(resolve, reject){
      if(!SR){ reject(new Error("Este navegador no reconoce voz. Usa Chrome, Edge o Safari.")); return; }
      if(activeRec){ try{ activeRec.stop(); }catch(e){} activeRec = null; }
      var rec = new SR();
      rec.lang = tag;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      var finalText = "", settled = false;

      rec.onresult = function(ev){
        var interim = "";
        for(var i=ev.resultIndex;i<ev.results.length;i++){
          var r = ev.results[i];
          if(r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if(onPartial) onPartial(finalText || interim);
      };
      rec.onerror = function(ev){
        if(settled) return;
        settled = true; activeRec = null;
        var msg;
        switch(ev.error){
          case "not-allowed":
          case "service-not-allowed":
            msg = "El navegador no dio permiso al micrófono. Toca el candado de la barra de direcciones y permítelo."; break;
          case "no-speech":      msg = "No se escuchó nada. Intenta otra vez, más cerca."; break;
          case "audio-capture":  msg = "No se encontró micrófono en este equipo."; break;
          case "network":        msg = "El reconocimiento de voz necesita internet."; break;
          case "language-not-supported": msg = "Este navegador no reconoce ese idioma por voz."; break;
          case "aborted":        msg = ""; break;
          default:               msg = "El micrófono falló. Intenta otra vez.";
        }
        reject(new Error(msg));
      };
      rec.onend = function(){
        activeRec = null;
        if(settled) return;
        settled = true;
        var t = finalText.trim();
        if(t) resolve(t);
        else reject(new Error("No se escuchó nada. Intenta otra vez, más cerca."));
      };
      activeRec = rec;
      try{ rec.start(); }
      catch(e){ activeRec = null; settled = true; reject(new Error("No se pudo abrir el micrófono. Intenta otra vez.")); }
    });
  }
  function stopListening(){ if(activeRec){ try{ activeRec.stop(); }catch(e){} } }

  /* ============ tarjetas ============ */
  function renderCards(){
    var box = $("cards");
    box.textContent = "";
    LANGS.forEach(function(L){
      var res = state.current ? state.current[L.code] : null;

      var card = document.createElement("div");
      card.className = "lang";
      card.style.setProperty("--accent", L.accent);

      var body = document.createElement("div");
      body.className = "body";

      var name = document.createElement("div");
      name.className = "name";
      name.textContent = L.label;

      var text = document.createElement("div");
      if(res && res.text){ text.className = "text"; text.textContent = res.text; }
      else if(res && res.error){ text.className = "text placeholder"; text.textContent = res.error; }
      else if(res && res.loading){ text.className = "text placeholder"; text.textContent = "Traduciendo…"; }
      else { text.className = "text placeholder"; text.textContent = "—"; }

      body.appendChild(name);
      body.appendChild(text);

      var btn = document.createElement("button");
      btn.className = "play";
      btn.setAttribute("aria-label", "Escuchar en " + L.label.toLowerCase());
      btn.appendChild(icon(SPK_D));
      btn.disabled = !(res && res.text);
      btn.addEventListener("click", function(){
        btn.setAttribute("data-busy","true");
        sayLang(res.text, L).then(function(){ btn.removeAttribute("data-busy"); });
      });

      card.appendChild(body);
      card.appendChild(btn);
      box.appendChild(card);
    });
  }

  /* ============ historial ============ */
  function fmtWhen(ts){
    var d = new Date(ts), hoy = new Date();
    var hh = ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
    if(d.toDateString() === hoy.toDateString()) return "Hoy " + hh;
    return d.getDate() + "/" + (d.getMonth()+1) + "/" + d.getFullYear() + " " + hh;
  }

  function renderHistory(){
    var box = $("hist");
    box.textContent = "";
    if(!state.history.length){
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Todavía no has guardado frases. Las que traduzcas quedan aquí, en este dispositivo.";
      box.appendChild(e);
      return;
    }
    state.history.forEach(function(item){
      var el = document.createElement("div");
      el.className = "item";

      var es = document.createElement("div");
      es.className = "es";
      es.textContent = item.es;
      el.appendChild(es);

      LANGS.forEach(function(L){
        var val = item[L.code];
        if(!val) return;
        var row = document.createElement("div");
        row.className = "row";

        var tag = document.createElement("span");
        tag.className = "tag";
        tag.style.color = L.accent;
        tag.textContent = L.short;

        var tr = document.createElement("span");
        tr.className = "tr";
        tr.textContent = val;

        var b = document.createElement("button");
        b.className = "mini";
        b.style.color = L.accent;
        b.setAttribute("aria-label", "Escuchar en " + L.label.toLowerCase());
        b.appendChild(icon(SPK_D));
        b.addEventListener("click", function(){ sayLang(val, L); });

        row.appendChild(tag); row.appendChild(tr); row.appendChild(b);
        el.appendChild(row);
      });

      var foot = document.createElement("div");
      foot.className = "foot";

      var when = document.createElement("span");
      when.className = "when";
      when.textContent = fmtWhen(item.ts);

      var actions = document.createElement("span");

      var again = document.createElement("button");
      again.className = "linkish";
      again.textContent = "Oír las tres";
      again.addEventListener("click", function(){
        var chain = [];
        LANGS.forEach(function(L){ if(item[L.code]) chain.push({ text:item[L.code], L:L }); });
        sayChain(chain, 0);
      });

      var use = document.createElement("button");
      use.className = "linkish";
      use.textContent = "Usar";
      use.addEventListener("click", function(){
        state.current = { es: item.es };
        LANGS.forEach(function(L){ state.current[L.code] = { text: item[L.code] || null }; });
        $("saidEs").textContent = item.es;
        renderCards();
        renderPractice();
        window.scrollTo({ top:0, behavior:"smooth" });
      });

      var del = document.createElement("button");
      del.className = "linkish";
      del.textContent = "Borrar";
      del.addEventListener("click", function(){
        state.history = state.history.filter(function(x){ return x.id !== item.id; });
        save(); renderHistory();
      });

      actions.appendChild(again); actions.appendChild(use); actions.appendChild(del);
      foot.appendChild(when); foot.appendChild(actions);
      el.appendChild(foot);
      box.appendChild(el);
    });
  }

  function pushHistory(es){
    var item = { id: String(Date.now()) + Math.random().toString(36).slice(2,6), ts: Date.now(), es: es };
    var any = false;
    LANGS.forEach(function(L){
      var r = state.current && state.current[L.code];
      if(r && r.text){ item[L.code] = r.text; any = true; }
    });
    if(!any) return;
    state.history.unshift(item);
    if(state.history.length > 300) state.history.length = 300;
    save(); renderHistory();
  }

  /* ============ traducir ============ */
  var busy = false;

  function doTranslate(text){
    text = tidy(text);
    if(!text || busy) return;
    if(text.length > 450){
      $("hintEs").textContent = "La frase es muy larga. Divídela en dos.";
      return;
    }
    busy = true;
    usedBackup = false;
    $("saidEs").textContent = text;
    $("hintEs").textContent = "Traduciendo…";
    state.current = { es: text };
    LANGS.forEach(function(L){ state.current[L.code] = { loading:true }; });
    renderCards();

    var jobs = LANGS.map(function(L){
      return translate(text, "es", L.code).then(function(t){
        state.current[L.code] = { text: t };
      }, function(){
        state.current[L.code] = { error: "No se pudo traducir a " + L.label.toLowerCase() + "." };
      }).then(function(){ renderCards(); });
    });

    Promise.all(jobs).then(function(){
      renderPractice();
      renderEngineNote();
      pushHistory(text);
      var chain = [];
      LANGS.forEach(function(L){
        var r = state.current[L.code];
        if(r && r.text) chain.push({ text:r.text, L:L });
      });
      $("hintEs").textContent = chain.length ? "Toca y habla en español" : "No se pudo traducir. Revisa tu internet.";
      busy = false;
      return sayChain(chain, 0);
    });
  }

  $("goEs").addEventListener("click", function(){
    var v = $("inEs").value;
    $("inEs").value = "";
    doTranslate(v);
  });
  $("inEs").addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); $("goEs").click(); }
  });

  var micEs = $("micEs");
  micEs.appendChild(icon(MIC_D));
  micEs.addEventListener("click", function(){
    if(micEs.getAttribute("data-listening") === "true"){ stopListening(); return; }
    stopAudio();
    micEs.setAttribute("data-listening","true");
    $("hintEs").textContent = "Escuchando… toca otra vez para parar";
    $("saidEs").textContent = "";
    listen("es-CO", function(p){ $("saidEs").textContent = p; })
      .then(function(text){
        micEs.setAttribute("data-listening","false");
        doTranslate(text);
      }, function(err){
        micEs.setAttribute("data-listening","false");
        $("hintEs").textContent = err.message || "Toca y habla en español";
      });
  });

  /* ============ conversar ============ */
  function renderChips(container, selected, onPick){
    container.textContent = "";
    LANGS.forEach(function(L){
      var b = document.createElement("button");
      b.className = "chip";
      b.textContent = L.label;
      b.setAttribute("aria-pressed", String(L.code === selected));
      b.addEventListener("click", function(){ onPick(L.code); });
      container.appendChild(b);
    });
  }
  function renderConv(){
    renderChips($("convChips"), state.convLang, function(code){
      state.convLang = code; save(); renderConv();
    });
    $("hintConv").textContent = "Toca cuando la otra persona vaya a hablar en " + lang(state.convLang).label.toLowerCase();
  }

  var convPlay = $("convPlay");
  convPlay.appendChild(icon(SPK_D));
  var micConv = $("micConv");
  micConv.appendChild(icon(MIC_D));
  micConv.addEventListener("click", function(){
    var L = lang(state.convLang);
    if(micConv.getAttribute("data-listening") === "true"){ stopListening(); return; }
    stopAudio();
    micConv.setAttribute("data-listening","true");
    $("hintConv").textContent = "Escuchando en " + L.label.toLowerCase() + "…";
    $("convHeard").textContent = "";
    var out = $("convEs");
    listen(L.asr, function(p){ $("convHeard").textContent = p; })
      .then(function(text){
        micConv.setAttribute("data-listening","false");
        $("convHeard").textContent = text;
        $("hintConv").textContent = "Traduciendo…";
        out.className = "text placeholder";
        out.textContent = "…";
        return translate(text, L.code, "es").then(function(es){
          out.className = "text";
          out.textContent = es;
          convPlay.disabled = false;
          convPlay.onclick = function(){ sayEs(es); };
          renderConv();
          return sayEs(es);
        });
      })
      .catch(function(err){
        micConv.setAttribute("data-listening","false");
        out.className = "text placeholder";
        out.textContent = err.message || "No se pudo traducir.";
        renderConv();
      });
  });

  /* ============ practicar ============ */
  function alignScore(target, said){
    var a = words(target), b = words(said);
    if(!a.length) return { pct:0, marks:[], target:[] };
    var n = a.length, m = b.length, d = [], i, j;
    for(i=0;i<=n;i++){ d[i] = [i]; }
    for(j=0;j<=m;j++){ d[0][j] = j; }
    for(i=1;i<=n;i++){
      for(j=1;j<=m;j++){
        var cost = (a[i-1] === b[j-1]) ? 0 : 1;
        d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
      }
    }
    var marks = new Array(n).fill(false);
    i = n; j = m;
    while(i > 0 && j > 0){
      if(a[i-1] === b[j-1] && d[i][j] === d[i-1][j-1]){ marks[i-1] = true; i--; j--; }
      else if(d[i][j] === d[i-1][j-1] + 1){ i--; j--; }
      else if(d[i][j] === d[i-1][j] + 1){ i--; }
      else { j--; }
    }
    var hits = 0;
    for(i=0;i<marks.length;i++) if(marks[i]) hits++;
    return { pct: Math.round(hits*100/n), marks: marks, target: a };
  }

  function currentPhrase(){
    var L = lang(state.pracLang);
    var r = state.current && state.current[L.code];
    return (r && r.text) ? r.text : null;
  }

  function renderPractice(){
    renderChips($("pracChips"), state.pracLang, function(code){
      state.pracLang = code; save(); renderPractice();
      $("score").className = "score hidden";
    });
    var L = lang(state.pracLang);
    var phrase = currentPhrase();
    $("pracLead").textContent = phrase ? ("Dila en voz alta en " + L.label.toLowerCase()) : "Sin frase todavía";
    var t = $("pracText");
    t.textContent = phrase || "Traduce algo en Traducir, o toca «Usar» en una frase guardada.";
    t.style.color = phrase ? L.accent : "";
    $("pracListen").disabled = !phrase;
    $("hintPrac").textContent = phrase ? "Toca y dila" : "Primero elige una frase";
  }

  $("pracListen").addEventListener("click", function(){
    var p = currentPhrase();
    if(p) sayLang(p, lang(state.pracLang));
  });

  var micPrac = $("micPrac");
  micPrac.appendChild(icon(MIC_D));
  micPrac.addEventListener("click", function(){
    var L = lang(state.pracLang);
    var phrase = currentPhrase();
    if(!phrase){ $("hintPrac").textContent = "Primero elige una frase"; return; }
    if(micPrac.getAttribute("data-listening") === "true"){ stopListening(); return; }
    stopAudio();
    micPrac.setAttribute("data-listening","true");
    $("hintPrac").textContent = "Escuchando…";
    $("score").className = "score hidden";

    listen(L.asr, null).then(function(said){
      micPrac.setAttribute("data-listening","false");
      $("hintPrac").textContent = "Toca y dila otra vez";
      var r = alignScore(phrase, said);

      $("scorePct").textContent = r.pct + "%";
      $("scorePct").style.color = r.pct >= 80 ? "#14524A" : (r.pct >= 50 ? "#9A5B08" : "#8C1D3F");

      var verdict;
      if(r.pct === 100)      verdict = "Te entendió completa.";
      else if(r.pct >= 80)   verdict = "Te entendió casi toda. Repite las palabras marcadas.";
      else if(r.pct >= 50)   verdict = "Te entendió a medias. Ve más despacio.";
      else                   verdict = "No te entendió. Escúchala otra vez y repítela por partes.";
      $("scoreVerdict").textContent = verdict;

      var box = $("scoreHeard");
      box.textContent = "";
      var line = document.createElement("span");
      line.className = "said-line";
      line.textContent = "El teléfono oyó: " + said;
      box.appendChild(line);
      var lead = document.createElement("span");
      lead.textContent = "De tu frase reconoció: ";
      box.appendChild(lead);
      r.target.forEach(function(w, i){
        var sp = document.createElement("span");
        sp.className = r.marks[i] ? "w-ok" : "w-bad";
        sp.textContent = w;
        box.appendChild(sp);
        box.appendChild(document.createTextNode(" "));
      });
      $("score").className = "score";
    }, function(err){
      micPrac.setAttribute("data-listening","false");
      $("hintPrac").textContent = err.message || "Toca y dila";
    });
  });

  /* ============ modos ============ */
  function setMode(m){
    state.mode = m;
    ["traducir","conversar","practicar"].forEach(function(k){
      $("tab-"+k).setAttribute("aria-selected", String(k === m));
      $("view-"+k).className = (k === m) ? "" : "hidden";
    });
    stopAudio();
    stopListening();
    if(m === "conversar") renderConv();
    if(m === "practicar") renderPractice();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".modes button"), function(b){
    b.addEventListener("click", function(){ setMode(b.getAttribute("data-mode")); });
  });

  /* ============ ajustes ============ */
  $("rate").addEventListener("input", function(){
    state.rate = parseFloat(this.value);
    $("rateVal").textContent = state.rate.toFixed(2);
    save();
  });
  $("clearHist").addEventListener("click", function(){
    if(!state.history.length) return;
    if(window.confirm("¿Borrar todas tus frases guardadas? No se puede deshacer.")){
      state.history = []; save(); renderHistory();
    }
  });
  function netTag(){ $("netTag").textContent = navigator.onLine ? "" : "Sin internet"; }
  window.addEventListener("online", netTag);
  window.addEventListener("offline", netTag);

  /* ============ arranque ============ */
  load();
  $("rate").value = state.rate;
  $("rateVal").textContent = state.rate.toFixed(2);
  renderCards();
  renderHistory();
  renderConv();
  renderPractice();
  renderEngineNote();
  netTag();
  setMode("traducir");
  setTimeout(function(){ refreshVoices(); renderEngineNote(); }, 900);

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
