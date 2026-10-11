import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, serverTimestamp, Bytes, Timestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-puzzle-punch',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const STAMP = '2026-10-10 120000';
const idOf = uid => `${uid}_2026-10-10-120000`;
const dbAs = uid => env.authenticatedContext(uid).firestore();
const startDoc = uid => ({
  uid, stamp: STAMP, game: 'PUZZLE PUNCH v0.85q', level: 'depths', result: 'in-progress',
  endReason: null, durationSec: 0, score: 0, kind: 'start',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
});
const logUpdate = (uid, n, kind = 'full') => ({
  uid, kind, log: Bytes.fromUint8Array(new Uint8Array(n)), rawBytes: n * 10, updatedAt: serverTimestamp(),
});
async function seed() {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'runs', idOf('alice')), { uid: 'alice', kind: 'start' }));
}

test('a player can create their own run', async () => {
  await assertSucceeds(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), startDoc('alice')));
});

test('a player can update their own run with a gzipped log', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertSucceeds(setDoc(ref, logUpdate('alice', 1000), { merge: true }));
});

test('a log just under the limit is accepted', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertSucceeds(setDoc(ref, logUpdate('alice', 949999), { merge: true }));
});

test('a log at the limit is rejected', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertFails(setDoc(ref, logUpdate('alice', 950000), { merge: true }));
});

test('a log that is not bytes is rejected', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await assertFails(setDoc(ref, { ...startDoc('alice'), kind: 'full', log: 'H4sI...', rawBytes: 10 }));
});

test("a player cannot write another player's document id", async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('bob')), startDoc('alice')));
});

test('the uid field must match the signed-in player', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), startDoc('bob')));
});

test('signed-out writes are rejected', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'runs', idOf('alice')), startDoc('alice')));
});

test('an extra field is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), { ...startDoc('alice'), ip: '1.2.3.4' }));
});

test('an unknown kind is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), { ...startDoc('alice'), kind: 'huge' }));
});

test('a client-chosen updatedAt is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')),
    { ...startDoc('alice'), updatedAt: Timestamp.fromMillis(0) }));
});

test('reads are denied, even of your own run', async () => {
  await seed();
  await assertFails(getDoc(doc(dbAs('alice'), 'runs', idOf('alice'))));
  await assertFails(getDocs(collection(dbAs('alice'), 'runs')));
});

test('deletes are denied, even of your own run', async () => {
  await seed();
  await assertFails(deleteDoc(doc(dbAs('alice'), 'runs', idOf('alice'))));
});

test('other collections are denied', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'other', 'x'), { a: 1 }));
});

/* Tightened shape: junk must not be able to fill storage or wedge the export. */
const put = (uid, data, id = idOf(uid)) => setDoc(doc(dbAs(uid), 'runs', id), data);

test('a stamp over 64 characters is rejected', async () => {
  const stamp = 'x'.repeat(65);
  await assertFails(put('alice', { ...startDoc('alice'), stamp }, `alice_${stamp}`));
});

test('the document id must match the stamp', async () => {
  await assertFails(put('alice', startDoc('alice'), 'alice_some-other-run'));
});

test('an endReason over 200 characters is rejected', async () => {
  await assertFails(put('alice', { ...startDoc('alice'), endReason: 'x'.repeat(201) }));
});

test('a score that is not a number is rejected', async () => {
  await assertFails(put('alice', { ...startDoc('alice'), score: 'lots' }));
});

test('a full run without a log is rejected', async () => {
  await assertFails(put('alice', { ...startDoc('alice'), kind: 'full' }));
});

test('a start document with a log is rejected', async () => {
  await assertFails(put('alice', { ...startDoc('alice'), log: Bytes.fromUint8Array(new Uint8Array(10)), rawBytes: 10 }));
});

test('rawBytes must be a whole number', async () => {
  await assertFails(put('alice', { ...startDoc('alice'), kind: 'full', log: Bytes.fromUint8Array(new Uint8Array(10)), rawBytes: 'ten' }));
});
