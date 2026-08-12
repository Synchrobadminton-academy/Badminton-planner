// Smoke test for planner.html — runs a headless browser against a mocked
// Firebase and asserts the core flows: boot + auth gate, tab layout, receipt
// import with court merging, booking payment records, calendar chips, per-court
// receipt buttons, and programme roster seeding.
//
// Run locally:  node tests/smoke.js
// (set PW_CHROMIUM to a chromium binary to skip Playwright's download)
const { chromium } = require('playwright');
const path = require('path');

// Test dates are computed relative to today so the suite never goes stale:
// the import self-heal logic only watches today-or-future entries.
const base = new Date();
base.setDate(base.getDate() + 11);
const D = base.toISOString().slice(0, 10);
const PAY = new Date().toISOString().slice(0, 10);

const db = {
  coaches: [{ id: 1, name: 'James', role: 'main', color: '#10b981' }],
  venues: [], standards: [], 'class-types': [], 'combo-colors': {}, booker_coach_map: {},
  sessions: [], instances: [],
  bot_sessions: {
    // two receipts, same venue/date/time, different courts — must merge to one block
    '-C1': { date: D, start_time: '16:00', end_time: '18:00', venue_text: 'Bishan Sport Hall', court_no: '01', class_type: 'ActiveSG', booker: 'Twu Eng', payment_date: PAY, venue_type: 'sports_hall', slots: 2 },
    '-C2': { date: D, start_time: '16:00', end_time: '18:00', venue_text: 'Bishan Sport Hall', court_no: '04', class_type: 'ActiveSG', booker: 'Derrick', payment_date: PAY, venue_type: 'sports_hall', slots: 2 },
    // different time — must NOT merge
    '-C3': { date: D, start_time: '14:00', end_time: '15:00', venue_text: 'Bishan Sport Hall', court_no: '02', class_type: 'ActiveSG', booker: 'jin', payment_date: PAY, venue_type: 'sports_hall', slots: 1 },
    // programme receipt — must seed an attendance roster
    '-P1': { date: D, start_time: '10:00', end_time: '11:00', venue_text: 'Yio Chu Kang Primary School', class_type: 'Academy', students: ['Alice Tan', 'Ben Lim'] },
  },
  bookings: {}, attendance: {},
  booking_images: {
    '-C1': { data: 'aGVsbG8x', mime_type: 'image/jpeg' },
    '-C2': { data: 'aGVsbG8y', mime_type: 'image/jpeg' },
  },
};

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures++; console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`); }
}

// Every write is recorded so tests can assert PATCH vs PUT behaviour
const writes = [];

// Mock Firebase Auth endpoints and the Realtime Database REST interface
async function mockFirebase(page) {
  await page.route(/googleapis\.com/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(/firebasedatabase\.app/, async route => {
    const req = route.request();
    const parts = new URL(req.url()).pathname.replace(/\.json$/, '').replace(/^\//, '').split('/');
    const method = req.method();
    if (method === 'GET') {
      let node = db;
      for (const p of parts) node = (node && node[p] !== undefined) ? node[p] : null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(node ?? null) });
    }
    const body = req.postData();
    if (method !== 'GET') writes.push({ method, path: parts.join('/'), body });
    if (method === 'PATCH') {
      // Real RTDB semantics: merge keys at the path; null deletes a key
      let node = db;
      for (let i = 0; i < parts.length - 1; i++) { if (node[parts[i]] === undefined) node[parts[i]] = {}; node = node[parts[i]]; }
      const last = parts[parts.length - 1];
      if (node[last] === undefined || node[last] === null || Array.isArray(node[last])) node[last] = {};
      const obj = JSON.parse(body);
      for (const k in obj) { if (obj[k] === null) delete node[last][k]; else node[last][k] = obj[k]; }
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    if (method === 'PUT') {
      let node = db;
      for (let i = 0; i < parts.length - 1; i++) { if (node[parts[i]] === undefined) node[parts[i]] = {}; node = node[parts[i]]; }
      node[parts[parts.length - 1]] = JSON.parse(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    if (method === 'POST') {
      const key = '-GEN' + Math.random().toString(36).slice(2, 8);
      let node = db;
      for (const p of parts) { if (node[p] === undefined) node[p] = {}; node = node[p]; }
      node[key] = JSON.parse(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: key }) });
    }
    return route.fulfill({ status: 200, body: 'null' });
  });
}

(async () => {
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  );
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockFirebase(page);

  await page.goto('file://' + path.resolve(__dirname, '..', 'planner.html'));
  await page.waitForTimeout(4500); // boot + first import cycle

  // ── Boot & auth gate ─────────────────────────────────────────
  check('auth gate shown with sign-in wording',
    await page.evaluate(() => document.getElementById('pw-sub').textContent), 'Sign in to continue');
  check('legacy shared password removed',
    await page.evaluate(() => typeof PW === 'undefined'), true);
  await page.evaluate(() => { document.getElementById('pw-gate').style.display = 'none'; });

  check('sidebar tabs',
    await page.evaluate(() => Array.from(document.querySelectorAll('.tab-item')).map(t => t.dataset.view)),
    ['dashboard', 'schedule', 'tracker', 'coaches', 'bookings', 'receipts']);

  // ── Court import + merge ─────────────────────────────────────
  const insts = await page.evaluate(() => S.get('instances').map(i =>
    `${i.date} ${i.start_time}-${i.end_time} ${i.venue_text} | ${i.court_no || ''}`).sort());
  check('instances: merged block + separate slot + programme class', insts, [
    `${D} 10:00-11:00 Yio Chu Kang Primary School | `,
    `${D} 14:00-15:00 Bishan Sport Hall | 02`,
    `${D} 16:00-18:00 Bishan Sport Hall | 01 & 04`,
  ]);
  check('one payment record per receipt',
    Object.values(db.bookings).map(b => `${b.booker}:${b.court}`).sort(),
    ['Derrick:04', 'Twu Eng:01', 'jin:02']);
  check('all bot entries flagged imported',
    Object.values(db.bot_sessions).every(v => v.imported === true), true);

  // ── Programme roster seeding ─────────────────────────────────
  const roster = Object.values(db.attendance)[0] || [];
  check('programme receipt seeds attendance roster',
    roster.map(a => a.name).sort(), ['Alice Tan', 'Ben Lim']);

  // ── Calendar chips ───────────────────────────────────────────
  await page.evaluate(([y, m]) => { calDate = new Date(y, m, 1); showView('schedule'); },
    [base.getFullYear(), base.getMonth()]);
  await page.waitForTimeout(700);
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cal-chip')).map(c => c.innerText.replace(/\n/g, ' | ')));
  check('merged chip shows combined courts + no-coach warning',
    chips.some(c => c.includes('Court: 01 & 04') && c.includes('⚠️')), true);
  check('chips render venue before time',
    chips.every(c => !c.includes('Court:') || c.indexOf('Bishan') < c.indexOf('Time:')), true);

  // ── Per-court receipt buttons ────────────────────────────────
  const mergedId = await page.evaluate(() => S.get('instances').find(i => (i.court_no || '').includes('&'))?.id);
  await page.evaluate(id => openEdit(id), mergedId);
  await page.waitForTimeout(800);
  check('merged block offers one View Receipt button per court',
    await page.evaluate(() => Array.from(document.querySelectorAll('#m-receipt-btns button')).map(b => b.textContent.trim())),
    ['📷 View Receipt — Court 01', '📷 View Receipt — Court 04']);
  await page.evaluate(() => document.querySelectorAll('#m-receipt-btns button')[1].click());
  await page.waitForTimeout(600);
  check('clicking a button opens exactly one full-size image',
    await page.evaluate(() => document.querySelectorAll('#img-modal-body img').length), 1);

  // ── Per-record storage ───────────────────────────────────────
  check('sessions + instances stored one record per "r<id>" key',
    !Array.isArray(db.sessions) && !Array.isArray(db.instances) &&
    Object.keys(db.sessions).every(k => k[0] === 'r') &&
    Object.keys(db.instances).every(k => k[0] === 'r'), true);

  writes.length = 0;
  const sessCountBefore = Object.values(db.sessions).filter(Boolean).length;
  await page.evaluate(() => {
    const l = S.get('sessions');
    l[0].notes = 'edited-by-test';
    S.set('sessions', l);
  });
  await page.waitForTimeout(400);
  const sessWrites = writes.filter(w => w.path === 'sessions');
  check('editing one lesson sends a PATCH touching only that record',
    { method: sessWrites[0]?.method, keys: Object.keys(JSON.parse(sessWrites[0]?.body || '{}')).length },
    { method: 'PATCH', keys: 1 });
  check('other records untouched after the edit',
    { count: Object.values(db.sessions).filter(Boolean).length,
      edited: Object.values(db.sessions).some(s => s && s.notes === 'edited-by-test') },
    { count: sessCountBefore, edited: true });

  check('bulk delete from a broken client is blocked',
    await page.evaluate(async () => {
      const snap = {}; for (let i = 1; i <= 10; i++) snap[i] = JSON.stringify({ id: i });
      fbServer['instances'] = snap; fbShape['instances'] = 'keyed';
      return await pushRecords('instances', [{ id: 1 }]); // would delete 9 of 10
    }), false);
  check('saving before data has loaded is refused',
    await page.evaluate(async () => {
      delete fbServer['instances'];
      return await pushRecords('instances', [{ id: 99, date: '2030-01-01' }]);
    }), false);

  check('no page errors', errors, []);

  // ── Mobile: bottom tab bar replaces the hamburger sidebar ────
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mobErrors = [];
  mob.on('pageerror', e => mobErrors.push(e.message));
  await mockFirebase(mob);
  await mob.goto('file://' + path.resolve(__dirname, '..', 'planner.html'));
  await mob.waitForTimeout(2500);
  await mob.evaluate(() => { document.getElementById('pw-gate').style.display = 'none'; });
  check('mobile shows bottom tab bar, hides sidebar + hamburger',
    await mob.evaluate(() => ({
      nav: getComputedStyle(document.getElementById('bottom-nav')).display,
      sidebar: getComputedStyle(document.getElementById('sidebar')).display,
      ham: getComputedStyle(document.querySelector('.ham-btn')).display,
      tabs: document.querySelectorAll('#bottom-nav .bn-item').length,
    })), { nav: 'flex', sidebar: 'none', ham: 'none', tabs: 6 });
  await mob.tap('#bottom-nav .bn-item[data-view="schedule"]');
  await mob.waitForTimeout(400);
  check('tapping a bottom tab switches view and highlights it',
    await mob.evaluate(() => ({
      view: document.querySelector('.view.active')?.id,
      active: document.querySelector('#bottom-nav .bn-item.active')?.dataset.view,
    })), { view: 'view-schedule', active: 'schedule' });
  check('no page errors on mobile', mobErrors, []);

  await browser.close();

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
