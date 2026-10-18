// Single-page client for Pool. Routes live in the URL hash:
//   #/            home and your pools
//   #/new         create a pool
//   #/p/:id       a pool (picks, leaderboard, all picks, organizer tools)

import { favoriteIndex, formatMoneyline, parseOptionLine, rollIndex, winChances } from './odds.js';
import { claudeEntry, slateToPool } from './slate.js';

const app = document.getElementById('app');
const STORAGE_KEY = 'pool:v1';

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function savePool(id, patch) {
  const all = loadSaved();
  all[id] = { ...all[id], ...patch, seenAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable (private mode); tokens only last this page view.
  }
  memory[id] = all[id];
}

function forgetPool(id) {
  const all = loadSaved();
  delete all[id];
  delete memory[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

// Fallback copy of credentials when localStorage is blocked.
const memory = {};
const creds = (id) => ({ ...memory[id], ...loadSaved()[id] });

async function api(path, { method = 'GET', body, poolId } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (poolId) {
    const c = creds(poolId);
    if (c.adminToken) headers['X-Admin-Token'] = c.adminToken;
    if (c.entryId) headers['X-Entry-Id'] = c.entryId;
    if (c.editToken) headers['X-Edit-Token'] = c.editToken;
  }
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const money = (n) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function render(...nodes) {
  app.replaceChildren(...nodes.filter((n) => n || n === 0));
}

function errorBox(message) {
  return h('div', { class: 'error', role: 'alert' }, message);
}

// ---------- router ----------

async function route() {
  const [hash, query = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  const parts = hash.split('/').filter(Boolean);
  // Organizer links carry the admin key; store it and drop it from the URL.
  const key = new URLSearchParams(query).get('key');
  if (key && parts[0] === 'p' && parts[1]) {
    savePool(decodeURIComponent(parts[1]), { adminToken: key });
    history.replaceState(null, '', `#${hash}`);
  }
  window.scrollTo(0, 0);
  if (parts.length === 0) return homePage();
  if (parts[0] === 'new') return createPage();
  if (parts[0] === 'help') return helpPage();
  if (parts[0] === 'p' && parts[1]) return poolPage(decodeURIComponent(parts[1]), parts[2]);
  render(h('div', { class: 'card empty' }, 'Page not found. ', h('a', { href: '#/' }, 'Go home')));
}


// ---------- home ----------

function homePage() {
  document.title = 'Pool';
  const saved = Object.entries(loadSaved()).sort((a, b) => (b[1].seenAt ?? 0) - (a[1].seenAt ?? 0));
  render(
    h('section', { class: 'hero' },
      h('h1', {}, 'Run the office pool without the spreadsheet.'),
      h('p', {}, 'Write the questions, share one link, and everyone makes their picks. Picks stay hidden until the pool locks, then the leaderboard scores itself as you enter results.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '#/new' }, 'Create a pool'),
        h('a', { class: 'btn btn-secondary', href: '#/help' }, 'How to invite people'))),
    isLocalOnly() && localNotice(),
    h('section', { class: 'card' },
      h('h2', {}, 'Your pools'),
      saved.length === 0
        ? h('p', { class: 'muted' }, 'Pools you create or join on this device show up here.')
        : h('ul', { class: 'list' }, saved.map(([id, s]) =>
          h('li', {},
            h('div', {},
              h('a', { href: `#/p/${encodeURIComponent(id)}` }, s.name || 'Untitled pool'),
              h('div', { class: 'small muted' },
                [s.adminToken && 'Organizer', s.entryId && `Entered as ${s.entryName ?? 'you'}`].filter(Boolean).join(' · ') || 'Viewed')),
            h('button', {
              class: 'btn-link small',
              onclick: () => {
                if (s.adminToken && !confirm('Forget this pool on this device? You will lose organizer access unless you saved the organizer link.')) return;
                forgetPool(id);
                homePage();
              },
            }, 'Forget'))))),
    h('section', { class: 'card' },
      h('h2', {}, 'How it works'),
      h('ol', { class: 'muted' },
        h('li', {}, 'Create a pool with your questions, an optional entry fee and a lock time.'),
        h('li', {}, 'Send the link. Everyone enters their name and picks; they can change picks until it locks.'),
        h('li', {}, 'As results come in, mark the winners. The leaderboard updates for everyone.'))));
}

// ---------- create ----------

const TEMPLATES = {
  blank: { name: '', questions: [{ prompt: '', options: ['', ''], points: 1 }] },
  football: {
    name: 'Sunday football picks',
    description: 'Pick the winner of each game. Closest guess on total points in the late game breaks ties.',
    questions: [
      { prompt: 'Game 1', options: ['Home', 'Away'], points: 1 },
      { prompt: 'Game 2', options: ['Home', 'Away'], points: 1 },
      { prompt: 'Game 3', options: ['Home', 'Away'], points: 1 },
    ],
    tiebreakerPrompt: 'Total points scored in the late game',
  },
  awards: {
    name: 'Awards night ballot',
    description: 'Pick the winner in each category. Bigger categories are worth more.',
    questions: [
      { prompt: 'Best Picture', options: ['Nominee A', 'Nominee B', 'Nominee C', 'Nominee D', 'Nominee E'], points: 3 },
      { prompt: 'Best Director', options: ['Nominee A', 'Nominee B', 'Nominee C', 'Nominee D', 'Nominee E'], points: 2 },
      { prompt: 'Best Actress', options: ['Nominee A', 'Nominee B', 'Nominee C', 'Nominee D', 'Nominee E'], points: 2 },
      { prompt: 'Best Actor', options: ['Nominee A', 'Nominee B', 'Nominee C', 'Nominee D', 'Nominee E'], points: 2 },
    ],
    tiebreakerPrompt: 'How long will the ceremony run, in minutes?',
  },
  baby: {
    name: 'Baby pool',
    description: 'Guess the details. Closest weight guess breaks ties.',
    questions: [
      { prompt: 'Boy or girl?', options: ['Boy', 'Girl'], points: 1 },
      { prompt: 'Arrives', options: ['Early', 'On the due date', 'Late'], points: 1 },
      { prompt: 'Hair color', options: ['Dark', 'Light', 'Red', 'Not much yet'], points: 1 },
    ],
    tiebreakerPrompt: 'Weight in ounces',
  },
};

function createPage() {
  document.title = 'New pool · Pool';
  let questions = [];
  let slate = null;
  const errorSlot = h('div');
  const slateButtons = h('div', { class: 'row', style: 'margin-top:12px' });
  const claudeToggle = h('input', { type: 'checkbox', id: 'f-claude', checked: true, style: 'width:auto;margin-right:8px' });
  const claudeRow = h('div', { class: 'field', hidden: true },
    h('label', { for: 'f-claude', style: 'display:flex;align-items:center;font-weight:500' }, claudeToggle,
      'Add Claude’s picks as an entry'),
    h('div', { class: 'hint' }, 'Claude researched this week’s odds, took the favorite in clear games and rolled the dice on the close ones.'));
  const questionList = h('div');
  const fields = {
    name: h('input', { id: 'f-name', maxlength: '80', required: true, placeholder: 'e.g. March bracket challenge' }),
    description: h('textarea', { id: 'f-desc', maxlength: '1000', placeholder: 'Rules, prizes, deadlines…' }),
    entryFee: h('input', { id: 'f-fee', type: 'number', min: '0', step: '0.01', placeholder: '0' }),
    lockAt: h('input', { id: 'f-lock', type: 'datetime-local' }),
    tiebreakerPrompt: h('input', { id: 'f-tb', maxlength: '200', placeholder: 'e.g. Total points in the final' }),
  };

  function applyTemplate(key, t = TEMPLATES[key]) {
    fields.name.value = t.name ?? '';
    fields.description.value = t.description ?? '';
    fields.tiebreakerPrompt.value = t.tiebreakerPrompt ?? '';
    fields.lockAt.value = '';
    questions = t.questions.map((q) => ({
      prompt: q.prompt,
      points: q.points ?? 1,
      lines: q.options.map((o, i) => (q.odds?.[i] != null ? `${o} | ${formatMoneyline(q.odds[i])}` : o)),
    }));
    slate = null;
    claudeRow.hidden = true;
    drawQuestions();
  }

  async function applySlate(file) {
    try {
      const res = await fetch(`/weeks/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error('Could not load that week');
      const loaded = await res.json();
      const t = slateToPool(loaded);
      applyTemplate(null, t);
      if (t.lockAt && Date.parse(t.lockAt) > Date.now()) {
        const d = new Date(t.lockAt);
        fields.lockAt.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      } else if (t.lockAt) {
        toast('Heads up: the first game of this week has already kicked off.');
      }
      slate = loaded;
      claudeRow.hidden = !loaded.claude;
    } catch (err) {
      toast(err.message);
    }
  }

  fetch('/weeks/index.json')
    .then((r) => (r.ok ? r.json() : { weeks: [] }))
    .then(({ weeks }) => slateButtons.replaceChildren(
      ...(weeks.length ? [h('span', { class: 'small muted', style: 'width:100%' }, 'This week’s games, with researched odds:')] : []),
      ...weeks.slice(0, 3).map((w) => h('button', { type: 'button', class: 'btn btn-small', onclick: () => applySlate(w.file) }, `🏈 ${w.title}`))))
    .catch(() => {});

  function drawQuestions() {
    questionList.replaceChildren(...questions.map((q, i) => {
      const optionsBox = h('textarea', {
        rows: Math.max(2, q.lines.length),
        placeholder: 'One option per line',
        oninput: (e) => { q.lines = e.target.value.split('\n'); },
      });
      optionsBox.value = q.lines.join('\n');
      return h('div', { class: 'question-editor' },
        h('div', { class: 'row spread' },
          h('h3', {}, `Question ${i + 1}`),
          questions.length > 1 && h('button', {
            type: 'button', class: 'btn-link small',
            onclick: () => { questions.splice(i, 1); drawQuestions(); },
          }, 'Remove')),
        h('div', { class: 'grid-q' },
          h('div', { class: 'field' },
            h('label', {}, 'Prompt'),
            h('input', { value: q.prompt, maxlength: '200', placeholder: 'e.g. Who wins the final?', oninput: (e) => { q.prompt = e.target.value; } })),
          h('div', { class: 'field' },
            h('label', {}, 'Points'),
            h('input', { type: 'number', min: '1', max: '100', value: String(q.points), oninput: (e) => { q.points = e.target.value; } }))),
        h('label', {}, 'Options ', h('span', { class: 'hint' }, 'one per line; add odds like “Bears | -118” to weight the dice')),
        optionsBox);
    }));
  }

  async function submit(e) {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    errorSlot.replaceChildren();
    try {
      const body = {
        name: fields.name.value,
        description: fields.description.value,
        entryFee: fields.entryFee.value,
        lockAt: fields.lockAt.value ? new Date(fields.lockAt.value).toISOString() : null,
        tiebreakerPrompt: fields.tiebreakerPrompt.value,
        questions: questions.map((q) => {
          const parsed = q.lines.map(parseOptionLine);
          return { prompt: q.prompt, options: parsed.map((o) => o.name), odds: parsed.map((o) => o.odds), points: q.points };
        }),
      };
      const { pool, adminToken } = await api('/pools', { method: 'POST', body });
      savePool(pool.id, { name: pool.name, adminToken });
      const claude = slate && claudeToggle.checked && !claudeRow.hidden && claudeEntry(slate, pool);
      let note = 'Pool created. Share the link to collect picks.';
      if (claude) {
        try {
          await api(`/pools/${encodeURIComponent(pool.id)}/entries`, { method: 'POST', body: claude });
          note = 'Pool created with Claude’s picks. Share the link to collect yours.';
        } catch (err) {
          note = `Pool created, but Claude’s picks couldn’t be added: ${err.message}`;
        }
      }
      location.hash = `#/p/${encodeURIComponent(pool.id)}/admin`;
      toast(note);
    } catch (err) {
      errorSlot.replaceChildren(errorBox(err.message));
      errorSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
    }
  }

  applyTemplate('blank');
  render(
    h('h1', {}, 'Create a pool'),
    h('div', { class: 'card' },
      h('label', {}, 'Start from'),
      h('div', { class: 'row' },
        Object.entries({ blank: 'Blank', football: 'Weekly football picks', awards: 'Awards ballot', baby: 'Baby pool' })
          .map(([k, label]) => h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => applyTemplate(k) }, label))),
      slateButtons),
    h('form', { class: 'card', onsubmit: submit, novalidate: true },
      errorSlot,
      h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Pool name'), fields.name),
      h('div', { class: 'field' }, h('label', { for: 'f-desc' }, 'Description ', h('span', { class: 'hint' }, 'optional')), fields.description),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'f-fee' }, 'Entry fee ', h('span', { class: 'hint' }, 'optional, for showing the pot')), fields.entryFee),
        h('div', { class: 'field' }, h('label', { for: 'f-lock' }, 'Picks lock at ', h('span', { class: 'hint' }, 'optional; you can also lock by hand')), fields.lockAt)),
      claudeRow,
      h('h2', {}, 'Questions'),
      questionList,
      h('button', {
        type: 'button', class: 'btn btn-secondary btn-small',
        onclick: () => { questions.push({ prompt: '', lines: ['', ''], points: 1 }); drawQuestions(); },
      }, '+ Add question'),
      h('div', { class: 'field', style: 'margin-top:20px' },
        h('label', { for: 'f-tb' }, 'Tiebreaker ', h('span', { class: 'hint' }, 'optional number guess; closest wins ties')),
        fields.tiebreakerPrompt),
      h('button', { class: 'btn', type: 'submit' }, 'Create pool')));
}

