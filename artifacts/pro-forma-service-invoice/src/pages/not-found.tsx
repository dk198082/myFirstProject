import { Link } from "wouter";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center p-6">
      <div className="max-w-sm rounded-sm border border-border bg-card p-8 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">404</div>
        <h1 className="mt-2 text-lg font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This workspace has a single page.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline" data-testid="link-home">
          Back to pro forma lookup
        </Link>
      </div>
    </main>
  );
}
