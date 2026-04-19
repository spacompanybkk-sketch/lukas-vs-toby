import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || 'demo-key',
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL || 'https://demo-default-rtdb.firebaseio.com',
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || 'demo-project',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
