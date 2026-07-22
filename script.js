(function(){
    const FLAG='mack_reshuffle_pending';

    function shuffle(a){
      for(let i=a.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        const t=a[i]; a[i]=a[j]; a[j]=t;
      }
      return a;
    }

    function setFlag(){ try{ localStorage.setItem(FLAG,'1'); }catch(e){} }
    function clearFlag(){ try{ localStorage.removeItem(FLAG); }catch(e){} }
    function hasFlag(){ try{ return !!localStorage.getItem(FLAG); }catch(e){ return false; } }

    /* Does this value look like a trivia category? (name/title + Q&A clue list) */
    function looksLikeCategory(o){
      if(!o || typeof o!=='object' || Array.isArray(o)) return false;
      const hasName = typeof o.name==='string' || typeof o.title==='string' || typeof o.category==='string' || typeof o.label==='string';
      if(!hasName) return false;
      const lists=[o.clues,o.questions,o.cards].filter(Array.isArray);
      if(!lists.length) return false;
      const first=lists[0][0];
      if(first==null || typeof first==='string') return true;
      if(typeof first==='object'){
        return ['q','question','clue','prompt','a','answer','response','value','points','text'].some(function(k){ return k in first; });
      }
      return false;
    }

    /* Extract the category array from a candidate value (checks common wrapper keys). */
    function asBank(d, depth){
      if(!d || depth>2) return null;
      if(Array.isArray(d)){
        return (d.length>1 && looksLikeCategory(d[0])) ? d : null;
      }
      if(typeof d==='object'){
        const keys=['categories','categoryList','cats','bank','questionBank','questions','clues','data','list','all','rounds','board'];
        for(const k of keys){
          if(d[k]){
            const r=asBank(d[k], depth+1);
            if(r) return r;
          }
        }
      }
      return null;
    }

    /* Find the game's question bank. The old script only tried a handful of
       hard-coded global names — if the engine used anything else the shuffle
       silently did nothing and the categories never changed. Now it checks
       known names AND safely scans every window property for anything shaped
       like a trivia-category array. */
    function findBank(){
      const names=['CATEGORIES','categories','GAME_DATA','gameData','QUESTION_BANK','questionBank','QUESTIONS','questions','BOARD_DATA','boardData','TRIVIA_DATA','triviaData','CLUES','clues','DATA','GAME','game','APP','STATE','state','CONFIG','ALL_CATEGORIES','allCategories','CATEGORY_BANK','categoryBank','GAME_CATEGORIES','gameCategories','TRIVIA','trivia','JEOPARDY','jeopardy','BANK','bank','CLUE_DATA','clueData'];
      for(const n of names){
        let v;
        try{ v=window[n]; }catch(e){ v=undefined; }
        /* const/let-declared globals never show up on window — probe the global
           lexical scope via eval too, or the bank is never found and the game
           falls back to only reordering the 6 visible categories. */
        if(v===undefined){ try{ v=window.eval(n); }catch(e2){ v=undefined; } }
        const r=asBank(v,0);
        if(r) return r;
      }
      try{
        const props=Object.getOwnPropertyNames(window);
        for(const k of props){
          let v; try{ v=window[k]; }catch(e){ continue; }
          if(!v || typeof v!=='object' || v===window || v===document) continue;
          const r=asBank(v,0);
          if(r) return r;
        }
      }catch(e){}
      return null;
    }

    function shuffleBank(){
      const bank=findBank();
      if(bank && bank.length>1){
        shuffle(bank);
        /* If the bank holds MORE categories than the board shows and the engine
           deals the first N each game, rotate a random slice to the front so a
           fresh lineup of categories is guaranteed — not just the same 6
           columns in a different order. */
        if(bank.length>6){
          const start=Math.floor(Math.random()*bank.length);
          const rotated=bank.slice(start).concat(bank.slice(0,start));
          for(let i=0;i<bank.length;i++) bank[i]=rotated[i];
        }
        return true;
      }
      return false;
    }

    /* DOM-level shuffle (guaranteed visible change). Desktop keeps its
       6-column grid structure — columns move as whole units, header + its 5
       tiles together; mobile shuffles whole category blocks. Event listeners
       survive appendChild, so every tile keeps working. */
    function shuffleDom(){
      const desk=document.getElementById('board-desktop');
      if(desk && desk.children.length){
        const kids=Array.prototype.slice.call(desk.children);
        const cols=6;
        if(kids.length%cols===0){
          const order=shuffle([0,1,2,3,4,5]);
          const frag=document.createDocumentFragment();
          for(let r=0;r<kids.length/cols;r++){
            order.forEach(c=>frag.appendChild(kids[r*cols+c]));
          }
          desk.appendChild(frag);
        }
      }
      const mob=document.getElementById('board-mobile');
      if(mob && mob.children.length){
        shuffle(Array.prototype.slice.call(mob.children)).forEach(n=>mob.appendChild(n));
      }
    }

    /* Some engines restart by reloading the whole page, which wipes any
       in-memory shuffle — the pending flag survives the reload so the bank is
       shuffled as early as possible on the next load (retries cover bank
       scripts that run after this one). */
    function applyPending(){
      if(!hasFlag()) return true;
      if(shuffleBank()){
        clearFlag();
        setTimeout(shuffleDom,350); /* covers an engine that already rendered */
        return true;
      }
      return false;
    }
    let attempts=0;
    applyPending();
    document.addEventListener('DOMContentLoaded', applyPending);
    const pendingIv=setInterval(function(){
      if(applyPending() || ++attempts>50) clearInterval(pendingIv);
    },100);

    let obs=null;
    const btn=document.getElementById('restart-btn');
    if(btn){
      btn.addEventListener('click',function(){
        setFlag(); /* in case this restart reloads the page */
        shuffleBank();
        /* Keep the flag armed for 2s: if the engine restarts by RELOADING the
           page, the flag survives the reload and applyPending() shuffles the
           bank on the next load, so a fresh set of categories is dealt.
           (Previously the flag was cleared instantly, so reload-style restarts
           always re-dealt the same 6 categories.) */
        setTimeout(clearFlag,2000);

        /* Runs AFTER the engine's own restart handler: if the engine re-rendered
           fresh categories from the shuffled bank this simply randomizes their
           positions; if it left the board untouched this reorders the columns
           directly — either way the player sees a changed board. */
        setTimeout(shuffleDom,150);

        /* If the engine re-renders asynchronously, catch that re-render and
           shuffle the fresh DOM too (the observer disconnects before
           shuffling, so our own DOM moves never retrigger it). */
        if(obs) obs.disconnect();
        const targets=[document.getElementById('board-desktop'),document.getElementById('board-mobile')].filter(Boolean);
        if(targets.length){
          obs=new MutationObserver(function(){
            obs.disconnect();
            obs=null;
            setTimeout(shuffleDom,60);
          });
          targets.forEach(function(t){ obs.observe(t,{childList:true}); });
          setTimeout(function(){ if(obs){ obs.disconnect(); obs=null; } },2500);
        }
      },true); /* capture phase → runs before the game's own restart handler */
    }
  })();

