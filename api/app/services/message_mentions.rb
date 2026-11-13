# Shared explicit-ID and legacy-name matching for delivery and the digest.
module MessageMentions
  def self.channel_mention?(message)
    return false unless message.channel_id.present?

    message.body.to_s.match?(/(^|[\s(])@everyone\b/i)
  end

  def self.user_ids_for(message, recipients)
    raw_explicit_ids = Array(message.mention_user_ids)
    explicit_ids = raw_explicit_ids.map(&:to_i).uniq
    allowed_ids = recipients.each_with_object({}) { |user, ids| ids[user.id] = true }
    explicit_ids.select! { |id| allowed_ids.key?(id) && id != message.author_id }
    return explicit_ids if raw_explicit_ids.any?
    return [] if message.body.blank?

    body = message.body.to_s
    recipients.filter_map do |user|
      next if user.id == message.author_id
      next if user.full_name.blank?

      user.id if body.match?(mention_pattern_for(user.full_name))
    end
  end

  def self.mention_pattern_for(full_name)
    /(^|[^[:alnum:]_])@#{Regexp.escape(full_name)}(?=$|[[:space:][:punct:]])/i
  end
end
