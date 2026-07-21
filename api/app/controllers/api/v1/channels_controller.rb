module Api
  module V1
    class ChannelsController < ApplicationController
      include MessageWindowing

      before_action :authenticate_user!
      before_action :set_channel, only: [ :show, :update, :destroy, :mark_read ]
      before_action :require_staff!, only: [ :create, :update, :destroy ]

      # GET /api/v1/channels
      def index
        channels = Channel.visible_for(current_user).includes(workspace: :cohort).ordered.to_a
        read_states = current_user.channel_read_states.where(channel_id: channels.map(&:id)).index_by(&:channel_id)
        unread_counts = unread_counts_for(channels)
        latest_messages = latest_messages_for(channels)
        muted_ids = muted_target_ids("Channel", channels.map(&:id))

        render json: {
          channels: channels.map { |channel| channel_json(channel, read_states[channel.id], unread_counts[channel.id] || 0, latest_messages[channel.id], muted_ids: muted_ids) }
        }
      end

      # GET /api/v1/channels/:id
      def show
        unless @channel.visible_to?(current_user)
          render_forbidden("Channel is not visible")
          return
        end

        message_scope = @channel.messages.visible
        messages = windowed_messages(message_scope)
        pinned_messages = @channel.messages.pinned_recent.to_a
        read_state = current_user.channel_read_states.find_by(channel: @channel)
        read_receipts = read_receipts_for(messages)

        render json: {
          channel: channel_json(@channel, read_state, unread_count_for(@channel, read_state), messages.last),
          messages: messages.map { |message| message_json(message, read_receipts: read_receipts[message.id]) },
          pinned_messages: pinned_messages.map { |message| message_json(message) },
          meta: message_window_meta(message_scope, messages)
        }
      end

      # POST /api/v1/channels
      def create
        workspace = workspace_for_mutation!
        return unless workspace

        channel = workspace.channels.new(channel_params.except(:cohort_id, :workspace_id))
        channel.cohort_id = workspace.cohort_id

        if channel.save
          render json: { channel: channel_json(channel, nil, 0, nil) }, status: :created
        else
          render json: { errors: channel.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/channels/:id
      def update
        if @channel.update(channel_params.except(:cohort_id, :workspace_id))
          render json: { channel: channel_json(@channel, nil, 0, nil) }
        else
          render json: { errors: @channel.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/channels/:id
      def destroy
        @channel.update!(status: :archived)
        render json: { channel: channel_json(@channel, nil, 0, nil) }
      end

      # PATCH /api/v1/channels/:id/read
      def mark_read
        unless @channel.visible_to?(current_user)
          render_forbidden("Channel is not visible")
          return
        end

        last_message = @channel.messages.visible.order(created_at: :desc, id: :desc).first
        read_state = find_or_create_read_state(@channel)
        previous_last_read_at = read_state.last_read_at
        read_state.mark_read!(last_message)
        current_user.notifications.message.where(path: "/messages/#{@channel.id}").unread.update_all(read_at: Time.current, updated_at: Time.current)
        ReadReceiptBroadcastJob.perform_later(@channel, current_user.id, previous_last_read_at)

        render json: { channel: channel_json(@channel, read_state, 0, last_message) }
      end

      private

      def set_channel
        @channel = Channel.includes(workspace: :cohort).find(params[:id])
      end

      def channel_params
        params.permit(:cohort_id, :workspace_id, :name, :description, :visibility, :status, :position)
      end

      def unread_counts_for(channels)
        counts = channels.index_with { 0 }
        return counts if channels.empty?

        join_sql = ApplicationRecord.sanitize_sql_array([
          "LEFT JOIN channel_read_states message_read_states ON message_read_states.channel_id = messages.channel_id AND message_read_states.user_id = ?",
          current_user.id
        ])

        Message.visible
          .where(channel_id: channels.map(&:id))
          .where.not(author_id: current_user.id)
          .joins(join_sql)
          .where("message_read_states.last_read_at IS NULL OR messages.created_at > message_read_states.last_read_at")
          .group(:channel_id)
          .count
          .then { |unread_counts| counts.merge(unread_counts) }
      end

      def unread_count_for(channel, read_state)
        messages = channel.messages.visible
        messages = messages.where.not(author_id: current_user.id)
        if read_state&.last_read_at
          messages = messages.where("created_at > ?", read_state.last_read_at)
        end
        messages.count
      end

      def latest_messages_for(channels)
        Message.visible
          .includes(:author, :message_attachments)
          .select("DISTINCT ON (messages.channel_id) messages.*")
          .where(channel_id: channels.map(&:id))
          .order(Arel.sql("messages.channel_id, messages.created_at DESC, messages.id DESC"))
          .to_a
          .index_by(&:channel_id)
      end

      def channel_json(channel, read_state = nil, unread_count = 0, latest_message = nil, muted_ids: nil)
        {
          id: channel.id,
          workspace_id: channel.workspace_id,
          workspace_name: channel.workspace.name,
          workspace_type: channel.workspace.workspace_type,
          cohort_id: channel.cohort_id,
          cohort_name: channel.cohort&.name,
          name: channel.name,
          description: channel.description,
          visibility: channel.visibility,
          status: channel.status,
          position: channel.position,
          muted: muted_ids ? muted_ids.include?(channel.id) : muted?(channel),
          unread_count: unread_count,
          last_read_at: read_state&.last_read_at,
          latest_message: MessageJson.latest(latest_message),
          created_at: channel.created_at,
          updated_at: channel.updated_at
        }
      end

      def muted?(target)
        MessagePreference.exists?(user: current_user, target: target, muted: true)
      end

      def muted_target_ids(target_type, target_ids)
        return [] if target_ids.empty?

        current_user.message_preferences
          .where(target_type: target_type, target_id: target_ids, muted: true)
          .pluck(:target_id)
      end

      def find_or_create_read_state(channel)
        current_user.channel_read_states.find_or_create_by!(channel: channel)
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
        current_user.channel_read_states.find_by!(channel: channel)
      end

      def workspace_for_mutation!
        if channel_params[:workspace_id].present?
          workspace = Workspace.find(channel_params[:workspace_id])
          return workspace if workspace.visible_to?(current_user) || current_user.staff?

          render_forbidden("Workspace is not visible")
          return nil
        end

        cohort = Cohort.find(channel_params[:cohort_id])
        Workspace.find_or_create_for_cohort!(cohort)
      end

      def read_receipts_for(messages)
        return {} if messages.empty?

        member_ids = @channel.workspace.recipient_users.reorder(nil).pluck(:id)
        states = ChannelReadState.includes(:user)
          .where(channel: @channel, user_id: member_ids)
          .where.not(last_read_at: nil)
          .to_a

        messages.to_h do |message|
          readers = states.select { |state| state.user_id != message.author_id && state.last_read_at && state.last_read_at >= message.created_at }
          [ message.id, {
            count: readers.size,
            users: readers.first(5).map { |state| receipt_user_json(state.user) }
          } ]
        end
      end

      def receipt_user_json(user)
        {
          id: user.id,
          full_name: user.full_name,
          avatar_url: user.avatar_url
        }
      end

      def message_json(message, read_receipts: nil)
        MessageJson.render(message, current_user: current_user, stream_url: true, read_receipts: read_receipts)
      end
    end
  end
end
