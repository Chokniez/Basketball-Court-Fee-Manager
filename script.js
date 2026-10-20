/* =========================================================
   Court Fee Manager
   One game at a time. Everything saves in the browser
   (localStorage), so there is no database.
   ========================================================= */

/* ---------- State ---------- */
const $ = (selector) => document.querySelector(selector);

// S = the saved game. UI = temporary screen state (not saved).
const freshGame = () => ({
  view: 'setup',   // 'setup' or 'game'
  rate: '',        // court fee per hour
  hours: '',
  players: [],     // { id, name }
  advs: {},        // playerId -> amount paid in advance (abono)
  pays: [],        // { id, pid, amt, ts, void }  money collected
  rets: [],        // { id, pid, amt, ts, void }  money returned
});

let S = freshGame();
let UI = { pay: null, ret: null, msg: '', err: '', ask: null };
let pendingAction = null;

try {
  const saved = localStorage.getItem('cfm');
  if (saved) S = Object.assign(freshGame(), JSON.parse(saved));
  S.rets = S.rets.filter((r) => r.pid); // drop entries from an older version
  delete S.adv;
} catch (e) {}

const save = () => {
  try { localStorage.setItem('cfm', JSON.stringify(S)); } catch (e) {}
};

/* ---------- Small helpers ---------- */
const peso = (n) => '₱' + (Math.round(n * 100) / 100).toLocaleString('en-PH');

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const time = (t) =>
  new Date(t).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

const clearMessages = () => { UI.msg = ''; UI.err = ''; };

// Adds up entries that were not cancelled
const sum = (list) => list.filter((x) => !x.void).reduce((t, x) => t + x.amt, 0);

const playerName = (id) => (S.players.find((p) => p.id == id) || { name: 'Someone' }).name;

/* ---------- Money math ---------- */
const totalFee = () => (+S.rate || 0) * (+S.hours || 0);

// Each share is rounded up to the next peso
const shareEach = () => (S.players.length ? Math.ceil(totalFee() / S.players.length) : 0);

const paidBy = (id) => sum(S.pays.filter((p) => p.pid == id));
const advanceTotal = () => Object.values(S.advs).reduce((t, v) => t + (+v || 0), 0);

// Everything the game screen needs, calculated in one place
function calc() {
  const share = shareEach();
  const advance = (id) => +S.advs[id] || 0;
  const stillOwes = (id) => Math.max(0, share - paidBy(id) - advance(id));
  const getsBack = (id) => Math.max(0, advance(id) - share);
  const returnedTo = (id) => sum(S.rets.filter((r) => r.pid == id));

  const advancers = S.players.filter((p) => getsBack(p.id) > 0);
  const collected = S.players.reduce((t, p) => t + paidBy(p.id), 0);
  const toCollect = S.players.reduce((t, p) => t + stillOwes(p.id), 0);
  const returned = sum(S.rets);
  const toReturn = advancers.reduce((t, p) => t + getsBack(p.id) - returnedTo(p.id), 0);

  return {
    share, advance, stillOwes, getsBack, returnedTo,
    advancers, collected, toCollect, returned, toReturn,
    holding: collected - returned,                 // collected but not yet returned
    settled: toCollect <= 0 && toReturn <= 0,
  };
}

