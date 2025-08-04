import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/shared/navbar";
import { Gamepad2, Coins, Trophy, Play, Clock, Users } from "lucide-react";
import { useState } from "react";

interface SponsoredGame {
  id: number;
  name: string;
  description: string;
  imageUrl: string;
  rewardAmount: string;
  sponsorName: string;
  gameUrl: string;
  isActive: boolean;
  createdAt: string;
}

interface GameSession {
  id: number;
  gameId: number;
  startedAt: string;
  completedAt?: string;
  score?: number;
  rewardAmount?: string;
  status: string;
  game: SponsoredGame;
}

export default function GamesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeGameId, setActiveGameId] = useState<number | null>(null);

  const { data: games, isLoading: gamesLoading } = useQuery<SponsoredGame[]>({
    queryKey: ['/api/games'],
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<GameSession[]>({
    queryKey: ['/api/game-sessions'],
  });

  const startGameMutation = useMutation({
    mutationFn: async (gameId: number) => {
      return apiRequest("POST", "/api/game-sessions", { gameId });
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['/api/game-sessions'] });
      setActiveGameId(session.gameId);
      
      // Open game in new window/tab
      const game = games?.find(g => g.id === session.gameId);
      if (game) {
        window.open(game.gameUrl, '_blank', 'width=800,height=600');
      }
      
      toast({
        title: "Game Started!",
        description: "Complete the game to earn ShareCoins!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start game. Please try again.",
        variant: "destructive",
      });
    },
  });

  const completeGameMutation = useMutation({
    mutationFn: async ({ sessionId, score }: { sessionId: number; score: number }) => {
      return apiRequest("PATCH", `/api/game-sessions/${sessionId}`, { 
        status: 'completed',
        score,
        completedAt: new Date().toISOString()
      });
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['/api/game-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      setActiveGameId(null);
      
      toast({
        title: "Congratulations!",
        description: `You earned ${session.rewardAmount} ShareCoins!`,
      });
    },
  });

  // Calculate total earnings
  const totalEarnings = sessions?.reduce((sum, session) => {
    return sum + (session.rewardAmount ? parseFloat(session.rewardAmount) : 0);
  }, 0) || 0;

  const completedGames = sessions?.filter(s => s.status === 'completed').length || 0;

  if (gamesLoading || sessionsLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Gamepad2 className="h-8 w-8 text-primary" />
            Play Games & Earn ShareCoins
          </h1>
          <p className="text-muted-foreground">
            Complete sponsored games to earn ShareCoins for borrowing items
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-green-600">{totalEarnings.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">Total ShareCoins Earned</p>
                </div>
                <Coins className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-blue-600">{completedGames}</p>
                  <p className="text-sm text-muted-foreground">Games Completed</p>
                </div>
                <Trophy className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-purple-600">{games?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Available Games</p>
                </div>
                <Users className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Available Games */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5" />
                Available Games
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {games?.map((game) => (
                  <div
                    key={game.id}
                    className="p-4 rounded-lg border hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <img
                        src={game.imageUrl}
                        alt={game.name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold">{game.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              Sponsored by {game.sponsorName}
                            </p>
                          </div>
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            <Coins className="h-3 w-3 mr-1" />
                            {game.rewardAmount} SC
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {game.description}
                        </p>
                        <Button
                          onClick={() => startGameMutation.mutate(game.id)}
                          disabled={startGameMutation.isPending || activeGameId === game.id}
                          className="w-full"
                        >
                          {activeGameId === game.id ? (
                            <>
                              <Clock className="h-4 w-4 mr-2" />
                              Playing...
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Play Now
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                
                {!games?.length && (
                  <div className="text-center py-8">
                    <Gamepad2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No games available at the moment</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Game Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {sessions?.slice(0, 5).map((session) => (
                  <div
                    key={session.id}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm">{session.game.name}</h4>
                      <Badge
                        variant={session.status === 'completed' ? 'default' : 'secondary'}
                        className={session.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                      >
                        {session.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{new Date(session.startedAt).toLocaleDateString()}</span>
                      {session.rewardAmount && (
                        <span className="text-green-600 font-medium">
                          +{session.rewardAmount} SC
                        </span>
                      )}
                    </div>
                    {session.score && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span>Score: {session.score}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                
                {!sessions?.length && (
                  <div className="text-center py-8">
                    <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No game sessions yet</p>
                    <p className="text-sm text-muted-foreground">Start playing to see your history here!</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}