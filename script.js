/* ============================================================
   Settle Up — Application Logic (Vanilla JavaScript)
   No frameworks, no libraries. Data lives in localStorage.
   ============================================================ */

'use strict';

const STORAGE_KEY = 'settleup.v2';
const EPS = 10;      // half a cent — smaller than this counts as settled
const TOLERANCE = 1; // how far contributions may drift from the total

/* ---------- State ---------- */
let state = {
  people: [],
  expenses: [],
  payments: []
};

let payMode = 'single';   // 'single' | 'multi'
let lastSplitIds = [];    // who was on screen last render

/* ---------- Element Lookups ---------- */
const $ = (id) => document.getElementById(id);

const el = {
  potValue: $('potValue'),
  potSub: $('potSub'),

  personForm: $('personForm'),
  personName: $('personName'),
  peopleList: $('peopleList'),
  peopleEmpty: $('peopleEmpty'),
  peopleCount: $('peopleCount'),

  expenseForm: $('expenseForm'),
  expDesc: $('expDesc'),
  expAmount: $('expAmount'),
  expPaidBy: $('expPaidBy'),
  payersBox: $('payersBox'),
  payersTally: $('payersTally'),
  splitBox: $('splitBox'),
  selectAll: $('selectAll'),
  clearAll: $('clearAll'),

  balanceList: $('balanceList'),
  balanceEmpty: $('balanceEmpty'),

  settleList: $('settleList'),
  settleEmpty: $('settleEmpty'),
  settleCount: $('settleCount'),

  historyBody: $('historyBody'),
  historyEmpty: $('historyEmpty'),
  resetBtn: $('resetBtn'),
  demoBtn: $('demoBtn'),

  toastStack: $('toastStack')
};

/* ---------- Helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const round2 = (n) => Math.round(n * 100) / 100;

function num(n) {
  return Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const money = (n) => 'Rs. ' + num(n);

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 68%, 68%)`;
}

const personById = (id) => state.people.find((p) => p.id === id);
const nameOf = (id) => (personById(id) ? personById(id).name : 'Unknown');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function avatarHtml(name, small) {
  return `<div class="avatar${small ? ' avatar--sm' : ''}"
    style="background:${colorFor(name)}" title="${escapeHtml(name)}">${initials(name)}</div>`;
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ` toast--${kind}` : '');
  node.textContent = message;
  el.toastStack.appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

const show = (node, visible) => node.classList.toggle('is-hidden', !visible);

/* ---------- Persistence (LocalStorage) ---------- */
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast("Couldn't save — storage quota exceeded or disabled.", 'bad');
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('settleup.v1');
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.expenses)) return;

    state.people = parsed.people;
    state.payments = Array.isArray(parsed.payments) ? parsed.payments : [];

    state.expenses = parsed.expenses.map((e) => {
      if (Array.isArray(e.payers)) return e;
      return {
        id: e.id,
        desc: e.desc,
        amount: e.amount,
        payers: [{ id: e.paidBy, amount: e.amount }],
        sharedBy: e.sharedBy,
        date: e.date
      };
    });
  } catch (err) {
    console.warn('Stored data unreadable, starting fresh.', err);
  }
}

/* ============================================================
   CORE MATH & DEBT SIMPLIFICATION ALGORITHM
   ============================================================ */

function computeBreakdown() {
  const book = {};
  state.people.forEach((p) => {
    book[p.id] = { paid: 0, share: 0, sent: 0, received: 0, net: 0 };
  });

  state.expenses.forEach((exp) => {
    exp.payers.forEach((payer) => {
      if (book[payer.id]) book[payer.id].paid += payer.amount;
    });

    const perHead = exp.amount / exp.sharedBy.length;
    exp.sharedBy.forEach((pid) => {
      if (book[pid]) book[pid].share += perHead;
    });
  });

  state.payments.forEach((pay) => {
    if (book[pay.from]) book[pay.from].sent += pay.amount;
    if (book[pay.to]) book[pay.to].received += pay.amount;
  });

  Object.values(book).forEach((row) => {
    row.paid = round2(row.paid);
    row.share = round2(row.share);
    row.sent = round2(row.sent);
    row.received = round2(row.received);
    row.net = round2(row.paid - row.share + row.sent - row.received);
  });

  return book;
}

function computeBalances() {
  const book = computeBreakdown();
  const balances = {};
  Object.entries(book).forEach(([id, row]) => { balances[id] = row.net; });
  return balances;
}