(function(){
    'use strict';

    /* ---------- locate the question bank (same strategy as the reshuffle script) ---------- */
    function looksLikeCategory(o){
      if(!o || typeof o!=='object' || Array.isArray(o)) return false;
      const hasName = typeof o.name==='string' || typeof o.title==='string' || typeof o.category==='string' || typeof o.label==='string';
      if(!hasName) return false;
      const lists=[o.clues,o.questions,o.cards].filter(Array.isArray);
      if(!lists.length) return false;
      const first=lists[0][0];
      if(first==null || typeof first==='string') return true;
      if(typeof first==='object'){
        return ['q','question','clue','prompt','a','answer','response','value','points','text'].some(function(k){ return k in first; });
      }
      return false;
    }
    function asBank(d, depth){
      if(!d || depth>2) return null;
      if(Array.isArray(d)) return (d.length>1 && looksLikeCategory(d[0])) ? d : null;
      if(typeof d==='object'){
        const keys=['categories','categoryList','cats','bank','questionBank','questions','clues','data','list','all','rounds','board'];
        for(const k of keys){
          if(d[k]){
            const r=asBank(d[k], depth+1);
            if(r) return r;
          }
        }
      }
      return null;
    }
    function findBank(){
      const names=['CATEGORIES','categories','GAME_DATA','gameData','QUESTION_BANK','questionBank','QUESTIONS','questions','BOARD_DATA','boardData','TRIVIA_DATA','triviaData','CLUES','clues','DATA','GAME','game','APP','STATE','state','CONFIG','ALL_CATEGORIES','allCategories','CATEGORY_BANK','categoryBank','GAME_CATEGORIES','gameCategories','TRIVIA','trivia','JEOPARDY','jeopardy','BANK','bank','CLUE_DATA','clueData'];
      for(const n of names){
        let v;
        try{ v=window[n]; }catch(e){ v=undefined; }
        if(v===undefined){ try{ v=window.eval(n); }catch(e2){ v=undefined; } }
        const r=asBank(v,0);
        if(r) return r;
      }
      try{
        const props=Object.getOwnPropertyNames(window);
        for(const k of props){
          let v; try{ v=window[k]; }catch(e){ continue; }
          if(!v || typeof v!=='object' || v===window || v===document) continue;
          const r=asBank(v,0);
          if(r) return r;
        }
      }catch(e){}
      return null;
    }
    function clueList(cat){
      const lists=[cat.clues,cat.questions,cat.cards].filter(Array.isArray);
      return lists.length?lists[0]:null;
    }

    /* ---------- pass 1: flag a second Daily Double in the bank data ---------- */
    const DD_KEYS=['dailyDouble','daily_double','isDailyDouble','dailydouble','dd','isDD'];
    function ddKeyOf(c){
      if(!c || typeof c!=='object') return null;
      for(const k of DD_KEYS){
        if(c[k]===true || c[k]===1 || c[k]==='true') return k;
      }
      return null;
    }
    function flagSecondDD(){
      const bank=findBank();
      if(!bank) return false;
      const playable=bank.slice(0,Math.min(6,bank.length)); /* board shows 6 categories */
      let flaggedCat=-1, flagKey=null, total=0;
      playable.forEach(function(cat,ci){
        const list=clueList(cat); if(!list) return;
        list.forEach(function(c){
          const k=ddKeyOf(c);
          if(k){ total++; flagKey=flagKey||k; if(flaggedCat===-1) flaggedCat=ci; }
        });
      });
      /* no data-flag convention found (DOM pass will try instead), or already 2+ */
      if(!flagKey || total>=2) return total>=2;
      /* pick a random unflagged clue in a DIFFERENT category than the existing DD */
      const choices=[];
      playable.forEach(function(cat,ci){
        if(ci===flaggedCat) return;
        const list=clueList(cat); if(!list) return;
        list.forEach(function(c){ if(c && typeof c==='object' && !ddKeyOf(c)) choices.push(c); });
      });
      if(!choices.length) return false;
      choices[Math.floor(Math.random()*choices.length)][flagKey]=true;
      return true;
    }

    /* ---------- pass 2: stamp the engine's DD marker onto a second tile ---------- */
    const DD_NAME_RE=/daily|double|(^|[-_])dd([-_]|$)/i;
    function boardTiles(){
      const out=[];
      ['board-desktop','board-mobile'].forEach(function(id){
        const b=document.getElementById(id);
        if(!b || !b.getClientRects().length) return;
        const ts=b.querySelectorAll('.tile');
        for(let i=0;i<ts.length;i++) out.push(ts[i]);
      });
      return out;
    }
    function tileDDMarker(t){
      for(let i=0;i<t.classList.length;i++){
        const c=t.classList[i];
        if(c==='tile' || c==='answered' || c==='tile-enter') continue;
        if(DD_NAME_RE.test(c)) return {kind:'class',name:c};
      }
      if(t.attributes){
        for(let j=0;j<t.attributes.length;j++){
          const a=t.attributes[j];
          if(a.name.indexOf('data-')!==0) continue;
          if(DD_NAME_RE.test(a.name)) return {kind:'data',name:a.name,value:a.value};
        }
      }
      return null;
    }
    function stampSecondDD(){
      const tiles=boardTiles();
      if(tiles.length<2) return false;
      const marked=[], unmarked=[];
      tiles.forEach(function(t){
        const m=tileDDMarker(t);
        if(m) marked.push(m); else unmarked.push(t);
      });
      /* nothing to copy (engine keeps DD state internally), already 2+, or no free tiles */
      if(!marked.length || marked.length>=2 || !unmarked.length) return marked.length>=2;
      const src=marked[0];
      const pick=unmarked[Math.floor(Math.random()*unmarked.length)];
      if(src.kind==='class') pick.classList.add(src.name);
      else pick.setAttribute(src.name, src.value || 'true');
      return true;
    }

    /* ---------- wiring: run both passes around every fresh board ---------- */
    flagSecondDD();
    document.addEventListener('DOMContentLoaded', flagSecondDD);

    /* game start: flag before the engine deals the board */
    const scr=document.getElementById('board-screen');
    if(scr) new MutationObserver(function(){
      if(!scr.classList.contains('hidden')) flagSecondDD();
    }).observe(scr,{attributes:true,attributeFilter:['class']});

    /* restart: the reshuffle script's capture listener is registered first, so
       the bank is already shuffled when these run — one immediate pass plus a
       delayed pass in case the engine re-flags its own DD during the deal */
    const rb=document.getElementById('restart-btn');
    if(rb) rb.addEventListener('click', function(){
      setTimeout(flagSecondDD,0);
      setTimeout(flagSecondDD,250);
    }, true);

    /* DOM pass: after any fresh render (children change, nothing answered yet).
       600ms ≈ after the reshuffle script's own post-render column shuffles. */
    let ddT=null;
    function scheduleStamp(){
      clearTimeout(ddT);
      ddT=setTimeout(function(){
        if(document.querySelector('#board-desktop .tile.answered, #board-mobile .tile.answered')) return;
        stampSecondDD();
      },600);
    }
    ['board-desktop','board-mobile'].forEach(function(id){
      const b=document.getElementById(id); if(!b) return;
      new MutationObserver(scheduleStamp).observe(b,{childList:true});
    });
    scheduleStamp();
  })();