// ---------- pool ----------

async function poolPage(id, initialTab) {
  render(h('div', { class: 'card empty' }, 'Loading…'));
  let pool;
  let admin = false;
  try {
    ({ pool, admin } = await api(`/pools/${encodeURIComponent(id)}`, { poolId: id }));
  } catch (err) {
    render(errorBox(err.message), h('a', { href: '#/' }, '← Back home'));
    return;
  }
  const c = creds(id);
  if (c.adminToken && !admin) savePool(id, { adminToken: undefined });
  const myEntry = pool.entries.find((e) => e.id === c.entryId && e.picks) ?? null;
  if (c.entryId && !myEntry) savePool(id, { entryId: undefined, editToken: undefined });
  savePool(id, { name: pool.name });
  document.title = `${pool.name} · Pool`;

  const tabs = [
    ['picks', myEntry ? 'My picks' : pool.locked ? 'Picks' : 'Enter'],
    ['leaderboard', 'Leaderboard'],
    pool.locked || admin ? ['all', 'All picks'] : null,
    admin ? ['admin', 'Organizer'] : null,
  ].filter(Boolean);
  let tab = tabs.some(([k]) => k === initialTab) ? initialTab
    : pool.locked || (myEntry && pool.leaderboard.decidedCount) ? 'leaderboard' : 'picks';

  const panel = h('div');
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });

  const refresh = (nextTab = tab) => poolPage(id, nextTab);
  function drawTabs() {
    tabBar.replaceChildren(...tabs.map(([k, label]) =>
      h('button', {
        class: 'tab', role: 'tab', 'aria-selected': String(k === tab),
        onclick: () => { tab = k; history.replaceState(null, '', `#/p/${encodeURIComponent(id)}/${k}`); drawTabs(); },
      }, label)));
    const views = { picks: picksTab, leaderboard: leaderboardTab, all: allPicksTab, admin: adminTab };
    panel.replaceChildren(views[tab](pool, { admin, myEntry, refresh }));
  }

  const shareUrl = `${location.origin}${location.pathname}#/p/${encodeURIComponent(id)}`;
  const lb = pool.leaderboard;
  render(
    h('section', { class: 'card' },
      h('div', { class: 'row spread' },
        h('h1', {}, pool.name),
        h('span', { class: `badge ${pool.locked ? 'locked' : ''}` }, pool.locked ? 'Locked' : 'Open for picks')),
      pool.description && h('p', { class: 'muted', style: 'white-space:pre-line' }, pool.description),
      h('div', { class: 'stats' },
        stat('Entries', pool.entries.length),
        pool.entryFee > 0 && stat('Pot', money(pool.pot)),
        stat('Results in', `${lb.decidedCount} / ${lb.totalQuestions}`),
        stat(pool.locked ? 'Locked' : 'Locks', pool.lockAt ? when(pool.lockAt) : 'By organizer')),
      h('label', { for: 'share' }, 'Invite link'),
      isLocalOnly() && localNotice(),
      h('div', { class: 'share' },
        h('input', { id: 'share', readonly: true, value: shareUrl, onfocus: (e) => e.target.select() }),
        canShare() && h('button', { class: 'btn', onclick: () => shareLink(pool.name, shareUrl) }, 'Share'),
        h('button', { class: 'btn btn-secondary', onclick: () => copy(shareUrl, 'Link copied. Paste it in a text or email.') }, 'Copy')),
      h('p', { class: 'small muted', style: 'margin:8px 0 0' },
        'Friends tap the link, type their name and make picks. ', h('a', { href: '#/help' }, 'How to invite'))),
    tabBar,
    panel);
  drawTabs();
}

