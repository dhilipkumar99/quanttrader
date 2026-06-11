import Link from "next/link";
import { BarChart2, Home, BookOpen } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-6 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mb-6">
        <BarChart2 className="h-8 w-8 text-white" />
      </div>

      <div className="text-8xl font-black text-zinc-800 mb-2">404</div>
      <h1 className="text-2xl font-bold text-zinc-200 mb-2">Page not found</h1>
      <p className="text-zinc-500 max-w-sm mb-8 leading-relaxed">
        The page you're looking for doesn't exist or has moved.
        Head back to the app to continue trading.
      </p>

      <div className="flex gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
        >
          <Home className="h-4 w-4" />
          Go to App
        </Link>
        <Link
          href="/how-it-works"
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-semibold transition-all"
        >
          <BookOpen className="h-4 w-4" />
          How it works
        </Link>
      </div>
    </div>
  );
}
