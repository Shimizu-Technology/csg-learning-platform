module Api
  module V1
    class CurriculumResourcesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_curriculum
      before_action :authorize_curriculum!
      before_action :require_staff!, only: [ :create, :complete, :destroy ]
      around_action :with_draft_lock, only: [ :create, :complete ]

      def index
        render json: { resources: @curriculum.curriculum_resources.ready.order(:id).map(&:resource_json) }
      end

      def create
        return storage_unavailable unless S3Service.configured?
        unless params[:file_size].is_a?(Integer)
          render json: { error: "file_size must be a whole byte count" }, status: :unprocessable_entity
          return
        end

        filename = params[:filename].to_s.gsub(/[^a-zA-Z0-9._-]/, "_")
        token = SecureRandom.uuid
        resource = @curriculum.curriculum_resources.new(
          title: params[:title], filename: filename, file_size: params[:file_size],
          s3_key: "course_resources/curriculum_#{@curriculum.id}/#{token}/#{filename}",
          upload_key: "course_resource_uploads/curriculum_#{@curriculum.id}/#{token}/#{filename}",
          upload_expires_at: Time.current + S3Service::PRESIGN_EXPIRY
        )
        resource.save!
        post = S3Service.generate_presigned_post(resource.upload_key, "application/zip", max_size: resource.file_size)
        render json: { resource: resource.resource_json, upload_url: post.url, fields: post.fields }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def complete
        return storage_unavailable unless S3Service.configured?

        resource = @curriculum.curriculum_resources.find(params[:id])
        resource.with_lock do
          if resource.ready?
            render json: { resource: resource.resource_json }
            return
          end
          if resource.upload_expires_at <= Time.current
            render json: { error: "Upload expired; start a new upload" }, status: :unprocessable_entity
            return
          end
          metadata = S3Service.object_metadata(resource.upload_key)
          unless metadata && metadata[:content_type] == "application/zip" && metadata[:content_length] == resource.file_size
            render json: { error: "Uploaded ZIP is missing or does not match its declared size and type" }, status: :unprocessable_entity
            return
          end
          # The still-valid upload POST can only overwrite staging, never a published ZIP.
          S3Service.copy_object(resource.upload_key, resource.s3_key, etag: metadata.fetch(:etag))
          resource.update!(ready: true)
        end
        S3Service.delete_object(resource.upload_key)
        render json: { resource: resource.resource_json }
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def download
        return storage_unavailable unless S3Service.configured?

        resource = @curriculum.curriculum_resources.ready.find(params[:id])
        expiry = CurriculumResource::DOWNLOAD_EXPIRY
        if @enrollment&.access_expires_at
          expiry = [ expiry, (@enrollment.access_expires_at - Time.current).floor ].min
          return render_forbidden("Course access has expired") unless expiry.positive?
        end
        response.headers["Cache-Control"] = "no-store"
        render json: { url: S3Service.generate_presigned_url(resource.s3_key, expires_in: expiry), expires_in: expiry }
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def destroy
        return storage_unavailable unless S3Service.configured?

        resource = @curriculum.curriculum_resources.find(params[:id])
        resource.with_lock do
          if resource.ready?
            render json: { error: "Published course files cannot be abandoned" }, status: :unprocessable_entity
            return
          end
          unless S3Service.delete_object(resource.upload_key) && S3Service.delete_object(resource.s3_key)
            render json: { error: "Could not clean the pending upload; try again" }, status: :bad_gateway
            return
          end
          resource.destroy!
        end
        head :no_content
      end

      private

      def set_curriculum
        @curriculum = Curriculum.find(params[:curricula_id])
      end

      def authorize_curriculum!
        allowed = if current_user.admin?
          true
        elsif current_user.instructor?
          current_user.accessible_cohorts.exists?(curriculum_id: @curriculum.id)
        else
          @enrollment = current_user.enrollments.active.joins(:cohort)
            .where(cohorts: { curriculum_id: @curriculum.id }).order(access_expires_at: :desc).first
          @enrollment.present?
        end
        render_forbidden("No current access to this curriculum") unless allowed
      end

      def with_draft_lock
        @curriculum.with_lock do
          if @curriculum.draft?
            yield
          else
            render json: { error: "Upload resources to a draft curriculum" }, status: :unprocessable_entity
          end
        end
      end

      def storage_unavailable
        render json: { error: "Course file storage is unavailable" }, status: :service_unavailable
      end

      def storage_error(error)
        Rails.logger.error("[CurriculumResources] #{error.class}")
        render json: { error: "Course file storage could not complete the request" }, status: :bad_gateway
      end
    end
  end
end
