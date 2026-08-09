import { useEffect, useState } from 'react';
import { useYoinClient } from '@yoin/client/react';

type Status = 'normal' | 'watch' | 'incident';
type EventKind = 'note' | 'watch' | 'incident' | 'resolved';

type Handover = {
  teamName?: string;
  shift?: string;
  status?: Status;
  summary?: string;
  onCall?: string;
  updatedAt?: string;
};

type HandoverEvent = {
  id: string;
  kind: EventKind;
  message: string;
  author: string;
  createdAt: string;
};

const statusLabel: Record<Status, string> = {
  normal: '正常',
  watch: '觀察中',
  incident: '處理事故',
};

function useMapSnapshot<T>(name: string): T {
  const client = useYoinClient();
  const [snapshot, setSnapshot] = useState<T>(() => client.getMap(name) as T);

  useEffect(() => {
    const refresh = () => setSnapshot(client.getMap(name) as T);
    refresh();
    return client.subscribe(refresh);
  }, [client, name]);

  return snapshot;
}

function useArraySnapshot<T>(name: string): T[] {
  const client = useYoinClient();
  const [snapshot, setSnapshot] = useState<T[]>(() => client.getArray(name) as T[]);

  useEffect(() => {
    const refresh = () => setSnapshot(client.getArray(name) as T[]);
    refresh();
    return client.subscribe(refresh);
  }, [client, name]);

  return snapshot;
}

function Presence() {
  const client = useYoinClient();
  const [awareness, setAwareness] = useState(() => new Map(client.getAwarenessStates()));
  const [name, setName] = useState(() => localStorage.getItem('yoin-handover-name') ?? '值班同事');

  useEffect(() => client.onAwarenessChange((states) => {
    // Copy the mutable Map so React receives a new value only when awareness
    // events arrive, rather than deriving a snapshot during rendering.
    setAwareness(new Map(states));
  }), [client]);

  useEffect(() => {
    localStorage.setItem('yoin-handover-name', name);
    client.setAwareness({ name, color: '#2563eb', device: 'desktop' });
  }, [client, name]);

  return (
    <section className="presence">
      <label>
        我的名稱
        <input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="people" aria-label="在線成員">
        {Array.from(awareness.values()).map((person) => (
          <span className="person" key={person.clientId} style={{ borderColor: person.color }}>
            <i style={{ background: person.color }} />{person.name || '未命名'}
          </span>
        ))}
      </div>
    </section>
  );
}

function StatusCard() {
  const client = useYoinClient();
  const handover = useMapSnapshot<Handover>('handover');
  const write = (key: keyof Handover, value: string) => {
    void client.setMap('handover', key, value);
    void client.setMap('handover', 'updatedAt', new Date().toISOString());
  };

  return (
    <section className="card status-card">
      <div className="section-heading"><div><p className="eyebrow">共同狀態</p><h2>{handover.teamName || '尚未命名的團隊'}</h2></div>
        <span className={`badge ${handover.status ?? 'normal'}`}>{statusLabel[handover.status ?? 'normal']}</span></div>
      <div className="form-grid">
        <label>團隊<input value={handover.teamName ?? ''} placeholder="例：前場" onChange={(e) => write('teamName', e.target.value)} /></label>
        <label>班別<input value={handover.shift ?? ''} placeholder="例：2026-01-01 日班" onChange={(e) => write('shift', e.target.value)} /></label>
        <label>值班負責人<input value={handover.onCall ?? ''} placeholder="例：Mina" onChange={(e) => write('onCall', e.target.value)} /></label>
        <label>服務狀態<select value={handover.status ?? 'normal'} onChange={(e) => write('status', e.target.value)}>{(Object.keys(statusLabel) as Status[]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}</select></label>
      </div>
      <label>交班摘要<textarea value={handover.summary ?? ''} placeholder="下一位值班者需要知道什麼？" onChange={(e) => write('summary', e.target.value)} /></label>
      {handover.updatedAt && <p className="muted">最後共同更新：{new Date(handover.updatedAt).toLocaleString()}</p>}
    </section>
  );
}

function EventLog() {
  const client = useYoinClient();
  const events = useArraySnapshot<HandoverEvent>('events');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<EventKind>('note');
  const myName = localStorage.getItem('yoin-handover-name') ?? '值班同事';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    void client.pushArray('events', { id: crypto.randomUUID(), kind, message: trimmed, author: myName, createdAt: new Date().toISOString() });
    setMessage('');
  };

  return (
    <section className="card log-card">
      <div className="section-heading"><div><p className="eyebrow">不可變紀錄</p><h2>事件時間線</h2></div><span className="muted">{events.length} 筆</span></div>
      <form onSubmit={submit} className="event-form">
        <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)}><option value="note">備註</option><option value="watch">觀察</option><option value="incident">事故</option><option value="resolved">已排除</option></select>
        <input value={message} maxLength={240} onChange={(e) => setMessage(e.target.value)} placeholder="新增交班事件…" />
        <button type="submit">記錄</button>
      </form>
      <ol className="timeline">
        {[...events].reverse().map((item) => <li key={item.id} className={item.kind}><span>{item.kind}</span><div><strong>{item.message}</strong><small>{item.author} · {new Date(item.createdAt).toLocaleString()}</small></div></li>)}
      </ol>
    </section>
  );
}

export function App({ room, undo, redo }: { room: string; undo: () => void; redo: () => void }) {
  const client = useYoinClient();
  const [online, setOnline] = useState(client.network.isConnected);

  useEffect(() => {
    client.subscribeNetwork((status) => setOnline(status === 'online'));
  }, [client]);

  return <main>
    <header><div><p className="eyebrow">Yoin 外部 consumer 範例</p><h1>協作交班板</h1><p className="subtitle">所有人共同維護當前狀態；斷線時照常編輯，重連後由 CRDT 合併。</p></div>
      <div className="connection"><span className={online ? 'dot online' : 'dot'} />{online ? '已連線' : '離線／連線中'}<code>room: {room}</code></div></header>
    <Presence />
    <div className="toolbar"><button onClick={undo}>復原我的操作</button><button onClick={redo}>重做</button><button onClick={() => client.network.reconnect()}>重新連線</button><span>以 <code>?room=team-a</code> 開第二個視窗即可協作。</span></div>
    <div className="layout"><StatusCard /><EventLog /></div>
  </main>;
}
