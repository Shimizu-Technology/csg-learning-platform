import { Hash, MessageCircle, Search } from 'lucide-react'

const channelRows = Array.from({ length: 5 }, (_, index) => index)
const messageRows = Array.from({ length: 4 }, (_, index) => index)

export function MessagesLoadingShell() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] min-h-[620px] w-full max-w-[1500px] overflow-hidden lg:px-4">
      <div className="grid min-h-0 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[328px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-slate-200 bg-slate-50/80 lg:flex lg:flex-col">
          <div className="border-b border-slate-200 bg-white px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3 w-16 animate-pulse rounded-full bg-slate-200" />
                <div className="h-5 w-44 animate-pulse rounded-full bg-slate-200" />
              </div>
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-400">
              <Search className="h-4 w-4" />
              <div className="h-3 w-28 animate-pulse rounded-full bg-slate-200" />
            </div>

            <div className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
              {channelRows.map((row) => (
                <div key={row} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-300 ring-1 ring-slate-200">
                    {row === 0 ? <MessageCircle className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className={`h-3 animate-pulse rounded-full bg-slate-200 ${row % 2 === 0 ? 'w-36' : 'w-28'}`} />
                    <div className="h-2 w-20 animate-pulse rounded-full bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-white">
          <header className="flex h-[73px] shrink-0 items-center justify-between border-b border-slate-200 px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
              <div className="space-y-2">
                <div className="h-4 w-44 animate-pulse rounded-full bg-slate-200" />
                <div className="h-3 w-28 animate-pulse rounded-full bg-slate-100" />
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col justify-end gap-5 overflow-hidden px-4 py-6 sm:px-6">
            {messageRows.map((row) => (
              <div key={row} className="flex gap-3">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
                    <div className="h-2 w-14 animate-pulse rounded-full bg-slate-100" />
                  </div>
                  <div className={`h-3 animate-pulse rounded-full bg-slate-100 ${row % 2 === 0 ? 'w-10/12' : 'w-7/12'}`} />
                  <div className={`h-3 animate-pulse rounded-full bg-slate-100 ${row % 3 === 0 ? 'w-6/12' : 'w-9/12'}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-3 sm:px-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-2">
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100" />
                </div>
                <div className="h-8 w-20 animate-pulse rounded-lg bg-primary-100" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