function simplifyDebts(balances) {
  const debtors = [];
  const creditors = [];

  Object.entries(balances).forEach(([id, amount]) => {
    if (amount < -EPS) debtors.push({ id, amount: -amount });
    else if (amount > EPS) creditors.push({ id, amount });
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const plan = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);

    plan.push({ from: debtors[i].id, to: creditors[j].id, amount: round2(amount) });

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < EPS) i++;
    if (creditors[j].amount < EPS) j++;
  }

  return plan;
}

/* ============================================================
   RENDERING
   ============================================================ */

function render() {
  renderPeople();
  renderPayerSelect();
  renderPayersBox();
  renderSplitBox();
  renderTally();
  renderPot();
  renderBalances();
  renderSettlements();
  renderHistory();
}

function renderPot() {
  const total = state.expenses.reduce((sum, e) => sum + e.amount, 0);
  el.potValue.textContent = money(total);

  if (state.expenses.length === 0) {
    el.potSub.textContent = 'No expenses yet';
    return;
  }

  const count = state.expenses.length;
  const heads = state.people.length || 1;
  el.potSub.textContent =
    `${count} ${count === 1 ? 'expense' : 'expenses'} · ${money(total / heads)} per head average`;
}

function renderPeople() {
  el.peopleCount.textContent = state.people.length;
  show(el.peopleEmpty, state.people.length === 0);

  el.peopleList.innerHTML = state.people.map((p) => `
    <li class="person">
      ${avatarHtml(p.name)}
      <span class="person__name">${escapeHtml(p.name)}</span>
      <button type="button" class="person__del" data-remove-person="${p.id}"
        aria-label="Remove ${escapeHtml(p.name)}">&times;</button>
    </li>`).join('');
}

function renderPayerSelect() {
  const previous = el.expPaidBy.value;

  el.expPaidBy.innerHTML =
    '<option value="">Select a person</option>' +
    state.people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  if (state.people.some((p) => p.id === previous)) el.expPaidBy.value = previous;
}

function renderPayersBox() {
  show(el.expPaidBy, payMode === 'single');
  show(el.payersBox, payMode === 'multi');
  show(el.payersTally, payMode === 'multi');

  if (state.people.length === 0) {
    el.payersBox.innerHTML = '<p class="empty empty--inline">Add people first.</p>';
    return;
  }

  const typed = {};
  el.payersBox.querySelectorAll('[data-payer]').forEach((input) => {
    if (input.value !== '') typed[input.dataset.payer] = input.value;
  });

  el.payersBox.innerHTML = state.people.map((p) => `
    <div class="payer-row">
      ${avatarHtml(p.name, true)}
      <span class="payer-row__name">${escapeHtml(p.name)}</span>
      <div class="money-input">
        <span class="money-input__prefix">Rs.</span>
        <input type="number" class="field field--mono" data-payer="${p.id}"
          value="${typed[p.id] || ''}" placeholder="0.00" min="0" step="0.01"
          aria-label="Amount paid by ${escapeHtml(p.name)}">
      </div>
    </div>`).join('');
}

function readPayerInputs() {
  const rows = [];
  el.payersBox.querySelectorAll('[data-payer]').forEach((input) => {
    const value = parseFloat(input.value);
    if (Number.isFinite(value) && value > 0) {
      rows.push({ id: input.dataset.payer, amount: round2(value) });
    }
  });
  return rows;
}

function renderTally() {
  if (payMode !== 'multi') return;

  const total = parseFloat(el.expAmount.value);
  const entered = readPayerInputs().reduce((sum, r) => sum + r.amount, 0);

  el.payersTally.classList.remove('is-balanced', 'is-over');

  if (!Number.isFinite(total) || total <= 0) {
    el.payersTally.innerHTML =
      `<span class="tally__label">Contributions so far</span>
       <span class="tally__value">${money(entered)}</span>`;
    return;
  }

  const remaining = round2(total - entered);

  if (Math.abs(remaining) <= TOLERANCE) {
    el.payersTally.classList.add('is-balanced');
    el.payersTally.innerHTML =
      `<span class="tally__label">Contributions match the total</span>
       <span class="tally__value">${money(entered)}</span>`;
  } else if (remaining < 0) {
    el.payersTally.classList.add('is-over');
    el.payersTally.innerHTML =
      `<span class="tally__label">Over the total by</span>
       <span class="tally__value">${money(-remaining)}</span>`;
  } else {
    el.payersTally.innerHTML =
      `<span class="tally__label">Still unaccounted for</span>
       <span class="tally__value">${money(remaining)}</span>`;
  }
}

