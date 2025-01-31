import { useState, useEffect } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Trophy } from "lucide-react";

type Card = {
  id: number;
  value: string;
  isFlipped: boolean;
  isMatched: boolean;
};

export default function GamesPage() {
  const { toast } = useToast();
  const [cards, setCards] = useState<Card[]>([]);
  const [flippedCards, setFlippedCards] = useState<Card[]>([]);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [moves, setMoves] = useState(0);

  const earnShareCoinsMutation = useMutation({
    mutationFn: async (earnedCoins: number) => {
      const res = await apiRequest("POST", "/api/transactions/game-reward", {
        amount: earnedCoins,
        gameType: "memory",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Congratulations! 🎉",
        description: "You've earned ShareCoins for completing the memory game!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to award ShareCoins",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const initializeGame = () => {
    const emojis = ["🎮", "🎲", "🎯", "🎪", "🎨", "🎭", "🎪", "🎯"];
    const gameCards = [...emojis, ...emojis]
      .sort(() => Math.random() - 0.5)
      .map((value, index) => ({
        id: index,
        value,
        isFlipped: false,
        isMatched: false,
      }));
    setCards(gameCards);
    setFlippedCards([]);
    setMatchedPairs(0);
    setMoves(0);
    setIsGameStarted(true);
  };

  const handleCardClick = (clickedCard: Card) => {
    if (
      flippedCards.length === 2 ||
      clickedCard.isFlipped ||
      clickedCard.isMatched
    )
      return;

    const newCards = cards.map((card) =>
      card.id === clickedCard.id ? { ...card, isFlipped: true } : card
    );
    setCards(newCards);

    const newFlippedCards = [...flippedCards, clickedCard];
    setFlippedCards(newFlippedCards);

    if (newFlippedCards.length === 2) {
      setMoves((prev) => prev + 1);
      if (newFlippedCards[0].value === newFlippedCards[1].value) {
        setMatchedPairs((prev) => prev + 1);
        setCards((prevCards) =>
          prevCards.map((card) =>
            card.id === newFlippedCards[0].id || card.id === newFlippedCards[1].id
              ? { ...card, isMatched: true }
              : card
          )
        );
        setFlippedCards([]);
      } else {
        setTimeout(() => {
          setCards((prevCards) =>
            prevCards.map((card) =>
              card.id === newFlippedCards[0].id ||
              card.id === newFlippedCards[1].id
                ? { ...card, isFlipped: false }
                : card
            )
          );
          setFlippedCards([]);
        }, 1000);
      }
    }
  };

  useEffect(() => {
    if (matchedPairs === 8) {
      const baseReward = 10;
      const movesBonus = Math.max(0, 20 - moves); // Bonus for completing in fewer moves
      const totalReward = baseReward + movesBonus;
      earnShareCoinsMutation.mutate(totalReward);
    }
  }, [matchedPairs]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Memory Game</h1>
          <p className="text-muted-foreground">
            Match pairs of cards to earn ShareCoins!
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            {!isGameStarted ? (
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-4">How to Play</h2>
                <ul className="text-left space-y-2 mb-6">
                  <li>• Find matching pairs of cards</li>
                  <li>• Complete the game in fewer moves for bonus rewards</li>
                  <li>• Earn up to 30 ShareCoins per game</li>
                </ul>
                <Button onClick={initializeGame} className="w-full md:w-auto">
                  Start Game
                </Button>
              </div>
            ) : (
              <>
                <div className="flex justify-between mb-4">
                  <span>Moves: {moves}</span>
                  <span>Matches: {matchedPairs}/8</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleCardClick(card)}
                      className={`h-24 rounded-lg text-3xl flex items-center justify-center transition-all duration-300 ${
                        card.isFlipped || card.isMatched
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                      disabled={card.isMatched}
                    >
                      {(card.isFlipped || card.isMatched) && card.value}
                    </button>
                  ))}
                </div>
                {matchedPairs === 8 && (
                  <div className="mt-6 text-center">
                    <div className="flex items-center justify-center gap-2 text-xl font-semibold text-green-600 mb-4">
                      <Trophy className="h-6 w-6" />
                      <span>Congratulations!</span>
                    </div>
                    <p className="mb-4">
                      You completed the game in {moves} moves!
                    </p>
                    <Button onClick={initializeGame}>Play Again</Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
