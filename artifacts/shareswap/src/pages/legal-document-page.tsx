import { Link } from "wouter";
import { SimpleMarkdown } from "@/components/legal/simple-markdown";

export function LegalDocumentPage({ source }: { source: string }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <SimpleMarkdown source={source} />
        <p className="mt-8 text-sm">
          <Link href="/" className="text-teal-600 underline">Back to ShareSwap</Link>
        </p>
      </div>
    </div>
  );
}
