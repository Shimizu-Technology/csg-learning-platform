import { useState } from 'react'
import { captureProductEvent } from '../../lib/analytics'
import { api } from '../../lib/api'
import type { ContentBlock, ContentBlockRendererProps } from './contentBlockTypes'
export function useKnowledgeCheckBlock({ block, cohortId, isStaff, readOnly, onProgressUpdate, setIsCompleted }: ContentBlockRendererProps & { isCompleted: boolean; setIsCompleted: React.Dispatch<React.SetStateAction<boolean>> }) {
  const [knowledgeCheckDraft, setKnowledgeCheckDraft] = useState<{ blockId: number; value: NonNullable<ContentBlock['knowledge_check']> } | null>(null)
  const knowledgeCheck = knowledgeCheckDraft?.blockId === block.id ? knowledgeCheckDraft.value : block.knowledge_check || null
  const [selectedCheckOption, setSelectedCheckOption] = useState<number | null>(null)
  const [checkingAnswer, setCheckingAnswer] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const handleKnowledgeCheck = async () => {
    if (isStaff || readOnly || !knowledgeCheck || selectedCheckOption === null) return
    setCheckingAnswer(true)
    setCheckError(null)
    if (knowledgeCheck.id < 0 && knowledgeCheck.correct_option !== undefined) {
      const correct = selectedCheckOption === knowledgeCheck.correct_option
      setKnowledgeCheckDraft({ blockId: block.id, value: {
        ...knowledgeCheck,
        attempt_count: knowledgeCheck.attempt_count + 1,
        latest_attempt: {
          id: -1,
          selected_option: selectedCheckOption,
          correct,
          correct_option: knowledgeCheck.correct_option,
          explanation: knowledgeCheck.explanation || '',
          created_at: new Date().toISOString(),
        },
      } })
      setCheckingAnswer(false)
      return
    }

    const response = await api.attemptKnowledgeCheck(knowledgeCheck.id, selectedCheckOption, cohortId)
    if (response.error || !response.data) {
      setCheckError(response.error || 'Could not check this answer.')
    } else {
      setKnowledgeCheckDraft({ blockId: block.id, value: response.data.knowledge_check })
      const result = response.data.knowledge_check.latest_attempt
      if (result) captureProductEvent('knowledge_check_attempted', {
        knowledge_check_id: response.data.knowledge_check.id,
        content_block_id: block.id,
        correct: result.correct,
        attempt: response.data.knowledge_check.attempt_count,
      })
      if (response.data.progress?.status === 'completed') {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    }
    setCheckingAnswer(false)
  }
 return { knowledgeCheck, selectedCheckOption, setSelectedCheckOption, checkingAnswer, checkError, setCheckError, handleKnowledgeCheck }
}
