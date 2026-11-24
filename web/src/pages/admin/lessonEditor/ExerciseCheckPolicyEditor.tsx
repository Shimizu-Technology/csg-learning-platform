import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { Button, IconButton } from '../../../components/ui/Button'
import { api } from '../../../lib/api'
import type { components } from '../../../types/api.generated'

type Policy = components['schemas']['ExerciseCheckPolicy']

function policyFields(policy: Policy | null) {
  return {
    branch: policy?.allowed_branch ?? '',
    apps: policy?.allowed_app_slugs.join(', ') ?? 'github-actions',
    workflow: policy?.expected_workflow_path ?? '',
    fingerprint: policy?.expected_workflow_sha ?? '',
  }
}

function draftFromPolicy(policy: Policy | null) {
  return { checks: policy?.required_checks ?? [], name: '', fields: policyFields(policy) }
}

type CheckPolicyDraft = ReturnType<typeof draftFromPolicy>
type CheckPolicyEditorState = {
  policy: Policy | null
  draft: CheckPolicyDraft
  busy?: boolean
  error?: string
}
export type CheckPolicyEditors = Partial<Record<number, CheckPolicyEditorState>>

export function hasCheckPolicyEdits(state: CheckPolicyEditorState) {
  return JSON.stringify(state.draft) !== JSON.stringify(draftFromPolicy(state.policy))
}

