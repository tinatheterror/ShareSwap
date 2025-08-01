import { Shield, AlertTriangle, CheckCircle, Eye, MessageSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const safetyTips = [
  {
    icon: Eye,
    title: "Meet in Public",
    description: "Always meet in well-lit, public places for item exchanges",
    category: "meeting"
  },
  {
    icon: CheckCircle,
    title: "Verify Identity",
    description: "Check user verification badges and ratings before lending",
    category: "verification"
  },
  {
    icon: MessageSquare,
    title: "Keep Communication on Platform",
    description: "Use our chat system to maintain a record of all interactions",
    category: "communication"
  },
  {
    icon: Shield,
    title: "Trust Your Instincts",
    description: "If something feels wrong, don't proceed with the transaction",
    category: "general"
  }
];

interface SafetyTipsProps {
  compact?: boolean;
  category?: "meeting" | "verification" | "communication" | "general";
}

export function SafetyTips({ compact = false, category }: SafetyTipsProps) {
  const filteredTips = category 
    ? safetyTips.filter(tip => tip.category === category)
    : safetyTips;

  if (compact) {
    return (
      <Alert className="border-amber-200 bg-amber-50">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          <strong>Safety Reminder:</strong> {filteredTips[0]?.description}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Safety Tips
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {filteredTips.map((tip, index) => {
            const Icon = tip.icon;
            return (
              <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium mb-1">{tip.title}</h4>
                  <p className="text-sm text-gray-600">{tip.description}</p>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center gap-2 text-blue-800 font-medium mb-1">
            <Shield className="w-4 h-4" />
            Report Suspicious Activity
          </div>
          <p className="text-sm text-blue-700 mb-2">
            Help keep our community safe by reporting any concerning behavior.
          </p>
          <Button variant="outline" size="sm" className="text-blue-700 border-blue-300">
            Report Issue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}