// localhost only ever means "this device", so a link built from it can't
// work on anyone else's phone.
function isLocalOnly() {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname) || location.hostname.endsWith('.localhost');
}

function localNotice() {
  return h('div', { class: 'error', role: 'note' },
    h('strong', {}, 'This link only works on this phone. '),
    'You opened Pool at “localhost”, so invite links point back to this phone. Run ',
    h('code', {}, 'npm run share'), ' and open Pool from the https link it gives you. ',
    h('a', { href: '#/help' }, 'Show me how'));
}

const canShare = () => typeof navigator.share === 'function';

async function shareLink(title, url) {
  try {
    await navigator.share({ title, text: `Join my pool “${title}” and make your picks:`, url });
  } catch (err) {
    if (err?.name !== 'AbortError') copy(url, 'Link copied. Paste it in a text or email.');
  }
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
}

async function copy(textValue, message) {
  try {
    await navigator.clipboard.writeText(textValue);
    toast(message);
  } catch {
    prompt('Copy this:', textValue);
  }
}

function picksTab(pool, { myEntry, refresh }) {
  if (pool.locked && !myEntry) {
    return h('div', { class: 'card empty' }, 'Picks are locked. See the leaderboard and everyone’s picks.');
  }
  const editing = !!myEntry;
  const readOnly = pool.locked;
  const picks = { ...(myEntry?.picks ?? {}) };
  const errorSlot = h('div');
  const nameInput = h('input', { id: 'e-name', maxlength: '80', required: true, placeholder: 'Your name' });
  const tbInput = pool.tiebreaker && h('input', { id: 'e-tb', type: 'number', step: 'any', disabled: readOnly, value: myEntry?.tiebreakerGuess ?? '' });
  const radios = {};
  const hasOdds = pool.questions.some((q) => q.odds);

  function fill(chooseIndex, message) {
    for (const q of pool.questions) {
      const i = chooseIndex(q);
      picks[q.id] = q.options[i];
      radios[q.id][i].checked = true;
    }
    toast(message);
  }
  const rollDice = () => fill((q) => rollIndex(q.odds, q.options.length),
    hasOdds ? '🎲 Rolled! Favorites come up more often, but upsets happen.' : '🎲 Rolled! Every option had an equal chance.');
  const takeFavorites = () => fill((q) => favoriteIndex(q.odds, q.options.length), 'Picked the favorite in every game.');

  async function submit(e) {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    errorSlot.replaceChildren();
    try {
      const body = { picks, tiebreakerGuess: tbInput ? tbInput.value : undefined };
      if (editing) {
        await api(`/pools/${encodeURIComponent(pool.id)}/entries/${encodeURIComponent(myEntry.id)}`, { method: 'PUT', body, poolId: pool.id });
        toast('Picks updated');
      } else {
        body.name = nameInput.value;
        const res = await api(`/pools/${encodeURIComponent(pool.id)}/entries`, { method: 'POST', body, poolId: pool.id });
        savePool(pool.id, { entryId: res.entryId, editToken: res.editToken, entryName: body.name.trim() });
        toast('You’re in! You can change picks until the pool locks.');
      }
      refresh('picks');
    } catch (err) {
      errorSlot.replaceChildren(errorBox(err.message));
      errorSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
    }
  }

  return h('form', { class: 'card', onsubmit: submit, novalidate: true },
    errorSlot,
    editing
      ? h('div', { class: 'notice' }, readOnly
        ? `Your picks as ${myEntry.name}.`
        : `You’re entered as ${myEntry.name}. Change any pick and save before the pool locks.`)
      : h('div', { class: 'field' }, h('label', { for: 'e-name' }, 'Your name'), nameInput),
    !readOnly && h('div', { class: 'row', style: 'margin-bottom:4px' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: rollDice }, '🎲 Roll the dice'),
      hasOdds && h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: takeFavorites }, 'Pick all favorites'),
      h('span', { class: 'small muted' }, hasOdds ? 'Dice are weighted by the odds. Change any pick before you submit.' : 'Fills in random picks. Change any before you submit.')),
    pool.questions.map((q) => {
      const mine = picks[q.id];
      const chances = q.odds ? winChances(q.odds, q.options.length) : null;
      radios[q.id] = [];
      return h('fieldset', { class: 'question', style: 'border:0;margin:0;padding-left:0;padding-right:0' },
        h('legend', { style: 'padding:0' }, h('strong', {}, q.prompt), ' ', h('span', { class: 'meta' }, `${q.points} pt${q.points === 1 ? '' : 's'}`)),
        h('div', { class: 'choices' }, q.options.map((o, i) => {
          const radio = h('input', { type: 'radio', name: `q-${q.id}`, value: o, checked: mine === o, disabled: readOnly, onchange: () => { picks[q.id] = o; } });
          radios[q.id].push(radio);
          return h('label', { class: 'choice' }, radio,
            h('span', {}, o, chances && h('small', { class: 'odds' },
              q.odds[i] != null ? `${formatMoneyline(q.odds[i])} · ` : '', `${Math.round(chances[i] * 100)}%`)));
        })),
        q.result !== null && mine && h('div', { class: `pick-result ${mine === q.result ? 'good' : 'bad'}` },
          mine === q.result ? `✓ Correct, +${q.points}` : `✗ Answer: ${q.result}`));
    }),
    pool.tiebreaker && h('div', { class: 'field', style: 'margin-top:16px' },
      h('label', { for: 'e-tb' }, 'Tiebreaker: ', pool.tiebreaker.prompt),
      tbInput,
      pool.tiebreaker.answer !== null && h('div', { class: 'small muted' }, `Answer: ${pool.tiebreaker.answer}`)),
    !readOnly && h('button', { class: 'btn', type: 'submit', style: 'margin-top:8px' }, editing ? 'Save changes' : 'Submit picks'));
}

