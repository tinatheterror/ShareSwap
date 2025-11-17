import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Trophy, Users, Timer, Coins, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Challenge = {
  id: number;
  title: string;
  description: string;
  challengeType: string;
  startDate: string;
  endDate: string;
  rewardAmount: string;
  status: string;
};

type Participant = {
  userId: number;
  username: string;
  currentScore: number;
  currentRank: number;
};

export default function ChallengesPage() {
  const { toast } = useToast();
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  const { data: challenges = [] } = useQuery<Challenge[]>({
    queryKey: ['/api/challenges'],
  });

  const { data: participants = [] } = useQuery<Participant[]>({
    queryKey: ['/api/challenges/participants', selectedChallenge?.id],
    enabled: !!selectedChallenge,
  });

  const joinChallengeMutation = useMutation({
    mutationFn: async (challengeId: number) => {
      const res = await apiRequest("POST", `/api/challenges/${challengeId}/join`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Joined Challenge!",
        description: "You're now participating in this challenge. Good luck!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to join challenge",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <TooltipProvider>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-3xl font-bold">Community Challenges</h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-5 w-5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Participate in challenges to earn bonus ShareCoins and climb the leaderboard</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {challenges.map((challenge) => (
            <Card key={challenge.id}>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{challenge.title}</h3>
                    <Badge 
                      variant={challenge.status === 'active' ? 'default' : 'secondary'}
                      className="mt-2"
                    >
                      {challenge.status.charAt(0).toUpperCase() + challenge.status.slice(1)}
                    </Badge>
                  </div>
                  <div className="flex items-center text-teal-500">
                    <Coins className="h-5 w-5 mr-1" />
                    <span className="font-semibold">
                      {Number(challenge.rewardAmount).toFixed(2)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                  {challenge.description}
                </p>

                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center">
                      <Timer className="h-4 w-4 mr-2" />
                      Time Remaining
                    </span>
                    <span className="font-medium">
                      {new Date(challenge.endDate) > new Date() 
                        ? `${Math.ceil((new Date(challenge.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days`
                        : "Ended"}
                    </span>
                  </div>
                  {selectedChallenge?.id === challenge.id && (
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center">
                        <Users className="h-4 w-4 mr-2" />
                        Participants
                      </span>
                      <span className="font-medium">{participants.length}</span>
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  disabled={challenge.status !== 'active'}
                  onClick={() => {
                    if (selectedChallenge?.id === challenge.id) {
                      joinChallengeMutation.mutate(challenge.id);
                    } else {
                      setSelectedChallenge(challenge);
                    }
                  }}
                >
                  {challenge.status === 'active' 
                    ? selectedChallenge?.id === challenge.id 
                      ? "Join Challenge"
                      : "View Details"
                    : "Challenge " + challenge.status}
                </Button>

                {selectedChallenge?.id === challenge.id && participants.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2 flex items-center">
                      <Trophy className="h-4 w-4 mr-2" />
                      Top Participants
                    </h4>
                    <div className="space-y-2">
                      {participants.slice(0, 3).map((participant) => (
                        <div 
                          key={participant.userId}
                          className="flex justify-between items-center"
                        >
                          <span className="text-sm">
                            {participant.username}
                          </span>
                          <div className="flex items-center">
                            <span className="text-sm font-medium mr-2">
                              {participant.currentScore} points
                            </span>
                            <Badge variant="outline">
                              #{participant.currentRank}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        </TooltipProvider>
      </main>
    </div>
  );
}
