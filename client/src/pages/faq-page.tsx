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
            Quick reference guide for using the platform
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Save Money or Earn Money */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Wallet className="h-5 w-5 text-[#0DCEA1]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Save Money or Earn Money</p>
                    <p className="text-xs text-gray-500">Borrow what you need for a fraction of the cost or even free. Rent out items you already have for extra cash.</p>
                  </div>
                </div>
              </div>

              {/* Turn Unused Items Into Value */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="h-5 w-5 text-[#0DCEA1]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Turn Unused Items Into Value</p>
                    <p className="text-xs text-gray-500">Most items sit idle. ShareSwap turns unused stuff into value without selling it or throwing it out.</p>
                  </div>
                </div>
              </div>

              {/* Built on Local Trust */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <UserCheck className="h-5 w-5 text-[#0DCEA1]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Built on Local Trust</p>
                    <p className="text-xs text-gray-500">Verified profiles, trust scores, and fair rules make sharing with neighbours safe and predictable.</p>
                  </div>
                </div>
              </div>

              {/* Reduce Waste Effortlessly */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Leaf className="h-5 w-5 text-[#0DCEA1]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Reduce Waste Effortlessly</p>
                    <p className="text-xs text-gray-500">Sharing means fewer purchases, less clutter, and less environmental impact with no extra effort required.</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What is ShareSwap */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                <ArrowLeftRight className="h-4 w-4 text-white" />
              </div>
              What is ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 mb-4">
              A community platform where neighbours share their own items
              through borrowing, renting, swapping, or gifting.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3">
                <HandHeart className="h-5 w-5 text-[#0DCEA1] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">
                  Borrow & Lend
                </span>
              </div>
              <div className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3">
                <DollarSign className="h-5 w-5 text-[#0DCEA1] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Rent</span>
              </div>
              <div className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3">
                <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Swap</span>
              </div>
              <div className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3">
                <Gift className="h-5 w-5 text-[#0DCEA1] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Gift</span>
              </div>
            </div>
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
                <AccordionTrigger className="text-sm">
                  How borrowing works
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Request an item, pay ShareCoins, and pick it up. Return it by
                  the agreed date. The lender earns ShareCoins when the item is
                  returned safely.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="borrow-2">
                <AccordionTrigger className="text-sm">
                  ShareCoins explanation
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  ShareCoins are the platform currency. Earn them by lending
                  items. Spend them to borrow. No real money changes hands for
                  borrowing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="borrow-3">
                <AccordionTrigger className="text-sm">
                  Trust-based security deposits
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Deposits are based on item value and your trust score. Higher
                  trust means lower deposits. Fully refundable when items return
                  in good condition.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
              ShareCoins are our community currency. They help keep sharing fair
              and accessible for everyone. They do not convert to real money.
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

        {/* How Swaps Work */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]" />
              How Swaps Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm mb-4">
              A swap is a direct item-for-item trade between neighbours. No
              cash. No deposits. Just swap. Value differences are balanced with
              ShareCoins. Our tier system ensures fair exchanges.
            </p>

            {/* Tiers & ShareCoin Values */}
            <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20 mb-4">
              <p className="text-[#0DCEA1] font-medium text-sm mb-3">
                Tiers & ShareCoin Values
              </p>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 1</p>
                  <p className="text-[#0DCEA1] font-medium text-sm">
                    5 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 2</p>
                  <p className="text-[#0DCEA1] font-medium text-sm">
                    10 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 3</p>
                  <p className="text-[#0DCEA1] font-medium text-sm">
                    20 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 4</p>
                  <p className="text-[#0DCEA1] font-medium text-sm">
                    40 ShareCoins
                  </p>
                </div>
              </div>
            </div>

            {/* Swap Rules */}
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
          </CardContent>
        </Card>

        {/* How Renting Works */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
              How Renting Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm mb-4">
              Renting uses real money instead of ShareCoins. Choose renting if
              you want to earn cash from your items.
            </p>

            {/* Key Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Suggested Pricing
                </p>
                <p className="text-xs text-gray-500">
                  Weekly rates based on item category. You can adjust the rate.
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
                  Owners set the deposit. Held until item is returned safely.
                </p>
              </div>
            </div>
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
                <AccordionTrigger className="text-sm">
                  What gifting means
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Give away items you no longer need. The recipient keeps the
                  item permanently. No payments or deposits required.
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