function leaderboardTab(pool, { myEntry }) {
  const lb = pool.leaderboard;
  if (!lb.rows.length) return h('div', { class: 'card empty' }, 'No entries yet. Share the invite link to get people in.');
  const hasTb = pool.tiebreaker && pool.tiebreaker.answer !== null;
  return h('div', { class: 'card' },
    lb.decidedCount === 0 && h('p', { class: 'muted small' }, 'No results yet. Scores update as the organizer marks winners.'),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '#'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'Points'),
          h('th', { class: 'num' }, 'Correct'), h('th', { class: 'num' }, 'Max possible'),
          hasTb && h('th', { class: 'num' }, 'Tiebreak off by'))),
        h('tbody', {}, lb.rows.map((r) =>
          h('tr', { class: r.entryId === myEntry?.id ? 'me' : '' },
            h('td', { class: 'rank' }, r.rank),
            h('td', {}, r.name),
            h('td', { class: 'num' }, h('strong', {}, r.score)),
            h('td', { class: 'num' }, `${r.correct} / ${r.decided}`),
            h('td', { class: 'num' }, r.maxScore),
            hasTb && h('td', { class: 'num' }, r.tiebreakerDiff ?? '—')))))));
}

function allPicksTab(pool) {
  if (!pool.entries.length) return h('div', { class: 'card empty' }, 'No entries yet.');
  return h('div', { class: 'card' },
    !pool.locked && h('p', { class: 'muted small' }, 'Only you as organizer can see this until the pool locks.'),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Name'),
          pool.questions.map((q) => h('th', {}, q.prompt)),
          pool.tiebreaker && h('th', { class: 'num' }, 'Tiebreak'))),
        h('tbody', {}, pool.entries.map((e) =>
          h('tr', {},
            h('td', {}, h('strong', {}, e.name)),
            pool.questions.map((q) => {
              const p = e.picks?.[q.id] ?? '—';
              const cls = q.result === null ? '' : p === q.result ? 'cell-good' : 'cell-bad';
              return h('td', { class: cls }, p);
            }),
            pool.tiebreaker && h('td', { class: 'num' }, e.tiebreakerGuess ?? '—')))),
        h('tfoot', {}, h('tr', {},
          h('th', {}, 'Result'),
          pool.questions.map((q) => h('th', {}, q.result ?? '—')),
          pool.tiebreaker && h('th', { class: 'num' }, pool.tiebreaker.answer ?? '—'))))));
}

