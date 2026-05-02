module Api
  module V1
    class DirectConversationsController < ApplicationController
      include MessageWindowing

      before_action :authenticate_user!
      before_action :set_conversation, only: [ :show, :mark_read ]

      # GET /api/v1/direct_conversations
      def index
        conversations = DirectConversation.visible_for(current_user)
          .includes({ workspace: :cohort }, :users)
          .to_a
        members = DirectConversationMember.where(direct_conversation_id: conversations.map(&:id), user: current_user)
          .index_by(&:direct_conversation_id)
        unread_counts = unread_counts_for(conversations, members)
        latest_messages = latest_messages_for(conversations)
        muted_ids = muted_target_ids(conversations.map(&:id))

        render json: {
          direct_conversations: conversations.map do |conversation|
            conversation_json(
              conversation,
              member: members[conversation.id],
              unread_count: unread_counts[conversation.id] || 0,
              latest_message: latest_messages[conversation.id],
              muted_ids: muted_ids
            )
          end
        }
      end

      # GET /api/v1/direct_conversations/available_users?workspace_id=1
      def available_users
        workspace = resolved_workspace
        unless workspace&.visible_to?(current_user) || current_user.staff?
          render_forbidden("Workspace is not visible")
          return
        end

        users = workspace.available_users_for(current_user)

        render json: { users: users.map { |user| user_json(user) } }
      end

      # GET /api/v1/direct_conversations/:id
      def show
        unless @conversation.visible_to?(current_user)
          render_forbidden("Conversation is not visible")
          return
        end

        member = @conversation.direct_conversation_members.find_by!(user: current_user)
        messages = windowed_messages(@conversation.messages.visible)
        pinned_messages = @conversation.messages.pinned_recent.to_a
        read_receipts = read_receipts_for(messages)

        render json: {
          direct_conversation: conversation_json(
            @conversation,
            member: member,
            unread_count: unread_count_for(@conversation, member),
            latest_message: messages.last
          ),
          messages: messages.map { |message| MessageJson.render(message, current_user: current_user, stream_url: true, read_receipts: read_receipts[message.id]) },
          pinned_messages: pinned_messages.map { |message| MessageJson.render(message, current_user: current_user, stream_url: true) }
        }
      end

      # POST /api/v1/direct_conversations
      def create
        workspace = resolved_workspace

        unless workspace&.visible_to?(current_user) || current_user.staff?
          render_forbidden("Workspace is not visible")
          return
        end

        if Array(conversation_params[:user_ids]).map(&:to_i).reject(&:zero?).uniq.empty?
          render json: { errors: [ "Choose at least one other member" ] }, status: :unprocessable_entity
          return
        end

        users = direct_users_for(workspace, conversation_params[:user_ids])
        conversation = DirectConversation.find_or_create_for!(workspace: workspace, users: users)

        render json: {
          direct_conversation: conversation_json(conversation, member: conversation.direct_conversation_members.find_by(user: current_user))
        }, status: :created
      end

      # PATCH /api/v1/direct_conversations/:id/read
      def mark_read
        unless @conversation.visible_to?(current_user)
          render_forbidden("Conversation is not visible")
          return
        end

        member = @conversation.direct_conversation_members.find_by!(user: current_user)
        member.mark_read!
        current_user.notifications.direct_message.where(path: "/messages/dm/#{@conversation.id}").unread.update_all(read_at: Time.current, updated_at: Time.current)

        render json: { direct_conversation: conversation_json(@conversation, member: member, unread_count: 0, latest_message: latest_messages_for([ @conversation ])[@conversation.id]) }
      end

      private

      def set_conversation
        @conversation = DirectConversation.find(params[:id])
      end

      def conversation_params
        params.permit(:cohort_id, :workspace_id, user_ids: [])
      end

      def direct_users_for(workspace, requested_ids)
        ids = Array(requested_ids).map(&:to_i).reject(&:zero?).uniq
        ids << current_user.id

        allowed_ids = workspace.available_users_for(current_user).reorder(nil).pluck(:id)
        allowed_ids << current_user.id
        allowed_ids.uniq!

        unless (ids - allowed_ids).empty?
          raise ActiveRecord::RecordNotFound
        end

        User.where(id: ids).to_a
      end

      def unread_counts_for(conversations, members)
        counts = conversations.index_with { 0 }
        return counts if conversations.empty?

        join_sql = ApplicationRecord.sanitize_sql_array([
          "LEFT JOIN direct_conversation_members current_members ON current_members.direct_conversation_id = messages.direct_conversation_id AND current_members.user_id = ?",
          current_user.id
        ])

        Message.visible
          .where(direct_conversation_id: conversations.map(&:id))
          .where.not(author_id: current_user.id)
          .joins(join_sql)
          .where("current_members.last_read_at IS NULL OR messages.created_at > current_members.last_read_at")
          .group(:direct_conversation_id)
          .count
          .then { |unread_counts| counts.merge(unread_counts) }
      end

      def unread_count_for(conversation, member)
        messages = conversation.messages.visible.where.not(author_id: current_user.id)
        messages = messages.where("created_at > ?", member.last_read_at) if member&.last_read_at
        messages.count
      end

      def latest_messages_for(conversations)
        return {} if conversations.empty?

        Message.visible
          .includes(:author, :message_attachments)
          .select("DISTINCT ON (messages.direct_conversation_id) messages.*")
          .where(direct_conversation_id: conversations.map(&:id))
          .order(Arel.sql("messages.direct_conversation_id, messages.created_at DESC, messages.id DESC"))
          .to_a
          .index_by(&:direct_conversation_id)
      end

      def conversation_json(conversation, member: nil, unread_count: 0, latest_message: nil, muted_ids: nil)
        {
          id: conversation.id,
          workspace_id: conversation.workspace_id,
          workspace_name: conversation.workspace.name,
          workspace_type: conversation.workspace.workspace_type,
          cohort_id: conversation.cohort_id,
          cohort_name: conversation.cohort&.name,
          title: conversation.title_for(current_user),
          status: conversation.status,
          muted: muted_ids ? muted_ids.include?(conversation.id) : MessagePreference.exists?(user: current_user, target: conversation, muted: true),
          unread_count: unread_count,
          last_read_at: member&.last_read_at,
          latest_message: MessageJson.latest(latest_message),
          users: conversation.users.map { |user| user_json(user) },
          created_at: conversation.created_at,
          updated_at: conversation.updated_at
        }
      end

      def read_receipts_for(messages)
        return {} if messages.empty?

        members = @conversation.direct_conversation_members.includes(:user).where.not(last_read_at: nil).to_a
        messages.to_h do |message|
          readers = members.select { |member| member.user_id != message.author_id && member.last_read_at && member.last_read_at >= message.created_at }
          [ message.id, {
            count: readers.size,
            users: readers.first(5).map { |member| receipt_user_json(member.user) }
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

      def user_json(user)
        {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          avatar_url: user.avatar_url,
          is_staff: user.staff?,
          is_admin: user.admin?
        }
      end

      def muted_target_ids(conversation_ids)
        return [] if conversation_ids.empty?

        current_user.message_preferences
          .where(target_type: "DirectConversation", target_id: conversation_ids, muted: true)
          .pluck(:target_id)
      end

      def resolved_workspace
        if conversation_params[:workspace_id].present?
          Workspace.find(conversation_params[:workspace_id])
        elsif conversation_params[:cohort_id].present?
          cohort = Cohort.find(conversation_params[:cohort_id])
          Workspace.find_or_create_for_cohort!(cohort)
        end
      end
    end
  end
end
