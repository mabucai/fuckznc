import {SharedCounter, randomId} from './counter.js';

const shots = [
  ['红头带', '戴红头带，笑着看镜头'],
  ['双手入镜', '两只手在镜头前比划'],
  ['对对对', '手扶额头，画面下方有粉色字幕'],
  ['侧头一笑', '戴红头带，歪头看镜头'],
  ['闭眼一秒', '闭着眼睛面对镜头'],
  ['双重画框', '双手围成画框，画面内还有一个小窗口'],
  ['老铁 678K', '动态表情，下方写着老铁 678K'],
];
const el = id => document.getElementById(id);
const format = new Intl.NumberFormat('zh-CN');
const number = n => format.format(n);
const localDay = () => new Date().toLocaleDateString('en-CA');
const asset = i => './assets/' + String(i + 1).padStart(2, '0') + (i === 6 ? '.gif' : '.webp');

let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('fuckznc.player.v1')) || {}; } catch {}
if (!preferences.client) preferences.client = randomId();
let selected = Number.isInteger(preferences.selected) && shots[preferences.selected] ? preferences.selected : 0;
let session = 0, combo = 0, lastHit = -Infinity, audio, toastTimer, popTimer;
let queueStorage;
try { queueStorage = window.sessionStorage; } catch {}

function save() {
  try { localStorage.setItem('fuckznc.player.v1', JSON.stringify(preferences)); } catch {}
}

function renderPlayer() {
  el('today').textContent = number(preferences.day === localDay() ? preferences.today || 0 : 0);
  el('session').textContent = number(session);
  el('best').textContent = number(preferences.best || 0) + '×';
  el('sound').setAttribute('aria-pressed', String(!!preferences.sound));
  el('sound').textContent = preferences.sound ? '音效 · 开' : '音效 · 关';
}

function selectShot(i) {
  selected = preferences.selected = i;
  el('photo').src = asset(i);
  el('photo').alt = shots[i][1];
  el('caption').textContent = shots[i][0];
  el('screen').setAttribute('aria-label', '给「' + shots[i][0] + '」加一票');
  el('position').textContent = String(i + 1).padStart(2, '0') + ' / 07';
  Array.from(el('film').children).forEach((button, index) => button.setAttribute('aria-pressed', String(index === i)));
  save();
}
for (const [index, [label]] of shots.entries()) {
  const button = document.createElement('button');
  button.title = label;
  button.setAttribute('aria-label', '放映「' + label + '」');
  const thumbnail = new Image();
  thumbnail.src = asset(index);
  thumbnail.alt = '';
  button.append(thumbnail);
  button.addEventListener('click', () => selectShot(index));
  el('film').append(button);
}

function renderRanking(target, rows, emptyText) {
  const items = rows.map(({id, value}) => {
    const item = document.createElement('li');
    const amount = document.createElement('b');
    amount.textContent = number(value);
    item.append(shots[id][0], amount);
    return item;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.textContent = emptyText;
    items.push(empty);
  }
  target.replaceChildren(...items);
}

const counter = new SharedCounter({
  baseUrl: 'https://fuckznc.ochre-gull-3398.chatgpt.site',
  client: preferences.client, storage: queueStorage,
  onChange({total, photos, status, pending}) {
    el('total').textContent = total === null ? '—' : number(total);
    const states = {online:'全站实时计数',connecting:'正在连接全站',offline:'等待恢复连接',limited:'点击正在排队'};
    el('connection').textContent = states[status];
    el('light').classList.toggle('on', status === 'online');
    el('pending').textContent = pending ? number(pending) + ' 次待同步' : '每 5 秒同步';
    const rows = [...photos].sort((a,b) => b.value - a.value || a.id - b.id);
    const empty = total === null ? '等待连接全站。' : '还没有记录，点一下就能上榜。';
    renderRanking(el('top'), rows.slice(0,3), empty);
    renderRanking(el('full'), rows, empty);
  }
});

function playTone() {
  if (!preferences.sound) return;
  try {
    audio ||= new AudioContext();
    audio.resume().catch(() => {});
    const tone = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    tone.frequency.setValueAtTime(240 + Math.min(combo,12)*18, now);
    tone.frequency.exponentialRampToValueAtTime(100, now + .08);
    gain.gain.setValueAtTime(.09,now);
    gain.gain.exponentialRampToValueAtTime(.001,now + .1);
    tone.connect(gain).connect(audio.destination);
    tone.start(); tone.stop(now + .1);
  } catch {}
}
function hit() {
  const now = performance.now();
  if (now - lastHit < 45) return;
  combo = now - lastHit < 1100 ? combo + 1 : 1;
  lastHit = now;
  session++;
  const day = localDay();
  preferences.today = (preferences.day === day ? preferences.today || 0 : 0) + 1;
  preferences.day = day;
  preferences.best = Math.max(preferences.best || 0, combo);
  counter.record(selected + 1);
  save(); renderPlayer(); playTone();
  el('pop').textContent = combo > 1 ? combo + ' 连击' : '+1';
  el('pop').hidden = false;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { el('pop').hidden = true; }, 780);
  el('hit').classList.add('pressed');
  setTimeout(() => el('hit').classList.remove('pressed'), 90);
}

el('hit').addEventListener('click', hit);
el('screen').addEventListener('click', hit);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || el('ranking').open) return;
  if (event.repeat) { event.preventDefault(); return; }
  if (event.target.closest('button,a,input,select,textarea,[contenteditable]')) return;
  event.preventDefault(); hit();
});
el('shuffle').addEventListener('click', () => selectShot((selected + 1 + Math.floor(Math.random() * (shots.length - 1))) % shots.length));
el('sound').addEventListener('click', () => {
  preferences.sound = !preferences.sound;
  save(); renderPlayer(); playTone();
});
el('all').addEventListener('click', () => el('ranking').showModal());
el('close').addEventListener('click', () => el('ranking').close());
el('share').addEventListener('click', async () => {
  const url = new URL('./', location.href).href;
  let message = '链接已复制';
  try {
    if (navigator.share) { await navigator.share({title:'fuckznc',url}); return; }
    await navigator.clipboard.writeText(url);
  } catch (error) {
    if (error.name === 'AbortError') return;
    message = url;
  }
  el('toast').textContent = message;
  el('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 3500);
});
function reconnect() {
  counter.retryAt = 0;
  counter.flush(); counter.refresh();
}
function sendPending() {
  if (navigator.sendBeacon) counter.beacon(navigator.sendBeacon.bind(navigator));
}
addEventListener('online', reconnect);
addEventListener('pagehide', sendPending);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sendPending();
  else { renderPlayer(); reconnect(); }
});
selectShot(selected);
renderPlayer();
counter.start();
