/* Tres idiomas — app de Yudy
   Motor: Gemini (clave de la usuaria, guardada solo en el dispositivo).
   Todo texto externo se inserta con textContent. Sin innerHTML. */
(function(){
  "use strict";

  var BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
  var TEXT_MODEL = "gemini-3.6-flash";
  var TTS_MODELS = ["gemini-3.8-flash-tts","gemini-3.1-flash-tts","gemini-3.1-flash-tts-preview","gemini-2.5-flash-preview-tts"];
  var ttsModelOk = null;

  var LANGS = [
    { code:"en", label:"Inglés",     short:"EN", accent:"#8C1D3F", say:"English",         tts:["en-US","en-GB","en"],      asr:"en-US" },
    { code:"no", label:"Noruego",    short:"NO", accent:"#14524A", say:"Norwegian Bokmål", tts:["nb-NO","no-NO","nb","no"], asr:"nb-NO" },
    { code:"nl", label:"Neerlandés", short:"NL", accent:"#9A5B08", say:"Dutch",           tts:["nl-NL","nl-BE","nl"],      asr:"nl-NL" }
  ];
  var ES_TTS = ["es-CO","es-419","es-MX","es-US","es-ES","es"];
  function lang(c){ for(var i=0;i<LANGS.length;i++) if(LANGS[i].code===c) return LANGS[i]; return LANGS[0]; }
  function indexOfLang(c){ for(var i=0;i<LANGS.length;i++) if(LANGS[i].code===c) return i; return 0; }

  var KEY = "tres-idiomas";
  var KKEY = "tres-idiomas-clave";
  var state = {
    mode:"traducir", current:null, history:[],
    convLang:"en", focus:"en", etapa:"oir", looping:false
  };
  var apiKey = "";

  function load(){
    try{
      apiKey = localStorage.getItem(KKEY) || "";
      var raw = localStorage.getItem(KEY);
      if(raw){
        var d = JSON.parse(raw);
        if(d && Array.isArray(d.history)) state.history = d.history;
        if(d && d.convLang) state.convLang = d.convLang;
      }
    }catch(e){}
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify({ history: state.history.slice(0,300), convLang: state.convLang })); }catch(e){}
  }

  var $ = function(id){ return document.getElementById(id); };

  /* ---------- iconos ---------- */
  var NS = "http://www.w3.org/2000/svg";
  var MIC_D = ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z","M19 10v2a7 7 0 0 1-14 0v-2","M12 19v3"];
  var SPK_D = ["M11 5 6 9H2v6h4l5 4V5z","M15.5 8.5a5 5 0 0 1 0 7"];
  function icon(paths){
    var s = document.createElementNS(NS,"svg");
    s.setAttribute("viewBox","0 0 24 24"); s.setAttribute("fill","none");
    s.setAttribute("stroke","currentColor"); s.setAttribute("stroke-width","1.8");
    s.setAttribute("stroke-linecap","round"); s.setAttribute("stroke-linejoin","round");
    s.setAttribute("aria-hidden","true");
    for(var i=0;i<paths.length;i++){
      var p = document.createElementNS(NS,"path"); p.setAttribute("d", paths[i]); s.appendChild(p);
    }
    return s;
  }

  /* ---------- texto ---------- */
  function tidy(t){
    var s = String(t == null ? "" : t);
    s = s.replace(/[\r\n\t\u000b\u000c\u0085\u00a0]+/g," ").replace(/\s+/g," ").trim();
    s = s.replace(/^[\s"'\u00ab\u00bb\u201c\u201d\u201e\u2018\u2019]+/,"");
    s = s.replace(/[\s"'\u00ab\u00bb\u201c\u201d\u201e\u2018\u2019]+$/,"");
    return s.trim();
  }
  function bare(s){
    return tidy(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9ñ ]/g," ").replace(/\s+/g," ").trim();
  }
  function words(s){ var n = bare(s); return n ? n.split(" ") : []; }

  /* ---------- llamadas a Gemini ---------- */
  function callModel(model, body){
    if(!apiKey) return Promise.reject(new Error("Falta tu clave. Tócala arriba, en «Mi clave»."));
    return fetch(BASE + model + ":generateContent", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body)
    }).then(function(r){
      return r.text().then(function(txt){ return { ok:r.ok, status:r.status, txt:txt }; });
    });
  }

  function withRetry(fn, veces){
    veces = veces || 3;
    var intento = 0;
    function go(){
      intento++;
      return fn().then(function(res){
        if(res.ok) return res;
        if((res.status === 503 || res.status === 429) && intento < veces){
          return new Promise(function(r){ setTimeout(r, 900*intento); }).then(go);
        }
        return res;
      });
    }
    return go();
  }

  function explainError(res){
    if(res.status === 400) return "Google no aceptó la clave. Revísala en «Mi clave».";
    if(res.status === 403) return "La clave no tiene permiso. Crea una nueva en Google AI Studio.";
    if(res.status === 429) return "Muchas peticiones seguidas. Espera un momento.";
    if(res.status === 503) return "Google está congestionado. Intenta otra vez en unos segundos.";
    return "Google respondió con error " + res.status + ".";
  }

  function translateAll(text){
    var prompt =
      "Traduce la siguiente frase del español al inglés, al noruego bokmål y al neerlandés.\n" +
      "Responde ÚNICAMENTE con un objeto JSON, sin explicaciones y sin marcas de código.\n" +
      'Formato exacto: {"en":"...","no":"...","nl":"..."}\n\nFrase: ' + text;
    return withRetry(function(){
      return callModel(TEXT_MODEL, { contents:[ { parts:[ { text: prompt } ] } ] });
    }).then(function(res){
      if(!res.ok) throw new Error(explainError(res));
      var data; try{ data = JSON.parse(res.txt); }catch(e){ throw new Error("Respuesta ilegible del traductor."); }
      var out = "";
      try{
        var parts = data.candidates[0].content.parts;
        for(var i=0;i<parts.length;i++) if(parts[i].text) out += parts[i].text;
      }catch(e){}
      if(!out) throw new Error("El traductor no devolvió texto.");
      var clean = out.replace(/```json/gi,"").replace(/```/g,"").trim();
      var tr; try{ tr = JSON.parse(clean); }catch(e){ throw new Error("El traductor no respondió en el formato esperado."); }
      var r = {};
      LANGS.forEach(function(L){ r[L.code] = tidy(tr[L.code]); });
      return r;
    });
  }

  function translateToEs(text, from){
    var prompt = "Traduce al español esta frase que está en " + from.say +
      ".\nResponde únicamente con la traducción, sin comillas ni explicaciones.\n\nFrase: " + text;
    return withRetry(function(){
      return callModel(TEXT_MODEL, { contents:[ { parts:[ { text: prompt } ] } ] });
    }).then(function(res){
      if(!res.ok) throw new Error(explainError(res));
      var data; try{ data = JSON.parse(res.txt); }catch(e){ throw new Error("Respuesta ilegible."); }
      var out = "";
      try{
        var parts = data.candidates[0].content.parts;
        for(var i=0;i<parts.length;i++) if(parts[i].text) out += parts[i].text;
      }catch(e){}
      out = tidy(out);
      if(!out) throw new Error("No se pudo traducir.");
      return out;
    });
  }

  /* ---------- voz ---------- */
  var audioCache = {};   /* clave: idioma|texto  ->  URL del audio */
  var cacheKeys = [];
  var playing = null;

  function pcmToWav(b64, rate){
    var bin = atob(b64), n = bin.length;
    var pcm = new Uint8Array(n);
    for(var i=0;i<n;i++) pcm[i] = bin.charCodeAt(i);
    var buf = new ArrayBuffer(44+n), v = new DataView(buf);
    function str(o,s){ for(var j=0;j<s.length;j++) v.setUint8(o+j, s.charCodeAt(j)); }
    str(0,"RIFF");  v.setUint32(4,36+n,true);  str(8,"WAVE");
    str(12,"fmt "); v.setUint32(16,16,true);   v.setUint16(20,1,true);
    v.setUint16(22,1,true);                    v.setUint32(24,rate,true);
    v.setUint32(28,rate*2,true);               v.setUint16(32,2,true);
    v.setUint16(34,16,true);                   str(36,"data");
    v.setUint32(40,n,true);
    new Uint8Array(buf,44).set(pcm);
    return new Blob([buf], { type:"audio/wav" });
  }

  function fetchVoice(text, L){
    var ck = L.code + "|" + text;
    if(audioCache[ck]) return Promise.resolve(audioCache[ck]);

    var body = {
      contents: [ { parts: [ { text: "Read the following aloud in " + L.say + ", naturally: " + text } ] } ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
      }
    };
    var order = ttsModelOk ? [ttsModelOk] : TTS_MODELS.slice();
    var i = 0;

    function attempt(){
      if(i >= order.length) return Promise.reject(new Error("sin voz"));
      var model = order[i++];
      return withRetry(function(){ return callModel(model, body); }, 2).then(function(res){
        if(!res.ok) return attempt();
        var data; try{ data = JSON.parse(res.txt); }catch(e){ return attempt(); }
        var inl = null, mime = "";
        try{
          var parts = data.candidates[0].content.parts;
          for(var p=0;p<parts.length;p++){
            if(parts[p].inlineData && parts[p].inlineData.data){
              inl = parts[p].inlineData.data; mime = parts[p].inlineData.mimeType || ""; break;
            }
          }
        }catch(e){}
        if(!inl) return attempt();
        ttsModelOk = model;
        var rate = 24000, m = /rate=(\d+)/.exec(mime);
        if(m) rate = parseInt(m[1],10);
        var blob;
        if(/wav/i.test(mime)){
          var bin = atob(inl), arr = new Uint8Array(bin.length);
          for(var k=0;k<bin.length;k++) arr[k] = bin.charCodeAt(k);
          blob = new Blob([arr], { type:"audio/wav" });
        } else {
          blob = pcmToWav(inl, rate);
        }
        var url = URL.createObjectURL(blob);
        audioCache[ck] = url;
        cacheKeys.push(ck);
        while(cacheKeys.length > 60){
          var old = cacheKeys.shift();
          try{ URL.revokeObjectURL(audioCache[old]); }catch(e){}
          delete audioCache[old];
        }
        return url;
      }, function(){ return attempt(); });
    }
    return attempt();
  }

  function stopAudio(){
    try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){}
    if(playing){ try{ playing.pause(); }catch(e){} playing = null; }
  }

  function deviceVoice(text, tags){
    if(!window.speechSynthesis) return null;
    var voices = [];
    try{ voices = window.speechSynthesis.getVoices(); }catch(e){}
    if(!voices.length) return null;
    for(var i=0;i<tags.length;i++){
      var tag = tags[i].toLowerCase(), root = tag.split("-")[0];
      var pool = voices.filter(function(v){
        var l = (v.lang||"").toLowerCase().replace("_","-");
        return l === tag || l.indexOf(tag+"-") === 0 || l.split("-")[0] === root;
      });
      if(pool.length) return pool[0];
    }
    return null;
  }

  function sayWithDevice(text, tags){
    return new Promise(function(resolve){
      var v = deviceVoice(text, tags);
      if(!v){ resolve(false); return; }
      var u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 0.9;
      u.onend = function(){ resolve(true); };
      u.onerror = function(){ resolve(true); };
      window.speechSynthesis.speak(u);
    });
  }

  function playUrl(url){
    return new Promise(function(resolve){
      var a = new Audio(url);
      playing = a;
      a.onended = function(){ playing = null; resolve(true); };
      a.onerror = function(){ playing = null; resolve(false); };
      var p = a.play();
      if(p && p.catch) p.catch(function(){ playing = null; resolve(false); });
    });
  }

  /* voz de Google primero; si falla, la del dispositivo */
  function say(text, L){
    text = tidy(text);
    if(!text) return Promise.resolve();
    stopAudio();
    return fetchVoice(text, L).then(playUrl).catch(function(){
      return sayWithDevice(text, L.tts);
    });
  }
  function sayEs(text){
    text = tidy(text);
    if(!text) return Promise.resolve();
    stopAudio();
    return sayWithDevice(text, ES_TTS).then(function(ok){
      if(ok) return true;
      var ES = { code:"es", say:"Spanish", tts:ES_TTS };
      return fetchVoice(text, ES).then(playUrl).catch(function(){ return false; });
    });
  }

  /* ---------- micrófono ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var activeRec = null;
  function listen(tag, onPartial){
    return new Promise(function(resolve, reject){
      if(!SR){ reject(new Error("Este navegador no reconoce voz. Usa Chrome, Edge o Safari.")); return; }
      if(activeRec){ try{ activeRec.stop(); }catch(e){} activeRec = null; }
      var rec = new SR();
      rec.lang = tag; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      var finalText = "", settled = false;
      rec.onresult = function(ev){
        var interim = "";
        for(var i=ev.resultIndex;i<ev.results.length;i++){
          var r = ev.results[i];
          if(r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        if(onPartial) onPartial(finalText || interim);
      };
      rec.onerror = function(ev){
        if(settled) return; settled = true; activeRec = null;
        var msg;
        switch(ev.error){
          case "not-allowed": case "service-not-allowed":
            msg = "El navegador no dio permiso al micrófono. Tócalo en el candado de la barra de direcciones."; break;
          case "no-speech":     msg = "No se oyó nada. Vamos otra vez, más cerca."; break;
          case "audio-capture": msg = "No se encontró micrófono."; break;
          case "network":       msg = "El micrófono necesita internet."; break;
          case "language-not-supported": msg = "Este navegador no reconoce ese idioma por voz."; break;
          case "aborted":       msg = ""; break;
          default:              msg = "El micrófono falló. Vamos otra vez.";
        }
        reject(new Error(msg));
      };
      rec.onend = function(){
        activeRec = null;
        if(settled) return; settled = true;
        var t = finalText.trim();
        if(t) resolve(t); else reject(new Error("No se oyó nada. Vamos otra vez, más cerca."));
      };
      activeRec = rec;
      try{ rec.start(); }catch(e){ activeRec = null; settled = true; reject(new Error("No se pudo abrir el micrófono.")); }
    });
  }
  function stopListening(){ if(activeRec){ try{ activeRec.stop(); }catch(e){} } }

  /* ---------- clave ---------- */
  function renderKeyState(){
    $("keyState").textContent = apiKey
      ? "Clave guardada en este dispositivo."
      : "Sin clave todavía. La app no puede traducir hasta que la pegues.";
  }
  $("openKey").addEventListener("click", function(){
    var v = $("view-clave");
    v.className = (v.className === "hidden") ? "" : "hidden";
    $("keyInput").value = apiKey;
    renderKeyState();
  });
  $("saveKey").addEventListener("click", function(){
    apiKey = $("keyInput").value.trim();
    try{ localStorage.setItem(KKEY, apiKey); }catch(e){}
    renderKeyState();
    $("view-clave").className = "hidden";
    noteT("");
  });
  $("forgetKey").addEventListener("click", function(){
    apiKey = "";
    try{ localStorage.removeItem(KKEY); }catch(e){}
    $("keyInput").value = "";
    renderKeyState();
  });

  function noteT(msg){
    var el = $("noteT");
    el.textContent = msg || "";
    el.className = msg ? "note show" : "note";
  }

  /* ---------- traducir ---------- */
  function renderCards(){
    var box = $("cards");
    box.textContent = "";
    LANGS.forEach(function(L){
      var r = state.current ? state.current[L.code] : null;
      var card = document.createElement("div");
      card.className = "lang";
      card.style.setProperty("--accent", L.accent);
      var body = document.createElement("div"); body.className = "body";
      var n = document.createElement("div"); n.className = "name"; n.textContent = L.label;
      var t = document.createElement("div");
      if(r && r.text){ t.className = "text"; t.textContent = r.text; }
      else if(r && r.loading){ t.className = "text placeholder"; t.textContent = "Traduciendo…"; }
      else { t.className = "text placeholder"; t.textContent = "—"; }
      body.appendChild(n); body.appendChild(t);
      var b = document.createElement("button");
      b.className = "play";
      b.setAttribute("aria-label","Escuchar en " + L.label.toLowerCase());
      b.appendChild(icon(SPK_D));
      b.disabled = !(r && r.text);
      b.addEventListener("click", function(){
        b.setAttribute("data-busy","true");
        say(r.text, L).then(function(){ b.removeAttribute("data-busy"); });
      });
      card.appendChild(body); card.appendChild(b);
      box.appendChild(card);
    });
  }

  var busy = false;
  function doTranslate(text){
    text = tidy(text);
    if(!text || busy) return;
    if(!apiKey){ noteT("Primero pega tu clave en «Mi clave», arriba."); return; }
    busy = true; noteT("");
    $("saidEs").textContent = text;
    $("hintEs").textContent = "Traduciendo…";
    state.current = { es: text };
    LANGS.forEach(function(L){ state.current[L.code] = { loading:true }; });
    renderCards();

    translateAll(text).then(function(r){
      state.current = { es: text };
      LANGS.forEach(function(L){ state.current[L.code] = { text: r[L.code] }; });
      renderCards();
      pushHistory(text);
      state.focus = "en"; state.etapa = "oir";
      renderAprender();
      $("hintEs").textContent = "Toca y habla en español";
      busy = false;
      return sayChain();
    }).catch(function(err){
      busy = false;
      $("hintEs").textContent = "Toca y habla en español";
      state.current = { es: text };
      renderCards();
      noteT(err.message || "No se pudo traducir.");
    });
  }

  function sayChain(){
    var chain = [];
    LANGS.forEach(function(L){
      var r = state.current && state.current[L.code];
      if(r && r.text) chain.push({ text:r.text, L:L });
    });
    var i = 0;
    function next(){
      if(i >= chain.length) return Promise.resolve();
      var item = chain[i++];
      return say(item.text, item.L).then(function(){
        return new Promise(function(r){ setTimeout(r, 500); });
      }).then(next);
    }
    return next();
  }

  $("goEs").addEventListener("click", function(){
    var v = $("inEs").value; $("inEs").value = ""; doTranslate(v);
  });
  $("inEs").addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); $("goEs").click(); }
  });

  var micEs = $("micEs");
  micEs.appendChild(icon(MIC_D));
  micEs.addEventListener("click", function(){
    if(micEs.getAttribute("data-on") === "true"){ stopListening(); return; }
    stopAudio();
    micEs.setAttribute("data-on","true");
    $("hintEs").textContent = "Escuchando… toca otra vez para parar";
    $("saidEs").textContent = "";
    listen("es-CO", function(p){ $("saidEs").textContent = p; }).then(function(t){
      micEs.setAttribute("data-on","false"); doTranslate(t);
    }, function(err){
      micEs.setAttribute("data-on","false");
      $("hintEs").textContent = err.message || "Toca y habla en español";
    });
  });

  /* ---------- aprender ---------- */
  function phraseOf(code){
    var r = state.current && state.current[code];
    return (r && r.text) ? r.text : null;
  }
  function hasPhrases(){ return !!(state.current && phraseOf("en")); }

  function renderAprender(){
    $("aprEs").textContent = state.current && state.current.es ? state.current.es : "Traduce algo primero, en la pestaña Traducir";

    $("stepOir").setAttribute("aria-selected", String(state.etapa === "oir"));
    $("stepDecir").setAttribute("aria-selected", String(state.etapa === "decir"));
    $("etapaOir").className = state.etapa === "oir" ? "" : "hidden";
    $("etapaDecir").className = state.etapa === "decir" ? "" : "hidden";

    var list = $("oirList");
    list.textContent = "";
    LANGS.forEach(function(L){
      var p = phraseOf(L.code);
      var d = document.createElement("div");
      d.className = "ll";
      d.style.setProperty("--accent", L.accent);
      d.setAttribute("data-lang", L.code);
      var n = document.createElement("div"); n.className = "n"; n.textContent = L.label;
      var t = document.createElement("div"); t.className = "t"; t.textContent = p || "—";
      d.appendChild(n); d.appendChild(t);
      list.appendChild(d);
    });

    var L = lang(state.focus);
    var card = $("focusCard");
    card.style.setProperty("--accent", L.accent);
    $("focusLang").textContent = L.label;
    $("focusText").textContent = phraseOf(L.code) || "—";
    $("focusListen").disabled = !phraseOf(L.code);

    var idx = indexOfLang(state.focus);
    $("nextLang").textContent = (idx < LANGS.length - 1)
      ? ("Vamos por el " + LANGS[idx+1].label.toLowerCase())
      : "Terminar";
    $("advanceNote").textContent = "";
    $("loopBtn").textContent = state.looping ? "Parar" : "Escuchar en bucle";
    $("loopBtn").setAttribute("data-on", String(state.looping));
  }

  function markNow(code){
    Array.prototype.forEach.call(document.querySelectorAll(".ll"), function(d){
      d.setAttribute("data-now", String(d.getAttribute("data-lang") === code));
    });
  }

  function loopOnce(){
    var i = 0;
    function step(){
      if(!state.looping) return Promise.resolve();
      if(i >= LANGS.length) return Promise.resolve();
      var L = LANGS[i++];
      var p = phraseOf(L.code);
      if(!p) return step();
      markNow(L.code);
      return say(p, L).then(function(){
        return new Promise(function(r){ setTimeout(r, 700); });
      }).then(step);
    }
    return step();
  }
  function runLoop(){
    if(!state.looping) return;
    loopOnce().then(function(){
      if(!state.looping) return;
      setTimeout(function(){
        if(state.looping) runLoop();
      }, 1200);
    });
  }

  $("loopBtn").addEventListener("click", function(){
    if(!hasPhrases()){ $("loopHint").textContent = "Traduce algo primero."; return; }
    if(state.looping){
      state.looping = false; stopAudio(); markNow("");
      $("loopHint").textContent = "Cuando lo tengas en el oído, pasa a Repetir";
      renderAprender();
      return;
    }
    state.looping = true;
    $("loopHint").textContent = "Sonando… toca Parar cuando quieras";
    renderAprender();
    runLoop();
  });

  $("stepOir").addEventListener("click", function(){ state.etapa = "oir"; renderAprender(); });
  $("stepDecir").addEventListener("click", function(){
    state.looping = false; stopAudio(); state.etapa = "decir";
    $("result").className = "result hidden";
    renderAprender();
  });

  $("focusListen").addEventListener("click", function(){
    var L = lang(state.focus), p = phraseOf(L.code);
    if(p) say(p, L);
  });

  $("nextLang").addEventListener("click", function(){
    var idx = indexOfLang(state.focus);
    if(idx < LANGS.length - 1){
      state.focus = LANGS[idx+1].code;
      $("result").className = "result hidden";
      $("decirHint").textContent = "Toca y dila";
      renderAprender();
    } else {
      $("advanceNote").textContent = "Frase dominada. Traduce otra cuando quieras.";
    }
  });

  function alignScore(target, said){
    var a = words(target), b = words(said);
    if(!a.length) return { pct:0, marks:[], target:[] };
    var n = a.length, m = b.length, d = [], i, j;
    for(i=0;i<=n;i++){ d[i] = [i]; }
    for(j=0;j<=m;j++){ d[0][j] = j; }
    for(i=1;i<=n;i++) for(j=1;j<=m;j++){
      var c = (a[i-1] === b[j-1]) ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c);
    }
    var marks = new Array(n).fill(false);
    i = n; j = m;
    while(i > 0 && j > 0){
      if(a[i-1] === b[j-1] && d[i][j] === d[i-1][j-1]){ marks[i-1] = true; i--; j--; }
      else if(d[i][j] === d[i-1][j-1]+1){ i--; j--; }
      else if(d[i][j] === d[i-1][j]+1){ i--; }
      else { j--; }
    }
    var hits = 0;
    for(i=0;i<marks.length;i++) if(marks[i]) hits++;
    return { pct: Math.round(hits*100/n), marks: marks, target: a };
  }

  var micDecir = $("micDecir");
  micDecir.appendChild(icon(MIC_D));
  micDecir.addEventListener("click", function(){
    var L = lang(state.focus), phrase = phraseOf(L.code);
    if(!phrase){ $("decirHint").textContent = "Traduce algo primero."; return; }
    if(micDecir.getAttribute("data-on") === "true"){ stopListening(); return; }
    state.looping = false; stopAudio();
    micDecir.setAttribute("data-on","true");
    $("decirHint").textContent = "Escuchando…";
    $("result").className = "result hidden";

    listen(L.asr, null).then(function(said){
      micDecir.setAttribute("data-on","false");
      $("decirHint").textContent = "Toca y dila";
      var r = alignScore(phrase, said);
      var idx = indexOfLang(state.focus);
      var siguiente = (idx < LANGS.length-1) ? LANGS[idx+1].label.toLowerCase() : null;

      $("resPct").textContent = "Vas " + r.pct + "%";
      $("resPct").style.color = r.pct >= 85 ? "#14524A" : (r.pct >= 50 ? "#B07A16" : "#5A6A5E");

      var verdict;
      if(r.pct >= 85){
        verdict = siguiente ? ("Listo, lo tienes. Vamos por el " + siguiente) : "Listo, lo tienes. Frase dominada.";
      } else if(r.pct >= 50){
        verdict = "Vas bien, dale otra vez. Vamos por el 100";
      } else {
        verdict = "Vamos otra vez";
      }
      $("resVerdict").textContent = verdict;

      var box = $("resHeard");
      box.textContent = "";
      var line = document.createElement("span");
      line.className = "said-line";
      line.textContent = "Se oyó: " + said;
      box.appendChild(line);
      r.target.forEach(function(w, i2){
        var sp = document.createElement("span");
        sp.className = r.marks[i2] ? "w-ok" : "w-pend";
        sp.textContent = w;
        box.appendChild(sp);
        box.appendChild(document.createTextNode(" "));
      });

      $("advanceNote").textContent = (r.pct < 85 && siguiente)
        ? "Si quieres, la repasas una vez más antes de seguir."
        : "";
      $("result").className = "result";
    }, function(err){
      micDecir.setAttribute("data-on","false");
      $("decirHint").textContent = err.message || "Toca y dila";
    });
  });

  /* ---------- conversar ---------- */
  function renderConv(){
    var c = $("convChips");
    c.textContent = "";
    LANGS.forEach(function(L){
      var b = document.createElement("button");
      b.className = "chip";
      b.textContent = L.label;
      b.setAttribute("aria-pressed", String(L.code === state.convLang));
      b.addEventListener("click", function(){ state.convLang = L.code; save(); renderConv(); });
      c.appendChild(b);
    });
    $("hintConv").textContent = "Toca cuando la otra persona vaya a hablar en " + lang(state.convLang).label.toLowerCase();
  }
  var convPlay = $("convPlay"); convPlay.appendChild(icon(SPK_D));
  var micConv = $("micConv"); micConv.appendChild(icon(MIC_D));
  micConv.addEventListener("click", function(){
    var L = lang(state.convLang);
    if(micConv.getAttribute("data-on") === "true"){ stopListening(); return; }
    stopAudio();
    micConv.setAttribute("data-on","true");
    $("hintConv").textContent = "Escuchando en " + L.label.toLowerCase() + "…";
    $("convHeard").textContent = "";
    var out = $("convEs");
    listen(L.asr, function(p){ $("convHeard").textContent = p; }).then(function(text){
      micConv.setAttribute("data-on","false");
      $("convHeard").textContent = text;
      out.className = "text placeholder"; out.textContent = "Traduciendo…";
      return translateToEs(text, L).then(function(es){
        out.className = "text"; out.textContent = es;
        convPlay.disabled = false;
        convPlay.onclick = function(){ sayEs(es); };
        renderConv();
        return sayEs(es);
      });
    }).catch(function(err){
      micConv.setAttribute("data-on","false");
      out.className = "text placeholder";
      out.textContent = err.message || "No se pudo traducir.";
      renderConv();
    });
  });

  /* ---------- historial ---------- */
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
      var el = document.createElement("div"); el.className = "item";
      var es = document.createElement("div"); es.className = "es"; es.textContent = item.es;
      el.appendChild(es);
      LANGS.forEach(function(L){
        var val = item[L.code];
        if(!val) return;
        var row = document.createElement("div"); row.className = "row";
        var tag = document.createElement("span"); tag.className = "tag"; tag.style.color = L.accent; tag.textContent = L.short;
        var tr = document.createElement("span"); tr.className = "tr"; tr.textContent = val;
        var b = document.createElement("button");
        b.className = "mini"; b.style.color = L.accent;
        b.setAttribute("aria-label","Escuchar en " + L.label.toLowerCase());
        b.appendChild(icon(SPK_D));
        b.addEventListener("click", function(){ say(val, L); });
        row.appendChild(tag); row.appendChild(tr); row.appendChild(b);
        el.appendChild(row);
      });
      var foot = document.createElement("div"); foot.className = "foot";
      var when = document.createElement("span"); when.className = "when"; when.textContent = fmtWhen(item.ts);
      var actions = document.createElement("span");

      var usar = document.createElement("button");
      usar.className = "linkish"; usar.textContent = "Practicar";
      usar.addEventListener("click", function(){
        state.current = { es: item.es };
        LANGS.forEach(function(L){ state.current[L.code] = { text: item[L.code] || null }; });
        state.focus = "en"; state.etapa = "oir"; state.looping = false;
        $("saidEs").textContent = item.es;
        renderCards(); renderAprender(); setMode("aprender");
        window.scrollTo({ top:0, behavior:"smooth" });
      });

      var del = document.createElement("button");
      del.className = "linkish"; del.textContent = "Borrar";
      del.addEventListener("click", function(){
        state.history = state.history.filter(function(x){ return x.id !== item.id; });
        save(); renderHistory();
      });

      actions.appendChild(usar); actions.appendChild(del);
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
  $("clearHist").addEventListener("click", function(){
    if(!state.history.length) return;
    if(window.confirm("¿Borrar todas tus frases guardadas? No se puede deshacer.")){
      state.history = []; save(); renderHistory();
    }
  });

  /* ---------- modos ---------- */
  function setMode(m){
    state.mode = m;
    ["traducir","aprender","conversar"].forEach(function(k){
      $("tab-"+k).setAttribute("aria-selected", String(k === m));
      $("view-"+k).className = (k === m) ? "" : "hidden";
    });
    state.looping = false;
    stopAudio(); stopListening();
    if(m === "aprender") renderAprender();
    if(m === "conversar") renderConv();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".modes button"), function(b){
    b.addEventListener("click", function(){ setMode(b.getAttribute("data-mode")); });
  });

  /* ---------- arranque ---------- */
  load();
  renderKeyState();
  renderCards();
  renderHistory();
  renderConv();
  renderAprender();
  setMode("traducir");
  if(!apiKey){
    $("view-clave").className = "";
    noteT("Pega tu clave de Google para empezar.");
  }
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
  }
})();