function adminTab(pool, { refresh }) {
  const results = Object.fromEntries(pool.questions.map((q) => [q.id, q.result ?? '']));
  const errorSlot = h('div');
  const tbAnswer = pool.tiebreaker && h('input', { id: 'a-tb', type: 'number', step: 'any', value: pool.tiebreaker.answer ?? '' });
  const path = `/pools/${encodeURIComponent(pool.id)}`;
  const adminUrl = `${location.origin}${location.pathname}#/p/${encodeURIComponent(pool.id)}/admin`;

  async function patch(body, message) {
    errorSlot.replaceChildren();
    try {
      await api(path, { method: 'PATCH', body, poolId: pool.id });
      toast(message);
      refresh('admin');
    } catch (err) {
      errorSlot.replaceChildren(errorBox(err.message));
    }
  }

  return h('div', {},
    errorSlot,
    h('section', { class: 'card' },
      h('h2', {}, 'Picks'),
      h('p', { class: 'muted' }, pool.locked
        ? 'Picks are locked. Everyone can see all picks.'
        : 'Picks are open. Lock them when the first event starts so nobody can change answers.'),
      pool.locked
        ? h('button', { class: 'btn btn-secondary', onclick: () => patch({ locked: false }, 'Pool reopened') }, 'Reopen picks')
        : h('button', { class: 'btn', onclick: () => patch({ locked: true }, 'Pool locked') }, 'Lock picks now'),
      pool.lockAt && h('p', { class: 'small muted', style: 'margin:8px 0 0' }, `Scheduled lock: ${when(pool.lockAt)}. Reopening only overrides a manual lock.`)),
    h('form', {
      class: 'card',
      onsubmit: (e) => {
        e.preventDefault();
        const body = { results };
        if (tbAnswer) body.tiebreakerAnswer = tbAnswer.value;
        patch(body, 'Results saved');
      },
    },
      h('h2', {}, 'Results'),
      h('p', { class: 'muted' }, 'Mark winners as they happen. Leave a question on “Not decided” until it is.'),
      pool.questions.map((q) => {
        const select = h('select', { id: `r-${q.id}`, onchange: (e) => { results[q.id] = e.target.value; } },
          h('option', { value: '' }, 'Not decided'),
          q.options.map((o) => h('option', { value: o, selected: q.result === o }, o)));
        return h('div', { class: 'field' }, h('label', { for: `r-${q.id}` }, q.prompt), select);
      }),
      pool.tiebreaker && h('div', { class: 'field' }, h('label', { for: 'a-tb' }, `Tiebreaker answer: ${pool.tiebreaker.prompt}`), tbAnswer),
      h('button', { class: 'btn', type: 'submit' }, 'Save results')),
    h('section', { class: 'card' },
      h('h2', {}, 'Entries'),
      pool.entries.length === 0
        ? h('p', { class: 'muted' }, 'No entries yet.')
        : h('ul', { class: 'list' }, pool.entries.map((e) =>
          h('li', {},
            h('div', {}, h('strong', {}, e.name), h('div', { class: 'small muted' }, `Entered ${when(e.createdAt)}${e.updatedAt ? ` · edited ${when(e.updatedAt)}` : ''}`)),
            h('button', {
              class: 'btn btn-danger btn-small',
              onclick: async () => {
                if (!confirm(`Remove ${e.name}'s entry?`)) return;
                try {
                  await api(`${path}/entries/${encodeURIComponent(e.id)}`, { method: 'DELETE', poolId: pool.id });
                  toast('Entry removed');
                  refresh('admin');
                } catch (err) {
                  errorSlot.replaceChildren(errorBox(err.message));
                }
              },
            }, 'Remove'))))),
    h('section', { class: 'card' },
      h('h2', {}, 'Organizer access'),
      h('p', { class: 'muted' }, 'Organizer access is saved in this browser. Copy this private link to manage the pool from another device. Don’t share it.'),
      h('button', { class: 'btn btn-secondary', onclick: () => copy(`${adminUrl}?key=${creds(pool.id).adminToken}`, 'Organizer link copied') }, 'Copy organizer link'),
      h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:20px 0' }),
      h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirm(`Delete “${pool.name}” for everyone? This can’t be undone.`)) return;
          try {
            await api(path, { method: 'DELETE', poolId: pool.id });
            forgetPool(pool.id);
            toast('Pool deleted');
            location.hash = '#/';
          } catch (err) {
            errorSlot.replaceChildren(errorBox(err.message));
          }
        },
      }, 'Delete pool')));
}

