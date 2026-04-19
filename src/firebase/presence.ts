import { ref, onValue, set, onDisconnect, serverTimestamp } from 'firebase/database';
import { db } from './config';

export type Player = 'lukas' | 'toby';

export function goOnline(player: Player): void {
  const presenceRef = ref(db, `presence/${player}`);
  const connectedRef = ref(db, '.info/connected');

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      set(presenceRef, { online: true, lastSeen: serverTimestamp() });
      onDisconnect(presenceRef).set({ online: false, lastSeen: serverTimestamp() });
    }
  });
}

export function watchOpponent(
  player: Player,
  callback: (online: boolean) => void,
): () => void {
  const opponent: Player = player === 'lukas' ? 'toby' : 'lukas';
  const opponentRef = ref(db, `presence/${opponent}`);

  const unsubscribe = onValue(opponentRef, (snap) => {
    const data = snap.val();
    callback(data?.online === true);
  });

  return unsubscribe;
}
