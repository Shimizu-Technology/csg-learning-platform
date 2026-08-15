class StaffRoleValidator < ActiveModel::EachValidator
  def validate_each(record, attribute, value)
    record.errors.add(attribute, "must be staff") if value && !value.staff?
  end
end