(function(){
    'use strict';

    function $(id){ return document.getElementById(id); }
    var hudBound=false;

    /* ---------- champion podium mirrors the HUD score ---------- */
    function bindHud(){
      if(hudBound) return;
      var h=$('hud-score'); if(!h) return;
      hudBound=true;
      var p=$('contestant-score-1');
      if(p) p.textContent=h.textContent;
      new MutationObserver(function(){
        var p=$('contestant-score-1');
        if(!p) return;
        if(p.textContent!==h.textContent){
          p.textContent=h.textContent;
          p.classList.remove('feed-pop'); void p.offsetWidth; p.classList.add('feed-pop');
        }
      }).observe(h,{childList:true,characterData:true,subtree:true});
    }

    /* ---------- wiring ----------
       Auto-start removed: nothing here opens a clue — the player picks
       every tile themselves. This script now only keeps the champion
       podium score mirrored with the HUD (retrying until the HUD exists). */
    bindHud();
    var tries=0;
    var iv=setInterval(function(){ bindHud(); if(hudBound || ++tries>20) clearInterval(iv); },700);
    document.addEventListener('DOMContentLoaded', bindHud);
  })();

(function(){
    'use strict';
    var TEST=/PayMeGPT/i, SWAP=/PayMeGPT/gi, NAME='Macknified AI Grand Master';
    function fix(node){
      if(!node) return;
      if(node.nodeType===3){ /* text node */
        if(TEST.test(node.nodeValue)) node.nodeValue=node.nodeValue.replace(SWAP,NAME);
        return;
      }
      if(node.nodeType!==1) return; /* elements only below */
      var tag=node.tagName;
      if(tag==='SCRIPT'||tag==='STYLE'||tag==='TEXTAREA') return;
      var kids=node.childNodes;
      for(var i=0;i<kids.length;i++) fix(kids[i]);
    }
    new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){
        var m=muts[i];
        if(m.type==='characterData') fix(m.target);
        for(var j=0;j<m.addedNodes.length;j++) fix(m.addedNodes[j]);
      }
    }).observe(document.body,{subtree:true,childList:true,characterData:true});
    fix(document.body);
    document.addEventListener('DOMContentLoaded',function(){ fix(document.body); });
  })();

