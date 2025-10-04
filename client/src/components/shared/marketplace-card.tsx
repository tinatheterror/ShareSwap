import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarketplaceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
  buttonText?: string;
}

export function MarketplaceCard({
  title,
  description,
  icon,
  onClick,
  className,
  buttonText = "Get Started",
}: MarketplaceCardProps) {
  return (
    <Card className={cn("w-full h-full flex flex-col bg-primary/10 border-primary/20 hover:border-primary/40 transition-colors", className)}>
      <CardContent className="pt-6 flex-1">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="p-3 bg-primary/20 rounded-full">
            {icon}
          </div>
          <h3 className="text-xl font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={onClick} className="w-full bg-primary hover:bg-primary/90">
          {buttonText}
        </Button>
      </CardFooter>
    </Card>
  );
}