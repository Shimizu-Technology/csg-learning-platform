class RecordDetail
  # A return plan (stored as a recovery plan, L-5.2): the student and cohort,
  # who owns it, the pace and scope agreed, when the next check-in is due, its
  # outcome, the follow-up plan or restart it came from, and its check-ins.
  # Editing and new check-ins stay on the student page's Support tab, where
  # the plan's actions are.
  #
  # Staff in the plan's cohort only (StaffCohortScope); check-ins are staff
  # notes about the learner, so the page is never shown to a student. The
  # newest CHECK_INS_SHOWN check-ins are listed by id, newest first, with the
  # total counted separately.
  class RecoveryPlanPage < Base
    CHECK_INS_SHOWN = 20

    private

    def cohort_id_for(id)
      RecoveryPlan.joins(:enrollment).where(id: id).pick("enrollments.cohort_id")
    end

    def build
      plan = RecoveryPlan.includes(:owner, :created_by, :intervention, :enrollment_restart, enrollment: [ :user, :cohort ]).find(@id)
      enrollment = plan.enrollment
      cohort = enrollment.cohort
      check_ins = plan.check_ins.includes(:author).order(id: :desc).limit(CHECK_INS_SHOWN).to_a
      intervention = plan.intervention
      restart = plan.enrollment_restart

      {
        type: "recovery_plan",
        id: plan.id,
        source: plan.source,
        status: plan.status,
        target_pace: plan.target_pace,
        required_scope: plan.required_scope,
        optional_scope: plan.optional_scope,
        check_in_cadence: plan.check_in_cadence,
        next_check_in_at: iso(plan.next_check_in_at),
        last_check_in_at: iso(plan.last_check_in_at),
        check_in_due: plan.status_active? && plan.next_check_in_at <= @now,
        outcome: plan.outcome,
        completed_at: iso(plan.completed_at),
        created_at: iso(plan.created_at),
        updated_at: iso(plan.updated_at),
        cohort: cohort_json(cohort),
        student: person(enrollment.user),
        enrollment_status: enrollment.status,
        owner: person(plan.owner).merge(valid: plan.owner_valid?),
        created_by: person(plan.created_by),
        can_edit: @viewer.can_teach_cohort?(cohort),
        follow_up: intervention && { id: intervention.id, status: intervention.status, severity: intervention.severity, created_at: iso(intervention.created_at) },
        restart: restart && { id: restart.id, created_at: iso(restart.created_at) },
        check_ins_count: plan.check_ins.count,
        check_ins: check_ins.map do |check_in|
          { id: check_in.id, body: check_in.body, author: person(check_in.author), created_at: iso(check_in.created_at),
            next_check_in_at: iso(check_in.next_check_in_at) }
        end
      }
    end
  end
end
