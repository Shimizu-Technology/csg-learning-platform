class CohortStaffOwnerValidator < ActiveModel::EachValidator
  MESSAGE = "must be an active admin or an active instructor assigned to this cohort".freeze

  def validate_each(record, attribute, value)
    record.errors.add(attribute, MESSAGE) unless value&.can_teach_cohort?(record.enrollment&.cohort)
  end
end
