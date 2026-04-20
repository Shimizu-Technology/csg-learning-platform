module Api
  module V1
    class MessagesSearchController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/messages/search?q=hello
      def index
        query = params[:q].to_s.strip
        if query.length < 2
          render json: { results: [] }
          return
        end

        channel_ids = Channel.visible_for(current_user).pluck(:id)
        direct_ids = DirectConversation.visible_for(current_user).pluck(:id)
        pattern = "%#{ActiveRecord::Base.sanitize_sql_like(query.downcase)}%"

        messages = Message.visible
          .includes(:author, :channel, :direct_conversation, :message_attachments, :message_reactions)
          .where("LOWER(body) LIKE ?", pattern)
          .where(Message.arel_table[:channel_id].in(channel_ids).or(Message.arel_table[:direct_conversation_id].in(direct_ids)))
          .order(created_at: :desc, id: :desc)
          .limit(search_limit)

        render json: {
          results: messages.map { |message| result_json(message) }
        }
      end

      private

      def search_limit
        params.fetch(:limit, 30).to_i.clamp(1, 50)
      end

      def result_json(message)
        json = MessageJson.render(message, current_user: current_user, stream_url: false)
        json[:context] = if message.channel
          {
            type: "channel",
            id: message.channel_id,
            label: "##{message.channel.name}",
            cohort_id: message.channel.cohort_id
          }
        else
          {
            type: "direct_conversation",
            id: message.direct_conversation_id,
            label: message.direct_conversation.title_for(current_user),
            cohort_id: message.direct_conversation.cohort_id
          }
        end
        json
      end
    end
  end
end
