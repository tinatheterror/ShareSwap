import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Upload, HandHeart } from "lucide-react";

export default function ShareOptionsPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Choose Your Option</h1>
          <p className="text-muted-foreground">
            Would you like to lend out your items or borrow from others?
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Lend Out</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Share your items and earn ShareCoins
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={() => navigate("/lend")}
              >
                Start Lending
              </Button>
            </CardFooter>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="pt-6">
              <div className="text-center mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <HandHeart className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Borrow</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Browse and borrow items from the community
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={() => navigate("/borrow")}
              >
                Browse Items
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