/* ---------- Setup screen ---------- */
function setupScreen() {
  const playerList = S.players.length
    ? S.players.map((p) => `
        <div class="line">
          <span>${esc(p.name)}</span>
          <button class="secondary small" onclick="removePlayer('${p.id}')">Remove</button>
        </div>`).join('')
    : '<p class="muted">No players yet. Type a name and tap Add Player.</p>';

  const advanceInputs = S.players.length
    ? S.players.map((p) => `
        <div class="line">
          <span>${esc(p.name)}</span>
          <input style="width:130px;margin:0" type="number" inputmode="decimal" min="0"
                 placeholder="₱0" aria-label="Paid in advance by ${esc(p.name)}"
                 value="${S.advs[p.id] || ''}" oninput="setAdvance('${p.id}', this.value)">
        </div>`).join('')
    : '<p class="muted">Add players first.</p>';

  return `
    <h1>New Game</h1>
    ${UI.err ? `<div class="alert alert-error">${UI.err}</div>` : ''}

    <div class="card">
      <h2>Step 1: Court fee</h2>
      <label>Court fee per hour (₱)
        <input type="number" inputmode="decimal" min="0" value="${S.rate}"
               oninput="S.rate = this.value; save(); updateTotals()">
      </label>
      <label>Hours played
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${S.hours}"
               oninput="S.hours = this.value; save(); updateTotals()">
      </label>
      <p class="big">Court fee: <span id="total-fee">${peso(totalFee())}</span></p>
    </div>

    <div class="card">
      <h2>Step 2: Who joined?</h2>
      <div class="row">
        <label style="flex:1;margin:0">Player name
          <input id="player-name" onkeydown="if (event.key == 'Enter') addPlayer()">
        </label>
        <button onclick="addPlayer()">Add Player</button>
      </div>
      <div style="margin-top:10px">${playerList}</div>
    </div>

    <div class="card">
      <h2>Step 3: Did anyone already pay the court?</h2>
      <p class="muted">That money is called abono, paid in advance. Type how much each person already paid. Leave it blank if they paid nothing.</p>
      ${advanceInputs}
      <p class="muted">Paid in advance so far: <b id="advance-total">${peso(advanceTotal())}</b></p>
    </div>

    <button class="big-btn" onclick="startGame()">See Who Owes What</button>`;
}

// Live updates while typing (no full redraw, so the keyboard stays open)
function updateTotals() {
  const el = $('#total-fee');
  if (el) el.textContent = peso(totalFee());
}

function setAdvance(id, value) {
  S.advs[id] = +value || 0;
  save();
  const el = $('#advance-total');
  if (el) el.textContent = peso(advanceTotal());
}

function addPlayer() {
  const name = $('#player-name').value.trim();
  clearMessages();
  if (!name) {
    UI.err = 'Type a player’s name first.';
    return render();
  }
  if (S.players.some((p) => p.name.toLowerCase() == name.toLowerCase())) {
    UI.err = name + ' is already on the list.';
    return render();
  }
  S.players.push({ id: 'p' + Date.now() + Math.floor(Math.random() * 99), name });
  save();
  render();
  $('#player-name').focus();
}

function removePlayer(id) {
  clearMessages();
  const hasEntries =
    S.pays.some((p) => p.pid == id && !p.void) || S.rets.some((r) => r.pid == id && !r.void);
  if (hasEntries) {
    UI.err = playerName(id) + ' already has payments recorded. Cancel those in the payment history first.';
    return render();
  }
  S.players = S.players.filter((p) => p.id != id);
  delete S.advs[id];
  save();
  render();
}

function startGame() {
  clearMessages();
  if (!(totalFee() > 0)) UI.err = 'Enter the court fee per hour and the hours played.';
  else if (S.players.length < 2) UI.err = 'Add at least 2 players to split the fee.';
  else if (advanceTotal() > totalFee()) UI.err = 'The advance payments add up to more than the court fee. Check the amounts in Step 3.';
  if (UI.err) return render();

  S.view = 'game';
  save();
  render();
  scrollTo(0, 0);
}

/* ---------- Game screen ---------- */
function playerRow(p, c) {
  const left = c.stillOwes(p.id);
  const isPaid = left <= 0;
  const adv = c.advance(p.id);

  const details =
    `Owes ${peso(c.share)}` +
    (adv ? ` · Paid in advance ${peso(adv)}` : '') +
    ` · Paid ${peso(paidBy(p.id))}` +
    (isPaid ? '' : ` · Left ${peso(left)}`);

  const action = isPaid
    ? '<span class="badge badge-ok">Paid</span>'
    : `<button class="small" onclick="openPayment('${p.id}')">Record Payment</button>`;

  const panel = UI.pay == p.id ? `
    <div class="panel">
      <label>Amount ${esc(p.name)} is paying (₱)
        <input id="pay-amount" type="number" inputmode="decimal" value="${left}">
      </label>
      <div class="row">
        <button onclick="confirmPayment('${p.id}')">Confirm Payment</button>
        <button class="secondary" onclick="UI.pay = null; clearMessages(); render()">Cancel</button>
      </div>
    </div>` : '';

  return `
    <div class="line wrap">
      <div><b>${esc(p.name)}</b><div class="muted">${details}</div></div>
      ${action}
    </div>${panel}`;
}

