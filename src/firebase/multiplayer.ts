import { ref, set, push, onValue, onChildAdded, remove, serverTimestamp } from 'firebase/database';
import { db } from './config';
import type { Player } from './presence';

export interface GameAction {
  type: 'place_unit' | 'game_over';
  player: Player;
  unitKey?: string;
  row?: number;
  col?: number;
  winner?: 'plants' | 'zombies';
  timestamp?: object;
}

export interface GameRoom {
  id: string;
  lukas: { ready: boolean };
  toby: { ready: boolean };
  status: 'waiting' | 'playing' | 'finished';
}

export function createGameRoom(): string {
  const roomRef = push(ref(db, 'rooms'));
  set(roomRef, {
    lukas: { ready: false },
    toby: { ready: false },
    status: 'waiting',
    createdAt: serverTimestamp(),
  });
  return roomRef.key!;
}

export function joinRoom(roomId: string, player: Player): void {
  set(ref(db, `rooms/${roomId}/${player}/ready`), true);
}

export function watchRoom(roomId: string, callback: (room: GameRoom | null) => void): () => void {
  const roomRef = ref(db, `rooms/${roomId}`);
  return onValue(roomRef, (snap) => {
    const data = snap.val();
    if (data) {
      callback({ id: roomId, ...data });
    } else {
      callback(null);
    }
  });
}

export function sendAction(roomId: string, action: GameAction): void {
  const actionsRef = ref(db, `rooms/${roomId}/actions`);
  push(actionsRef, { ...action, timestamp: serverTimestamp() });
}

export function watchActions(roomId: string, callback: (action: GameAction) => void): () => void {
  const actionsRef = ref(db, `rooms/${roomId}/actions`);
  return onChildAdded(actionsRef, (snap) => {
    callback(snap.val());
  });
}

export function setRoomStatus(roomId: string, status: 'waiting' | 'playing' | 'finished'): void {
  set(ref(db, `rooms/${roomId}/status`), status);
}

export function deleteRoom(roomId: string): void {
  remove(ref(db, `rooms/${roomId}`));
}

export function sendChallenge(fromPlayer: Player, roomId: string): void {
  const toPlayer: Player = fromPlayer === 'lukas' ? 'toby' : 'lukas';
  set(ref(db, `challenges/${toPlayer}`), { roomId, from: fromPlayer });
}

export function watchChallenge(player: Player, callback: (data: { roomId: string; from: Player } | null) => void): () => void {
  const challengeRef = ref(db, `challenges/${player}`);
  return onValue(challengeRef, (snap) => {
    callback(snap.val());
  });
}

export function clearChallenge(player: Player): void {
  remove(ref(db, `challenges/${player}`));
}
