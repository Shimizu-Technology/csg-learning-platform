interface LoadingSpinnerProps {
  message?: string
  fullScreen?: boolean
}

export function LoadingSpinner({ message, fullScreen = true }: LoadingSpinnerProps) {
  const variant = skeletonVariantFor(message)
  const content = (
    <div className="mx-auto w-full max-w-6xl space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{message || 'Loading content'}</span>
      <div className="space-y-2">
        <SkeletonLine className="h-3 w-24 bg-primary-100" />
        <SkeletonLine className="h-7 w-64" />
        <SkeletonLine className="h-4 w-full max-w-md bg-slate-100" />
      </div>
      {variant === 'table' && <TableSkeleton />}
      {variant === 'detail' && <DetailSkeleton />}
      {variant === 'editor' && <EditorSkeleton />}
      {variant === 'media' && <MediaSkeleton />}
      {variant === 'profile' && <ProfileSkeleton />}
      {variant === 'dashboard' && <DashboardSkeleton />}
      {variant === 'list' && <ListSkeleton />}
    </div>
  )

  if (fullScreen) {
    return <div className="min-h-screen bg-slate-50 px-4 py-8 lg:px-8">{content}</div>
  }

  return <div className="px-4 py-8">{content}</div>
}

type SkeletonVariant = 'dashboard' | 'list' | 'table' | 'detail' | 'editor' | 'media' | 'profile'

function skeletonVariantFor(message = ''): SkeletonVariant {
  const normalized = message.toLowerCase()
  if (normalized.includes('dashboard')) return 'dashboard'
  if (normalized.includes('student') || normalized.includes('grading') || normalized.includes('submission') || normalized.includes('team')) return 'table'
  if (normalized.includes('cohort') || normalized.includes('module') || normalized.includes('lesson') || normalized.includes('exercise')) return 'detail'
  if (normalized.includes('content')) return 'editor'
  if (normalized.includes('recording')) return 'media'
  if (normalized.includes('profile')) return 'profile'
  return 'list'
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-full bg-slate-200 ${className}`} />
}

function SkeletonBox({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-slate-100 ${className}`} />
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5">
            <SkeletonBox className="h-10 w-10 rounded-xl" />
            <SkeletonLine className="mt-4 h-6 w-20" />
            <SkeletonLine className="mt-2 h-3 w-28 bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <SkeletonLine className="h-5 w-48" />
          <SkeletonBox className="mt-5 h-32" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2].map((item) => <SkeletonLine key={item} className="h-4 w-full bg-slate-100" />)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <SkeletonBox className="mx-auto h-28 w-28 rounded-full" />
          <SkeletonLine className="mx-auto mt-5 h-4 w-32" />
          <SkeletonLine className="mx-auto mt-2 h-3 w-24 bg-slate-100" />
        </div>
      </div>
    </>
  )
}

function ListSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <SkeletonBox className="h-11 w-full rounded-xl" />
      </div>
      <div className="divide-y divide-slate-100">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="flex items-center gap-4 p-4">
            <SkeletonBox className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonLine className="h-4 w-56 max-w-full" />
              <SkeletonLine className="h-3 w-80 max-w-full bg-slate-100" />
            </div>
            <SkeletonLine className="hidden h-8 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <SkeletonLine key={item} className="h-3 w-24" />)}
      </div>
      <div className="divide-y divide-slate-100">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="grid gap-3 p-4 sm:grid-cols-4">
            <SkeletonLine className="h-4 w-40" />
            <SkeletonLine className="h-4 w-32 bg-slate-100" />
            <SkeletonLine className="h-4 w-28 bg-slate-100" />
            <SkeletonLine className="h-4 w-20 bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <SkeletonLine className="h-6 w-72 max-w-full" />
            <SkeletonLine className="h-4 w-96 max-w-full bg-slate-100" />
          </div>
          <SkeletonBox className="h-20 w-20 rounded-full" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5">
            <SkeletonLine className="h-5 w-48" />
            <SkeletonLine className="mt-3 h-3 w-full bg-slate-100" />
            <SkeletonLine className="mt-2 h-3 w-10/12 bg-slate-100" />
            <SkeletonBox className="mt-4 h-24" />
          </div>
        ))}
      </div>
    </>
  )
}

function EditorSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {[0, 1, 2, 3, 4].map((item) => <SkeletonLine key={item} className="mb-4 h-4 w-full bg-slate-100" />)}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <SkeletonLine className="h-6 w-64" />
        <SkeletonBox className="mt-5 h-80" />
      </div>
    </div>
  )
}

function MediaSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <SkeletonBox className="aspect-video w-full" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-white p-3">
            <SkeletonLine className="h-4 w-48" />
            <SkeletonLine className="mt-2 h-3 w-32 bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-4">
          <SkeletonBox className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <SkeletonLine className="h-5 w-48" />
            <SkeletonLine className="h-3 w-56 bg-slate-100" />
          </div>
        </div>
        <SkeletonBox className="mt-6 h-11 rounded-lg" />
      </div>
      <ListSkeleton />
    </div>
  )
}
