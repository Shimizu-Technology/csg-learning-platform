import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Building2, CheckCircle2, Globe, Mail, RefreshCw, Clock } from 'lucide-react'
import { api, type SchoolIdentityResponse } from '../../lib/api'
import { brand } from '../../lib/brand'
import { schoolTimeDescription, schoolTimeZone } from '../../lib/schoolTime'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export function SchoolIdentityPreview() {
  const [identity, setIdentity] = useState<SchoolIdentityResponse['school_identity'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getSchoolIdentity()
      if (response.data && !response.error && !response.fromCache) {
        setIdentity(response.data.school_identity)
      } else {
        setError(response.error || 'Could not load server branding settings.')
      }
    } catch {
      setError('Could not load server branding settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mismatches: string[] = []
  if (identity) {
    if (identity.name !== brand.schoolName) mismatches.push(`School name (API "${identity.name}" vs Web "${brand.schoolName}")`)
    if (identity.product_name !== brand.productName) mismatches.push(`Product name (API "${identity.product_name}" vs Web "${brand.productName}")`)
    if (identity.support_email !== brand.supportEmail) mismatches.push(`Support email (API "${identity.support_email}" vs Web "${brand.supportEmail}")`)
    if (identity.site_url.replace(/\/$/, '') !== brand.siteUrl.replace(/\/$/, '')) mismatches.push('Public school website URL')
    if (identity.app_url.replace(/\/$/, '') !== brand.appUrl.replace(/\/$/, '')) mismatches.push('Public app URL')
  }

  return (
    <div className="space-y-5">
      <section className="app-surface space-y-5 p-5 sm:p-6" aria-labelledby="school-identity-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="school-identity-heading" className="flex items-center gap-2 text-lg font-bold text-ink">
              <Building2 className="h-5 w-5 text-ink-muted" aria-hidden="true" />
              School identity
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Read-only preview of the branding learners see in the app, public pages, and outgoing emails.
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {loading ? 'Checking…' : 'Refresh'}
          </Button>
        </div>

        {/* Visual brand header preview */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface-sunken p-4 sm:p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-raised p-2">
            <img
              src={brand.logoSrc}
              alt={`${brand.schoolName} logo`}
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-bold text-ink [overflow-wrap:anywhere]">{brand.schoolName}</p>
              <Badge tone="neutral">{brand.schoolAbbreviation}</Badge>
            </div>
            <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">
              Product name: <strong className="text-ink">{brand.productName}</strong> · Short name: {brand.schoolShortName}
            </p>
            <p className="mt-1 text-xs text-ink-muted [overflow-wrap:anywhere]">
              Support contact: {brand.supportEmail}
            </p>
          </div>
          {identity && (
            <Badge tone={mismatches.length ? 'warning' : 'success'}>
              {mismatches.length ? (
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Needs alignment
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Web and API match
                </span>
              )}
            </Badge>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
            {error} Showing built web branding below.
          </div>
        )}

        {mismatches.length > 0 && (
          <div role="alert" className="rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
            <p className="font-semibold">Web and API branding differ before launch:</p>
            <ul className="mt-1 list-disc pl-5 text-xs leading-5">
              {mismatches.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-line p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Mail className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Email and support
            </h3>
            <dl className="mt-3 space-y-3 text-sm">
              <IdentityRow label="Support email" value={identity?.support_email || brand.supportEmail} />
              <IdentityRow
                label="Outgoing email sender"
                value={identity ? identity.email_sender || 'Not configured on API (using provider default)' : 'Loading…'}
              />
              <IdentityRow label="Privacy contact" value={brand.privacyEmail} />
              <IdentityRow label="Legal operator" value={brand.operatorName} />
            </dl>
          </div>

          <div className="rounded-2xl border border-line p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Clock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Time zone and URLs
            </h3>
            <dl className="mt-3 space-y-3 text-sm">
              <IdentityRow
                label="School time zone"
                value={identity ? `${identity.time_zone} (${identity.time_zone_label})` : `${schoolTimeZone} (${schoolTimeDescription()})`}
              />
              <IdentityRow label="Public school website" value={identity?.site_url || brand.siteUrl} />
              <IdentityRow label="App URL" value={identity?.app_url || brand.appUrl} />
              <IdentityRow
                label="Email deep-link origin"
                value={identity ? identity.frontend_origin || 'Not set' : 'Loading…'}
              />
            </dl>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface-sunken p-4 text-xs leading-5 text-ink-secondary">
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            <Globe className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            How to update school branding
          </p>
          <p className="mt-1">
            Branding is configured per deployment so public pages, emails, and mobile builds stay consistent without
            storing secrets in the database. Update API boot environment variables (<code>SCHOOL_NAME</code>,{' '}
            <code>SUPPORT_EMAIL</code>, <code>SCHOOL_TIME_ZONE</code>, <code>EMAIL_SENDER_NAME</code>,{' '}
            <code>SCHOOL_SITE_URL</code>, <code>SCHOOL_APP_URL</code>) and rebuild the web client with matching{' '}
            <code>VITE_*</code> variables.
          </p>
        </div>
      </section>
    </div>
  )
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}
