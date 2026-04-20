module Api
  module V1
    class DirectConversationsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_conversation, only: [ :show, :mark_read ]

      # GET /api/v1/direct_conversations
      def index
        conversations = DirectConversation.visible_for(current_user)
          .includes(:cohort, :users, messages: [ :author, :message_attachments ])
          .to_a
        members = DirectConversationMember.where(direct_conversation_id: conversations.map(&:id), user: current_user)
          .index_by(&:direct_conversation_id)
        unread_counts = unread_counts_for(conversations, members)
        latest_messages = latest_messages_for(conversations)

        render json: {
          direct_conversations: conversations.map do |conversation|
            conversation_json(
              conversation,
              member: members[conversation.id],
              unread_count: unread_counts[conversation.id] || 0,
              latest_message: latest_messages[conversation.id]
            )
          end
        }
      end

      # GET /api/v1/direct_conversations/available_users?cohort_id=1
      def available_users
        cohort = Cohort.find(params[:cohort_id])

        unless current_user.staff? || current_user.enrollments.active.exists?(cohort: cohort)
          render_forbidden("Cohort is not visible")
          return
        end

        student_ids = cohort.enrollments.active.select(:user_id)
        users = User.where(id: student_ids)
          .or(User.where(role: [ User.roles[:instructor], User.roles[:admin] ]))
          .where.not(id: current_user.id)
          .order(:first_name, :last_name, :email)

        render json: { users: users.map { |user| user_json(user) } }
      end

      # GET /api/v1/direct_conversations/:id
      def show
        unless @conversation.visible_to?(current_user)
          render_forbidden("Conversation is not visible")
          return
        end

        member = @conversation.direct_conversation_members.find_by!(user: current_user)
        messages = @conversation.messages.visible
          .includes(:author, :message_attachments, :message_reactions)
          .chronological
          .limit(message_limit)
          .to_a

        render json: {
          direct_conversation: conversation_json(
            @conversation,
            member: member,
            unread_count: unread_count_for(@conversation, member),
            latest_message: messages.last
          ),
          messages: messages.map { |message| MessageJson.render(message, current_user: current_user, stream_url: true) }
        }
      end

      # POST /api/v1/direct_conversations
      def create
        cohort = Cohort.find(conversation_params[:cohort_id])

        unless current_user.staff? || current_user.enrollments.active.exists?(cohort: cohort)
          render_forbidden("Cohort is not visible")
          return
        end

        users = direct_users_for(cohort, conversation_params[:user_ids])
        conversation = DirectConversation.find_or_create_for!(cohort: cohort, users: users)

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
        params.permit(:cohort_id, user_ids: [])
      end

      def message_limit
        params.fetch(:message_limit, 100).to_i.clamp(1, 200)
      end

      def direct_users_for(cohort, requested_ids)
        ids = Array(requested_ids).map(&:to_i).reject(&:zero?).uniq
        ids << current_user.id

        allowed_ids = User.where(role: [ User.roles[:instructor], User.roles[:admin] ]).pluck(:id)
        allowed_ids += cohort.enrollments.active.pluck(:user_id)
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

      def conversation_json(conversation, member: nil, unread_count: 0, latest_message: nil)
        {
          id: conversation.id,
          cohort_id: conversation.cohort_id,
          cohort_name: conversation.cohort.name,
          title: conversation.title_for(current_user),
          status: conversation.status,
          muted: MessagePreference.exists?(user: current_user, target: conversation, muted: true),
          unread_count: unread_count,
          last_read_at: member&.last_read_at,
          latest_message: MessageJson.latest(latest_message),
          users: conversation.users.map { |user| user_json(user) },
          created_at: conversation.created_at,
          updated_at: conversation.updated_at
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
    end
  end
end