function advanceRow(p, c) {
  const waiting = c.getsBack(p.id) - c.returnedTo(p.id);

  const status = waiting <= 0
    ? '<span class="badge badge-ok">Paid back</span>'
    : `<span class="badge badge-warn">Gets back ${peso(waiting)}</span>`;

  let action = '';
  if (waiting > 0 && UI.ret == p.id) {
    const prefill = Math.max(0, Math.min(c.holding, waiting));
    action = `
      <div class="panel">
        <label>Amount returned to ${esc(p.name)} (₱)
          <input id="return-amount" type="number" inputmode="decimal" value="${prefill}">
        </label>
        <div class="row">
          <button onclick="confirmReturn()">Confirm Money Returned</button>
          <button class="secondary" onclick="UI.ret = null; clearMessages(); render()">Cancel</button>
        </div>
      </div>`;
  } else if (waiting > 0) {
    action = `<button class="secondary full" onclick="UI.ret = '${p.id}'; UI.pay = null; clearMessages(); render()">Record Money Returned to ${esc(p.name)}</button>`;
  }

  return `
    <div class="line">
      <div>
        <b>${esc(p.name)}</b>
        <div class="muted">Paid ${peso(c.advance(p.id))} in advance, share is ${peso(c.share)}</div>
      </div>
      ${status}
    </div>${action}`;
}

function abonoCard(c) {
  if (!c.advancers.length) return '';
  return `
    <div class="card">
      <h2>Abono: money paid in advance</h2>
      <p class="muted">These players paid part of the court fee first. Anything above their own share gets returned to them.</p>
      <p class="big">${peso(Math.max(0, c.toReturn))}</p>
      <p class="muted">Total money still to return</p>
      ${c.advancers.map((p) => advanceRow(p, c)).join('')}
      <div class="line"><span>Collected from players</span><b>${peso(c.collected)}</b></div>
      <div class="line"><span>Already returned</span><b>${peso(c.returned)}</b></div>
      <div class="line"><span>Collected, not yet returned</span><b>${peso(c.holding)}</b></div>
      ${c.holding < 0 ? '<div class="alert alert-warn">The numbers don’t balance: more was returned than collected. Check the history below.</div>' : ''}
    </div>`;
}

function historyList() {
  const entries = [
    ...S.pays.map((x) => ({ ...x, kind: 'pay' })),
    ...S.rets.map((x) => ({ ...x, kind: 'return' })),
  ].sort((a, b) => b.ts - a.ts);

  if (!entries.length) return '<p class="muted">Nothing recorded yet.</p>';

  return entries.map((e) => {
    const text = e.kind == 'pay'
      ? `${esc(playerName(e.pid))} paid ${peso(e.amt)}`
      : `Returned ${peso(e.amt)} to ${esc(playerName(e.pid))}`;
    const cancelBtn = e.void
      ? ''
      : `<button class="secondary small" onclick="cancelEntry('${e.kind}', '${e.id}')">Cancel</button>`;
    return `
      <div class="line">
        <div class="${e.void ? 'void' : ''}">
          ${text}
          <div class="muted">${time(e.ts)}${e.void ? ' · Cancelled' : ''}</div>
        </div>
        ${cancelBtn}
      </div>`;
  }).join('');
}

function gameScreen() {
  const c = calc();
  const advanceNote = advanceTotal()
    ? `<p class="muted">Already paid to the court in advance: ${peso(advanceTotal())}. Court balance left to pay: ${peso(Math.max(0, totalFee() - advanceTotal()))}.</p>`
    : '';

  return `
    <h1>This Game</h1>
    ${UI.msg ? `<div class="alert alert-ok">${UI.msg}</div>` : ''}
    ${UI.err ? `<div class="alert alert-error">${UI.err}</div>` : ''}
    ${c.settled ? `<div class="alert alert-ok">All settled. Everyone has paid${c.advancers.length ? ' and everyone who paid in advance is paid back' : ''}.</div>` : ''}

    <div class="card">
      <p class="muted">Still to collect from players</p>
      <p class="big">${peso(Math.max(0, c.toCollect))}</p>
      <div class="grid" style="margin-top:12px">
        <div><span class="muted">Court fee</span><b>${peso(totalFee())}</b></div>
        <div><span class="muted">Players</span><b>${S.players.length}</b></div>
        <div><span class="muted">Each pays</span><b>${peso(c.share)}</b></div>
        <div><span class="muted">Collected</span><b>${peso(c.collected)}</b></div>
      </div>
      <p class="muted">Each share is rounded up to the next peso.</p>
      ${advanceNote}
    </div>

    <div class="card">
      <h2>Players</h2>
      ${S.players.map((p) => playerRow(p, c)).join('')}
    </div>

    ${abonoCard(c)}

    <div class="card">
      <details><summary>Payment History</summary>${historyList()}</details>
    </div>

    <div class="row">
      <button class="secondary" style="flex:1" onclick="editGame()">Change Players or Fee</button>
      <button class="secondary" style="flex:1" onclick="newGame()">Start a New Game</button>
    </div>`;
}

