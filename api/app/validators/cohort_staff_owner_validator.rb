class CohortStaffOwnerValidator < ActiveModel::EachValidator
  MESSAGE = "must be an active admin or an active instructor assigned to this cohort, with an accepted invitation".freeze

  def validate_each(record, attribute, value)
    record.errors.add(attribute, MESSAGE) unless value && !value.invite_pending? && value.can_teach_cohort?(record.enrollment&.cohort)
  end
end
