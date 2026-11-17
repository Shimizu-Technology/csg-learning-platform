# A person's community-safety record, for admins (L-3.2 "person → reports
# and blocks"): how many reports are about them (and how many of those are
# still open), how many they filed, how many people they blocked and how many
# blocked them. Counts only, never report details or message text; the
# reports themselves open on Safety, filtered to the person.
#
# Admins only: everyone else gets nil. Two queries, whatever the counts.
class PersonSafety
  OPEN_STATUSES = ContentReport.statuses.values_at("pending", "reviewing").freeze

  def self.for(viewer:, user_id:)
    return nil unless viewer&.admin? && !viewer.archived? && user_id

    reports = ContentReport.where(reporter_id: user_id).or(ContentReport.where(reported_user_id: user_id)).pick(
      count_where("reported_user_id = ?", user_id),
      count_where("reported_user_id = ? AND status IN (?)", user_id, OPEN_STATUSES),
      count_where("reporter_id = ?", user_id)
    )
    blocks = UserBlock.where(blocker_id: user_id).or(UserBlock.where(blocked_user_id: user_id)).pick(
      count_where("blocker_id = ?", user_id),
      count_where("blocked_user_id = ?", user_id)
    )
    { reports_about: reports[0], open_reports_about: reports[1], reports_by: reports[2], blocks_made: blocks[0], blocked_by: blocks[1] }
  end

  def self.count_where(condition, *values)
    Arel.sql("COUNT(*) FILTER (WHERE #{ActiveRecord::Base.sanitize_sql_array([ condition, *values ])})")
  end
  private_class_method :count_where
end
