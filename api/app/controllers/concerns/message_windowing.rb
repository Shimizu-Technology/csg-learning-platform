module MessageWindowing
  extend ActiveSupport::Concern

  private

  def message_limit
    params.fetch(:message_limit, 100).to_i.clamp(1, 200)
  end

  def windowed_messages(scope)
    if params[:before_message_id].present?
      anchor = scope.find_by(id: params[:before_message_id])
      return latest_messages(scope) unless anchor

      messages = scope
        .where("messages.created_at < ? OR (messages.created_at = ? AND messages.id < ?)", anchor.created_at, anchor.created_at, anchor.id)
        .order(created_at: :desc, id: :desc)
        .limit(message_limit)
        .to_a
      return preload_message_window(sort_messages(messages))
    end

    if params[:around_message_id].present?
      anchor = scope.find_by(id: params[:around_message_id])
      return latest_messages(scope) unless anchor

      before = scope.where("messages.created_at < ? OR (messages.created_at = ? AND messages.id < ?)", anchor.created_at, anchor.created_at, anchor.id)
        .order(created_at: :desc, id: :desc)
        .limit(message_limit / 2)
        .to_a
      after = scope.where("messages.created_at > ? OR (messages.created_at = ? AND messages.id > ?)", anchor.created_at, anchor.created_at, anchor.id)
        .order(created_at: :asc, id: :asc)
        .limit(message_limit - before.size - 1)
        .to_a

      return preload_message_window(sort_messages([ *before, anchor, *after ]))
    end

    latest_messages(scope)
  end

  def latest_messages(scope)
    preload_message_window(sort_messages(scope.order(created_at: :desc, id: :desc).limit(message_limit).to_a))
  end

  def sort_messages(messages)
    messages.sort_by { |message| [ message.created_at, message.id ] }
  end

  def preload_message_window(messages)
    ActiveRecord::Associations::Preloader.new(
      records: messages,
      associations: [ :author, :message_attachments, :replies, { message_reactions: :user } ]
    ).call

    messages
  end

  def message_window_meta(scope, messages)
    first = messages.first
    last = messages.last

    {
      oldest_message_id: first&.id,
      newest_message_id: last&.id,
      has_older: first ? scope.where("messages.created_at < ? OR (messages.created_at = ? AND messages.id < ?)", first.created_at, first.created_at, first.id).exists? : false,
      has_newer: last ? scope.where("messages.created_at > ? OR (messages.created_at = ? AND messages.id > ?)", last.created_at, last.created_at, last.id).exists? : false
    }
  end
end
