/* Rennstall – gemeinsamer Speicher für Rundenzähler, Bahnplaner und Rennstall-Seite.
 * Mit FIREBASE_CONFIG: Daten liegen online (Firebase Firestore) und alle im Rennstall sehen dasselbe.
 * Ohne FIREBASE_CONFIG: Demo-Modus, alles bleibt nur auf diesem Gerät.
 */
(function(){
'use strict';

// ▼▼▼ Hier kommen deine Firebase-Daten rein (aus der Firebase-Konsole kopieren) ▼▼▼
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCLMurqVg-1jZ_lT2giPHK35NrNEwpb_vM",
  authDomain: "carrera-c2cd7.firebaseapp.com",
  projectId: "carrera-c2cd7",
  storageBucket: "carrera-c2cd7.firebasestorage.app",
  messagingSenderId: "50978267462",
  appId: "1:50978267462:web:70b19fa49d3017a01f0547"
};
// ▲▲▲ ---------------------------------------------------------------------- ▲▲▲

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SKEY = 'go-rennstall-sitzung';
const DKEY = 'go-rennstall-demo';
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ohne 0/O und 1/I, damit man den Code gut abtippen kann
const COLLS = ['drivers','tracks','races'];

function lsGet(k,def){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function newId(n){ let s=''; const a=new Uint32Array(n); crypto.getRandomValues(a); for(const x of a) s+=ABC[x%ABC.length]; return s; }
function cleanCode(c){ return String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function formatCode(id){ return id ? id.match(/.{1,4}/g).join('-') : ''; }
function withTimeout(p,ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('timeout'),{code:'timeout'})),ms))]); }

/* ---------- Demo-Speicher (nur dieses Gerät) ---------- */
const demo = {
  db(){ return lsGet(DKEY,{teams:{}}); },
  put(db){ lsSet(DKEY,db); },
  async getTeam(id){ const t=this.db().teams[id]; return t?{id,...t.info}:null; },
  async createTeam(id,info){ const db=this.db(); db.teams[id]={info,drivers:{},tracks:{},races:{}}; this.put(db); },
  async updateTeam(id,patch){ const db=this.db(); Object.assign(db.teams[id].info,patch); this.put(db); },
  async list(id,coll){ const t=this.db().teams[id]; return t?Object.entries(t[coll]).map(([k,v])=>({id:k,...v})):[]; },
  async set(id,coll,docId,data){ const db=this.db(); db.teams[id][coll][docId]=data; this.put(db); },
  async remove(id,coll,docId){ const db=this.db(); delete db.teams[id][coll][docId]; this.put(db); },
};

/* ---------- Firebase ---------- */
let fbP=null;
function fb(){
  if(!fbP) fbP=(async()=>{
    const appM=await import(SDK+'firebase-app.js');
    const fs=await import(SDK+'firebase-firestore.js');
    const app=appM.initializeApp(FIREBASE_CONFIG);
    let db;
    try{ db=fs.initializeFirestore(app,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})}); }
    catch(e){ db=fs.getFirestore(app); }
    return {fs,db};
  })();
  return fbP;
}
const online = {
  async getTeam(id){ const {fs,db}=await fb(); const s=await fs.getDoc(fs.doc(db,'teams',id)); return s.exists()?{id,...s.data()}:null; },
  async createTeam(id,info){ const {fs,db}=await fb(); await fs.setDoc(fs.doc(db,'teams',id),info); },
  async updateTeam(id,patch){ const {fs,db}=await fb(); await fs.setDoc(fs.doc(db,'teams',id),patch,{merge:true}); },
  async list(id,coll){ const {fs,db}=await fb(); const q=await fs.getDocs(fs.collection(db,'teams',id,coll)); return q.docs.map(d=>({id:d.id,...d.data()})); },
  async set(id,coll,docId,data){ const {fs,db}=await fb(); await fs.setDoc(fs.doc(db,'teams',id,coll,docId),data); },
  async remove(id,coll,docId){ const {fs,db}=await fb(); await fs.deleteDoc(fs.doc(db,'teams',id,coll,docId)); },
};
const B = FIREBASE_CONFIG ? online : demo;

/* ---------- öffentliche Schnittstelle ---------- */
function session(){ const s=lsGet(SKEY,null); return s&&s.teamId?s:null; }
function need(){ const s=session(); if(!s) throw new Error('Kein Rennstall verbunden'); return s; }

window.Rennstall = {
  demo: !FIREBASE_CONFIG,
  formatCode, cleanCode,
  session,
  setMe(driverId){ const s=need(); s.me=driverId||null; lsSet(SKEY,s); },
  leave(){ try{ localStorage.removeItem(SKEY); }catch(e){} },
  async createTeam(name){
    const id=newId(12);
    await withTimeout(B.createTeam(id,{name:String(name).slice(0,40),created:Date.now(),currentTrackId:null}),15000);
    lsSet(SKEY,{teamId:id,teamName:name,me:null}); return id;
  },
  async joinTeam(code){
    const id=cleanCode(code); if(id.length!==12) throw Object.assign(new Error('Der Code hat 12 Zeichen.'),{code:'format'});
    const t=await withTimeout(B.getTeam(id),15000);
    if(!t) throw Object.assign(new Error('Zu diesem Code gibt es keinen Rennstall.'),{code:'notfound'});
    lsSet(SKEY,{teamId:id,teamName:t.name,me:null}); return t;
  },
  async getTeam(){ const s=need(); const t=await B.getTeam(s.teamId); if(t&&t.name!==s.teamName){ s.teamName=t.name; lsSet(SKEY,s); } return t; },
  async updateTeam(patch){ const s=need(); return B.updateTeam(s.teamId,patch); },
  async list(coll){ if(!COLLS.includes(coll)) throw new Error(coll); const s=need(); return B.list(s.teamId,coll); },
  /** speichert ein Dokument; wartet höchstens `waitMs` auf den Server (offline wird später hochgeladen) */
  async add(coll,data,waitMs=6000){
    if(!COLLS.includes(coll)) throw new Error(coll); const s=need(); const id=newId(16);
    const p=B.set(s.teamId,coll,id,data);
    try{ await withTimeout(p,waitMs); return {id,synced:true}; }
    catch(e){ if(e.code==='timeout'){ p.catch(()=>{}); return {id,synced:false}; } throw e; }
  },
  async set(coll,id,data){ const s=need(); return B.set(s.teamId,coll,id,data); },
  async remove(coll,id){ const s=need(); return B.remove(s.teamId,coll,id); },
};
})();
