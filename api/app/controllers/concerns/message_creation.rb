# Shared create path for human (Clerk) and agent-token message posts so both
# get identical idempotency, Markdown normalization, read state and delivery.
module MessageCreation
  extend ActiveSupport::Concern

  private

  # Extra audit attributes for a new message; agent posts override this.
  def message_creation_attributes
    {}
  end

  def send_push?
    ActiveModel::Type::Boolean.new.cast(params.fetch(:send_push, true))
  end

  def create_message_for(destination)
    attachments = Array(message_params[:attachments])
    mention_user_ids = sanitized_mention_user_ids_for(destination)
    return if performed?

    source = requested_source
    if source == :invalid
      render json: { errors: [ "Message source must be a lesson, submission or help request" ] }, status: :unprocessable_entity
      return
    end

    existing = existing_message_for_client_id
    if existing
      render_existing_message(existing, destination, attachments, mention_user_ids)
      return
    end

    if message_params[:body].to_s.strip.blank? && attachments.empty?
      render json: { errors: [ "Message must include text or an attachment" ] }, status: :unprocessable_entity
      return
    end

    begin
      attachments.each { |attachment| validate_uploaded_attachment!(attachment) }
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      return
    end

    message = destination.messages.new(
      body: message_params[:body].to_s,
      parent_message_id: message_params[:parent_message_id],
      client_message_id: message_params[:client_message_id],
      mention_user_ids: mention_user_ids,
      source_type: source&.fetch(:type),
      source_id: source&.fetch(:id),
      delivery_push_requested: send_push?,
      delivery_tracking_requested: true,
      **message_creation_attributes
    )
    message.author = current_user

    begin
      Message.transaction(requires_new: true) do
        message.save!
        persist_files!(message, attachments)
      end
    rescue ActiveRecord::RecordNotUnique => e
      raise unless client_message_id_unique_violation?(e)

      existing = existing_message_for_client_id
      raise unless existing

      render_existing_message(existing, destination, attachments, mention_user_ids)
      return
    rescue ActiveRecord::RecordInvalid => e
      if duplicate_client_message_id_error?(e, message) && (existing = existing_message_for_client_id)
        render_existing_message(existing, destination, attachments, mention_user_ids)
      else
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end
      return
    end

    mark_read_for(message)
    return unless deliver_committed_message(message)

    render json: { message: message_json(message.reload) }, status: :created
  end

  def existing_message_for_client_id
    client_message_id = message_params[:client_message_id].to_s.strip
    return if client_message_id.blank?

    current_user.messages.find_by(client_message_id: client_message_id)
  end

  def render_existing_message(message, destination, attachments, mention_user_ids)
    unless same_message_intent?(message, destination, attachments, mention_user_ids)
      render json: { errors: [ "Client message ID has already been used for a different message" ] }, status: :conflict
      return
    end

    mark_read_for(message)
    return unless deliver_committed_message(message)

    render json: { message: message_json(message.reload) }, status: :ok
  end

  def duplicate_client_message_id_error?(error, message)
    error.record.is_a?(Message) &&
      message.client_message_id.present? &&
      error.record.client_message_id == message.client_message_id &&
      error.record.errors.details.fetch(:client_message_id, []).any? { |detail| detail[:error] == :taken }
  end

  def client_message_id_unique_violation?(error)
    Message.client_message_id_constraint_violation?(error)
  end

  def same_message_intent?(message, destination, attachments, mention_user_ids)
    persisted_mention_user_ids = Array(message.mention_user_ids).map(&:to_i)
    # Raw IDs preserve the original intent when a mentioned member leaves;
    # sanitized IDs still reject any newly valid mention added on replay.
    message.deleted_at.nil? &&
      message.destination == destination &&
      message.body.to_s == MarkdownText.normalize(message_params[:body].to_s) &&
      message.parent_message_id == Message.type_for_attribute(:parent_message_id).cast(message_params[:parent_message_id]) &&
      (persisted_mention_user_ids - requested_mention_user_ids).empty? &&
      (mention_user_ids - persisted_mention_user_ids).empty? &&
      persisted_attachment_intent(message) == requested_attachment_intent(attachments) &&
      [ message.source_type, message.source_id ] == requested_source_pair
  end

  # { type:, id: } for a requested message source (L-1.8), nil for none, or
  # :invalid. Whether the author may attach it is the model's validation.
  # Agent posts don't permit these params, so they never carry a source.
  def requested_source
    type = message_params[:source_type].presence
    id = message_params[:source_id].presence
    return nil if type.nil? && id.nil?

    stored_type = MessageSource.stored_type(type)
    return :invalid unless stored_type && id.to_s.match?(/\A[1-9]\d{0,18}\z/)

    { type: stored_type, id: id.to_i }
  end

  def requested_source_pair
    source = requested_source
    source.is_a?(Hash) ? [ source[:type], source[:id] ] : [ nil, nil ]
  end

  def deliver_committed_message(message, operation: :create)
    MessageDeliveryService.created(message)
    true
  rescue StandardError => error
    Rails.logger.error(
      "[MessagesController] delivery_deferred message_id=#{message.id} " \
      "error_class=#{error.class.name}"
    )
    # Solid Queue owns durable recovery after the committed write. Inline
    # clients with an idempotency key can safely retry; legacy clients are
    # told the write was accepted because retrying would duplicate it.
    return true if ActiveJob::Base.queue_adapter_name == "solid_queue"

    if operation == :destroy || message.client_message_id.blank?
      render json: { message: message_json(message.reload), delivery_pending: true }, status: :accepted
      return false
    end

    render json: { errors: [ "Message was saved but delivery is still pending; try again" ] }, status: :service_unavailable
    false
  end

  def persisted_attachment_intent(message)
    message.message_attachments.map do |attachment|
      [ attachment.s3_key, attachment.filename, attachment.content_type, attachment.byte_size ]
    end.sort
  end

  def requested_attachment_intent(attachments)
    attachments.map do |attachment|
      [ attachment[:s3_key].to_s, attachment[:filename].to_s, attachment[:content_type].to_s, attachment[:byte_size].to_i ]
    end.sort
  end

  def persist_files!(message, attachments)
    attachments.each do |attachment|
      message.message_attachments.create!(
        uploaded_by: current_user,
        s3_key: attachment[:s3_key],
        filename: attachment[:filename],
        content_type: attachment[:content_type],
        byte_size: attachment[:byte_size]
      )
    end
  end

  def validate_uploaded_attachment!(attachment)
    key = attachment[:s3_key].to_s
    unless key.start_with?(message_attachment_prefix)
      raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment path is not allowed") })
    end

    return unless S3Service.configured?

    metadata = S3Service.object_metadata(key)
    unless metadata
      raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment upload was not found") })
    end

    expected_type = attachment[:content_type].to_s.downcase
    uploaded_type = metadata[:content_type].to_s.downcase.split(";").first.strip
    if uploaded_type != expected_type
      raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment content type does not match upload") })
    end

    if metadata[:content_length].to_i != attachment[:byte_size].to_i
      raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment size does not match upload") })
    end
  end

  def message_attachment_prefix
    destination = @channel || @direct_conversation || @message&.destination
    destination.is_a?(Channel) ? "message_attachments/channel_#{destination.id}/" : "message_attachments/dm_#{destination.id}/"
  end

  def mark_read_for(message)
    if message.channel
      find_or_create_read_state(message.channel).mark_read!(message)
    else
      message.direct_conversation.direct_conversation_members.find_by!(user: current_user).mark_read!(message)
    end
  end

  def find_or_create_read_state(channel)
    current_user.channel_read_states.find_or_create_by!(channel: channel)
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
    current_user.channel_read_states.find_by!(channel: channel)
  end

  def sanitized_mention_user_ids_for(destination)
    raw_ids = requested_mention_user_ids
    return [] if raw_ids.empty?

    allowed_ids = destination.recipients.reorder(nil).where(id: raw_ids).pluck(:id)
    allowed_ids.reject { |id| id == current_user.id }
  end

  def requested_mention_user_ids
    return @requested_mention_user_ids if defined?(@requested_mention_user_ids)

    values = Array(message_params[:mention_user_ids]).reject(&:blank?)
    unless values.all? { |value| value.is_a?(Integer) || value.to_s.match?(/\A\d+\z/) }
      render json: { errors: [ "Mention user IDs must be numeric" ] }, status: :unprocessable_entity
      return @requested_mention_user_ids = []
    end

    @requested_mention_user_ids = values.map(&:to_i).uniq
  end

  def message_json(message)
    MessageJson.render(message, current_user: current_user, stream_url: true)
  end
end
