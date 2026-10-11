/* Cloud telemetry for the public Firebase build: GA run events, and each run's log,
   gzipped, in Firestore (runs/{uid}_{stamp}). scripts/deploy.sh adds this module to public/index.html;
   the game file knows nothing about it, and nothing here may throw into the game.
   Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, serverTimestamp, Bytes } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { gameHooks, docId, createRecorder } from './telemetry-core.js';

const warn = (...a) => console.warn('[cloud-telemetry]', ...a);
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
/* The game's state lives in its own closure; window.DELVE is what it exposes. */
const hooks = () => gameHooks(() => {
  const D = window.DELVE;
  return { G: D.G, telem: D.debug.telem, full: D.telemetryJSON, slim: D.debug.telemetrySlimJSON };
});

/* scripts/deploy.sh stamps the game's version on this module's tag (the game keeps it in its closure). */
const GAME_VERSION = document.querySelector('script[data-game-version]')?.dataset.gameVersion;

/* GA: the Google tag that scripts/deploy.sh puts in <head> loads gtag.js and sends page_view; run
   events go through it too, so GA is set up in one place and a page load counts once. On localhost
   the events go to the console instead. */
function gaEvent(name, params) {
  const p = GAME_VERSION ? { game_version: GAME_VERSION, ...params } : params;
  if (LOCAL) console.debug('[cloud-telemetry] GA', name, p);
  else if (typeof window.gtag === 'function') window.gtag('event', name, p);
}

/* Firestore: anonymous sign-in, then save(stamp, fields, create). On localhost, the emulators. */
function setupStore(app) {
  const auth = getAuth(app), db = getFirestore(app);
  if (LOCAL) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
  const uid = signInAnonymously(auth).then(c => c.user.uid);
  uid.catch(e => warn('sign-in failed; runs will not be saved', e));
  return async (stamp, fields, create) => {
    const id = await uid;
    const data = { uid: id, stamp, ...fields, updatedAt: serverTimestamp() };
    if (fields.log) data.log = Bytes.fromUint8Array(fields.log);
    if (create) data.createdAt = serverTimestamp();
    await setDoc(doc(db, 'runs', docId(id, stamp)), data, { merge: !create });
  };
}

function start() {
  if (!hooks()) { warn('game globals not found; telemetry off'); return; }
  const app = initializeApp(firebaseConfig);
  const rec = createRecorder({
    hooks, warn,
    save: setupStore(app),
    event: (name, params) => { try { gaEvent(name, params); } catch (e) { warn('GA', e); } },
  });
  setInterval(rec.tick, 1000);
  /* A phone player who switches away mid-run: save what there is so far (at most every 5 minutes). */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rec.hidden(); });
}

try { start(); } catch (e) { warn('start failed', e); }
