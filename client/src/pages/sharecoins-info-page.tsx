
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, CheckCircle, ArrowRight, Star, Shield, TrendingUp } from "lucide-react";

export default function ShareCoinsInfoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full mb-6 shadow-lg">
            <Coins className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-4">How ShareCoins Work</h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            ShareCoins are the currency of our marketplace. They reward lending, encourage sharing, and help build community reputation.
          </p>
        </div>

        {/* When Coins Are Earned & Charged */}
        <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <ArrowRight className="h-6 w-6" />
              When Coins Are Earned & Charged
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                    <span className="text-orange-600 font-bold">B</span>
                  </div>
                  Borrowers
                </h3>
                <p className="text-slate-600">
                  <span className="font-semibold">Charged upon item pickup.</span>
                </p>
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                  <p className="text-sm text-slate-700">
                    <strong>Example:</strong> You borrow a blender → full ShareCoin cost is deducted at pickup.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                    <span className="text-teal-600 font-bold">L</span>
                  </div>
                  Lenders
                </h3>
                <p className="text-slate-600">
                  <span className="font-semibold">Earn ShareCoins upon delivery to borrower.</span>
                </p>
                <div className="bg-teal-50 p-4 rounded-lg border border-teal-200">
                  <p className="text-sm text-slate-700">
                    <strong>Example:</strong> You lend a stroller → coins are credited to your account once the borrower receives it.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 bg-gradient-to-r from-teal-50 to-teal-100 p-4 rounded-lg border border-teal-200 flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-teal-600 flex-shrink-0" />
              <p className="text-slate-700 font-medium">
                This ensures commitment from both sides and smooth, trustable transactions.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Valuation System */}
        <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <TrendingUp className="h-6 w-6" />
              Valuation System
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Borrower Cost</h3>
                <p className="text-slate-600 mb-4">Depends on item value and lending duration:</p>
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <Badge className="bg-green-600 text-white mb-2">Low-Value</Badge>
                    <p className="text-2xl font-bold text-green-700">5 SC</p>
                    <p className="text-sm text-slate-600">per borrow</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <Badge className="bg-blue-600 text-white mb-2">Medium-Value</Badge>
                    <p className="text-2xl font-bold text-blue-700">10 SC</p>
                    <p className="text-sm text-slate-600">per borrow</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                    <Badge className="bg-purple-600 text-white mb-2">High-Value</Badge>
                    <p className="text-2xl font-bold text-purple-700">15-20 SC</p>
                    <p className="text-sm text-slate-600">per borrow</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Lender Earnings</h3>
                <p className="text-slate-600 mb-4">
                  Typically <strong>50–80%</strong> of borrower's spent ShareCoins (platform may keep a small portion).
                </p>
                <div className="bg-teal-50 p-4 rounded-lg border border-teal-200">
                  <p className="text-sm text-slate-700">
                    <strong>Example:</strong> Borrower pays 10 ShareCoins → lender earns 8 ShareCoins upon delivery.
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Star className="h-6 w-6 text-yellow-500" />
                  Bonus Coins
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 bg-teal-500 rounded-full mt-1.5 flex-shrink-0"></div>
                    <p className="text-slate-700">Urgent requests: <strong>+2 coins</strong></p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 bg-teal-500 rounded-full mt-1.5 flex-shrink-0"></div>
                    <p className="text-slate-700">Lending to fulfill wishlist items: <strong>+1–3 coins</strong></p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 bg-teal-500 rounded-full mt-1.5 flex-shrink-0"></div>
                    <p className="text-slate-700">First-time lenders or special promotions: <strong>+1 coin</strong></p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Flow */}
        <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <ArrowRight className="h-6 w-6" />
              Transaction Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-teal-700">
                  1
                </div>
                <p className="text-slate-700">Borrower picks up item → ShareCoins deducted</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-teal-700">
                  2
                </div>
                <p className="text-slate-700">Lender delivers item → ShareCoins credited</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-teal-700">
                  3
                </div>
                <p className="text-slate-700">Optional bonuses applied</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-teal-700">
                  4
                </div>
                <p className="text-slate-700">Reputation updated: successful transactions increase lender's standing</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Additional Rules */}
        <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <Shield className="h-6 w-6" />
              Additional Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-teal-600 mt-0.5 flex-shrink-0" />
                <p className="text-slate-700">Coins are non-transferable outside the app.</p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-teal-600 mt-0.5 flex-shrink-0" />
                <p className="text-slate-700">
                  <strong>Refunds:</strong> If the item isn't delivered or is returned damaged, coins may be refunded or partially refunded per platform rules.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-teal-600 mt-0.5 flex-shrink-0" />
                <p className="text-slate-700">
                  <strong>Tracking:</strong> All transactions are tracked in-app for transparency.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-teal-600 mt-0.5 flex-shrink-0" />
                <p className="text-slate-700">
                  <strong>Reputation:</strong> Each successful lending increases lender's reputation, unlocking future bonuses and privileges.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Example Table */}
        <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-t-lg">
            <CardTitle className="text-2xl">Examples</CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-teal-200">
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Item Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Borrower Pays</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Lender Earns</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Bonus Coins</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-3 px-4 text-slate-700">Blender (Medium)</td>
                    <td className="py-3 px-4 text-slate-700">10 SC</td>
                    <td className="py-3 px-4 text-slate-700">8 SC</td>
                    <td className="py-3 px-4 text-slate-700">2 SC urgent</td>
                    <td className="py-3 px-4 text-slate-600 text-sm">Coins credited upon delivery</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-3 px-4 text-slate-700">Stroller (High)</td>
                    <td className="py-3 px-4 text-slate-700">15 SC</td>
                    <td className="py-3 px-4 text-slate-700">12 SC</td>
                    <td className="py-3 px-4 text-slate-700">3 SC wishlist</td>
                    <td className="py-3 px-4 text-slate-600 text-sm">Coins credited upon delivery</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-slate-700">Board Game (Low)</td>
                    <td className="py-3 px-4 text-slate-700">5 SC</td>
                    <td className="py-3 px-4 text-slate-700">4 SC</td>
                    <td className="py-3 px-4 text-slate-700">0 SC</td>
                    <td className="py-3 px-4 text-slate-600 text-sm">Coins credited upon delivery</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Key Points */}
        <Card className="border-0 shadow-xl bg-gradient-to-r from-teal-500 to-teal-600 text-white">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <CheckCircle className="h-6 w-6" />
              Key Points
            </h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 bg-white rounded-full mt-1.5 flex-shrink-0"></div>
                <p className="text-white">Borrowers pay at pickup → commitment ensured</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 bg-white rounded-full mt-1.5 flex-shrink-0"></div>
                <p className="text-white">Lenders earn at delivery → safe and fair</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 bg-white rounded-full mt-1.5 flex-shrink-0"></div>
                <p className="text-white">Bonuses and reputation reward helpful behavior</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 bg-white rounded-full mt-1.5 flex-shrink-0"></div>
                <p className="text-white">Simple, transparent, scalable for multiple item types</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