function renderSplitBox() {
  if (state.people.length === 0) {
    el.splitBox.innerHTML =
      '<p class="empty empty--inline">Add people to choose who shares this cost.</p>';
    lastSplitIds = [];
    return;
  }

  const ticked = new Set(
    [...el.splitBox.querySelectorAll('input:checked')].map((c) => c.value)
  );
  const alreadyShown = new Set(lastSplitIds);

  el.splitBox.innerHTML = state.people.map((p) => {
    const checked = !alreadyShown.has(p.id) || ticked.has(p.id) ? 'checked' : '';
    return `
      <label class="chk">
        <input type="checkbox" value="${p.id}" ${checked}>
        <span class="chk__face">${avatarHtml(p.name, true)}${escapeHtml(p.name)}</span>
      </label>`;
  }).join('');

  lastSplitIds = state.people.map((p) => p.id);
}

function renderBalances() {
  const book = computeBreakdown();
  const hasData = state.people.length > 0 &&
    (state.expenses.length > 0 || state.payments.length > 0);

  show(el.balanceEmpty, !hasData);
  if (!hasData) { el.balanceList.innerHTML = ''; return; }

  const sorted = [...state.people].sort((a, b) => book[b.id].net - book[a.id].net);

  el.balanceList.innerHTML = sorted.map((p) => {
    const row = book[p.id];
    let cls = 'bal--zero';
    let tag = 'All square';
    let sign = '';

    if (row.net > EPS) { cls = 'bal--pos'; tag = 'Gets back'; sign = '+'; }
    else if (row.net < -EPS) { cls = 'bal--neg'; tag = 'Owes'; sign = '−'; }

    const parts = [
      `<span class="wk"><span class="wk__k">Paid</span> ${num(row.paid)}</span>`,
      `<span class="wk"><span class="wk__k">Share</span> ${num(row.share)}</span>`
    ];
    if (row.sent > EPS) {
      parts.push(`<span class="wk"><span class="wk__k">Settled</span> ${num(row.sent)}</span>`);
    }
    if (row.received > EPS) {
      parts.push(`<span class="wk"><span class="wk__k">Received</span> ${num(row.received)}</span>`);
    }

    return `
      <li class="bal ${cls}">
        ${avatarHtml(p.name)}
        <div class="bal__body">
          <div class="bal__name">${escapeHtml(p.name)}</div>
          <div class="bal__note">${parts.join('')}</div>
        </div>
        <div class="bal__right">
          <div class="bal__amt">${sign}${money(row.net)}</div>
          <div class="bal__tag">${tag}</div>
        </div>
      </li>`;
  }).join('');
}

function renderSettlements() {
  const plan = simplifyDebts(computeBalances());
  const hasActivity = state.expenses.length > 0 || state.payments.length > 0;

  show(el.settleEmpty, !hasActivity);

  if (!hasActivity) {
    el.settleList.innerHTML = '';
    el.settleCount.textContent = '0 payments';
    return;
  }

  if (plan.length === 0) {
    el.settleCount.textContent = 'settled';
    el.settleList.innerHTML = `
      <div class="settled">
        <strong>Everyone's square</strong>
        <span>No payments needed — the group is even.</span>
      </div>`;
    return;
  }

  el.settleCount.textContent =
    `${plan.length} ${plan.length === 1 ? 'payment' : 'payments'}`;

  el.settleList.innerHTML = plan.map((pay) => {
    const from = nameOf(pay.from);
    const to = nameOf(pay.to);
    return `
      <div class="flow">
        <button type="button" class="flow__paid"
          data-settle="${pay.from}|${pay.to}|${pay.amount}">Mark as paid</button>
        <div class="flow__party">
          ${avatarHtml(from)}
          <span class="flow__name">${escapeHtml(from)}</span>
        </div>
        <div class="flow__wire">
          <span class="flow__amt">${money(pay.amount)}</span>
        </div>
        <div class="flow__party flow__party--to">
          <span class="flow__name">${escapeHtml(to)}</span>
          ${avatarHtml(to)}
        </div>
      </div>`;
  }).join('');
}

function payerLines(payers, showAmounts) {
  return payers.map((p) => `
    <div class="paid-line">
      ${avatarHtml(nameOf(p.id), true)}
      <span class="paid-line__name">${escapeHtml(nameOf(p.id))}</span>
      ${showAmounts ? `<span class="paid-line__amt">${money(p.amount)}</span>` : ''}
    </div>`).join('');
}