(function(){
      var TITLE = 'MACKNIFIED AI GRAND MASTER';
      var el = document.getElementById('rank-title');
      function forceTitle(){ if(el && el.textContent !== TITLE){ el.textContent = TITLE; } }
      forceTitle();
      if(el && window.MutationObserver){
        new MutationObserver(forceTitle).observe(el, { childList:true, characterData:true, subtree:true });
      }
    })();

/* ============================================================================
   GAME DATA — 6 categories x 5 clues, built from the Macknified AI Platform
   knowledge base. "a" = correct answer, "d" = three distractors.
   ============================================================================ */
const GAME_DATA = [
  { cat:"Widget Wizardry", clues:[
    { v:200,  q:"Which widget appears on a website as a floating chat bubble?", a:"Launcher Widget", d:["Iframe Embed","Voice Launcher Widget","Inline Sidebar Widget"] },
    { v:400,  q:"Which widget lets you embed the chatbot directly into a webpage layout?", a:"Iframe Embed", d:["Launcher Widget","Voice Launcher Widget","Popover Widget"] },
    { v:600,  q:"Which URL parameter hides the widget header?", a:"hideHeader=true", d:["header=off","showHeader=false","noHeader=1"] },
    { v:800,  q:"Which three appearance modes are supported by widgets?", a:"Auto, Light, and Dark", d:["Light, Dark, and Neon","Day, Night, and Dusk","System, Bright, and Dim"] },
    { v:1000, q:"Which special launcher position is documented specifically for voice launchers?", a:"Bottom-center", d:["Top-center","Middle-left","Fullscreen overlay"] }
  ]},
  { cat:"Voice Masters", clues:[
    { v:200,  q:"Which company powers the platform's ultra-realistic voice cloning in Voice Lab?", a:"ElevenLabs", d:["OpenAI","Twilio","AWS"] },
    { v:400,  q:"Which OpenAI Realtime voice is described as gentle and storyteller-like?", a:"Ballad", d:["Verse","Sage","Echo"] },
    { v:600,  q:"Which Grok Realtime voice is described as energetic and upbeat?", a:"Eve", d:["Leo","Sal","Ara"] },
    { v:800,  q:"With Load Conversation History enabled, how many past messages can be injected into a new voice session?", a:"The last 40 messages", d:["The last 10 messages","The last 20 messages","The last 100 messages"] },
    { v:1000, q:"Which realtime provider connects through a WebSocket proxy instead of WebRTC?", a:"xAI Grok Realtime", d:["OpenAI Realtime","ElevenLabs","Claude Realtime"] }
  ]},
  { cat:"Channel Surfing", clues:[
    { v:200,  q:"Which provider handles SMS and phone-number integrations?", a:"Twilio", d:["Stripe","Meta","AWS SES"] },
    { v:400,  q:"Which company provides the WhatsApp Business API integration?", a:"Meta", d:["Google","Twilio","Telegram"] },
    { v:600,  q:"Which Telegram command creates a new bot with @BotFather?", a:"/newbot", d:["/create","/bot","/start"] },
    { v:800,  q:"Why can't the AI automate direct messages on X?", a:"X's end-to-end encryption prevents third-party AI access", d:["X banned all chatbots","The X API is too expensive","DMs no longer exist on X"] },
    { v:1000, q:"How many integrated communication channels are listed in the platform overview?", a:"11", d:["7","9","15"] }
  ]},
  { cat:"Flow State", clues:[
    { v:200,  q:"What is the entry point of every Flow Builder flow?", a:"The Start node", d:["The Trigger node","The AI Response node","The Webhook node"] },
    { v:400,  q:"Which node pauses a conversation for a set amount of time?", a:"Delay node", d:["Wait node","Sleep node","Hold node"] },
    { v:600,  q:"Which node displays multiple swipeable items in chat?", a:"Carousel node", d:["Gallery node","Slider node","Deck node"] },
    { v:800,  q:"Which action rotates conversation assignment among team members?", a:"Assign Round-Robin", d:["Assign Conversation","Move Pipeline Stage","Shuffle Assign"] },
    { v:1000, q:"What is the default maximum number of follow-up attempts in AI Tasks?", a:"3", d:["1","5","Unlimited"] }
  ]},
  { cat:"Brain Power", clues:[
    { v:200,  q:"What does RAG stand for?", a:"Retrieval-Augmented Generation", d:["Random Answer Generation","Rapid Agent Gateway","Realtime Audio Guide"] },
    { v:400,  q:"Which knowledge-base option supports live voice conversations?", a:"Native Document Upload", d:["External OpenAI Vector Stores","URL Scraping","FTP Sync"] },
    { v:600,  q:"In Google's protocol for external AI systems, what does A2A stand for?", a:"Agent-to-Agent", d:["Ask-to-Answer","API-to-API","Audio-to-Action"] },
    { v:800,  q:"Which AI model powers the /video slash command?", a:"Google Gemini Veo", d:["OpenAI Sora","Claude Motion","Grok Vision"] },
    { v:1000, q:"Why can't external OpenAI vector stores be searched during realtime voice sessions?", a:"The Realtime API doesn't support the file_search tool", d:["They cost too much per call","They only work in dark mode","They require a Twilio number"] }
  ]},
  { cat:"By The Numbers", clues:[
    { v:200,  q:"How many OpenAI Realtime voices are documented?", a:"10", d:["6","8","12"] },
    { v:400,  q:"How many xAI Grok Realtime voices are listed?", a:"5", d:["3","7","10"] },
    { v:600,  q:"How long are videos generated with the documented /video command?", a:"8 seconds", d:["4 seconds","15 seconds","60 seconds"] },
    { v:800,  q:"What is the maximum total attachment size for one Inbox email?", a:"25 MB", d:["10 MB","50 MB","100 MB"] },
    { v:1000, q:"External OpenAI Vector Stores can support roughly how many files?", a:"10,000 or more", d:["Up to 10","Up to 100","Exactly 500"] }
  ]}
];

