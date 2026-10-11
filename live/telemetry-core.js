/* Pure helpers for the cloud telemetry module (live/cloud-telemetry.js). No Firebase imports, so the
   browser module, the export script and the Node tests all share them.
   Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md */

export const RUN_STATES = new Set(['escort', 'hold', 'greed', 'escape', 'end']);   // the game's inRunState()
export const SLIM_THRESHOLD = 900000;   // gzipped bytes; at or over this the slim log goes instead
export const PARTIAL_GAP_MS = 300000;   // at most one hidden-tab save per run every 5 minutes

/* The game keeps its state inside its own closure; what it exposes is window.DELVE. The caller passes
   a probe that reads it ({ G, telem, full, slim }); anything missing or renamed comes back as null. */
export function gameHooks(probe) {
  try {
    const h = probe();
    const ok = h && h.G && typeof h.G === 'object' && typeof h.telem === 'function'
      && typeof h.full === 'function' && typeof h.slim === 'function';
    return ok ? h : null;
  } catch (e) {
    return null;
  }
}

export function snapshotOf(h) {
  return { run: h.telem(), state: h.G.state, skip: !!(h.G.bot || h.G.stage) };   // startRun makes a new log array per run
}

/* Turns one-second snapshots into run start / end events: one start per new run (log array) seen in a
   run state, one end per run when the state reaches 'end'. Bot runs and the studio stage are ignored. */
export function createTracker() {
  let started = null, ended = null, inRun = false;
  return {
    step(s) {
      inRun = !s.skip && RUN_STATES.has(s.state);
      if (!inRun) return [];
      const events = [];
      if (s.run !== started) { started = s.run; events.push({ type: 'start', run: s.run }); }
      if (s.state === 'end' && ended !== s.run) { ended = s.run; events.push({ type: 'end', run: s.run }); }
      return events;
    },
    active() { return inRun && started !== null && started !== ended ? started : null; },
  };
}

export function docId(uid, stamp) {
  return `${uid}_${String(stamp).replace(/[^0-9A-Za-z-]/g, '-')}`;
}

/* RUN_STAMP is not exposed; the log header carries it as `run`. */
export function stampOf(slimText) {
  const run = JSON.parse(slimText).run;
  return typeof run === 'string' && run ? run : 'unstamped';
}

export function headerFields(slimText) {
  const o = JSON.parse(slimText), s = o.summary || {};
  return {
    game: String(o.game ?? ''),
    level: String(o.level ?? ''),
    result: String(o.result ?? ''),
    endReason: o.endReason ?? null,
    durationSec: typeof s.durationSec === 'number' ? s.durationSec : null,
    score: typeof o.score === 'number' ? o.score : null,
  };
}

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* maxBytes bounds the output: a small, hostile log can inflate to gigabytes (a gzip bomb). */
export async function gunzip(bytes, maxBytes = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error(`gzip output over ${maxBytes} bytes`); }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

export async function buildLog(kind, fullText, slimText, threshold = SLIM_THRESHOLD) {
  let text = fullText, log = await gzip(text);
  if (log.length >= threshold) { kind = 'slim'; text = slimText; log = await gzip(text); }
  return { kind, log, rawBytes: new TextEncoder().encode(text).length };
}

/* One write at a time, in order: a hidden-tab save still in flight must never land after the
   end-of-run save and overwrite the full log. A failed job is reported and the queue carries on. */
export function createQueue(onError) {
  let chain = Promise.resolve();
  return job => (chain = chain.then(job).catch(onError));
}

/* The module's behaviour with Firebase and GA injected: tick() once a second, hidden() when the tab
   hides. save(stamp, fields, create) gets fields.log as a Uint8Array; event(name, params) is GA. */
export function createRecorder({ hooks, save, event, warn, now = Date.now }) {
  const tracker = createTracker();
  const lastPartial = new WeakMap();   // run (its log array) -> time of its last hidden-tab save
  let last = Promise.resolve();
  const queue = createQueue(e => warn('save failed', e));
  const enqueue = job => (last = queue(job));
  /* The texts are taken now, not when the job runs: a stalled earlier save must not let this job read
     a later run's state. */
  const saveLog = (kind, full, slim) => enqueue(async () => {
    const { kind: k, log, rawBytes } = await buildLog(kind, full, slim);
    await save(stampOf(slim), { ...headerFields(slim), kind: k, log, rawBytes }, false);
  });
  return {
    tick() {
      try {
        const h = hooks();
        if (!h) return;
        for (const ev of tracker.step(snapshotOf(h))) {
          const slim = h.slim(), head = headerFields(slim);
          if (ev.type === 'start') {
            event('run_start', { level: head.level, game: head.game });
            enqueue(() => save(stampOf(slim), { ...head, kind: 'start' }, true));
          } else {
            event('run_end', { level: head.level, game: head.game, result: head.result,
              end_reason: head.endReason ?? '', duration_sec: head.durationSec ?? 0, score: head.score ?? 0 });
            saveLog('full', h.full(), slim);
          }
        }
      } catch (e) { warn('tick', e); }
    },
    hidden() {
      try {
        const h = hooks(), run = tracker.active();
        if (!h || !run || h.telem() !== run) return;
        const t = now();
        if (t - (lastPartial.get(run) ?? -Infinity) < PARTIAL_GAP_MS) return;
        lastPartial.set(run, t);
        saveLog('partial', h.full(), h.slim());
      } catch (e) { warn('hidden', e); }
    },
    flush: () => last,
  };
}
