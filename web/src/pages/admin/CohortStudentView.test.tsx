import { describe, expect, it } from 'vitest'

import { previewSectionsForCohort } from './CohortStudentView'

describe('previewSectionsForCohort', () => {
  it('keeps alumni recordings inside the learning library', () => {
    expect(previewSectionsForCohort('alumni')).not.toContain('recordings')
    expect(previewSectionsForCohort('alumni')).toContain('materials')
  })

  it('preserves the recordings navigation for regular cohorts', () => {
    expect(previewSectionsForCohort('standard')).toContain('recordings')
  })
})