function renderHistory() {
  const hasActivity = state.expenses.length > 0 || state.payments.length > 0;
  show(el.historyEmpty, !hasActivity);

  const rows = [
    ...state.expenses.map((e) => ({ kind: 'expense', data: e })),
    ...state.payments.map((p) => ({ kind: 'payment', data: p }))
  ].sort((a, b) => new Date(b.data.date) - new Date(a.data.date));

  el.historyBody.innerHTML = rows.map((row) => {
    const when = new Date(row.data.date)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    if (row.kind === 'payment') {
      const pay = row.data;
      return `
        <tr class="is-payment">
          <td>
            <div class="desc__main">Settled up<span class="tag">payment</span></div>
            <div class="desc__date">${when}</div>
          </td>
          <td>
            <div class="paid-line">
              ${avatarHtml(nameOf(pay.from), true)}
              <span class="paid-line__name">${escapeHtml(nameOf(pay.from))}</span>
              <span class="paid-line__amt">${money(pay.amount)}</span>
            </div>
          </td>
          <td>
            <div class="paid-line muted">
              ${avatarHtml(nameOf(pay.to), true)}
              <span class="paid-line__name">${escapeHtml(nameOf(pay.to))} received</span>
            </div>
          </td>
          <td class="ta-r">${money(pay.amount)}</td>
          <td class="ta-r muted">—</td>
          <td class="ta-r">
            <button type="button" class="row-del" data-remove-payment="${pay.id}"
              aria-label="Undo this payment">&times;</button>
          </td>
        </tr>`;
    }

    const exp = row.data;
    const perHead = exp.amount / exp.sharedBy.length;
    const manyPayers = exp.payers.length > 1;
    const payerCell = payerLines(exp.payers, manyPayers);

    const sharerCell = exp.sharedBy.map((id) => `
      <div class="paid-line">
        ${avatarHtml(nameOf(id), true)}
        <span class="paid-line__name">${escapeHtml(nameOf(id))}</span>
        <span class="paid-line__amt muted">${money(perHead)}</span>
      </div>`).join('');

    return `
      <tr>
        <td>
          <div class="desc__main">${escapeHtml(exp.desc)}</div>
          <div class="desc__date">${when}</div>
        </td>
        <td>${payerCell}</td>
        <td>${sharerCell}</td>
        <td class="ta-r">${money(exp.amount)}</td>
        <td class="ta-r">${money(perHead)}</td>
        <td class="ta-r">
          <button type="button" class="row-del" data-remove-expense="${exp.id}"
            aria-label="Delete ${escapeHtml(exp.desc)}">&times;</button>
        </td>
      </tr>`;
  }).join('');
}

/* ============================================================
   USER ACTIONS
   ============================================================ */

function addPerson(rawName) {
  const name = rawName.trim();

  if (!name) { toast('Type a name first.', 'bad'); return false; }
  if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    toast(`${name} is already in the group.`, 'bad');
    return false;
  }

  state.people.push({ id: uid(), name });
  save();
  render();
  toast(`${name} joined the group.`, 'good');
  return true;
}

function removePerson(id) {
  const person = personById(id);
  if (!person) return;

  const inExpense = state.expenses.some(
    (e) => e.sharedBy.includes(id) || e.payers.some((p) => p.id === id)
  );
  const inPayment = state.payments.some((p) => p.from === id || p.to === id);

  if (inExpense || inPayment) {
    toast(`${person.name} appears in the activity list. Delete those entries first.`, 'bad');
    return;
  }

  state.people = state.people.filter((p) => p.id !== id);
  save();
  render();
  toast(`${person.name} removed.`);
}

function addExpense() {
  const desc = el.expDesc.value.trim();
  const amount = parseFloat(el.expAmount.value);
  const sharedBy = [...el.splitBox.querySelectorAll('input:checked')].map((c) => c.value);

  if (state.people.length < 2) {
    toast('Add at least two people before logging expenses.', 'bad');
    return;
  }
  if (!desc) { toast('Give the expense a short description.', 'bad'); el.expDesc.focus(); return; }
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Enter a total amount greater than zero.', 'bad');
    el.expAmount.focus();
    return;
  }

  let payers;

  if (payMode === 'single') {
    const paidBy = el.expPaidBy.value;
    if (!paidBy) { toast('Choose who paid.', 'bad'); el.expPaidBy.focus(); return; }
    payers = [{ id: paidBy, amount: round2(amount) }];
  } else {
    payers = readPayerInputs();

    if (payers.length === 0) {
      toast('Enter how much each person put in.', 'bad');
      return;
    }

    const entered = round2(payers.reduce((sum, p) => sum + p.amount, 0));
    const gap = round2(amount - entered);

    if (Math.abs(gap) > TOLERANCE) {
      toast(
        gap > 0
          ? `${money(gap)} is unaccounted for. Contributions must add up to ${money(amount)}.`
          : `Contributions are ${money(-gap)} over the total of ${money(amount)}.`,
        'bad'
      );
      return;
    }
  }

  if (sharedBy.length === 0) {
    toast('Pick at least one person to split between.', 'bad');
    return;
  }

  state.expenses.push({
    id: uid(),
    desc,
    amount: round2(amount),
    payers,
    sharedBy,
    date: new Date().toISOString()
  });

  save();

  el.expDesc.value = '';
  el.expAmount.value = '';
  el.payersBox.querySelectorAll('[data-payer]').forEach((i) => { i.value = ''; });

  render();
  el.expDesc.focus();

  toast(`${desc} added — ${money(amount / sharedBy.length)} each.`, 'good');
}

