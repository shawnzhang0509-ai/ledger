export const metadata = { title: "Unsubscribe · DRIFTAE" };

// Public: linked from every DRIFTAE promo email. A button (not the link itself) unsubscribes, so mail scanners
// that open links don't unsubscribe people by accident.
export default function UnsubscribePage({ searchParams }: { searchParams: { t?: string; done?: string } }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">DRIFTAE emails</h1>
      {searchParams.done ? (
        <p className="mt-4 text-slate-600">You&apos;re unsubscribed. We won&apos;t email you offers again.</p>
      ) : searchParams.t ? (
        <form method="post" action="/api/unsubscribe" className="mt-6">
          <input type="hidden" name="t" value={searchParams.t} />
          <p className="text-slate-600">Stop new-arrival and members-only emails from DRIFTAE?</p>
          <button type="submit" className="mt-6 rounded bg-slate-900 px-5 py-2 text-white">Unsubscribe</button>
        </form>
      ) : (
        <p className="mt-4 text-slate-600">Use the unsubscribe link in one of our emails, or email driftaenz@gmail.com.</p>
      )}
    </main>
  );
}
