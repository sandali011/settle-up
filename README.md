# Settle Up — Group Expense Splitter

**Split group expenses and settle up in the fewest possible payments.**

Four friends on a trip. Everyone pays for something. By the end nobody knows who owes who. Settle Up tracks every expense, works out each person's net position, and then reduces the whole tangle to the **shortest list of payments** that squares the group.

Built with vanilla JavaScript — no frameworks, no build step, no dependencies.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![No Dependencies](https://img.shields.io/badge/dependencies-none-success?style=flat)

---

## Live demo

🔗 **[Try it here](https://sandali011.github.io/settle-up/)**


---

## The problem it solves

Most expense splitters stop at *"here's what everyone owes."* That leaves you with a mess of small transfers. If three people each owe two other people, that's six bank transfers for one weekend away.

Settle Up goes one step further and asks: **what is the minimum set of payments that leaves everyone square?**

### A worked example

Three friends. Two expenses.

| Expense | Amount | Paid by | Split between |
|---|---:|---|---|
| Hotel | Rs. 9,000 | Amaya | all three |
| Dinner | Rs. 3,000 | Binara | all three |

**Settling each expense on its own — 4 transfers:**

```
Binara  → Amaya   Rs. 3,000     (hotel share)
Chamath → Amaya   Rs. 3,000     (hotel share)
Amaya   → Binara  Rs. 1,000     (dinner share)
Chamath → Binara  Rs. 1,000     (dinner share)
```

**What Settle Up produces — 2 transfers:**

```
Chamath → Amaya   Rs. 4,000
Binara  → Amaya   Rs. 1,000
```

Same outcome. Half the payments. Nobody has to send money in both directions.

---

## How the simplification works

The algorithm runs in three steps.

### 1. Build the ledger

For every person, track four numbers:

| Field | Meaning |
|---|---|
| `paid` | total they put in across all expenses |
| `share` | total they were responsible for |
| `sent` | settlement payments they have already made |
| `received` | settlement payments they have already received |

### 2. Reduce each person to a single net figure

```js
net = paid - share + sent - received
```

A positive `net` means the group owes them. A negative `net` means they owe the group. By construction every `net` sums to zero — the individual expenses stop mattering, and only the net position does.

This is the key move. Once everyone is a single number, **who paid for what becomes irrelevant** — which is exactly why the payment count drops.

### 3. Greedily match the largest debtor to the largest creditor

```js
debtors.sort(descending by amount)
creditors.sort(descending by amount)

while (debtors remain && creditors remain) {
  amount = min(largest debtor, largest creditor)
  record: debtor pays creditor `amount`
  subtract amount from both
  drop whichever side has reached zero
}
```

Each pass through the loop settles at least one person completely, so a group of `n` people needs **at most `n - 1` payments** — regardless of how many expenses were logged. Four friends and forty receipts still settle in three transfers.

> This is the *Optimal Account Balancing* problem. Finding the true minimum is NP-hard, so this uses the standard greedy heuristic: fast, and optimal or near-optimal for realistic group sizes.

---

## Features

**Expenses**
- Log an expense with a description, amount, and who it is split between
- **Multiple payers per expense** — two people can go halves on one dinner bill
- Live tally shows whether the contributions add up to the total before you submit
- Split between everyone, or just the people who were actually there

**Balances**
- Net position per person, with the working shown (paid / share / settled / received)
- Colour-coded: green gets money back, coral owes money

**Settlement**
- The shortest payment plan, recalculated on every change
- **Mark as paid** — settlements are recorded and fold back into the balances
- Undo a payment and the debt reappears

**Activity**
- Full history of expenses and settlements, newest first
- Per-head cost on every row
- Delete any entry; everything recalculates

**Quality of life**
- All data persists in `localStorage` — close the tab and come back
- Sample trip data to try it without typing anything
- Toast notifications for every action
- Fully responsive down to 360px
- Keyboard accessible with visible focus rings, ARIA labels, and a live region
- Respects `prefers-reduced-motion`

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Markup | Semantic HTML5 | Landmarks and real form elements, so it works with a screen reader |
| Styling | CSS3 — Grid, custom properties, `backdrop-filter` | One theme block at the top of the file; no preprocessor needed |
| Logic | Vanilla JavaScript (ES6+) | The whole point — no framework hiding the mechanics |
| Storage | `localStorage` with a schema migration | Works offline, no backend |
| Build | None | Open `index.html` and it runs |

---

## Running it locally

```bash
git clone https://github.com/sandali011/settle-up.git
```

Then open `index.html` in a browser. There is no install step.

For a local server (optional):

```bash
npx serve .
```

---

## Project structure

```
settle-up/
├── index.html      # markup and layout regions
├── style.css       # design tokens, components, responsive rules
├── script.js       # state, maths, rendering, event wiring
├── bg.svg          # hand-built line-art background
└── README.md
```

`script.js` is organised in five labelled sections:

1. **State & element lookups** — a single `state` object, all DOM nodes cached once
2. **Helpers** — money formatting, deterministic avatar colours, HTML escaping
3. **Persistence** — save/load with a v1 to v2 schema migration
4. **Core maths** — `computeBreakdown()`, `computeBalances()`, `simplifyDebts()`
5. **Rendering & events** — one `render()` entry point, event delegation for dynamic nodes

---

## Data model

```js
{
  people: [
    { id: "lx8f2a", name: "Amaya" }
  ],

  expenses: [
    {
      id: "lx8f3b",
      desc: "Hotel — 2 nights",
      amount: 9000,
      payers: [ { id: "lx8f2a", amount: 9000 } ],   // one payer, or many
      sharedBy: [ "lx8f2a", "lx8f4c", "lx8f5d" ],
      date: "2026-10-23T09:14:00.000Z"
    }
  ],

  payments: [
    { id: "lx8f6e", from: "lx8f4c", to: "lx8f2a", amount: 4000, date: "..." }
  ]
}
```

---

## Notes on some decisions

**Money and floating point.** Every monetary result goes through `round2()`, and comparisons use an epsilon rather than `=== 0`. Without it, `0.1 + 0.2` style drift makes a settled group look like it still owes a fraction of a cent.

**Schema migration.** The first version stored a single `paidBy` id per expense. Adding multiple payers changed that to a `payers[]` array. Rather than wiping existing data, `load()` detects the old shape and converts it on read, so anyone who used v1 keeps their history.

**Escaping user input.** Names and descriptions are rendered with template literals into `innerHTML`, so every interpolated value passes through `escapeHtml()` first. A person named `<img onerror=...>` renders as text, not as markup.

**Colour discipline.** Amber, mint and coral are reserved for money and the primary action. Everything else is a neutral. The background art sits at 30% opacity behind a vignette so the interface stays readable over it.

**Checkbox state across re-renders.** The split-selection checkboxes are rebuilt on every render. `renderSplitBox()` remembers which ids were on screen last time, so newly-added people default to checked while existing selections are preserved.

---

## Roadmap

- [ ] Backend with Express + MongoDB so groups sync across devices
- [ ] User accounts with JWT authentication
- [ ] Multi-currency with live exchange rates
- [ ] Export a settlement plan as PDF
- [ ] Dockerised, with a GitHub Actions CI/CD pipeline

---

## Licence

MIT
