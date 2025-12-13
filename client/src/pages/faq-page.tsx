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
  HandHeart,
  DollarSign,
  Gift,
  Shield,
  Star,
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
            Quick reference guide for using the platform
          </p>
        </div>

        {/* What is ShareSwap */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                <ArrowLeftRight className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-teal-600">ShareSwap</span>
              <span className="font-normal text-gray-800">What is ShareSwap?</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 mb-4">
              A community platform where neighbours share items through borrowing, renting, swapping, or gifting.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-3">
                <Coins className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Borrow</span>
              </div>
              <div className="flex items-center gap-2 bg-green-50 rounded-lg p-3">
                <DollarSign className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Rent</span>
              </div>
              <div className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3">
                <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Swap</span>
              </div>
              <div className="flex items-center gap-2 bg-pink-50 rounded-lg p-3">
                <Gift className="h-5 w-5 text-pink-500 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Gift</span>
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
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="earn-1">
                <AccordionTrigger className="text-sm">When do I earn ShareCoins?</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  ShareCoins are credited after successful completion. Your reward is guaranteed when the item is safely returned.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="earn-2">
                <AccordionTrigger className="text-sm">How much do I earn?</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Reward amount varies by item value and lending duration. Higher value items and longer periods earn more.
                  <Link href="/sharecoins-info" className="text-teal-600 hover:text-teal-700 ml-1 font-medium">
                    Learn more
                  </Link>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="earn-3">
                <AccordionTrigger className="text-sm">Bonus opportunities</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Earn extra ShareCoins for urgent requests. Each successful lending also increases your community standing.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Borrowing & Lending */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HandHeart className="h-5 w-5 text-teal-600" />
              Borrowing & Lending
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="borrow-1">
                <AccordionTrigger className="text-sm">How borrowing works</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Request an item, pay ShareCoins, and pick it up. Return it by the agreed date. The lender earns ShareCoins when the item is returned safely.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="borrow-2">
                <AccordionTrigger className="text-sm">ShareCoins explanation</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  ShareCoins are the platform currency. Earn them by lending items. Spend them to borrow. No real money changes hands for borrowing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="borrow-3">
                <AccordionTrigger className="text-sm">Trust-based security deposits</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Deposits are based on item value and your trust score. Higher trust means lower deposits. Fully refundable when items return in good condition.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Renting (Cash) */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
              Renting (Cash)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="rent-1">
                <AccordionTrigger className="text-sm">Renting vs borrowing</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Renting uses real money. Borrowing uses ShareCoins. Choose renting if you want to earn cash from your items.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="rent-2">
                <AccordionTrigger className="text-sm">Suggested pricing</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  We suggest weekly rates based on item category. You can adjust the rate and deposit. Platform fee is 0% for 2025, only 3% payment processing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="rent-3">
                <AccordionTrigger className="text-sm">Cash security deposits</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Owners set the deposit amount. Deposits are held until the item is returned. Protects against damage or non-return.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Swapping */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]" />
              Swapping
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="swap-1">
                <AccordionTrigger className="text-sm">What is swapping</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  A direct item-for-item trade. No cash. No deposits. Value differences are balanced with ShareCoins.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="swap-2">
                <AccordionTrigger className="text-sm">Tiers & swap rules</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 1</div>
                        <div className="text-[#0DCEA1]">5 SC</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 2</div>
                        <div className="text-[#0DCEA1]">10 SC</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 3</div>
                        <div className="text-[#0DCEA1]">20 SC</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 4</div>
                        <div className="text-[#0DCEA1]">40 SC</div>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                        <span>Same tier: Direct swap</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                        <span>1 tier apart: Lower tier adds ShareCoins</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-400 rounded-full"></span>
                        <span>2+ tiers apart: Not allowed</span>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Gifting */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gift className="h-5 w-5 text-pink-500" />
              Gifting
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="gift-1">
                <AccordionTrigger className="text-sm">What gifting means</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Give away items you no longer need. The recipient keeps the item permanently. No payments or deposits required.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="gift-2">
                <AccordionTrigger className="text-sm">Optional ShareCoin reward</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Recipients can choose to tip ShareCoins as a thank you. This is optional and not expected.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Trust & Safety */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-teal-600" />
              Trust & Safety
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="trust-1">
                <AccordionTrigger className="text-sm">Verified profiles</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Verify your identity with government ID and payment method. Verified users get a badge and access to higher-value items.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trust-2">
                <AccordionTrigger className="text-sm">Trust score affects deposits</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Your trust score is built through successful transactions. Higher scores mean lower deposit requirements for borrowing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trust-3">
                <AccordionTrigger className="text-sm">Abuse prevention</AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  We detect unusual patterns like frequent cancellations or ShareCoin farming. Accounts with suspicious activity may be restricted.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
