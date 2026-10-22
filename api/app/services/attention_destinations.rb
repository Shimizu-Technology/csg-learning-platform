# The enrollment workspace owns per-student learning setup.
class AttentionDestinations
  def self.learning_setup(enrollment)
    "/admin/cohorts/#{enrollment.cohort_id}/students/#{enrollment.user_id}/access"
  end
end
