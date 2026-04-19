import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCToJM-qajO9KJRzsaYm1gSGT2mjqUutfs',
  authDomain: 'lukas-toby-plants-vs-zombies.firebaseapp.com',
  databaseURL: 'https://lukas-toby-plants-vs-zombies-default-rtdb.firebaseio.com',
  projectId: 'lukas-toby-plants-vs-zombies',
  storageBucket: 'lukas-toby-plants-vs-zombies.firebasestorage.app',
  messagingSenderId: '354508032840',
  appId: '1:354508032840:web:8324d4b1d2e61f6168417d',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