// ---------- help ----------

const BROWSERS = {
  chrome: {
    label: 'Chrome (Android)',
    share: ['Open your pool and tap Share under the invite link.', 'Pick Messages, WhatsApp, email or any app, and send it.', 'No Share button? Tap Copy, then paste the link into a text.'],
    join: ['Tap the link in the text. It opens in Chrome.', 'Type your name, tap a team in every game (or 🎲 Roll the dice) and tap Submit picks.', 'To come back later, open the same link in Chrome. Pool remembers you there.'],
    home: 'Tap ⋮ (top right) → Add to Home screen, so the pool is one tap away.',
  },
  safari: {
    label: 'Safari (iPhone)',
    share: ['Open your pool and tap Share under the invite link.', 'Pick Messages, Mail or WhatsApp and send it.', 'No Share button? Tap Copy, then paste the link into a message.'],
    join: ['Tap the link in Messages. It opens in Safari.', 'Type your name, tap a team in every game (or 🎲 Roll the dice) and tap Submit picks.', 'To come back later, open the same link in Safari. Pool remembers you there.'],
    home: 'Tap the Share icon (□↑) at the bottom → Add to Home Screen.',
  },
  chromeios: {
    label: 'Chrome (iPhone)',
    share: ['Open your pool and tap Share under the invite link.', 'Pick Messages, Mail or WhatsApp and send it.', 'No Share button? Tap Copy, then paste the link into a message.'],
    join: ['Links from Messages open in Safari unless Chrome is your default browser (Settings → Apps → Chrome → Default Browser App).', 'Type your name, pick every game (or 🎲 Roll the dice) and tap Submit picks.', 'Always come back in the same browser you joined with. Pool remembers you per browser.'],
    home: 'Tap the Share icon (□↑) in the address bar → Add to Home Screen.',
  },
};