function removeExpense(id) {
  const exp = state.expenses.find((e) => e.id === id);
  if (!exp) return;

  state.expenses = state.expenses.filter((e) => e.id !== id);
  save();
  render();
  toast(`${exp.desc} deleted.`);
}

function recordPayment(from, to, amount) {
  state.payments.push({
    id: uid(),
    from,
    to,
    amount: round2(amount),
    date: new Date().toISOString()
  });

  save();
  render();
  toast(`${nameOf(from)} paid ${nameOf(to)} ${money(amount)}.`, 'good');
}

function removePayment(id) {
  const pay = state.payments.find((p) => p.id === id);
  if (!pay) return;

  state.payments = state.payments.filter((p) => p.id !== id);
  save();
  render();
  toast('Payment undone — the debt is back.');
}

function loadDemo() {
  const names = ['Kamal', 'Nimali', 'Saman', 'Tharu'];
  const people = names.map((name) => ({ id: uid(), name }));
  const [kamal, nimali, saman, tharu] = people.map((p) => p.id);
  const all = people.map((p) => p.id);
  const now = () => new Date().toISOString();

  state = {
    people,
    expenses: [
      { id: uid(), desc: 'Guest house — 2 nights', amount: 24000,
        payers: [{ id: kamal, amount: 24000 }], sharedBy: all, date: now() },

      { id: uid(), desc: 'Dinner', amount: 2000,
        payers: [{ id: nimali, amount: 1500 }, { id: saman, amount: 500 }],
        sharedBy: all, date: now() },

      { id: uid(), desc: 'Van hire', amount: 15000,
        payers: [{ id: nimali, amount: 15000 }], sharedBy: all, date: now() },

      { id: uid(), desc: 'Entrance tickets', amount: 3200,
        payers: [{ id: tharu, amount: 3200 }], sharedBy: [kamal, saman, tharu], date: now() }
    ],
    payments: []
  };

  save();
  render();
  toast('Sample trip loaded. Delete it any time.', 'good');
}

function resetAll() {
  if (!confirm('Delete all people, expenses and payments? This cannot be undone.')) return;

  state = { people: [], expenses: [], payments: [] };
  lastSplitIds = [];
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('settleup.v1');
  render();
  toast('Everything cleared.');
}

/* ============================================================
   EVENT WIRING (DOM Event Listeners)
   ============================================================ */

el.personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (addPerson(el.personName.value)) el.personName.value = '';
  el.personName.focus();
});

el.expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addExpense();
});

el.selectAll.addEventListener('click', () => {
  el.splitBox.querySelectorAll('input').forEach((c) => { c.checked = true; });
});

el.clearAll.addEventListener('click', () => {
  el.splitBox.querySelectorAll('input').forEach((c) => { c.checked = false; });
});

document.querySelectorAll('[data-paymode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    payMode = btn.dataset.paymode;
    document.querySelectorAll('[data-paymode]').forEach((b) => {
      b.classList.toggle('is-active', b === btn);
    });
    renderPayersBox();
    renderTally();
  });
});

el.payersBox.addEventListener('input', renderTally);
el.expAmount.addEventListener('input', renderTally);

el.resetBtn.addEventListener('click', resetAll);
el.demoBtn.addEventListener('click', loadDemo);

// Event delegation for dynamically rendered buttons
document.addEventListener('click', (e) => {
  const personBtn = e.target.closest('[data-remove-person]');
  if (personBtn) { removePerson(personBtn.dataset.removePerson); return; }

  const expenseBtn = e.target.closest('[data-remove-expense]');
  if (expenseBtn) { removeExpense(expenseBtn.dataset.removeExpense); return; }

  const paymentBtn = e.target.closest('[data-remove-payment]');
  if (paymentBtn) { removePayment(paymentBtn.dataset.removePayment); return; }

  const settleBtn = e.target.closest('[data-settle]');
  if (settleBtn) {
    const [from, to, amount] = settleBtn.dataset.settle.split('|');
    recordPayment(from, to, parseFloat(amount));
  }
});

/* ---------- App Initialization ---------- */
load();
render();