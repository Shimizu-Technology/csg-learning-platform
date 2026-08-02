module Api
  module V1
    class FeedbackSnippetsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_snippet, only: [ :update, :destroy ]
      before_action :set_active_snippet, only: :use
      before_action :require_owner_or_admin!, only: [ :update, :destroy ]

      def index
        snippets = FeedbackSnippet.active.includes(:created_by).recommended
        render json: { feedback_snippets: snippets.map { |snippet| snippet_json(snippet) } }
      end

      def create
        snippet = current_user.feedback_snippets.new(snippet_params)
        if snippet.save
          render json: { feedback_snippet: snippet_json(snippet) }, status: :created
        else
          render json: { errors: snippet.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @snippet.update(snippet_params)
          render json: { feedback_snippet: snippet_json(@snippet) }
        else
          render json: { errors: @snippet.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @snippet.update!(active: false)
        head :no_content
      end

      def use
        @snippet.increment!(:usage_count)
        render json: { feedback_snippet: snippet_json(@snippet) }
      end

      private

      def set_snippet
        @snippet = FeedbackSnippet.find(params[:id])
      end

      def set_active_snippet
        @snippet = FeedbackSnippet.active.find(params[:id])
      end

      def require_owner_or_admin!
        return if current_user.admin? || @snippet.created_by_id == current_user.id

        render json: { error: "Forbidden" }, status: :forbidden
      end

      def snippet_params
        params.require(:feedback_snippet).permit(:title, :body)
      end

      def snippet_json(snippet)
        {
          id: snippet.id,
          title: snippet.title,
          body: snippet.body,
          usage_count: snippet.usage_count,
          created_by: snippet.created_by.full_name,
          can_manage: current_user.admin? || snippet.created_by_id == current_user.id
        }
      end
    end
  end
end