const TOTAL_CLUES = 30;
const CLUE_SECONDS = 15;
const LETTERS = ["A","B","C","D"];

/* ============================================================================
   STATE
   ============================================================================ */
let state;
function resetState(){
  state = {
    score:0, correct:0, wrong:0, streak:0, best:0,
    answered:new Set(), results:{},
    dd: Math.floor(Math.random()*6) + "-" + Math.floor(Math.random()*5), // one hidden Daily Double
    current:null, locked:false, muted: state ? state.muted : false,
    timer:null, timeLeft:CLUE_SECONDS
  };
}

/* ============================================================================
   AUDIO — tiny WebAudio synth for game-show sound effects (no assets needed)
   ============================================================================ */
let actx = null;
function initAudio(){
  if(!actx){ try{ actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ actx = null; } }
  if(actx && actx.state === "suspended"){ actx.resume(); }
}
function tone(freq, delay, dur, type, gain){
  if(!actx || state.muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function sfx(name){
  if(!actx || state.muted) return;
  switch(name){
    case "click":   tone(660,0,.07,"square",.05); break;
    case "reveal":  tone(392,0,.12,"sine",.12); tone(523.25,.1,.2,"sine",.12); break;
    case "correct": tone(523.25,0,.14,"triangle",.16); tone(659.25,.12,.14,"triangle",.16); tone(783.99,.24,.32,"triangle",.18); break;
    case "wrong":   tone(160,0,.35,"sawtooth",.13); tone(110,.05,.4,"sawtooth",.11); break;
    case "timeout": tone(440,0,.2,"sine",.12); tone(330,.18,.2,"sine",.12); tone(220,.36,.35,"sine",.12); break;
    case "dd":      tone(98,0,.5,"sawtooth",.2); tone(196,.05,.5,"square",.09); tone(784,.1,.6,"triangle",.14); break;
    case "end":     [523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,i*.15,.32,"triangle",.15)); break;
  }
}

/* ============================================================================
   BACKGROUND PARTICLES — slow drifting gold/blue dust with mouse parallax
   ============================================================================ */
const bg = document.getElementById("bg-canvas");
const bctx = bg.getContext("2d");
let parts = [], mx = .5, my = .5;
function sizeCanvases(){
  bg.width = innerWidth; bg.height = innerHeight;
  fx.width = innerWidth; fx.height = innerHeight;
}
function initParts(){
  parts = [];
  const n = Math.min(120, Math.floor(innerWidth / 11));
  for(let i=0;i<n;i++){
    parts.push({
      x: Math.random()*bg.width,
      y: Math.random()*bg.height,
      z: .25 + Math.random()*.75,                 // depth: affects size/speed/alpha
      r: .6 + Math.random()*2.2,
      vy: .12 + Math.random()*.35,
      gold: Math.random() < .3                    // 30% gold, 70% blue
    });
  }
}
function drawParts(){
  bctx.clearRect(0,0,bg.width,bg.height);
  const px = (mx - .5) * 26, py = (my - .5) * 18;
  for(const p of parts){
    p.y -= p.vy * p.z;
    if(p.y < -6){ p.y = bg.height + 6; p.x = Math.random()*bg.width; }
    bctx.beginPath();
    bctx.arc(p.x + px*p.z, p.y + py*p.z, p.r*p.z, 0, Math.PI*2);
    bctx.fillStyle = p.gold
      ? "rgba(255,215,94," + (0.10 + p.z*0.28) + ")"
      : "rgba(93,169,255," + (0.08 + p.z*0.24) + ")";
    bctx.fill();
  }
  requestAnimationFrame(drawParts);
}

/* ============================================================================
   CONFETTI — celebratory burst renderer on the foreground fx canvas
   ============================================================================ */
const fx = document.getElementById("fx-canvas");
const fctx = fx.getContext("2d");
let confetti = [], fxRunning = false;
function burst(x, y, n){
  const colors = ["#ffd75e","#f5b301","#3ddc84","#5da9ff","#ffffff"];
  for(let i=0;i<(n||80);i++){
    confetti.push({
      x:x, y:y,
      vx:(Math.random()-.5)*16,
      vy:-(Math.random()*13 + 3),
      g:.34, life:1, decay:.008 + Math.random()*.012,
      size:4 + Math.random()*6,
      color:colors[Math.floor(Math.random()*colors.length)],
      rot:Math.random()*Math.PI, vr:(Math.random()-.5)*.3
    });
  }
  if(!fxRunning){ fxRunning = true; runFx(); }
}
function runFx(){
  fctx.clearRect(0,0,fx.width,fx.height);
  confetti = confetti.filter(c => c.life > 0);
  for(const c of confetti){
    c.vy += c.g; c.x += c.vx; c.y += c.vy; c.vx *= .985;
    c.rot += c.vr; c.life -= c.decay;
    fctx.save();
    fctx.globalAlpha = Math.max(c.life, 0);
    fctx.translate(c.x, c.y); fctx.rotate(c.rot);
    fctx.fillStyle = c.color;
    fctx.fillRect(-c.size/2, -c.size/2, c.size, c.size*.6);
    fctx.restore();
  }
  if(confetti.length){ requestAnimationFrame(runFx); }
  else { fxRunning = false; fctx.clearRect(0,0,fx.width,fx.height); }
}

/* ============================================================================
   HELPERS
   ============================================================================ */
const $ = s => document.querySelector(s);
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}
function fmtMoney(v){ return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(); }
function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => { s.classList.add("hidden"); s.classList.remove("screen-enter","flex"); });
  const el = document.getElementById(id);
  el.classList.remove("hidden");
  if(id === "results-screen"){ el.classList.add("flex"); }
  el.classList.add("screen-enter");
}

