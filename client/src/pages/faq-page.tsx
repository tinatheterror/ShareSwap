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

        {/* What is ShareSwap */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
                <ArrowLeftRight className="h-4 w-4 text-white" />
              </div>
              <span className="font-normal text-gray-800">
                What is ShareSwap?
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 mb-4">
              A community platform where neighbours share items through
              borrowing, renting, swapping, or gifting.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-3">
                <Coins className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">
                  Borrow & Lend
                </span>
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

        {/* What are ShareCoins? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="h-5 w-5 text-teal-600" />
              What are ShareCoins?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-4 border border-teal-200">
              <p className="text-gray-700 text-sm">
                ShareCoins are our community currency. They help keep sharing fair and accessible for everyone.
              </p>
              <p className="text-red-600 font-medium text-sm mt-2">
                They do NOT convert to real money.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* How ShareCoins Are Spent */}
        <Card className="mb-6">
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
            <div className="grid grid-cols-2 gap-3">
              {/* Borrowing Items */}
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Borrowing Items</p>
                    <p className="text-xs text-gray-500">Pay to borrow</p>
                  </div>
                </div>
              </div>

              {/* Swap Offset */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ArrowLeftRight className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Swap Tier Offset</p>
                    <p className="text-xs text-gray-500">Balance value differences</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How ShareCoins Are Earned - Visual Cards */}
        <Card className="mb-6">
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {/* Lending */}
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HandHeart className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Lending Out
                    </p>
                    <p className="text-xs text-gray-500">Earn when you lend</p>
                  </div>
                </div>
              </div>

              {/* Swaps */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4 border border-[#0DCEA1]/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Completed Swap
                    </p>
                    <p className="text-xs text-gray-500">Each party earns</p>
                  </div>
                </div>
              </div>

              {/* Rentals */}
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Completed Rental
                    </p>
                    <p className="text-xs text-gray-500">Owner & renter each</p>
                  </div>
                </div>
              </div>

              {/* Gifts */}
              <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-4 border border-pink-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-pink-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gift className="h-5 w-5 text-pink-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Gift Given/Received
                    </p>
                    <p className="text-xs text-gray-500">Both parties earn</p>
                  </div>
                </div>
              </div>

              {/* Urgent Help */}
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border border-orange-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Urgent Wishlist Help
                    </p>
                    <p className="text-xs text-gray-500">
                      When fulfilled in time
                    </p>
                  </div>
                </div>
              </div>

              {/* Sponsored Games */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gamepad2 className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Sponsored Games
                    </p>
                    <p className="text-xs text-gray-500">Daily play limit</p>
                  </div>
                </div>
              </div>

              {/* Referrals */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Friend Referral
                    </p>
                    <p className="text-xs text-gray-500">
                      When friend completes first transaction
                    </p>
                  </div>
                </div>
              </div>

              {/* Level Up */}
              <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-4 border border-teal-200 md:col-span-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-teal-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="h-5 w-5 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Neighbour Level Up
                    </p>
                    <p className="text-xs text-gray-500">
                      Grow your community standing
                    </p>
                  </div>
                </div>
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
                <AccordionTrigger className="text-sm">
                  Renting vs borrowing
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Renting uses real money. Borrowing uses ShareCoins. Choose
                  renting if you want to earn cash from your items.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="rent-2">
                <AccordionTrigger className="text-sm">
                  Suggested pricing
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  We suggest weekly rates based on item category. You can adjust
                  the rate and deposit. Platform fee is 0% for 2025, only 3%
                  payment processing.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="rent-3">
                <AccordionTrigger className="text-sm">
                  Cash security deposits
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Owners set the deposit amount. Deposits are held until the
                  item is returned. Protects against damage or non-return.
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
                <AccordionTrigger className="text-sm">
                  What is swapping
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  A direct item-for-item trade. No cash. No deposits. Value
                  differences are balanced with ShareCoins.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="swap-2">
                <AccordionTrigger className="text-sm">
                  Tiers & swap rules
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 1</div>
                        <div className="text-[#0DCEA1]">5 ShareCoins</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 2</div>
                        <div className="text-[#0DCEA1]">10 ShareCoins</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 3</div>
                        <div className="text-[#0DCEA1]">20 ShareCoins</div>
                      </div>
                      <div className="bg-[#E6FBF5] rounded p-2">
                        <div className="font-semibold">Tier 4</div>
                        <div className="text-[#0DCEA1]">40 ShareCoins</div>
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
                  Are rewards fixed?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Yes. Each action has a set reward amount. Rewards are not
                  negotiable and are credited automatically upon completion.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-faq-2">
                <AccordionTrigger className="text-sm">
                  Are there any limits?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Some activities have daily or per-request limits to keep
                  things fair. Sponsored games can be played once per day.
                  Urgent request bonuses apply once per request.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-faq-3">
                <AccordionTrigger className="text-sm">
                  One-time bonuses
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
