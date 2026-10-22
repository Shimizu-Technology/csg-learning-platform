# Keep the actionable setup destination in one place until Access absorbs these controls.
class AttentionDestinations
  def self.learning_setup(enrollment)
    "/admin/students/#{enrollment.user_id}?legacy=1"
  end
end
