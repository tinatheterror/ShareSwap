import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type SponsoredGame = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  rewardAmount: number;
  sponsorName: string;
  gameUrl: string;
};

export default function GamesPage() {
  const { toast } = useToast();
  const [activeGame, setActiveGame] = useState<SponsoredGame | null>(null);

  // Fetch available sponsored games
  const { data: games = [] } = useQuery<SponsoredGame[]>({
    queryKey: ['/api/games/sponsored'],
  });

  // Example games data while endpoint is being set up
  const sampleGames: SponsoredGame[] = [
    {
      id: "1",
      name: "Puzzle Master",
      description: "Complete challenging puzzles and earn rewards",
      imageUrl: "/game-thumbnails/puzzle.jpg",
      rewardAmount: 5,
      sponsorName: "GameCo",
      gameUrl: "https://sponsor1.example.com/game1"
    },
    {
      id: "2",
      name: "Speed Runner",
      description: "Race against time to collect coins",
      imageUrl: "/game-thumbnails/racing.jpg",
      rewardAmount: 10,
      sponsorName: "RacingInc",
      gameUrl: "https://sponsor2.example.com/game2"
    }
  ];

  const startGameSession = useMutation({
    mutationFn: async (gameId: string) => {
      const res = await apiRequest("POST", `/api/games/${gameId}/start-session`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Game Session Started",
        description: "Complete the game to earn ShareCoins!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start game",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Sponsored Games</h1>
          <p className="text-muted-foreground">
            Play sponsored games to earn ShareCoins
          </p>
        </div>

        {activeGame ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">{activeGame.name}</h2>
                <Button 
                  variant="outline"
                  onClick={() => setActiveGame(null)}
                >
                  Exit Game
                </Button>
              </div>
              <div className="aspect-video w-full bg-muted rounded-lg">
                {/* This will be replaced with actual game integration */}
                <iframe src={activeGame.gameUrl} title={activeGame.name} className="w-full h-full" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(games.length > 0 ? games : sampleGames).map((game) => (
              <Card key={game.id}>
                <CardContent className="p-6">
                  <div className="aspect-video w-full bg-muted rounded-lg mb-4">
                    {/* Game thumbnail will be displayed here */}
                    <img src={game.imageUrl} alt={game.name} className="w-full h-full object-cover rounded-lg" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{game.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {game.description}
                  </p>
                  <div className="flex justify-between items-center">
                    <div className="text-sm">
                      <p className="font-medium">Reward: {game.rewardAmount} ShareCoins</p>
                      <p className="text-muted-foreground">by {game.sponsorName}</p>
                    </div>
                    <Button
                      onClick={() => {
                        startGameSession.mutate(game.id);
                        setActiveGame(game);
                      }}
                    >
                      Play Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}