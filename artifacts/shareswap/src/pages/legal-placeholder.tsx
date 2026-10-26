import { Link } from "wouter";

export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-gray-600">The full text is coming soon.</p>
        <Link href="/" className="text-teal-600 underline">
          Back to ShareSwap
        </Link>
      </div>
    </div>
  );
}
