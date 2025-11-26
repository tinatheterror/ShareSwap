import { Card } from "@/components/ui/card";
import { Sparkles, Smartphone } from "lucide-react";

interface SmartScanProps {
  onAnalysisComplete?: (analysis: any, photos: string[]) => void;
}

export function SmartScan({ onAnalysisComplete }: SmartScanProps) {
  return (
    <Card className="p-6 bg-gradient-to-br from-teal-50 to-white border-2 border-teal-200">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-lg text-gray-900">
              Smart Scan — Only in the App
            </h3>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-teal-600" />
          </div>
          <p className="text-gray-700 font-medium mb-2">
            Use the app to scan your item
          </p>
          <p className="text-sm text-gray-500">
            and we'll do the writing for you.
          </p>
        </div>

        <div className="pt-4 border-t border-teal-200">
          <p className="text-xs font-medium text-gray-700 mb-2">
            SmartScan features:
          </p>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>✓ Auto-fill name, description, category & brand</li>
            <li>✓ Condition rating estimation</li>
            <li>✓ AI-powered item recognition</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}