export function ExerciseCheckPolicyEditor({ blockId, state, setCheckPolicyEditors, readOnly }: {
  blockId: number
  state?: CheckPolicyEditorState
  setCheckPolicyEditors: Dispatch<SetStateAction<CheckPolicyEditors>>
  readOnly?: boolean
}) {
  const id = useId()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const loaded = state !== undefined

  useEffect(() => {
    if (loaded) return
    let active = true
    void api.getExerciseCheckPolicy(blockId).then((response) => {
      if (!active) return
      if (!response.data || response.error || response.fromCache) {
        setLoadError(response.error || 'Could not load check rules. Try again.')
        return
      }
      const policy = response.data.active_policy
      setCheckPolicyEditors((current) => current[blockId] ? current : {
        ...current,
        [blockId]: { policy, draft: draftFromPolicy(policy) },
      })
    }).catch(() => {
      if (active) setLoadError('Could not load check rules. Try again.')
    })
    return () => { active = false }
  }, [blockId, loadAttempt, loaded, setCheckPolicyEditors])

  if (loadError) return <>
    <p role="alert" className="text-sm text-danger-ink">{loadError}</p>
    <Button variant="secondary" onClick={() => { setLoadError(''); setLoadAttempt((attempt) => attempt + 1) }}>Retry</Button>
  </>
  if (!state) return <p role="status" className="text-sm text-ink-muted">Loading check rules…</p>

  const { policy, draft, busy, error } = state
  const { checks, name, fields } = draft
  const checkName = name.trim()
  const canAdd = checkName.length > 0 && !checks.includes(checkName) && checks.length < 20
  const nextChecks = canAdd ? [...checks, checkName] : checks
  const canSave = nextChecks.length > 0 &&
    JSON.stringify([nextChecks, fields]) !== JSON.stringify([policy?.required_checks ?? [], policyFields(policy)])

  function updateState(update: (current: CheckPolicyEditorState) => CheckPolicyEditorState) {
    setCheckPolicyEditors((current) => {
      const editor = current[blockId]
      return editor ? { ...current, [blockId]: update(editor) } : current
    })
  }

  function editDraft(update: (current: CheckPolicyDraft) => CheckPolicyDraft) {
    updateState((current) => ({ ...current, draft: update(current.draft), error: undefined }))
  }

  function addCheck() {
    if (!canAdd) return
    editDraft((current) => ({ ...current, checks: nextChecks, name: '' }))
  }

  async function save(deactivate: boolean) {
    updateState((current) => ({ ...current, busy: true, error: undefined }))
    try {
      const response = deactivate
        ? await api.deactivateExerciseCheckPolicy(blockId)
        : await api.saveExerciseCheckPolicy(blockId, {
          required_checks: nextChecks,
          allowed_branch: fields.branch.trim() || null,
          allowed_app_slugs: fields.apps.split(',').map((app) => app.trim()).filter(Boolean),
          expected_workflow_path: fields.workflow.trim() || null,
          expected_workflow_sha: fields.fingerprint.trim() || null,
        })
      if (!response.data || response.error) {
        updateState((current) => ({ ...current, busy: false, error: response.error || 'Could not update check rules. Try again.' }))
        return
      }
      const saved = response.data.active_policy
      updateState(() => ({ policy: saved, draft: draftFromPolicy(saved) }))
      setConfirming(false)
    } catch {
      updateState((current) => ({ ...current, busy: false, error: 'Could not update check rules. Try again.' }))
    }
  }

  const advancedFields = [
    { key: 'branch', label: 'Default branch', placeholder: 'main' },
    { key: 'apps', label: 'Trusted check app', placeholder: 'github-actions' },
    { key: 'workflow', label: 'Required workflow file path', placeholder: '.github/workflows/checks.yml' },
    { key: 'fingerprint', label: 'Workflow file fingerprint', placeholder: 'Optional' },
  ] as const

  return (
    <>
      <p className="text-sm leading-5 text-ink-secondary">When all required checks pass on a student's commit, Learn suggests a passing grade (B) for an instructor to confirm.</p>
      <p role="status" className={`text-sm ${policy ? 'font-semibold text-success-ink' : 'text-ink-muted'}`}>
        {policy
          ? `Active · ${policy.required_checks.length} required ${policy.required_checks.length === 1 ? 'check' : 'checks'} · Version ${policy.version}`
          : "No check rules yet — grade suggestions won't run for this exercise."}
      </p>
      <fieldset disabled={busy || readOnly} className="grid min-w-0 gap-2">
        {readOnly
          ? <p className="text-sm font-semibold text-ink-secondary">Required check names</p>
          : <label htmlFor={id} className="text-sm font-semibold text-ink-secondary">Required check names</label>}
        {checks.length > 0 && (
          <ul aria-label="Required checks" className="grid gap-1.5">
            {checks.map((check) => (
              <li key={check} className="flex min-w-0 items-center gap-1 rounded-xl border border-line bg-surface-sunken pl-3">
                <span className="min-w-0 flex-1 py-1 text-sm wrap-anywhere">{check}</span>
                {!readOnly && <IconButton label={`Remove ${check}`} className="shrink-0" onClick={() => editDraft((current) => ({ ...current, checks: current.checks.filter((item) => item !== check) }))}><X className="h-4 w-4" /></IconButton>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && <>
          <div className="flex min-w-0 gap-2">
            <input
              id={id}
              value={name}
              onChange={(event) => { const name = event.target.value; editDraft((current) => ({ ...current, name })) }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCheck() } }}
              className="app-control min-h-11 min-w-0 flex-1 max-lg:text-base"
              placeholder="exercise-111"
              aria-describedby={`${id}-hint`}
              maxLength={255}
            />
            <Button variant="secondary" className="shrink-0" disabled={!canAdd} onClick={addCheck}>
              <Plus className="h-4 w-4" aria-hidden="true" />Add
            </Button>
          </div>
          <p id={`${id}-hint`} className="text-xs leading-5 text-ink-muted">Enter each name exactly as it appears in GitHub. You can add up to 20 checks.</p>
        </>}
        <details className="rounded-xl border border-line px-3">
          <summary className="group flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink-secondary">
            Advanced <ChevronDown className="h-4 w-4 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="grid min-w-0 gap-3 pb-3">
            {advancedFields.map(({ key, label, placeholder }) => (
              <label key={key} className="grid min-w-0 gap-1 text-sm font-semibold text-ink-secondary">{label}
                <input
                  value={fields[key]}
                  onChange={(event) => { const value = event.target.value; editDraft((current) => ({ ...current, fields: { ...current.fields, [key]: value } })) }}
                  className="app-control min-h-11 w-full min-w-0 max-lg:text-base"
                  placeholder={placeholder}
                />
                {key === 'apps' && <span className="text-xs font-normal text-ink-muted">Separate multiple GitHub app names with commas.</span>}
              </label>
            ))}
          </div>
        </details>
      </fieldset>
      {!readOnly && (
        <>
          <Button className="min-h-11" disabled={busy || confirming || !canSave} onClick={() => void save(false)}>
            {busy && !confirming ? 'Saving…' : 'Save check rules'}
          </Button>
          {hasCheckPolicyEdits(state) && !confirming && (
            <Button variant="quiet" disabled={busy} onClick={() => editDraft(() => draftFromPolicy(policy))}>Reset check-rule edits</Button>
          )}
          {policy && (confirming ? (
            <div className="grid gap-2 rounded-2xl border border-line bg-surface-sunken p-3">
              <p className="text-sm text-ink-secondary">Turn off suggestions for this exercise? Previously saved grades stay as they are.</p>
              <Button variant="danger" disabled={busy} onClick={() => void save(true)}>{busy ? 'Turning off…' : 'Turn off suggestions'}</Button>
              <Button variant="secondary" disabled={busy} onClick={() => { setConfirming(false); updateState((current) => ({ ...current, error: undefined })) }}>Cancel</Button>
            </div>
          ) : (
            <Button variant="quiet" className="min-h-11 whitespace-normal" disabled={busy} onClick={() => { setConfirming(true); updateState((current) => ({ ...current, error: undefined })) }}>
              Turn off check suggestions for this exercise
            </Button>
          ))}
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </>
  )
}
