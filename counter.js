const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{20,64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function randomId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
export class SharedCounter {
  constructor({baseUrl, client, storage, fetcher = globalThis.fetch.bind(globalThis), onChange = () => {}}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = client;
    this.storage = storage;
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.total = null;
    this.photos = [];
    this.status = 'connecting';
    this.queue = [];
    this.sending = false;
    this.generation = 0;
    this.retryAt = 0;
    try {
      const queue = JSON.parse(storage?.getItem('fuckznc.shared.queue.v2') || '[]');
      if (Array.isArray(queue)) this.queue = queue.filter(item => validId(item.id) && validId(item.client) && Number.isInteger(item.amount) && item.amount > 0 && item.amount <= 100 && Number.isInteger(item.photo) && item.photo >= 1 && item.photo <= 7 && item.region === 'XX').map(item => ({...item, sealed:true}));
    } catch {}
  }
  get snapshot() {
    return {total:this.total, photos:this.photos, status:this.status, pending:this.queue.reduce((n,item) => n + item.amount, 0)};
  }
  emit() { this.onChange(this.snapshot); }
  save() { try { this.storage?.setItem('fuckznc.shared.queue.v2', JSON.stringify(this.queue)); } catch {} }
  record(photo) {
    if (!Number.isInteger(photo) || photo < 1 || photo > 7) return;
    const last = this.queue.at(-1);
    if (last && !last.sealed && last.photo === photo && last.amount < 100) last.amount++;
    else this.queue.push({id:randomId(),client:this.client,amount:1,photo,region:'XX',sealed:false});
    this.save();
    this.emit();
  }
  accept(data) {
    if (!data || !integer(data.total) || !Array.isArray(data.photos) || !data.photos.every(row => integer(row.id) && row.id < 7 && integer(row.value))) throw Error('Invalid counter response');
    // A slower earlier request must never rewind a newer global snapshot.
    if (this.total === null || data.total >= this.total) { this.total = data.total; this.photos = data.photos; }
    this.status = 'online';
  }
  async refresh() {
    if (this.sending) return;
    const generation = this.generation;
    try {
      const response = await this.fetcher(this.baseUrl + '/api/stats', {cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw Error('Counter unavailable');
      const data = await response.json();
      if (generation !== this.generation) return;
      this.accept(data);
    } catch { if (generation === this.generation) this.status = 'offline'; }
    this.emit();
  }
  async flush() {
    if (this.sending || !this.queue.length || Date.now() < this.retryAt) return;
    this.sending = true;
    this.generation++;
    const batch = this.queue[0];
    batch.sealed = true;
    this.save();
    try {
      const {sealed,...body} = batch;
      const response = await this.fetcher(this.baseUrl + '/api/click', {method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),keepalive:true});
      if (response.status === 429) { this.retryAt = Date.now() + 10000; this.status = 'limited'; return; }
      if (!response.ok) throw Error('Counter unavailable');
      const data = await response.json();
      this.accept(data);
      this.queue = this.queue.filter(item => item.id !== batch.id);
      this.save();
      this.retryAt = 0;
    } catch { this.status = 'offline'; this.retryAt = Date.now() + 4000; }
    finally { this.sending = false; this.emit(); }
  }
  beacon(sendBeacon) {
    const batch = this.queue[0];
    if (!batch) return;
    // Keep the same immutable ID until the server acknowledges it after return/reload.
    batch.sealed = true;
    this.save();
    const {sealed,...body} = batch;
    try { sendBeacon(this.baseUrl + '/api/click', new Blob([JSON.stringify(body)], {type:'application/json'})); } catch {}
  }
  start() {
    this.emit();
    this.refresh();
    this.flushTimer = setInterval(() => this.flush(), 700);
    this.refreshTimer = setInterval(() => {if (!globalThis.document?.hidden) this.refresh();}, 5000);
  }
  stop() {clearInterval(this.flushTimer);clearInterval(this.refreshTimer);}
}