/* ============================================================================
   BOARD RENDERING — desktop classic grid + mobile stacked category cards
   ============================================================================ */
function tileButton(ci, ki, mobile){
  const key = ci + "-" + ki;
  const cl = GAME_DATA[ci].clues[ki];
  const b = document.createElement("button");
  const done = state.answered.has(key);

  if(mobile){
    b.className = "tile rounded-lg h-11 flex items-center justify-center" + (done ? " answered" : "");
    b.innerHTML = done ? resultMark(state.results[key]) : '<span class="val text-lg">$' + cl.v + '</span>';
  } else {
    b.className = "tile rounded-xl h-16 lg:h-20 flex items-center justify-center" + (done ? " answered" : "");
    b.innerHTML = done ? resultMark(state.results[key]) : '<span class="val text-2xl lg:text-3xl">$' + cl.v + '</span>';
  }
  if(!done){
    b.setAttribute("aria-label", GAME_DATA[ci].cat + " for $" + cl.v);
    b.addEventListener("click", () => openClue(ci, ki));
  }
  return b;
}
function resultMark(ok){
  return ok
    ? '<span class="font-display text-2xl text-emerald-500/80">✓</span>'
    : '<span class="font-display text-2xl text-red-500/70">✕</span>';
}
function renderBoard(animate){
  const desk = $("#board-desktop"), mob = $("#board-mobile");
  desk.innerHTML = ""; mob.innerHTML = "";

  // Desktop: row 1 = all 6 category headers, then clue rows
  GAME_DATA.forEach((c, ci) => {
    const h = document.createElement("div");
    h.className = "cat-header rounded-xl h-16 lg:h-20 flex items-center justify-center text-center px-1" + (animate ? " tile-enter" : "");
    if(animate) h.style.animationDelay = (ci * 70) + "ms";
    h.innerHTML = '<span class="text-[10px] lg:text-xs font-bold uppercase tracking-wider text-sky-200 leading-tight">' + c.cat + '</span>';
    desk.appendChild(h);
  });
  for(let ki=0; ki<5; ki++){
    for(let ci=0; ci<6; ci++){
      const t = tileButton(ci, ki, false);
      if(animate){ t.classList.add("tile-enter"); t.style.animationDelay = (200 + ki*90 + ci*60) + "ms"; }
      desk.appendChild(t);
    }
  }

  // Mobile: one card per category with a row of 5 value chips
  GAME_DATA.forEach((c, ci) => {
    const card = document.createElement("div");
    card.className = "cat-header rounded-xl p-3" + (animate ? " tile-enter" : "");
    if(animate) card.style.animationDelay = (ci * 90) + "ms";
    const head = document.createElement("div");
    head.className = "text-center text-xs font-bold uppercase tracking-[.2em] text-sky-200 mb-2.5";
    head.textContent = c.cat;
    const row = document.createElement("div");
    row.className = "grid grid-cols-5 gap-1.5";
    for(let ki=0; ki<5; ki++){ row.appendChild(tileButton(ci, ki, true)); }
    card.appendChild(head); card.appendChild(row);
    mob.appendChild(card);
  });
}
function updateHud(){
  const s = $("#hud-score");
  s.textContent = fmtMoney(state.score);
  s.className = "font-display text-lg md:text-2xl leading-none " + (state.score < 0 ? "text-red-400" : "text-amber-300");
  $("#hud-streak").textContent = "×" + state.streak;
  $("#hud-left").textContent = TOTAL_CLUES - state.answered.size;
}

