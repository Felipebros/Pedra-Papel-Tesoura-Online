import { 
  collection, 
  addDoc, 
  doc, 
  serverTimestamp, 
  query, 
  where, 
  getDocs, 
  deleteDoc,
  runTransaction,
  increment,
  setDoc,
  limit,
  updateDoc,
  onSnapshot as firestoreOnSnapshot,
  getDoc
} from 'firebase/firestore';
import { db, Move, GameSession } from './firebase';

export const findMatch = async (user: { uid: string, displayName: string, photoURL: string }) => {
  const matchmakingRef = collection(db, 'matchmaking');
  const q = query(matchmakingRef, where('uid', '!=', user.uid), limit(1));
  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    const opponentDoc = snapshot.docs[0];
    const opponent = opponentDoc.data();
    
    const gameData = {
      players: [user.uid, opponent.uid],
      playerData: {
        [user.uid]: { displayName: user.displayName, photoURL: user.photoURL },
        [opponent.uid]: { displayName: opponent.displayName, photoURL: opponent.photoURL }
      },
      status: 'playing',
      moves: {},
      winner: null,
      sessionScore: {
        [user.uid]: 0,
        [opponent.uid]: 0
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    const gameRef = await addDoc(collection(db, 'games'), gameData);
    await deleteDoc(doc(db, 'matchmaking', opponentDoc.id));
    return gameRef.id;
  } else {
    await setDoc(doc(db, 'matchmaking', user.uid), {
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL,
      createdAt: serverTimestamp()
    });
    return null;
  }
};

export const submitMove = async (gameId: string, userId: string, move: Move) => {
  const gameRef = doc(db, 'games', gameId);
  
  await runTransaction(db, async (transaction) => {
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists()) return;
    
    const data = gameDoc.data() as GameSession;
    const newMoves = { ...data.moves, [userId]: move };
    
    const playerIds = data.players;
    if (newMoves[playerIds[0]] && newMoves[playerIds[1]]) {
      const move1 = newMoves[playerIds[0]];
      const move2 = newMoves[playerIds[1]];
      let winner: string | 'draw' = 'draw';
      
      if (move1 !== move2) {
        if (
          (move1 === 'rock' && move2 === 'scissors') ||
          (move1 === 'paper' && move2 === 'rock') ||
          (move1 === 'scissors' && move2 === 'paper')
        ) {
          winner = playerIds[0];
        } else {
          winner = playerIds[1];
        }
      }
      
      const user1Ref = doc(db, 'users', playerIds[0]);
      const user2Ref = doc(db, 'users', playerIds[1]);
      
      const sessionScore = data.sessionScore || { [playerIds[0]]: 0, [playerIds[1]]: 0 };
      const newSessionScore = { ...sessionScore };

      if (winner === 'draw') {
        transaction.update(user1Ref, { 'stats.draws': increment(1) });
        transaction.update(user2Ref, { 'stats.draws': increment(1) });
      } else {
        const loserId = playerIds.find(id => id !== winner)!;
        transaction.update(doc(db, 'users', winner), { 'stats.wins': increment(1) });
        transaction.update(doc(db, 'users', loserId), { 'stats.losses': increment(1) });
        newSessionScore[winner] = (newSessionScore[winner] || 0) + 1;
      }

      transaction.update(gameRef, {
        moves: newMoves,
        status: 'finished',
        winner,
        sessionScore: newSessionScore,
        updatedAt: serverTimestamp()
      });

      // Archive the result for history
      const resultRef = collection(db, 'game_results');
      addDoc(resultRef, {
        gameId: gameId,
        players: playerIds,
        playerData: data.playerData,
        moves: newMoves,
        winner,
        createdAt: serverTimestamp()
      });
    } else {
      transaction.update(gameRef, {
        moves: newMoves,
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const requestRematch = async (gameId: string, userId: string) => {
  const gameRef = doc(db, 'games', gameId);
  
  await runTransaction(db, async (transaction) => {
    const gameDoc = await transaction.get(gameRef);
    if (!gameDoc.exists()) return;
    
    const data = gameDoc.data() as GameSession;
    const currentRequests = data.rematchRequests || [];
    
    if (currentRequests.includes(userId)) return;
    
    const newRequests = [...currentRequests, userId];
    
    if (newRequests.length === 2) {
      // Both agreed, reset the game
      transaction.update(gameRef, {
        status: 'playing',
        moves: {},
        winner: null,
        rematchRequests: [],
        updatedAt: serverTimestamp()
      });
    } else {
      transaction.update(gameRef, {
        rematchRequests: newRequests,
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const resetRound = async (gameId: string) => {
  const gameRef = doc(db, 'games', gameId);
  await updateDoc(gameRef, {
    status: 'playing',
    moves: {},
    winner: null,
    updatedAt: serverTimestamp()
  });
};

export const abandonGame = async (gameId: string) => {
  const gameRef = doc(db, 'games', gameId);
  await updateDoc(gameRef, {
    status: 'abandoned',
    updatedAt: serverTimestamp()
  });
};

export const sendInvite = async (fromUser: { uid: string, displayName: string, photoURL: string }, toUid: string) => {
  const invitesRef = collection(db, 'invites');
  await addDoc(invitesRef, {
    from: fromUser.uid,
    fromName: fromUser.displayName,
    fromPhoto: fromUser.photoURL,
    to: toUid,
    status: 'pending',
    createdAt: serverTimestamp()
  });
};

export const acceptInvite = async (inviteId: string) => {
  const inviteRef = doc(db, 'invites', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return;
  
  const inviteData = inviteSnap.data();
  
  // Create game
  const fromUserDoc = await getDoc(doc(db, 'users', inviteData.from));
  const toUserDoc = await getDoc(doc(db, 'users', inviteData.to));
  
  if (!fromUserDoc.exists() || !toUserDoc.exists()) return;
  
  const fromUser = fromUserDoc.data();
  const toUser = toUserDoc.data();

  const gameData = {
    players: [inviteData.from, inviteData.to],
    playerData: {
      [inviteData.from]: { displayName: fromUser.displayName, photoURL: fromUser.photoURL },
      [inviteData.to]: { displayName: toUser.displayName, photoURL: toUser.photoURL }
    },
    status: 'playing',
    moves: {},
    winner: null,
    sessionScore: {
      [inviteData.from]: 0,
      [inviteData.to]: 0
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  
  const gameRef = await addDoc(collection(db, 'games'), gameData);
  
  await updateDoc(inviteRef, {
    status: 'accepted',
    gameId: gameRef.id,
    updatedAt: serverTimestamp()
  });
  
  return gameRef.id;
};

export const declineInvite = async (inviteId: string) => {
  const inviteRef = doc(db, 'invites', inviteId);
  await updateDoc(inviteRef, {
    status: 'declined',
    updatedAt: serverTimestamp()
  });
};
