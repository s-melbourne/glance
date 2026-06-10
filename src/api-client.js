const API_BASE = '/api';

let db;

function getDb() {
  if (db) return db;
  if (typeof Dexie === 'undefined') {
    return null;
  }

  db = new Dexie('glance-local');
  db.version(1).stores({
    chores: 'id,assignedUser,updatedAt',
    lists: 'id,listType,checked,updatedAt',
    meta: 'key,updatedAt',
  });

  return db;
}

async function putMeta(key, value) {
  const dexie = getDb();
  if (!dexie) return;
  await dexie.meta.put({ key, value, updatedAt: new Date().toISOString() });
}

async function getMeta(key) {
  const dexie = getDb();
  if (!dexie) return null;
  const row = await dexie.meta.get(key);
  return row ? row.value : null;
}

export async function fetchCalendarEvents() {
  try {
    const res = await fetch(`${API_BASE}/calendar`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    await putMeta('calendar-cache', { events, fetchedAt: payload.fetchedAt || new Date().toISOString() });
    return { events, fromCache: false };
  } catch {
    const cached = await getMeta('calendar-cache');
    if (cached && Array.isArray(cached.events)) {
      return { events: cached.events, fromCache: true };
    }
    return { events: [], fromCache: true };
  }
}

export async function getChores(userId) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  try {
    const res = await fetch(`${API_BASE}/chores${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const chores = Array.isArray(payload.chores) ? payload.chores : [];
    const dexie = getDb();
    if (dexie) await dexie.chores.bulkPut(chores);
    return chores;
  } catch {
    const dexie = getDb();
    if (!dexie) return [];
    if (userId) return dexie.chores.where('assignedUser').equals(userId).toArray();
    return dexie.chores.toArray();
  }
}

export async function createChore(payload) {
  const res = await fetch(`${API_BASE}/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to create chore (${res.status})`);
  const data = await res.json();
  const dexie = getDb();
  if (dexie && data.chore) await dexie.chores.put(data.chore);
  return data.chore;
}

export async function updateChore(id, payload) {
  const res = await fetch(`${API_BASE}/chores/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to update chore (${res.status})`);
  const data = await res.json();
  const dexie = getDb();
  if (dexie && data.chore) await dexie.chores.put(data.chore);
  return data.chore;
}

export async function getListItems(listType) {
  const res = await fetch(`${API_BASE}/lists?listType=${encodeURIComponent(listType)}`);
  if (!res.ok) throw new Error(`Failed to get list items (${res.status})`);
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const dexie = getDb();
  if (dexie) await dexie.lists.bulkPut(items);
  return items;
}

export async function createListItem(payload) {
  const res = await fetch(`${API_BASE}/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to create list item (${res.status})`);
  const data = await res.json();
  const dexie = getDb();
  if (dexie && data.item) await dexie.lists.put(data.item);
  return data.item;
}

export async function updateListItem(id, payload) {
  const res = await fetch(`${API_BASE}/lists/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to update list item (${res.status})`);
  const data = await res.json();
  const dexie = getDb();
  if (dexie && data.item) await dexie.lists.put(data.item);
  return data.item;
}

export async function deleteListItem(id, listType) {
  const res = await fetch(`${API_BASE}/lists/${encodeURIComponent(id)}?listType=${encodeURIComponent(listType)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete list item (${res.status})`);
  }
  const dexie = getDb();
  if (dexie) await dexie.lists.delete(id);
}
