import { Link } from "wouter";
import { SimpleMarkdown } from "@/components/legal/simple-markdown";
// The text lives in docs/legal so it can be reviewed as a document; this page only shows it.
import chargebacks from "../../../../docs/legal/chargebacks-and-disputes.md?raw";

export default function ChargebacksPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <SimpleMarkdown source={chargebacks} />
        <p className="mt-8 text-sm">
          <Link href="/" className="text-teal-600 underline">Back to ShareSwap</Link>
        </p>
      </div>
    </div>
  );
}
