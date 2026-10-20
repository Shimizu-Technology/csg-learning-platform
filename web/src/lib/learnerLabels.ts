/**
 * Learner-facing names for module types. The stored enum values describe how
 * staff build a curriculum (a course package imports as `workshop`); learners
 * see what the module is to them.
 */
const MODULE_TYPE_LABELS: Record<string, string> = {
  prework: 'Prework',
  live_class: 'Live class',
  capstone: 'Capstone project',
  advanced: 'Advanced topics',
  workshop: 'Focused course',
  recording: 'Class recordings',
}

export function learnerModuleTypeLabel(moduleType: string | null | undefined): string {
  if (!moduleType) return 'Module'
  const known = MODULE_TYPE_LABELS[moduleType]
  if (known) return known
  const words = moduleType.replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Module'
}

/** "code_challenge" -> "Code challenge" */
export function blockTypeLabel(blockType: string | null | undefined): string {
  const words = (blockType || '').replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Block'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The header for a lesson block: "Exercise · E3 — two-item receipt". When the
 * title already starts with the type ("Checkpoint 1 — budget decision"), the
 * type prefix is dropped so the word doesn't repeat and wrap on phones.
 */
export function blockHeaderParts(blockType: string | null | undefined, title: string | null | undefined): { typeLabel: string | null; title: string | null } {
  const typeLabel = blockTypeLabel(blockType)
  const cleanTitle = title?.trim() || null
  if (!cleanTitle) return { typeLabel, title: null }
  const repeats = new RegExp(`^${escapeRegExp(typeLabel)}(?![\\p{L}\\p{N}_])`, 'iu').test(cleanTitle)
  return { typeLabel: repeats ? null : typeLabel, title: cleanTitle }
}
