import { useEffect, useState } from 'react';
import { listQueued, subscribeQueue } from '../lib/offlineQueue.js';

export function useOfflineQueue() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => listQueued().then((rows) => alive && setItems(rows));
    refresh();
    const unsubscribe = subscribeQueue(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return items;
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