/* ---------- Recording money ---------- */
function openPayment(id) {
  clearMessages();
  UI.pay = id;
  UI.ret = null;
  render();
  const input = $('#pay-amount');
  if (input) { input.focus(); input.select(); }
}

function confirmPayment(id) {
  clearMessages();
  const amount = +$('#pay-amount').value;
  const left = calc().stillOwes(id);

  if (!(amount > 0)) {
    UI.err = 'Enter an amount bigger than ₱0.';
    return render();
  }
  if (amount > left + 0.001) {
    UI.err = `${playerName(id)} only owes ${peso(left)} more. Enter ${peso(left)} or less.`;
    return render();
  }

  const ts = Date.now();
  S.pays.push({ id: 'x' + ts, pid: id, amt: amount, ts });
  save();
  UI.pay = null;
  UI.msg = `Payment recorded: ${playerName(id)} paid ${peso(amount)} at ${time(ts)}.`;
  render();
  scrollTo(0, 0);
}

function confirmReturn() {
  clearMessages();
  const pid = UI.ret;
  const amount = +$('#return-amount').value;
  const c = calc();
  const owedToThem = c.getsBack(pid) - c.returnedTo(pid);
  const name = playerName(pid);

  if (!(amount > 0)) {
    UI.err = 'Enter an amount bigger than ₱0.';
    return render();
  }
  if (amount > owedToThem + 0.001) {
    UI.err = `${name} is only owed ${peso(owedToThem)} more. Enter ${peso(owedToThem)} or less.`;
    return render();
  }
  if (amount > c.holding + 0.001) {
    UI.err = `You only have ${peso(Math.max(0, c.holding))} collected that hasn’t been returned yet. Collect more payments first, or enter less.`;
    return render();
  }

  const ts = Date.now();
  S.rets.push({ id: 'x' + ts, pid, amt: amount, ts });
  save();
  UI.ret = null;
  UI.msg = `Money returned: ${peso(amount)} to ${name} at ${time(ts)}.`;
  render();
  scrollTo(0, 0);
}

/* ---------- Actions that need a "Are you sure?" popup ---------- */
function confirmFirst(message, action) {
  UI.ask = message;
  pendingAction = action;
  render();
}

function cancelEntry(kind, id) {
  confirmFirst('Cancel this entry? It stays in the history, marked as cancelled, and the totals update.', () => {
    const list = kind == 'pay' ? S.pays : S.rets;
    const entry = list.find((x) => x.id == id);
    if (entry) entry.void = true;
    clearMessages();
    UI.msg = 'Entry cancelled.';
  });
}

function editGame() {
  confirmFirst('Changing players or the fee changes everyone’s share. Your recorded payments are kept. Continue?', () => {
    clearMessages();
    S.view = 'setup';
  });
}

function newGame() {
  confirmFirst('Start a new game? This clears the current game, including all payments.', () => {
    S = freshGame();
    clearMessages();
  });
}

function modal() {
  if (!UI.ask) return '';
  return `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="card">
        <p style="margin:0;font-weight:600">${UI.ask}</p>
        <div class="row">
          <button onclick="answerYes()">Yes, continue</button>
          <button class="secondary" onclick="UI.ask = null; render()">Go back</button>
        </div>
      </div>
    </div>`;
}

function answerYes() {
  const action = pendingAction;
  UI.ask = null;
  pendingAction = null;
  if (action) action();
  save();
  render();
}

/* ---------- Draw the page ---------- */
function render() {
  $('#app').innerHTML = (S.view == 'setup' ? setupScreen() : gameScreen()) + modal();
}

render();