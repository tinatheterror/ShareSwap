# Teen accounts (phase 2)

> **Not for launch.** A design for a later phase, kept so the launch work does not close it off. Launch uses a single rule: the minimum age is the age of majority where the person lives (see `artifacts/api-server/src/age-of-majority.ts`). Nothing below is built, and none of it has had legal review. Parental consent for under-13s, children's privacy law (COPPA in the US, PIPEDA and Quebec's Law 25 in Canada), and each province's and state's rules on minors' contracts all need counsel before any of it ships.

## Principle

ShareSwap's actual minimum account age and Apple's App Store age rating are separate decisions. The age rating is answered honestly from the app's content and features. The minimum account age is a product and legal decision. Eligibility is enforced in the backend permissions, not only by hiding buttons.

Being 18 does not mean someone has reached the age of majority where they live (it is 19 in several provinces and states, and 21 in Mississippi). Independent contractual and financial activity uses the applicable age of majority, wherever the law needs it.

## Proposal

- Minimum account age: **13+**.
- **13 to 17:** a restricted account, with parental or guardian consent.
- **18+:** an adult account. Independent financial and contractual features apply only once the person has reached the age of majority where they live.
- **Under the age of majority:** no independent Stripe payouts and no Stripe-facilitated deposits.
- **Rentals and deposits** need an adult account holder, or a properly supported guardian-managed arrangement.
- **Swaps and gifts** are allowed with appropriate guardian consent and safety restrictions.

## Features by age

| Feature | Ages 13 to 17 | Adults |
| --- | --- | --- |
| Browse listings | Yes | Yes |
| Create wishlists | Yes | Yes |
| List items | With guardian consent | Yes |
| Gift items | With guardian consent | Yes |
| Receive gifted items | With guardian consent | Yes |
| Swap items | With guardian consent | Yes |
| Borrow, direct trust deposit between users | With guardian consent and involvement | Yes |
| Borrow, Stripe-facilitated trust deposit | Not independently: an adult account holder is required | Yes, subject to Stripe eligibility |
| Rent items | An adult account holder is required | Yes |
| Receive Stripe payouts | Through an eligible adult or guardian arrangement | Yes, subject to Stripe eligibility |

## Borrowing rules

Borrowing stays open to minors through the direct-deposit route, but minors cannot use Stripe-managed deposits on their own. The two methods do not carry the same risks, and the rules should not pretend they do.

1. **Direct trust deposit**
   - Both parties arrange the deposit themselves.
   - Guardian consent is required for a minor.
   - The guardian is involved in agreeing the deposit and the return conditions.
   - No unsupervised exchanges between minors and unknown adults.
2. **Stripe-facilitated trust deposit**
   - An adult account holder is required.
   - Stripe's account eligibility requirements apply.
   - A minor cannot independently authorise the payment or the deposit.

## What building it would need

- Guardian accounts and a consent flow that can be verified and revoked, with its own records and deletion rules.
- Age and guardian-consent checks in the API permissions behind every listing, request, deposit and payout route, alongside the existing terms and age checks.
- Safety restrictions for minors: meeting rules, who they can message, visibility of their profile and location, and moderation for reports involving minors.
- Collecting and keeping the date of birth, which the launch design avoids, or a different way to know a person is under the age of majority.
- Updated Terms, Privacy Policy, Community Guidelines, App Store and Google Play answers, and a children's privacy review.
