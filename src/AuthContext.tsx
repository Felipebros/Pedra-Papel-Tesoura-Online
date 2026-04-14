import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db, UserProfile } from './firebase';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        // Initial check and creation if needed
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName || 'Jogador',
            photoURL: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
            stats: { wins: 0, losses: 0, draws: 0 },
            isOnline: true,
            status: 'online',
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp(),
          };
          await setDoc(userDocRef, newProfile);
        }

        // Real-time listener
        unsubscribeProfile = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setProfile(doc.data() as UserProfile);
          }
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  useEffect(() => {
    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      let awayTimer: any = null;
      let offlineTimer: any = null;
      let currentStatus: 'online' | 'away' | 'offline' = 'offline';

      const updateStatus = (status: 'online' | 'away' | 'offline') => {
        if (currentStatus === status) return;
        currentStatus = status;
        
        const data: any = {
          isOnline: status !== 'offline',
          status: status,
          lastSeen: serverTimestamp()
        };

        updateDoc(userDocRef, data).catch(console.error);
      };

      const clearAllTimers = () => {
        if (awayTimer) clearTimeout(awayTimer);
        if (offlineTimer) clearTimeout(offlineTimer);
      };

      const startPresenceTimers = () => {
        clearAllTimers();
        
        if (document.visibilityState === 'visible') {
          updateStatus('online');
          // Se ficar inativo por 5 min -> Ausente
          awayTimer = setTimeout(() => {
            updateStatus('away');
            // Se continuar inativo por mais 5 min -> Offline
            offlineTimer = setTimeout(() => {
              updateStatus('offline');
            }, 5 * 60 * 1000);
          }, 5 * 60 * 1000);
        } else {
          // Se trocar de aba -> Ausente imediatamente
          updateStatus('away');
          // Se ficar em outra aba por 5 min -> Offline
          offlineTimer = setTimeout(() => {
            updateStatus('offline');
          }, 5 * 60 * 1000);
        }
      };

      // Início
      startPresenceTimers();

      const handleActivity = () => {
        if (document.visibilityState === 'visible') {
          startPresenceTimers();
        }
      };

      const handleVisibilityChange = () => {
        startPresenceTimers();
      };

      const handleBeforeUnload = () => {
        // Tenta marcar como offline ao fechar
        updateStatus('offline');
      };

      window.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('mousemove', handleActivity);
      window.addEventListener('keydown', handleActivity);
      window.addEventListener('click', handleActivity);
      window.addEventListener('scroll', handleActivity);
      window.addEventListener('beforeunload', handleBeforeUnload);
      
      return () => {
        clearAllTimers();
        window.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('mousemove', handleActivity);
        window.removeEventListener('keydown', handleActivity);
        window.removeEventListener('click', handleActivity);
        window.removeEventListener('scroll', handleActivity);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        updateStatus('offline');
      };
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