function helpPage() {
  document.title = 'How to invite · Pool';
  let current = /iPhone|iPad/.test(navigator.userAgent) ? (/CriOS/.test(navigator.userAgent) ? 'chromeios' : 'safari') : 'chrome';
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div');
  const steps = (items) => h('ol', {}, items.map((t) => h('li', {}, t)));

  function draw() {
    tabBar.replaceChildren(...Object.entries(BROWSERS).map(([k, b]) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(k === current), onclick: () => { current = k; draw(); } }, b.label)));
    const b = BROWSERS[current];
    panel.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, '2. Send the invite'), steps(b.share)),
      h('section', { class: 'card' }, h('h2', {}, '3. What your friends do'), steps(b.join),
        h('p', { class: 'small muted' }, 'Optional: ', b.home)));
  }

  render(
    h('h1', {}, 'How to invite people'),
    isLocalOnly() && localNotice(),
    h('section', { class: 'card' },
      h('h2', {}, '1. Get a link that works on other phones'),
      h('p', { class: 'muted' }, 'A link that starts with localhost only works on the phone running Pool. To get a real link, run Pool with a public address. In Termux:'),
      h('pre', { class: 'code' }, 'cd ~/Pool\ngit pull\npkg install cloudflared   # first time only\nnpm run share'),
      steps([
        'Wait for “Your public Pool link: https://….trycloudflare.com”.',
        'Open that https link in Chrome or Safari on your phone (long-press it in Termux → Open URL, or type it in).',
        'Create your pool from that page. Its invite link now works for anyone, on Wi-Fi or mobile data.',
        'Leave Termux running. Closing it or pressing Ctrl+C turns the link off. Each run makes a new link, so re-send invites if you restart.',
      ])),
    h('h2', { style: 'margin-top:24px' }, 'Pick your browser'),
    tabBar,
    panel,
    h('section', { class: 'card' },
      h('h2', {}, 'If something goes wrong'),
      h('ul', { class: 'muted' },
        h('li', {}, '“Can’t connect” or “Site can’t be reached”: Termux was closed or npm run share stopped. Start it again and send the new link.'),
        h('li', {}, 'Friend sees an empty form instead of their picks: they opened the link in a different browser. Use the one they joined with.'),
        h('li', {}, 'Lost organizer access on a new device: on the Organizer tab, use Copy organizer link and open it on the other device.'))));
  draw();
}

// Start last so every route's helpers and templates are defined.
window.addEventListener('hashchange', route);
route();
