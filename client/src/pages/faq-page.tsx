import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight,
  Coins,
  HandHeart,
  DollarSign,
  Gift,
  Shield,
  Gamepad2,
  Users,
  TrendingUp,
  Clock,
  HelpCircle,
  Package,
  Wallet,
  Sparkles,
  UserCheck,
  Leaf,
} from "lucide-react";

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
            Everything you need to know to use the platform with confidence
          </p>
        </div>

        {/* Why ShareSwap? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-[#0DCEA1]" />
              Why ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Save Money or Earn Money */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-white rounded-full flex items-center justify-center relative">
                  {/* Paper money stack illustration */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    {/* Back bill */}
                    <div className="absolute -left-0.5 top-1 w-11 h-6 bg-[#2E8B57] rounded-md rotate-[-8deg]">
                      <div className="absolute left-1 top-1 w-1.5 h-1.5 bg-[#3CB371] rounded-full opacity-60"></div>
                      <div className="absolute right-1 bottom-1 w-1.5 h-1.5 bg-[#3CB371] rounded-full opacity-60"></div>
                    </div>
                    {/* Front bill */}
                    <div className="w-11 h-6 bg-[#3CB371] rounded-md relative rotate-[5deg]">
                      {/* Center circle with $ */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-4 h-4 bg-[#2E8B57] rounded-full flex items-center justify-center">
                          <span className="text-[10px] text-[#90EE90] font-bold">
                            $
                          </span>
                        </div>
                      </div>
                      {/* Corner dots */}
                      <div className="absolute left-1 top-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute right-1 top-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute left-1 bottom-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute right-1 bottom-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Save or Earn Money
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Borrow for less or rent out for extra cash.
                </p>
              </div>

              {/* Turn Unused Items Into Value */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-white rounded-full flex items-center justify-center relative">
                  {/* Sofa with price tag illustration */}
                  <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2">
                    {/* Sofa body */}
                    <div className="w-10 h-4 bg-[#7C9EB2] rounded-t-lg border border-[#5A7A8A]"></div>
                    {/* Sofa back */}
                    <div className="w-10 h-3 bg-[#5A7A8A] rounded-t-md -mt-3.5 mx-auto"></div>
                    {/* Sofa arms */}
                    <div className="absolute -left-1.5 bottom-0 w-2 h-3.5 bg-[#7C9EB2] rounded-l-md border border-[#5A7A8A]"></div>
                    <div className="absolute -right-1.5 bottom-0 w-2 h-3.5 bg-[#7C9EB2] rounded-r-md border border-[#5A7A8A]"></div>
                    {/* Sofa legs */}
                    <div className="absolute left-1.5 -bottom-1 w-1 h-1 bg-[#8B7355] rounded-sm"></div>
                    <div className="absolute right-1.5 -bottom-1 w-1 h-1 bg-[#8B7355] rounded-sm"></div>
                    {/* Price tag hanging from arm */}
                    <div className="absolute -right-3 -top-1">
                      <div className="w-0.5 h-2 bg-amber-600 mx-auto"></div>
                      <div className="w-5 h-6 bg-amber-100 border-2 border-amber-400 rounded-sm shadow-sm -mt-0.5">
                        <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-amber-400 rounded-full"></div>
                        <div className="flex items-center justify-center h-full text-[10px] text-amber-700 font-bold mt-0.5">
                          $
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Turn Idle Into Value
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Your unused items can help others.
                </p>
              </div>

              {/* Built on Local Trust */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-white rounded-full flex items-center justify-center relative">
                  {/* ID card with shield illustration */}
                  <div className="w-8 h-6 bg-[#87CEEB] rounded-sm border border-[#5F9EA0] rotate-[-5deg] absolute left-3">
                    <div className="absolute top-1 left-1 w-2 h-2 bg-white/60 rounded-full"></div>
                    <div className="absolute bottom-1 left-1 right-1 h-0.5 bg-white/40"></div>
                    <div className="absolute bottom-2 left-1 right-2 h-0.5 bg-white/40"></div>
                  </div>
                  <div className="absolute right-3 bottom-3">
                    <Shield className="h-5 w-5 text-gray-400 fill-gray-100" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-1.5 h-2 bg-gray-400 rounded-sm mt-0.5"></div>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Built on Local Trust
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Verified profiles and fair rules.
                </p>
              </div>

              {/* Reduce Waste Effortlessly */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-white rounded-full flex items-center justify-center relative">
                  {/* Earth with leaf illustration */}
                  <div className="w-9 h-9 bg-[#87CEEB] rounded-full relative overflow-hidden">
                    {/* North America - wider at top, narrower at bottom */}
                    <div className="absolute top-0.5 left-0 w-3.5 h-3 bg-[#3CB371]" style={{borderRadius: '40% 60% 30% 70%'}}></div>
                    {/* South America - elongated, tapers down */}
                    <div className="absolute bottom-0 left-1 w-2 h-3 bg-[#3CB371]" style={{borderRadius: '50% 50% 30% 70%'}}></div>
                    {/* Africa - large, elongated */}
                    <div className="absolute top-2 right-0.5 w-2.5 h-4 bg-[#3CB371]" style={{borderRadius: '60% 40% 50% 50%'}}></div>
                    {/* Europe - small blob above Africa */}
                    <div className="absolute top-0.5 right-1 w-2 h-1.5 bg-[#3CB371]" style={{borderRadius: '50% 50% 60% 40%'}}></div>
                  </div>
                  <div className="absolute -top-0.5 right-3">
                    <Leaf className="h-4 w-4 text-[#228B22] fill-[#90EE90]" />
                  </div>
                  <div className="absolute bottom-3 left-3 w-2 h-2 bg-[#90EE90] rounded-full"></div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Reduce Waste
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Less buying, less clutter, less impact.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What is ShareSwap */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <img
                src="/shareswap-logo.jpeg"
                alt="ShareSwap Logo"
                className="w-9 h-9 rounded-lg"
              />
              What is ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm mb-6">
              A community platform where neighbours share their own items
              through borrowing, renting, swapping, or gifting.
            </p>

            <Tabs defaultValue="borrow" className="w-full">
              <TabsList className="grid grid-cols-4 gap-2 h-auto bg-transparent p-0 mb-4">
                <TabsTrigger
                  value="borrow"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <HandHeart className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Borrow & Lend
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="rent"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <DollarSign className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Rent
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="swap"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <ArrowLeftRight className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Swap
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="gift"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <Gift className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Gift
                  </span>
                </TabsTrigger>
              </TabsList>

              {/* Borrow & Lend Tab Content */}
              <TabsContent value="borrow" className="mt-0">
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="borrow-1">
                    <AccordionTrigger className="text-sm">
                      How borrowing works
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600">
                      Request an item, pay ShareCoins, and pick it up. Return it
                      by the agreed date. The lender earns ShareCoins when the
                      item is returned safely.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="borrow-2">
                    <AccordionTrigger className="text-sm">
                      ShareCoins explanation
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600">
                      ShareCoins are the platform currency. Earn them by lending
                      items. Spend them to borrow. No real money changes hands
                      for borrowing.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="borrow-3">
                    <AccordionTrigger className="text-sm">
                      Trust-based security deposits
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600">
                      Deposits are based on item value and your trust score.
                      Higher trust means lower deposits. Fully refundable when
                      items return in good condition.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </TabsContent>

              {/* Rent Tab Content */}
              <TabsContent value="rent" className="mt-0">
                <p className="text-gray-700 text-sm mb-4">
                  Renting uses real money instead of ShareCoins. Choose renting
                  if you want to earn cash from your items.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Suggested Pricing
                    </p>
                    <p className="text-xs text-gray-500">
                      Weekly rental rates and security deposits are suggested
                      based on item category. You can adjust the rate and
                      security deposit to your desire.
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Platform Fees
                    </p>
                    <p className="text-xs text-gray-500">
                      0% platform fee for 2025. Only 3% payment processing.
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      Security Deposits
                    </p>
                    <p className="text-xs text-gray-500">
                      Owners can adjust the suggested deposit amount. Held until
                      item is returned safely.
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Swap Tab Content */}
              <TabsContent value="swap" className="mt-0">
                <p className="text-gray-700 text-sm mb-4">
                  A swap is a direct item-for-item trade between neighbours. No
                  cash. No deposits. Just swap. Value differences are balanced
                  with ShareCoins. Our tier system ensures fair exchanges.
                </p>

                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20 mb-4">
                  <p className="text-[#0DCEA1] font-medium text-sm mb-3">
                    Tiers & ShareCoin Values
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 1
                      </p>
                      <p className="text-[#0DCEA1] font-medium text-sm">
                        5 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 2
                      </p>
                      <p className="text-[#0DCEA1] font-medium text-sm">
                        10 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 3
                      </p>
                      <p className="text-[#0DCEA1] font-medium text-sm">
                        20 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 4
                      </p>
                      <p className="text-[#0DCEA1] font-medium text-sm">
                        40 ShareCoins
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-gray-800 text-sm mb-3">
                    Swap Rules
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-3 h-3 rounded-full bg-green-500 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          Same-tier swaps
                        </p>
                        <p className="text-xs text-gray-500">Direct swaps.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-3 h-3 rounded-full bg-yellow-400 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          One-tier difference
                        </p>
                        <p className="text-xs text-gray-500">
                          The person with the lower-tier item adds ShareCoins to
                          balance the value.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-3 h-3 rounded-full bg-red-400 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          Two tier difference
                        </p>
                        <p className="text-xs text-gray-500">Not allowed.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Gift Tab Content */}
              <TabsContent value="gift" className="mt-0">
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="gift-1">
                    <AccordionTrigger className="text-sm">
                      What gifting means
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600">
                      Give away items you no longer need. The recipient keeps
                      the item permanently. No payments or deposits required.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="gift-2">
                    <AccordionTrigger className="text-sm">
                      ShareCoin reward
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600">
                      Both the giver and receiver earn ShareCoins when a gift is
                      completed.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* What are ShareCoins? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="h-5 w-5 text-teal-600" />
              What are ShareCoins?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm">
              ShareCoins are the currency of our marketplace. They help keep
              sharing fair and accessible for everyone. ShareCoins do not
              convert to real money. They mainly reward lending, but also
              encourage sharing and help build community. reputation.
            </p>
          </CardContent>
        </Card>

        {/* Spent & Earned Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* How ShareCoins Are Spent */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="flex items-center">
                  <span className="text-orange-500 font-bold text-lg mr-0.5">
                    −
                  </span>
                  <Coins className="h-5 w-5 text-orange-500" />
                </div>
                How ShareCoins Are Spent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {/* Borrowing Items */}
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3 border border-amber-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <HandHeart className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Borrowing Items
                      </p>
                      <p className="text-[10px] text-gray-500">Pay to borrow</p>
                    </div>
                  </div>
                </div>

                {/* Swap Offset */}
                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-3 border border-[#0DCEA1]/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ArrowLeftRight className="h-4 w-4 text-[#0DCEA1]" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Swap Tier Offset
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Balance value differences
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* How ShareCoins Are Earned */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="flex items-center">
                  <span className="text-teal-600 font-bold text-lg mr-0.5">
                    +
                  </span>
                  <Coins className="h-5 w-5 text-teal-600" />
                </div>
                How ShareCoins Are Earned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {/* Lending */}
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3 border border-amber-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <HandHeart className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Lending Items
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Earn when you lend
                      </p>
                    </div>
                  </div>
                </div>

                {/* Swaps */}
                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-3 border border-[#0DCEA1]/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ArrowLeftRight className="h-4 w-4 text-[#0DCEA1]" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Completed Swap
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Each party earns
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rentals */}
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 border border-green-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <DollarSign className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Completed Rental
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Owner & renter each
                      </p>
                    </div>
                  </div>
                </div>

                {/* Gifts */}
                <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-3 border border-pink-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-pink-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Gift className="h-4 w-4 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Gift Given/Received
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Both parties earn
                      </p>
                    </div>
                  </div>
                </div>

                {/* Urgent Help */}
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-3 border border-orange-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-orange-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="h-4 w-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Urgent Help
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Fulfilled in time
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sponsored Games */}
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 border border-purple-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Gamepad2 className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Sponsored Games
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Daily play limit
                      </p>
                    </div>
                  </div>
                </div>

                {/* Referrals */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Friend Referral
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Friend's first transaction
                      </p>
                    </div>
                  </div>
                </div>

                {/* Level Up */}
                <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-3 border border-teal-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-teal-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Level Up
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Community standing
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
                <AccordionTrigger className="text-sm">
                  Verified profiles
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Verify your identity with government ID and payment method.
                  Verified users get a badge and access to higher-value items.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trust-2">
                <AccordionTrigger className="text-sm">
                  Trust score affects deposits
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Your trust score is built through successful transactions.
                  Higher scores mean lower deposit requirements for borrowing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trust-3">
                <AccordionTrigger className="text-sm">
                  Keeping the community fair
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  We monitor activity to ensure a positive experience for
                  everyone. Accounts with unusual patterns may be reviewed.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* ShareCoin FAQ - Moved to bottom */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HelpCircle className="h-5 w-5 text-gray-500" />
              ShareCoin FAQ
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="sc-faq-1">
                <AccordionTrigger className="text-sm">
                  Are ShareCoin rewards fixed?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Yes. Each action has a set reward amount. Rewards are not
                  negotiable and are credited automatically upon completion.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-faq-2">
                <AccordionTrigger className="text-sm">
                  Are there any limits on ShareCoin rewards?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Some activities have daily or per-request limits to keep
                  things fair. Sponsored games can be played once per day.
                  Urgent request bonuses apply once per request.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-faq-3">
                <AccordionTrigger className="text-sm">
                  One-time ShareCoin bonuses
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Earn bonus ShareCoins for completing your first swap, gift,
                  rent, or borrow. You also get a one-time bonus for completing
                  your profile with verification, photo, and bio.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
