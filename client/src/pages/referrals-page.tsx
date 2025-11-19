import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/shared/navbar";
import { Users, Gift, Copy, Share } from "lucide-react";
import { useState } from "react";

export default function ReferralsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [referralCode, setReferralCode] = useState('');

  const { data: user } = useQuery<any>({
    queryKey: ['/api/user'],
  });

  const generateCodeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/referrals/generate", {});
      return response.json();
    },
    onSuccess: (data) => {
      setReferralCode(data.referralCode);
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      toast({
        title: "Referral code generated!",
        description: "Share this code with friends to earn ShareCoins.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate referral code. Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = async () => {
    const code = referralCode || user?.referralCode;
    if (code) {
      await navigator.clipboard.writeText(code);
      toast({
        title: "Copied!",
        description: "Referral code copied to clipboard.",
      });
    }
  };

  const shareReferral = async () => {
    const code = referralCode || user?.referralCode;
    if (code && navigator.share) {
      try {
        await navigator.share({
          title: 'Join ShareSpace',
          text: `Join me on ShareSpace with code ${code} and we both get 10 ShareCoins!`,
          url: `${window.location.origin}/register?ref=${code}`,
        });
      } catch (error) {
        // Fallback to clipboard
        copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Users className="h-8 w-8 text-primary" />
            Invite Friends
          </h1>
          <p className="text-muted-foreground">
            Earn 10 ShareCoins everytime a friend joins and completes their first transaction
          </p>
        </div>

        {/* Referral Code Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-teal-600" />
              Your Referral Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user?.referralCode || referralCode ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    value={referralCode || user?.referralCode}
                    readOnly
                    className="font-mono text-lg font-bold text-center"
                  />
                  <Button onClick={copyToClipboard} variant="outline">
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                  <Button onClick={shareReferral}>
                    <Share className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                </div>
                
                <div className="bg-teal-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-teal-800 mb-2">How it works:</h3>
                  <ul className="text-sm text-teal-700 space-y-1">
                    <li>• Share your code with friends</li>
                    <li>• They sign up using your code</li>
                    <li>• When they complete their first transaction, you both get 10 ShareCoins!</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">
                  When neighbours sign up using your code you'll earn ShareCoins to use on future rentals or requests.
                </p>
                <Button 
                  onClick={() => generateCodeMutation.mutate()}
                  disabled={generateCodeMutation.isPending}
                >
                  {generateCodeMutation.isPending ? 'Generating...' : 'Generate Referral Code'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Benefits Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Referral Benefits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="text-center">
                <div className="bg-teal-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Gift className="h-8 w-8 text-teal-600" />
                </div>
                <h3 className="font-semibold mb-2">Earn ShareCoins</h3>
                <p className="text-sm text-muted-foreground">
                  Get 10 ShareCoins for each successful referral
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-teal-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="h-8 w-8 text-teal-600" />
                </div>
                <h3 className="font-semibold mb-2">Build Community</h3>
                <p className="text-sm text-muted-foreground">
                  Help grow the sharing economy in your neighborhood
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}