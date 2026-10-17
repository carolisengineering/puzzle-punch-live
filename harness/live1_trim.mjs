/* LIVE 1 — THE TRIM. One level (THE LIVING DEPTHS), no hub: START on the setup screen
   descends straight into the mine; the end screen goes back to the setup screen.
   Run from the repo root:  node harness/live1_trim.mjs
   Every replacement must match exactly once or the script stops and writes nothing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FILE = 'PUZZLE PUNCH.html';
const FROM_MD5 = '1d92687c059027873245bf05538305fc';   // v0.86c, as copied from Puzzle-Punch @ 3634482
/* Earlier sources this same trim ran against, unchanged: v0.85m md5 77e86a3e01f4a1ea4c738cc63da54707
   (Puzzle-Punch @ 93fc3cd), the first LIVE 1 cut; v0.85o md5 c8beff8206ae9b044c7be17598178fc0
   (Puzzle-Punch @ 70e129f); v0.85q md5 076d5af2467aa1f483213866f57e2b90 (Puzzle-Punch @ c155c19); v0.85v md5 d1b289e6296193a82137870aaf530314 (Puzzle-Punch @ 445facc). v0.86a md5 ee849232ef0dddb832cf802e9c760cae (Puzzle-Punch @ a09adab). Point FROM_MD5 at the version in hand. */
let s = readFileSync(FILE, 'utf8');
const md5 = t => createHash('md5').update(t, 'utf8').digest('hex');
if(md5(s) !== FROM_MD5) throw new Error(`md5 is ${md5(s)}, expected ${FROM_MD5} (v0.86c). Not patching.`);

const once = (from, to, label) => {
  const i = s.indexOf(from);
  if(i < 0) throw new Error(`${label}: not found`);
  if(s.indexOf(from, i + 1) >= 0) throw new Error(`${label}: found more than once`);
  s = s.slice(0, i) + to + s.slice(i + from.length);
};
const cut = (startMark, endMark, label) => {
  const a = s.indexOf(startMark); if(a < 0) throw new Error(`${label}: start not found`);
  const b = s.indexOf(endMark, a); if(b < 0) throw new Error(`${label}: end not found`);
  s = s.slice(0, a) + s.slice(b);
};

/* §1 the level list: the depths alone. The castle to the manor are cut from LEVELS; their per-level
   code stays in the file for now (dead, unreachable) and can be pruned in a later pass. */
cut("  { id: 'castle', name: 'THE CASTLE', doorLabel: 'LEVEL 2 · THE CASTLE',",
    "];\n/* v0.36 — LEVELS NOT BUILT YET,", '§1 LEVELS');
once("    shapes: null },   // null = the full SHAPES pool\n",
     "    shapes: null }    // null = the full SHAPES pool\n  /* LIVE 1: the castle, the forest, the desert, the glacier, the rainbow road and the manor live in the big repo (Puzzle-Punch). This cut is the depths alone. */\n",
     '§1 depths entry');
once("  { id: 'sweets',   doorLabel: 'LEVEL 7 · THE DESSERT',  accent: '#ff9ec4', note: 'he was not joking' }\n",
     "  /* LIVE 1: no sealed doors; there is no hub to show them in */\n", '§1 COMING');

/* §2 the descent without the hub: the same path the dev menu's computer runs take (startRun, then the
   depths' walk out of the mouth), with the human seats as they are. */
once("function startHub(){\n",
     "/* LIVE 1 — no antechamber. START descends into the one level, the way the dev menu's runs do (startRun, then the walk out of the mouth). */\nfunction liveDescend(){\n  startRun(0);\n  if(LVL.id === 'depths') walkStart84d(0);\n}\nfunction startHub(){\n",
     '§2 liveDescend');
once("{ startPrev = true; startHub(); requestAnimationFrame(frame); return; }",
     "{ startPrev = true; liveDescend(); requestAnimationFrame(frame); return; }   /* LIVE 1 */", '§2 setup confirm');
once("    if(P1IN.src && P2IN.src && stSel && !startPrev) startHub();   // v0.26: START enters the antechamber; the doors start the runs",
     "    if(P1IN.src && P2IN.src && stSel && !startPrev) liveDescend();   // v0.26: START enters the antechamber; the doors start the runs · LIVE 1: START descends", '§2 setup START');

/* §3 the end screen: START goes back to the setup screen (the menu), hub or no hub. */
once("      if(P1IN.src && P2IN.src && !G.bot) startHub();\n      else { G.state = 'setup'; G.t = 0; G.paused = false; G.phaseT = 0; }",
     "      /* LIVE 1: no hub to go back to; the setup screen is the menu */\n      G.state = 'setup'; G.t = 0; G.paused = false; G.phaseT = 0;", '§3 end screen');

writeFileSync(FILE, s);
console.log('patched', FILE, 'md5', md5(s));
