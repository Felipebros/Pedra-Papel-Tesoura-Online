import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, limit, deleteDoc, getDocs, getDocFromServer } from 'firebase/firestore';

// Initialize Firebase
const rawConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Clean and validate
const firebaseOptions: any = {};
Object.entries(rawConfig).forEach(([key, value]) => {
  if (typeof value === 'string') {
    firebaseOptions[key] = value.trim().replace(/["']/g, '');
  } else {
    firebaseOptions[key] = value;
  }
});

// Diagnostic log (masked for security)
if (firebaseOptions.apiKey) {
  const key = firebaseOptions.apiKey;
  // console.log(`[Firebase Debug] API Key loaded: ${key.substring(0, 6)}...${key.substring(key.length - 4)} (Length: ${key.length})`);
  // console.log(`[Firebase Debug] Project ID: ${firebaseOptions.projectId}`);
} else {
  console.error("[Firebase Debug] API Key NOT found in environment variables!");
}

const app = initializeApp(firebaseOptions);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Test connection
async function testConnection() {
  try {
    // Try to fetch a non-existent doc just to test connectivity
    await getDocFromServer(doc(db, '_internal_', 'connection-test'));
    // console.log("[Firebase Debug] Firestore connection successful.");
  } catch (error: any) {
    if (error.message?.includes('the client is offline')) {
      console.error("[Firebase Debug] Firestore connection failed: Client is offline. Check your configuration.");
    } else {
      console.log("[Firebase Debug] Firestore reachable (received expected permission/not-found error).");
    }
  }
}
testConnection();

export const googleProvider = new GoogleAuthProvider();

// Auth helper
export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

// Types
export type Move = 'rock' | 'paper' | 'scissors';
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  stats: UserStats;
  isOnline?: boolean;
  status?: 'online' | 'away' | 'offline';
  lastSeen?: any;
  friends?: string[]; // Array of friend UIDs
  createdAt: any;
}

export interface FriendRequest {
  id: string;
  from: string;
  fromName: string;
  fromPhoto: string;
  to: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: any;
}

export interface GameSession {
  id: string;
  players: string[];
  playerData: Record<string, { displayName: string; photoURL: string }>;
  status: GameStatus;
  moves: Record<string, Move>;
  winner: string | 'draw' | null;
  sessionScore?: Record<string, number>;
  rematchRequests?: string[];
  createdAt: any;
  updatedAt: any;
}
