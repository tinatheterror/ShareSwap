import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeftRight,
  Coins,
  CheckCircle,
  Star,
  Shield,
  HelpCircle,
  HandHeart,
  DollarSign,
  Gift,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-800 mb-2">
            Help & FAQ
          </h1>
          <p className="text-gray-600">
            Everything you need to know about to use the platform with confidence
          </p>
        </div>

        {/* What is ShareSwap? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                  <ArrowLeftRight className="h-4 w-4 text-white" />
                </div>
                <span className="font-bold text-teal-600">ShareSwap</span>
              </div>
              What is ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-700 font-medium">
                A community platform where neighbors can:
              </p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-3">
                  <Coins className="h-5 w-5 text-amber-500" />
                  <span className="text-sm font-medium text-gray-700">Borrow items using ShareCoins</span>
                </div>
                <div className="flex items-center gap-2 bg-green-50 rounded-lg p-3">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  <span className="text-sm font-medium text-gray-700">Rent items for cash</span>
                </div>
                <div className="flex items-center gap-2 bg-purple-50 rounded-lg p-3">
                  <ArrowLeftRight className="h-5 w-5 text-purple-500" />
                  <span className="text-sm font-medium text-gray-700">Swap items</span>
                </div>
                <div className="flex items-center gap-2 bg-pink-50 rounded-lg p-3">
                  <Gift className="h-5 w-5 text-pink-500" />
                  <span className="text-sm font-medium text-gray-700">Gift items</span>
                </div>
              </div>

              <p className="text-gray-600 text-center italic pt-2">
                Give what you can. Take what you need. Simple.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* How Swaps Work */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowLeftRight className="h-5 w-5 text-purple-600" />
              How Swaps Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600">
                Swapping lets you trade items directly with neighbours. Our tier system ensures fair exchanges.
              </p>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <h4 className="font-medium text-purple-800 mb-3">Swap Tiers & ShareCoin Values</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-sm text-gray-500">Tier 1</div>
                    <div className="font-semibold">Under $50</div>
                    <div className="text-purple-600 text-sm">5 SC</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-sm text-gray-500">Tier 2</div>
                    <div className="font-semibold">$50–$150</div>
                    <div className="text-purple-600 text-sm">10 SC</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-sm text-gray-500">Tier 3</div>
                    <div className="font-semibold">$150–$300</div>
                    <div className="text-purple-600 text-sm">20 SC</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-sm text-gray-500">Tier 4</div>
                    <div className="font-semibold">$300+</div>
                    <div className="text-purple-600 text-sm">40 SC</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium text-gray-800">Swap Fairness Rules</h4>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="inline-block w-3 h-3 bg-green-400 rounded-full mt-1.5"></span>
                    <div>
                      <span className="font-medium">Same-tier swaps</span>
                      <p className="text-sm text-gray-600">Fair and free! No offset needed when swapping items in the same tier.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="inline-block w-3 h-3 bg-yellow-400 rounded-full mt-1.5"></span>
                    <div>
                      <span className="font-medium">One-tier difference</span>
                      <p className="text-sm text-gray-600">Allowed with a ShareCoin offset. The person with the lower-tier item adds ShareCoins to balance the value.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="inline-block w-3 h-3 bg-red-400 rounded-full mt-1.5"></span>
                    <div>
                      <span className="font-medium">Two or more tier difference</span>
                      <p className="text-sm text-gray-600">Not allowed. Items too different in value can lead to disputes.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-100 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 mb-2">Important Notes</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Only ShareCoins can balance value differences (no cash offsets)</li>
                  <li>• No security deposits required for swaps</li>
                  <li>• Both parties keep what they receive after the swap</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How ShareCoin Earning Works */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="h-5 w-5 text-teal-600" />
              How ShareCoin Earning Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-teal-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-teal-600" />
                    <h4 className="font-medium text-teal-800">Earning Requirements</h4>
                  </div>
                  <Link href="/sharecoins" className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm font-medium">
                    Learn More <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-teal-600 mt-0.5">•</span>
                    <div>
                      <span className="font-medium text-gray-800">ShareCoins earned only after successful completion</span>
                      <p className="text-gray-500 text-xs">Your reward is guaranteed when the item is safely returned</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-teal-600 mt-0.5">•</span>
                    <div>
                      <span className="font-medium text-gray-800">Reward amount varies by item value & duration</span>
                      <p className="text-gray-500 text-xs">Higher value items and longer lending periods earn more ShareCoins</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg p-4 border border-amber-100">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-5 w-5 text-amber-600" />
                  <h4 className="font-medium text-amber-800">Bonus Opportunities</h4>
                </div>
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-600 mt-0.5">•</span>
                    <span>Extra ShareCoins for urgent requests - help neighbours in need and earn bonus rewards</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-600 mt-0.5">•</span>
                    <span>Build reputation while earning rewards - each successful lending increases your community standing</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Types */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HandHeart className="h-5 w-5 text-primary" />
              Types of Sharing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HandHeart className="h-4 w-4 text-teal-600" />
                  <h4 className="font-medium">Borrow It</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Lend items to neighbours using ShareCoins. Borrowers pay a trust-based deposit that's returned when the item comes back safely.
                </p>
              </div>
              
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  <h4 className="font-medium">Rent It</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Earn cash by renting your items. Set your own weekly rate and security deposit. Platform fee is 0% for 2025!
                </p>
              </div>
              
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowLeftRight className="h-4 w-4 text-purple-600" />
                  <h4 className="font-medium">Swap It</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Trade items directly with neighbours. Use the tier system to ensure fair exchanges with ShareCoin offsets if needed.
                </p>
              </div>
              
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Gift className="h-4 w-4 text-pink-600" />
                  <h4 className="font-medium">Have It (Gift)</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Give away items you no longer need. Help reduce waste and make a neighbour's day!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* General FAQ */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HelpCircle className="h-5 w-5 text-gray-600" />
              Frequently Asked Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>What are ShareCoins?</AccordionTrigger>
                <AccordionContent>
                  ShareCoins are our community currency. You earn them by lending items to neighbours and spend them to borrow items. They help keep sharing fair and accessible for everyone.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-2">
                <AccordionTrigger>How do security deposits work?</AccordionTrigger>
                <AccordionContent>
                  For borrowing, deposits are based on your trust score - the higher your score, the lower your deposit. For rentals, owners set the deposit amount. Deposits are returned when items come back in good condition.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-3">
                <AccordionTrigger>What if an item gets damaged?</AccordionTrigger>
                <AccordionContent>
                  We recommend taking photos before and after each transaction. If damage occurs, the security deposit helps cover repairs or replacement. Our community guidelines encourage open communication to resolve any issues.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-4">
                <AccordionTrigger>How is my trust score calculated?</AccordionTrigger>
                <AccordionContent>
                  Your trust score is based on your sharing history, including successful transactions, timely returns, item condition, and community feedback. The more you share responsibly, the higher your score grows.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-5">
                <AccordionTrigger>Can I cancel a transaction?</AccordionTrigger>
                <AccordionContent>
                  Yes, you can cancel pending requests. Once a transaction is confirmed and items are exchanged, please communicate with the other party to arrange returns. Frequent cancellations may affect your trust score.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-6">
                <AccordionTrigger>What are the platform fees?</AccordionTrigger>
                <AccordionContent>
                  For 2025, the platform fee for rentals is 0%! Only a 3% payment processing fee applies. Borrowing with ShareCoins has no fees. Swaps are completely free.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