/* ============================================================================
   CLUE FLOW — open modal, optional Daily Double splash, timer, answering
   ============================================================================ */
function openClue(ci, ki){
  if(state.locked) return;
  const key = ci + "-" + ki;
  if(state.answered.has(key)) return;
  sfx("click");

  const cl = GAME_DATA[ci].clues[ki];
  const isDD = state.dd === key;
  state.current = { ci, ki, key, cl, isDD, value: isDD ? cl.v * 2 : cl.v, opts: shuffle([{t:cl.a, ok:true}].concat(cl.d.map(t => ({t:t, ok:false})))) };

  // Fill card
  $("#clue-cat").textContent = GAME_DATA[ci].cat;
  $("#clue-val").textContent = (isDD ? "DD " : "") + fmtMoney(state.current.value);
  $("#clue-text").textContent = cl.q;
  $("#feedback").classList.add("hidden");

  const grid = $("#opt-grid");
  grid.innerHTML = "";
  state.current.opts.forEach((o, idx) => {
    const btn = document.createElement("button");
    btn.className = "opt-btn rounded-xl px-4 py-3.5 text-left flex items-center gap-3";
    btn.innerHTML = '<span class="opt-letter font-display w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-lg">' + LETTERS[idx] + '</span>' +
                    '<span class="text-sm md:text-base font-medium text-slate-100">' + o.t + '</span>';
    btn.addEventListener("click", () => answer(idx));
    grid.appendChild(btn);
  });

  // Show modal; Daily Double plays its splash first
  const modal = $("#clue-modal"), card = $("#clue-card"), dd = $("#dd-splash");
  modal.classList.remove("hidden");
  if(isDD){
    sfx("dd");
    dd.classList.remove("hidden"); dd.classList.add("flex");
    card.classList.add("hidden");
    setTimeout(() => {
      dd.classList.add("hidden"); dd.classList.remove("flex");
      revealCard();
    }, 2100);
  } else {
    revealCard();
  }
}
function revealCard(){
  sfx("reveal");
  const card = $("#clue-card");
  card.classList.remove("hidden");
  card.classList.remove("card-in");
  void card.offsetWidth;           // restart CSS animation
  card.classList.add("card-in");
  startTimer();
}

/* ===== TIMER ===== */
function startTimer(){
  clearInterval(state.timer);
  state.timeLeft = CLUE_SECONDS;
  paintTimer();
  state.timer = setInterval(() => {
    state.timeLeft -= 0.1;
    paintTimer();
    if(state.timeLeft <= 0){ clearInterval(state.timer); onTimeout(); }
  }, 100);
}
function paintTimer(){
  const pct = Math.max(state.timeLeft / CLUE_SECONDS * 100, 0);
  const bar = $("#timer-bar");
  bar.style.width = pct + "%";
  bar.classList.toggle("danger", state.timeLeft <= 5);
  $("#timer-num").textContent = Math.max(Math.ceil(state.timeLeft), 0);
  $("#timer-num").className = "font-display text-xl w-8 text-right " + (state.timeLeft <= 5 ? "text-red-400" : "text-amber-300");
}

/* ===== ANSWER HANDLING ===== */
function lockOptions(){
  document.querySelectorAll("#opt-grid .opt-btn").forEach((b, i) => {
    b.disabled = true;
    if(state.current.opts[i].ok) b.classList.add("opt-correct");
  });
}
function answer(idx){
  if(state.locked || !state.current) return;
  state.locked = true;
  clearInterval(state.timer);

  const cur = state.current;
  const picked = cur.opts[idx];
  const btns = document.querySelectorAll("#opt-grid .opt-btn");
  lockOptions();

  if(picked.ok){
    state.score += cur.value;
    state.streak++; state.best = Math.max(state.best, state.streak);
    state.correct++;
    state.results[cur.key] = true;
    sfx("correct");
    burst(innerWidth/2, innerHeight/2, 90);
    showFeedback("CORRECT  +" + fmtMoney(cur.value), "text-emerald-400", null);
  } else {
    btns[idx].classList.add("opt-wrong");
    state.score -= cur.value;
    state.streak = 0;
    state.wrong++;
    state.results[cur.key] = false;
    sfx("wrong");
    showFeedback("INCORRECT  " + fmtMoney(-cur.value), "text-red-400", cur.cl.a);
  }
  state.answered.add(cur.key);
  updateHud();
}
function onTimeout(){
  if(state.locked || !state.current) return;
  state.locked = true;
  const cur = state.current;
  lockOptions();
  state.score -= cur.value;
  state.streak = 0;
  state.wrong++;
  state.results[cur.key] = false;
  sfx("timeout");
  showFeedback("TIME\u2019S UP  " + fmtMoney(-cur.value), "text-red-400", cur.cl.a);
  state.answered.add(cur.key);
  updateHud();
}
function showFeedback(text, colorClass, correctAnswer){
  const fb = $("#feedback");
  fb.classList.remove("hidden");
  const ft = $("#feedback-text");
  ft.textContent = text;
  ft.className = "feed-pop font-display text-3xl md:text-5xl tracking-wide " + colorClass;
  ft.classList.remove("feed-pop"); void ft.offsetWidth; ft.classList.add("feed-pop");
  $("#feedback-answer").innerHTML = correctAnswer
    ? 'The correct answer was <span class="text-emerald-400 font-semibold">' + correctAnswer + '</span>'
    : "";
  $("#continue-btn").focus();
}
function closeClue(){
  $("#clue-modal").classList.add("hidden");
  $("#clue-card").classList.add("hidden");
  $("#dd-splash").classList.add("hidden"); $("#dd-splash").classList.remove("flex");
  state.current = null;
  state.locked = false;
  renderBoard(false);
  if(state.answered.size >= TOTAL_CLUES){
    setTimeout(showResults, 700);
  }
}

