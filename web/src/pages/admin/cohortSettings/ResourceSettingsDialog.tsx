import { useId } from 'react'
import { ExternalLink, Keyboard, Link2, Plus, Save, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/shared/Modal'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { SegmentButton, SegmentedControl } from '../../../components/ui/Choice'
import { sanitizeUrl } from '../../../lib/sanitizeUrl'
import { RESOURCE_CATEGORY_LABELS, RESOURCE_CATEGORY_OPTIONS } from './settingsForm'
import type { CohortSettingsController } from './useCohortSettings'

export function ResourceSettingsDialog({ settings }: { settings: CohortSettingsController }) {
  const fieldId = useId()
  const {
    savingResources,
    classResources,
    setClassResources,
    showResourcesModal,
    setShowResourcesModal,
    resourcesMode,
    setResourcesMode,
    saveClassResources,
  } = settings
  return (
    <>
      {/* Resources Modal */}
      <Modal
        open={showResourcesModal}
        onClose={() => setShowResourcesModal(false)}
        title="Class resources"
        subtitle="Open resources when you need them, or switch to edit mode to maintain the list."
        icon={<Link2 className="h-6 w-6 text-ink-secondary" />}
        size="xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => setClassResources((prev) => [...prev, { title: '', url: '', category: 'general' }])}
            >
              <Plus className="h-4 w-4" />
              Add resource
            </Button>
            <Button onClick={saveClassResources} disabled={savingResources}>
              <Save className="h-4 w-4" />
              Done editing resources
            </Button>
          </div>
        }
      >
        <div className="space-y-4 max-lg:[&_input]:text-base max-lg:[&_select]:text-base max-lg:[&_textarea]:text-base">
          <SegmentedControl label="Resources mode">
            {(['view', 'edit'] as const).map((mode) => (
              <SegmentButton key={mode} selected={resourcesMode === mode} onClick={() => setResourcesMode(mode)}>
                {mode === 'view' ? 'View' : 'Edit'}
              </SegmentButton>
            ))}
          </SegmentedControl>

          {resourcesMode === 'view' ? (
            classResources.length === 0 ? (
              <p className="text-sm text-ink-muted py-8 text-center">
                No resources added yet. Switch to edit mode to add the first one.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {classResources.map((resource, idx) => {
                  const isHotkey = ['hotkeys', 'shortcuts'].includes(resource.category || '')
                  return (
                    <a
                      key={`${resource.url}-${idx}`}
                      href={sanitizeUrl(resource.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`pressable rounded-2xl border p-4 hover:border-line-strong ${
                        isHotkey ? 'border-line bg-surface-sunken' : 'border-line bg-surface-raised'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {isHotkey && <Keyboard className="h-4 w-4 text-ink-secondary" />}
                            <h3 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                              {resource.title || 'Untitled resource'}
                            </h3>
                            <Badge>{RESOURCE_CATEGORY_LABELS[resource.category || 'general'] || 'General'}</Badge>
                          </div>
                          {resource.description && (
                            <p className="mt-1 text-sm text-ink-secondary">{resource.description}</p>
                          )}
                          <p className="mt-1 break-all text-xs text-ink-muted">{resource.url}</p>
                        </div>
                        <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-muted" />
                      </div>
                    </a>
                  )
                })}
              </div>
            )
          ) : (
            <div className="space-y-3">
              {classResources.length === 0 ? (
                <p className="text-sm text-ink-muted py-8 text-center">
                  No resources added yet. Click "Add resource" below to get started.
                </p>
              ) : (
                classResources.map((res, idx) => (
                  <div key={idx} className="rounded-xl border border-line p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold tabular-nums text-ink-muted">Resource {idx + 1}</span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setClassResources((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <input
                          type="text"
                          value={res.title}
                          onChange={(e) =>
                            setClassResources((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)),
                            )
                          }
                          placeholder="For example: Class Zoom link"
                          className="app-control w-full"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`${fieldId}-category-${idx}`}
                          className="mb-1 block text-xs font-semibold text-ink-secondary"
                        >
                          Category
                        </label>
                        <select
                          id={`${fieldId}-category-${idx}`}
                          value={res.category || 'general'}
                          onChange={(e) =>
                            setClassResources((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, category: e.target.value } : item)),
                            )
                          }
                          className="app-control w-full"
                        >
                          {RESOURCE_CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <input
                      type="url"
                      value={res.url}
                      onChange={(e) =>
                        setClassResources((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, url: e.target.value } : item)),
                        )
                      }
                      placeholder="https://..."
                      className="app-control w-full"
                    />
                    <input
                      type="text"
                      value={res.description || ''}
                      onChange={(e) =>
                        setClassResources((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, description: e.target.value } : item)),
                        )
                      }
                      placeholder="Optional description"
                      className="app-control w-full"
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
