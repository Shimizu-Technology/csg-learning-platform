import { Button } from '../ui/Button'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { ContentBlockController } from './useContentBlockController'

export function KnowledgeCheckBlock({ controller, ...props }: ContentBlockRendererProps & { controller: ContentBlockController }) {
  const { knowledgeCheck, selectedCheckOption, setSelectedCheckOption, checkingAnswer, checkError, setCheckError, handleKnowledgeCheck } = controller
  const { isStaff, readOnly } = props
  return <>
        {knowledgeCheck && (
          <section className="rounded-2xl border border-line bg-surface-sunken/60 p-4" aria-label="Quick retrieval check">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-ink-muted">Quick recall</p>
              {knowledgeCheck.objective_code && <span className="rounded-full border border-line bg-surface-raised px-2 py-0.5 font-mono text-xs font-semibold text-ink-secondary">{knowledgeCheck.objective_code}</span>}
            </div>
            <p className="mt-2 text-base font-semibold leading-6 text-ink">{knowledgeCheck.prompt}</p>
            <div className="mt-4 grid gap-2">
              {knowledgeCheck.options.map((option, index) => {
                const result = knowledgeCheck.latest_attempt
                const isCorrectAnswer = result && index === result.correct_option
                const wasIncorrectChoice = result && !result.correct && index === result.selected_option
                return <button key={`${index}:${option}`} type="button" disabled={Boolean(isStaff || readOnly || result?.correct)} onClick={() => { setSelectedCheckOption(index); setCheckError(null) }} aria-pressed={selectedCheckOption === index} className={`pressable min-h-11 rounded-xl border px-4 py-2.5 text-left text-sm font-medium ${isCorrectAnswer ? 'border-success-line bg-success-soft text-success-ink' : wasIncorrectChoice ? 'border-warning-line bg-warning-soft text-warning-ink' : selectedCheckOption === index ? 'border-action-primary bg-surface-raised text-ink ring-1 ring-action-primary' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'} disabled:cursor-default`}>{option}</button>
              })}
            </div>
            {isStaff && knowledgeCheck.correct_option !== undefined ? <div className="mt-4 rounded-xl border border-line bg-surface-raised p-3 text-sm text-ink-secondary"><p className="font-semibold text-ink">Answer: {knowledgeCheck.options[knowledgeCheck.correct_option]}</p><p className="mt-1 leading-6">{knowledgeCheck.explanation}</p></div> : knowledgeCheck.latest_attempt ? <div aria-live="polite" className={`mt-4 rounded-xl border p-3 ${knowledgeCheck.latest_attempt.correct ? 'border-success-line bg-success-soft' : 'border-warning-line bg-warning-soft'}`}><p className={`text-sm font-semibold ${knowledgeCheck.latest_attempt.correct ? 'text-success-ink' : 'text-warning-ink'}`}>{knowledgeCheck.latest_attempt.correct ? 'Correct — this check is complete.' : 'Not yet — review the explanation and try again.'}</p><p className="mt-1 text-sm leading-6 text-ink-secondary">{knowledgeCheck.latest_attempt.explanation}</p></div> : null}
            {!isStaff && !knowledgeCheck.latest_attempt?.correct && <Button disabled={readOnly || selectedCheckOption === null || checkingAnswer} onClick={() => void handleKnowledgeCheck()} className="mt-4">{checkingAnswer ? 'Checking…' : knowledgeCheck.latest_attempt ? 'Try this answer' : 'Check answer'}</Button>}
            {checkError && <p className="mt-2 text-sm font-semibold text-danger-ink" role="alert">{checkError}</p>}
            {knowledgeCheck.attempt_count > 0 && <p className="mt-2 text-xs tabular-nums text-ink-muted">{knowledgeCheck.attempt_count} {knowledgeCheck.attempt_count === 1 ? 'attempt' : 'attempts'} recorded</p>}
          </section>
        )}


  </>
}
