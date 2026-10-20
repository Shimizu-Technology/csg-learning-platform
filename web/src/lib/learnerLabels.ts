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
