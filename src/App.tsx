import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  User as UserIcon, 
  LogOut, 
  Play, 
  Hand, 
  RotateCcw, 
  Medal,
  Swords,
  Loader2,
  History,
  X
} from 'lucide-react';
import { useAuth, AuthProvider } from './AuthContext';
import { loginWithGoogle, logout, Move, GameSession, UserProfile, db } from './firebase';
import { findMatch, submitMove, requestRematch, abandonGame, resetRound } from './gameService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { collection, query, orderBy, limit, onSnapshot, doc, deleteDoc, where, getDoc } from 'firebase/firestore';

const GameUI = () => {
  const { user, profile, loading } = useAuth();
  const [gameState, setGameState] = useState<'idle' | 'searching' | 'playing' | 'result'>('idle');
  const [currentGame, setCurrentGame] = useState<GameSession | null>(null);
  const [selectedMove, setSelectedMove] = useState<Move | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [searchStartTime, setSearchStartTime] = useState<number>(0);
  const [showHistory, setShowHistory] = useState(false);
  const [matchHistory, setMatchHistory] = useState<GameSession[]>([]);
  const [headToHead, setHeadToHead] = useState({ wins: 0, losses: 0, draws: 0 });
  const [lastMoves, setLastMoves] = useState<Record<string, Move>>({});
  const [lastWinner, setLastWinner] = useState<string | 'draw' | null>(null);

  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add('dark');
    
    const q = query(collection(db, 'users'), orderBy('stats.wins', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data() as UserProfile);
      setLeaderboard(users);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && showHistory) {
      const q = query(
        collection(db, 'games'),
        where('players', 'array-contains', user.uid),
        where('status', '==', 'finished')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameSession));
        // Sort client-side to avoid index requirement
        setMatchHistory(games.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
      });
      return () => unsubscribe();
    }
  }, [user, showHistory]);

  useEffect(() => {
    if (user && currentGame) {
      const opponentId = currentGame.players.find(id => id !== user.uid);
      if (opponentId) {
        const q = query(
          collection(db, 'games'),
          where('players', 'array-contains', user.uid),
          where('status', '==', 'finished')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
          let wins = 0, losses = 0, draws = 0;
          snapshot.docs.forEach(doc => {
            const data = doc.data() as GameSession;
            if (data.players.includes(opponentId)) {
              if (data.winner === user.uid) wins++;
              else if (data.winner === 'draw') draws++;
              else if (data.winner === opponentId) losses++;
            }
          });
          setHeadToHead({ wins, losses, draws });
        });
        return () => unsubscribe();
      }
    }
  }, [user, currentGame?.id]);

  useEffect(() => {
    if (gameState === 'searching' && user && searchStartTime > 0) {
      // Simplified query to avoid index requirements
      const q = query(
        collection(db, 'games'), 
        where('players', 'array-contains', user.uid), 
        where('status', '==', 'playing')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          // Find the most recent game from the results
          const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GameSession));
          
          // Filter for games created AFTER we started searching (with a small grace period)
          const validGames = games.filter(g => {
            const createdAt = g.createdAt?.toMillis?.() || 0;
            return createdAt >= searchStartTime - 2000; // 2s grace
          });

          if (validGames.length > 0) {
            const latestGame = validGames.sort((a, b) => {
              const timeA = a.createdAt?.toMillis?.() || 0;
              const timeB = b.createdAt?.toMillis?.() || 0;
              return timeB - timeA;
            })[0];

            setCurrentGame(latestGame);
            setGameState('playing');
            toast.success("Partida iniciada!");
          }
        }
      });
      return () => unsubscribe();
    }
  }, [gameState, user, searchStartTime]);

  useEffect(() => {
    if (currentGame?.id) {
      const unsubscribe = onSnapshot(doc(db, 'games', currentGame.id), (doc) => {
        if (doc.exists()) {
          const game = { id: doc.id, ...doc.data() } as GameSession;
          setCurrentGame(game);
          
          // Reset local move state when a new round starts (status is playing and our move is gone)
          if (game.status === 'playing' && !game.moves[user.uid]) {
            setSelectedMove(null);
          }

          if (game.status === 'finished') {
            setLastMoves(game.moves);
            setLastWinner(game.winner);
          }

          if (game.status === 'abandoned') {
            toast.error("O oponente saiu da partida.");
            resetGame();
          }
        }
      });
      return () => unsubscribe();
    }
  }, [currentGame?.id, user?.uid]);

  useEffect(() => {
    if (currentGame?.status === 'finished') {
      const timer = setTimeout(() => {
        resetRound(currentGame.id).catch(console.error);
      }, 3000); // 3 seconds is a good middle ground
      return () => clearTimeout(timer);
    }
  }, [currentGame?.status, currentGame?.id]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentGame?.id && (gameState === 'playing' || gameState === 'searching')) {
        // We can't await here, but we can try to send the update
        abandonGame(currentGame.id);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentGame?.id, gameState]);

  const handleStartSearch = async () => {
    if (!profile) return;
    
    // Reset states
    setCurrentGame(null);
    setSelectedMove(null);
    const now = Date.now();
    setSearchStartTime(now);
    setGameState('searching');
    
    try {
      const gameId = await findMatch(profile);
      if (gameId) {
        // If we found a match, fetch it immediately
        const gameDoc = await getDoc(doc(db, 'games', gameId));
        if (gameDoc.exists()) {
          const gameData = { id: gameDoc.id, ...gameDoc.data() } as GameSession;
          setCurrentGame(gameData);
          setGameState('playing');
          toast.success("Oponente encontrado!");
        }
      } else {
        toast.info("Procurando oponente...");
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro ao procurar partida.");
      setGameState('idle');
      setSearchStartTime(0);
    }
  };

  const handleCancelSearch = async () => {
    if (!user) return;
    await deleteDoc(doc(db, 'matchmaking', user.uid));
    resetGame();
  };

  const handleMove = async (move: Move) => {
    if (!currentGame || !user) return;
    setSelectedMove(move);
    try {
      await submitMove(currentGame.id, user.uid, move);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao enviar jogada.");
    }
  };

  const resetGame = () => {
    if (currentGame?.id && (gameState === 'playing' || gameState === 'searching')) {
      abandonGame(currentGame.id).catch(console.error);
    }
    setGameState('idle');
    setCurrentGame(null);
    setSelectedMove(null);
  };

  const handleRematch = async () => {
    if (!currentGame || !user) return;
    try {
      await requestRematch(currentGame.id, user.uid);
      toast.info("Pedido de revanche enviado!");
    } catch (error) {
      console.error(error);
      toast.error("Erro ao pedir revanche.");
    }
  };

  const handleNewOpponent = async () => {
    resetGame();
    handleStartSearch();
  };

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      toast.success("Login realizado com sucesso!");
    } catch (error: any) {
      console.error("Login Error Details:", error);
      const errorMessage = error.message || "Erro desconhecido";
      const errorCode = error.code || "sem-codigo";
      toast.error(`Erro no Login (${errorCode}): ${errorMessage}`);
      
      if (errorCode === 'auth/api-key-not-valid') {
        console.error("A chave de API configurada não é válida para este projeto. Verifique as restrições no Google Cloud Console.");
      }
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
        <Loader2 className="h-12 w-12 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-4 text-white">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-5xl font-black tracking-tighter uppercase italic text-orange-500">
              PEDRA PAPEL TESOURA
            </h1>
            <p className="text-zinc-400 font-medium">O clássico, agora multiplayer online.</p>
          </div>
          
          <Card className="border-zinc-800 bg-zinc-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white">Entrar no Jogo</CardTitle>
              <CardDescription className="text-zinc-400">
                Faça login para salvar suas estatísticas e subir no ranking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={handleLogin}
                className="w-full bg-white text-black hover:bg-zinc-200 font-bold h-12"
              >
                Continuar com Google
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-zinc-900 px-2 text-zinc-500">Ou use e-mail</span>
                </div>
              </div>
              <div className="space-y-2">
                <Button variant="outline" className="w-full border-zinc-800 text-white hover:bg-zinc-800 h-12" disabled>
                  Login com E-mail (Em breve)
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-orange-500/30">
      <header className="border-b border-zinc-800 p-4 backdrop-blur-md sticky top-0 z-50 bg-zinc-950/80">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button 
            onClick={resetGame}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group"
          >
            <Swords className="text-orange-500 h-6 w-6 group-hover:rotate-12 transition-transform" />
            <span className="font-black italic tracking-tighter text-xl uppercase">PPT ONLINE</span>
          </button>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 pr-4 border-r border-zinc-800">
              <div className="text-right">
                <p className="text-sm font-bold text-zinc-100">{profile?.displayName}</p>
                <div className="flex gap-2 text-xs font-black uppercase">
                  <span className="text-green-500">{profile?.stats.wins} Vitórias</span>
                  <span className="text-red-500">{profile?.stats.losses} Derrotas</span>
                </div>
              </div>
              <Avatar className="h-10 w-10 border-2 border-orange-500/20">
                <AvatarImage src={profile?.photoURL} />
                <AvatarFallback><UserIcon /></AvatarFallback>
              </Avatar>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setShowHistory(true)} className="text-zinc-400 hover:text-white hover:bg-zinc-900">
              <History className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={logout} className="text-zinc-400 hover:text-white hover:bg-zinc-900">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-8">
        <AnimatePresence mode="wait">
          {gameState === 'idle' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-2 space-y-8">
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 to-orange-900 p-8 sm:p-12 shadow-2xl shadow-orange-900/20">
                  <div className="relative z-10 space-y-6">
                    <h2 className="text-4xl sm:text-6xl font-black italic tracking-tighter uppercase leading-none">
                      PRONTO PARA <br /> A BATALHA?
                    </h2>
                    <p className="text-orange-100 max-w-md font-medium opacity-80">
                      Desafie jogadores de todo o mundo em tempo real. Suba no ranking e torne-se o mestre do PPT.
                    </p>
                    <Button 
                      onClick={handleStartSearch}
                      size="lg" 
                      className="bg-white text-black hover:bg-zinc-100 font-black uppercase italic tracking-tighter text-xl h-16 px-10 rounded-full shadow-xl"
                    >
                      JOGAR AGORA
                    </Button>
                  </div>
                  <div className="absolute -right-10 -bottom-10 opacity-10 rotate-12">
                    <Swords size={300} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'VITÓRIAS', value: profile?.stats.wins, color: 'text-green-500' },
                    { label: 'DERROTAS', value: profile?.stats.losses, color: 'text-red-500' },
                    { label: 'EMPATES', value: profile?.stats.draws, color: 'text-zinc-400' }
                  ].map((stat) => (
                    <Card key={stat.label} className="bg-zinc-900/50 border-zinc-800 text-center p-4">
                      <p className="text-xs font-black text-zinc-500 tracking-widest uppercase">{stat.label}</p>
                      <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                    </Card>
                  ))}
                </div>
              </div>

              <Card className="bg-zinc-900/50 border-zinc-800 h-fit">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-xl font-black italic uppercase tracking-tighter text-white">Ranking Global</CardTitle>
                  <Trophy className="h-5 w-5 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-4 mt-4">
                      {leaderboard.map((player, index) => (
                        <div key={player.uid} className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-6 text-xs font-mono text-zinc-500 font-bold">
                              {index + 1}.
                            </div>
                            <Avatar className="h-8 w-8 border border-zinc-800">
                              <AvatarImage src={player.photoURL} />
                              <AvatarFallback className="bg-zinc-800 text-zinc-100">{player.displayName[0]}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-bold truncate max-w-[150px] text-zinc-100">{player.displayName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-orange-500">{player.stats.wins} Vitórias</span>
                            {index < 3 && <Medal className={`h-5 w-5 ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-zinc-400' : 'text-amber-600'}`} />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {gameState === 'searching' && (
            <motion.div 
              key="searching"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-20 space-y-8"
            >
              <div className="relative">
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-orange-500/20 rounded-full blur-3xl"
                />
                <div className="relative bg-zinc-900 border-4 border-orange-500 p-10 rounded-full">
                  <Loader2 className="h-20 w-20 animate-spin text-orange-500" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black italic uppercase tracking-tighter">Procurando Oponente...</h2>
                <p className="text-zinc-500 font-medium">Prepare sua estratégia, a batalha vai começar.</p>
              </div>
              <Button variant="ghost" onClick={handleCancelSearch} className="text-zinc-500 hover:text-white">
                Cancelar Busca
              </Button>
            </motion.div>
          )}

          {(gameState === 'playing') && currentGame && (
            <motion.div 
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between gap-4">
                {/* Opponent */}
                <div className="flex-1 flex flex-col items-center gap-4">
                  <div className="relative">
                    <Avatar className="h-24 w-24 border-4 border-zinc-800">
                      <AvatarImage src={currentGame.playerData[currentGame.players.find(id => id !== user.uid)!]?.photoURL} />
                      <AvatarFallback>?</AvatarFallback>
                    </Avatar>
                    {currentGame.moves[currentGame.players.find(id => id !== user.uid)!] && (
                      <Badge className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-green-500 text-black font-black uppercase text-[10px]">Pronto</Badge>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="font-black uppercase italic tracking-tighter text-zinc-500 text-xs">Oponente</p>
                    <p className="text-xl font-bold text-zinc-100">{currentGame.playerData[currentGame.players.find(id => id !== user.uid)!]?.displayName}</p>
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="bg-orange-500 text-black font-black italic px-4 py-1 rounded-full text-sm uppercase tracking-tighter">VS</div>
                  <div className="h-20 w-[2px] bg-gradient-to-b from-transparent via-zinc-800 to-transparent" />
                </div>

                {/* You */}
                <div className="flex-1 flex flex-col items-center gap-4">
                  <div className="relative">
                    <Avatar className="h-24 w-24 border-4 border-orange-500/50">
                      <AvatarImage src={profile?.photoURL} />
                      <AvatarFallback>EU</AvatarFallback>
                    </Avatar>
                    {selectedMove && (
                      <Badge className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-orange-500 text-black font-black uppercase text-[10px]">Sua Jogada</Badge>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="font-black uppercase italic tracking-tighter text-orange-500 text-xs">Você</p>
                    <p className="text-xl font-bold text-zinc-100">{profile?.displayName}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-6 py-4">
                <div className="h-12 flex items-center justify-center">
                  <AnimatePresence mode="wait">
                    {currentGame.status === 'finished' ? (
                      <motion.div
                        key="result-text"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="text-center"
                      >
                        <h3 className={`text-4xl font-black italic uppercase tracking-tighter ${
                          currentGame.winner === user.uid ? 'text-green-500' : 
                          currentGame.winner === 'draw' ? 'text-zinc-400' : 'text-red-500'
                        }`}>
                          {currentGame.winner === user.uid ? 'VOCÊ VENCEU!' : 
                           currentGame.winner === 'draw' ? 'EMPATE!' : 'VOCÊ PERDEU!'}
                        </h3>
                      </motion.div>
                    ) : (
                      <motion.h3 
                        key="status-text"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-2xl font-black italic uppercase tracking-tighter text-center text-zinc-400"
                      >
                        {selectedMove ? "Aguardando oponente..." : "Escolha sua jogada"}
                      </motion.h3>
                    )}
                  </AnimatePresence>
                </div>
                
                <div className="flex gap-4 sm:gap-8">
                  {(['rock', 'paper', 'scissors'] as Move[]).map((move) => (
                    <motion.button
                      key={move}
                      whileHover={!selectedMove && currentGame.status === 'playing' ? { scale: 1.1, y: -5 } : {}}
                      whileTap={!selectedMove && currentGame.status === 'playing' ? { scale: 0.95 } : {}}
                      onClick={() => handleMove(move)}
                      disabled={!!selectedMove || currentGame.status === 'finished'}
                      className={`
                        group relative flex flex-col items-center gap-4 p-6 rounded-3xl border-2 transition-all duration-300
                        ${(selectedMove === move || (currentGame.status === 'finished' && currentGame.moves[user.uid] === move))
                          ? 'bg-orange-500 border-orange-400 text-black shadow-2xl shadow-orange-500/20' 
                          : (selectedMove || currentGame.status === 'finished')
                            ? 'bg-zinc-900 border-zinc-800 opacity-40 grayscale' 
                            : 'bg-zinc-900 border-zinc-800 hover:border-orange-500/50 hover:bg-zinc-800'
                        }
                      `}
                    >
                      <div className="text-4xl sm:text-6xl">
                        {move === 'rock' && '✊'}
                        {move === 'paper' && '✋'}
                        {move === 'scissors' && '✌️'}
                      </div>
                      <span className="font-black uppercase italic tracking-tighter text-sm">{
                        move === 'rock' ? 'Pedra' : move === 'paper' ? 'Papel' : 'Tesoura'
                      }</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="space-y-6 pt-6 border-t border-zinc-900">
                {/* Last Moves Drawings */}
                {Object.keys(lastMoves).length > 0 && (
                  <div className="flex justify-center gap-12 items-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-4xl transition-all duration-500 ${
                        lastWinner === currentGame.players.find(id => id !== user.uid) || lastWinner === 'draw' 
                        ? 'opacity-100 scale-110' 
                        : 'grayscale opacity-20 scale-90'
                      }`}>
                        {lastMoves[currentGame.players.find(id => id !== user.uid)!] === 'rock' && '✊'}
                        {lastMoves[currentGame.players.find(id => id !== user.uid)!] === 'paper' && '✋'}
                        {lastMoves[currentGame.players.find(id => id !== user.uid)!] === 'scissors' && '✌️'}
                      </span>
                    </div>
                    <div className="text-[10px] font-black text-zinc-800 italic">VS</div>
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-4xl transition-all duration-500 ${
                        lastWinner === user.uid || lastWinner === 'draw' 
                        ? 'opacity-100 scale-110' 
                        : 'grayscale opacity-20 scale-90'
                      }`}>
                        {lastMoves[user.uid] === 'rock' && '✊'}
                        {lastMoves[user.uid] === 'paper' && '✋'}
                        {lastMoves[user.uid] === 'scissors' && '✌️'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="text-center space-y-2">
                  <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Placar da Partida Atual</p>
                  <div className="flex justify-center gap-12">
                    <div className="text-center">
                      <p className="text-3xl font-black text-orange-500">
                        {currentGame.sessionScore?.[currentGame.players.find(id => id !== user.uid)!] || 0}
                      </p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase">Oponente</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-black text-orange-500">
                        {currentGame.sessionScore?.[user.uid] || 0}
                      </p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase">Você</p>
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-2">
                  <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Histórico Geral entre vocês</p>
                  <div className="flex justify-center gap-8">
                    <div className="text-center">
                      <p className="text-2xl font-black text-green-500">{headToHead.wins}</p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase">Vitórias</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black text-zinc-400">{headToHead.draws}</p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase">Empates</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black text-red-500">{headToHead.losses}</p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase">Derrotas</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <Button 
                    onClick={resetGame}
                    variant="outline"
                    className="border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-900 font-black uppercase italic tracking-tighter h-12 px-8 rounded-full"
                  >
                    SAIR DA PARTIDA
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <Toaster position="bottom-center" theme="dark" />

      {/* Match History Overlay */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-xl">
                    <History className="text-orange-500 h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black italic uppercase tracking-tighter">Histórico de Partidas</h2>
                    <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Suas últimas batalhas</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)} className="rounded-full hover:bg-zinc-800">
                  <X className="h-6 w-6" />
                </Button>
              </div>

              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4">
                  {matchHistory.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <div className="bg-zinc-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                        <Swords className="text-zinc-600 h-8 w-8" />
                      </div>
                      <p className="text-zinc-500 font-medium italic">Nenhuma partida encontrada ainda...</p>
                    </div>
                  ) : (
                    matchHistory.map((game) => {
                      const opponentId = game.players.find(id => id !== user?.uid);
                      const opponent = game.playerData[opponentId!];
                      const isWinner = game.winner === user?.uid;
                      const isDraw = game.winner === 'draw';
                      const myMove = game.moves[user?.uid || ''];
                      const opponentMove = game.moves[opponentId!];

                      return (
                        <div key={game.id} className="bg-zinc-950/50 border border-zinc-800/50 rounded-2xl p-4 flex items-center justify-between group hover:border-orange-500/30 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className={`w-2 h-12 rounded-full ${isWinner ? 'bg-green-500' : isDraw ? 'bg-zinc-500' : 'bg-red-500'}`} />
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10 border border-zinc-800">
                                <AvatarImage src={opponent?.photoURL} />
                                <AvatarFallback className="bg-zinc-800 text-zinc-100">{opponent?.displayName[0]}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-bold text-zinc-100">{opponent?.displayName}</p>
                                <p className={`text-[10px] font-black uppercase tracking-tighter ${isWinner ? 'text-green-500' : isDraw ? 'text-zinc-400' : 'text-red-500'}`}>
                                  {isWinner ? 'Vitória' : isDraw ? 'Empate' : 'Derrota'}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <div className="flex items-center gap-3 bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-800">
                              <span className="text-xl">{myMove === 'rock' ? '✊' : myMove === 'paper' ? '✋' : '✌️'}</span>
                              <span className="text-xs font-black text-zinc-700 italic">VS</span>
                              <span className="text-xl grayscale opacity-50">{opponentMove === 'rock' ? '✊' : opponentMove === 'paper' ? '✋' : '✌️'}</span>
                            </div>
                            <div className="text-right hidden sm:block">
                              <p className="text-[10px] font-mono text-zinc-600">
                                {game.createdAt?.toDate ? new Date(game.createdAt.toDate()).toLocaleDateString() : 'Recent'}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
              
              <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
                <Button onClick={() => setShowHistory(false)} className="w-full bg-zinc-100 text-black hover:bg-white font-black uppercase italic tracking-tighter h-12 rounded-2xl">
                  FECHAR
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <GameUI />
    </AuthProvider>
  );
}