/* ============================================================================
   RESULTS — rank tiers based on final score
   ============================================================================ */
function rankFor(s){
  if(s < 0)     return { t:"SCRIPT KIDDIE", d:"The agents are not angry — just disappointed. Hit the docs, rebuild a flow or two, and run it back." };
  if(s < 5000)  return { t:"PLATFORM APPRENTICE", d:"You know your way around agents and widgets. A few more deep-dives into channels and voices and Pro status awaits." };
  if(s < 10000) return { t:"CERTIFIED PRO USER", d:"Impressive. You configure channels, voices, widgets, and flows like a seasoned platform operator." };
  if(s < 15000) return { t:"WHITE LABEL OWNER", d:"Elite-tier knowledge. Clients pay for a brain like yours — the platform keeps almost no secrets from you." };
  return { t:"PAYMEGPT GRAND MASTER", d:"Total command of the entire Macknified AI stack. You do not just use the platform — you ARE the platform." };
}
function showResults(){
  const r = rankFor(state.score);
  $("#rank-title").textContent = r.t;
  const fs = $("#final-score");
  fs.textContent = fmtMoney(state.score);
  fs.className = "font-display text-4xl md:text-6xl mt-3 " + (state.score < 0 ? "text-red-400" : "text-sky-200");
  $("#rank-blurb").textContent = r.d;
  $("#stat-correct").textContent = state.correct;
  $("#stat-wrong").textContent = state.wrong;
  $("#stat-streak").textContent = "×" + state.best;
  const answered = state.correct + state.wrong;
  $("#stat-acc").textContent = (answered ? Math.round(state.correct / answered * 100) : 0) + "%";
  showScreen("results-screen");
  sfx("end");
  if(state.score > 0){
    burst(innerWidth*.25, innerHeight*.3, 90);
    setTimeout(() => burst(innerWidth*.75, innerHeight*.3, 90), 350);
    setTimeout(() => burst(innerWidth*.5, innerHeight*.2, 110), 700);
  }
}

/* ============================================================================
   GAME LIFECYCLE + EVENT WIRING
   ============================================================================ */
function startGame(){
  initAudio();
  resetState();
  renderBoard(true);
  updateHud();
  showScreen("board-screen");
  sfx("reveal");
}
document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("again-btn").addEventListener("click", startGame);
document.getElementById("restart-btn").addEventListener("click", () => { sfx("click"); startGame(); });
document.getElementById("continue-btn").addEventListener("click", closeClue);

// Sound toggle
document.getElementById("mute-btn").addEventListener("click", () => {
  state.muted = !state.muted;
  $("#icon-sound-on").classList.toggle("hidden", state.muted);
  $("#icon-sound-off").classList.toggle("hidden", !state.muted);
  if(!state.muted) sfx("click");
});

// Keyboard: 1-4 / A-D to answer, Enter or Space to continue
document.addEventListener("keydown", e => {
  if($("#clue-modal").classList.contains("hidden")) return;
  if(!state.locked){
    const k = e.key.toLowerCase();
    let idx = -1;
    if(["1","2","3","4"].includes(k)) idx = parseInt(k,10) - 1;
    if(["a","b","c","d"].includes(k)) idx = "abcd".indexOf(k);
    if(idx >= 0) answer(idx);
  } else if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    closeClue();
  }
});

// Mouse parallax: tilt the 3D board + drift particles
window.addEventListener("mousemove", e => {
  mx = e.clientX / innerWidth; my = e.clientY / innerHeight;
  if(!$("#board-screen").classList.contains("hidden")){
    const ry = (mx - .5) * 7;
    const rx = 5 - (my - .5) * 6;
    document.documentElement.style.setProperty("--rx", rx.toFixed(2) + "deg");
    document.documentElement.style.setProperty("--ry", ry.toFixed(2) + "deg");
  }
});

/* ===== BOOT ===== */
resetState();
sizeCanvases();
initParts();
drawParts();
window.addEventListener("resize", sizeCanvases);