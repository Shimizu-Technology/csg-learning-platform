module Api
  module V1
    # Shared class files and one private folder per enrolled student. Uploads
    # use the same two-phase S3 flow as course ZIPs: a presigned POST into a
    # staging key, then `complete` checks the object and copies it to the
    # published key. A student only ever sees shared files visible to students
    # and their own folder.
    class CohortFilesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_cohort
      before_action :authorize_cohort!
      before_action :require_staff!, only: :copy_to_students

      FOLDER_STATUSES = %i[active paused].freeze

      def index
        return render json: staff_index if current_user.staff?

        files = @cohort.cohort_files.ready.student_visible.includes(:uploaded_by)
          .where(student_id: [ nil, current_user.id ]).order(:folder, :title, :id)
          .select { |file| @enrollment.file_available_for_read?(file) }
        class_files, my_files = files.partition(&:class_file?)
        render json: {
          class_files: class_files.map { |file| file.file_json },
          my_files: my_files.map { |file| file.file_json(can_manage: student_manages?(file)) },
          folders: files.map(&:folder).uniq.sort,
          storage_configured: S3Service.configured?,
          can_upload_personal: student_can_write?
        }
      end

      def create
        return storage_unavailable unless S3Service.configured?
        unless params[:file_size].is_a?(Integer)
          render json: { error: "file_size must be a whole byte count" }, status: :unprocessable_entity
          return
        end
        student_id = upload_student_id
        return if performed?

        CohortFile.purge_expired_pending!(@cohort.cohort_files)

        filename = CohortFile.sanitize_filename(params[:filename])
        content_type = CohortFile.normalized_content_type(filename, params[:content_type]) if filename
        unless content_type
          render json: { error: "This file type can't be uploaded. Use a PDF, Office document, spreadsheet, slide deck, text, ZIP, image, audio or MP4 file." },
            status: :unprocessable_entity
          return
        end

        token = SecureRandom.uuid
        owner = student_id ? "student_#{student_id}" : "shared"
        file = @cohort.cohort_files.new(
          student_id: student_id, uploaded_by: current_user,
          title: params[:title].presence || File.basename(filename, File.extname(filename)),
          description: params[:description], folder: params[:folder],
          visibility: current_user.staff? ? params[:visibility].presence || "students" : "students",
          filename: filename, content_type: content_type, file_size: params[:file_size],
          s3_key: "cohort_files/cohort_#{@cohort.id}/#{owner}/#{token}/#{filename}",
          upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/#{filename}",
          upload_expires_at: Time.current + S3Service::PRESIGN_EXPIRY
        )
        file.save!
        post = S3Service.generate_presigned_post(file.upload_key, file.content_type, max_size: file.file_size)
        render json: { file: file.file_json(can_manage: true), upload_url: post.url, fields: post.fields }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def complete
        return storage_unavailable unless S3Service.configured?
        return render_forbidden("Uploads to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        file.with_lock do
          if file.ready?
            render json: { file: file.file_json(can_manage: true) }
            return
          end
          if file.upload_expires_at <= Time.current
            render json: { error: "Upload expired; start a new upload" }, status: :unprocessable_entity
            return
          end
          metadata = S3Service.object_metadata(file.upload_key)
          unless metadata && metadata[:content_type] == file.content_type && metadata[:content_length] == file.file_size
            render json: { error: "Uploaded file is missing or does not match its declared size and type" }, status: :unprocessable_entity
            return
          end
          # Bound to the HEAD etag, so the checked bytes are the object copied below.
          unless CohortFile.content_matches?(file.filename, S3Service.read_prefix(file.upload_key, if_match: metadata.fetch(:etag)))
            render json: { error: "This file's contents don't match its .#{CohortFile.extension_for(file.filename)} type. Export it again and re-upload." },
              status: :unprocessable_entity
            return
          end
          # The still-valid upload POST can only overwrite staging, never a published file.
          S3Service.copy_object(file.upload_key, file.s3_key, etag: metadata.fetch(:etag))
          file.update!(ready: true)
        end
        # Delete staging only once `ready` commits, so a rolled-back publish can retry.
        ActiveRecord.after_all_transactions_commit { delete_staging_upload(file) }
        render json: { file: file.file_json(can_manage: true) }
      rescue Aws::S3::Errors::PreconditionFailed
        # The staged object was replaced between the size check and the read or copy.
        render json: { error: "Upload changed while confirming; try again" }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def download
        return storage_unavailable unless S3Service.configured?

        file = readable_files.ready.find(params[:id])
        expiry = CohortFile::DOWNLOAD_EXPIRY
        unless current_user.staff?
          return render_forbidden("This file was not available before your pause") unless @enrollment.file_available_for_read?(file)

          if @enrollment.access_expires_at
            expiry = [ expiry, (@enrollment.access_expires_at - Time.current).floor ].min
            return render_forbidden("Course access has expired") unless expiry.positive?
          end
        end
        response.headers["Cache-Control"] = "no-store"
        url = S3Service.generate_presigned_url(file.s3_key, expires_in: expiry,
          response_content_disposition: "attachment; filename=\"#{file.filename}\"")
        render json: { url: url, expires_in: expiry, filename: file.filename }
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def update
        return render_forbidden("Changes to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        keys = current_user.staff? ? %i[title description folder visibility] : %i[title description folder]
        file.update!(params.slice(*keys).permit(*keys).to_h.compact)
        render json: { file: file.file_json(can_manage: true) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # `pending_only` abandons an unfinished upload and never removes a
      # published file, so a client retrying after a lost `complete` is safe.
      def destroy
        return render_forbidden("Changes to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        file.with_lock do
          if ActiveModel::Type::Boolean.new.cast(params[:pending_only]) && file.ready?
            render json: { error: "This file was already published" }, status: :unprocessable_entity
            return
          end
          # Local and demo rows have no stored objects to clean up.
          if S3Service.configured? && !(S3Service.delete_object(file.upload_key) && S3Service.delete_object(file.s3_key))
            render json: { error: "Could not delete the stored file; try again" }, status: :bad_gateway
            return
          end
          file.storage_cleaned = true
          file.destroy!
        end
        head :no_content
      end

      # Copies a ready class file into every active student's folder. Students
      # who already have a copy are skipped, so re-running reaches only new ones.
      def copy_to_students
        return storage_unavailable unless S3Service.configured?

        source = @cohort.cohort_files.find(params[:id])
        unless source.class_file? && source.ready?
          render json: { error: "Only uploaded class files can be copied to student folders" }, status: :unprocessable_entity
          return
        end
        folder = params[:folder].presence || source.folder
        copied_ids = @cohort.cohort_files.where(source_file_id: source.id).where.not(student_id: nil).pluck(:student_id).to_set
        copies = []
        skipped = 0
        @cohort.enrollments.active.includes(:user).order(:id).each do |enrollment|
          copy = copy_for(source, enrollment.user_id, folder) unless copied_ids.include?(enrollment.user_id)
          if copy
            copies << copy
          else
            skipped += 1
          end
        end
        render json: { copied_count: copies.size, skipped_count: skipped, files: copies.map { |file| file.file_json(can_manage: true) } }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def authorize_cohort!
        return render_forbidden("Cannot access this cohort") unless current_user.can_access_cohort?(@cohort)
        return if current_user.staff?

        @enrollment = current_user.enrollments.with_read_access.find_by(cohort: @cohort)
        render_forbidden("Not enrolled in this cohort") unless @enrollment
      end

      def staff_index
        class_files = @cohort.cohort_files.class_files.ready.includes(:uploaded_by).order(:folder, :title, :id).to_a
        enrollments = @cohort.enrollments.where(status: FOLDER_STATUSES).includes(:user).to_a
          .sort_by { |enrollment| [ enrollment.user.full_name.downcase, enrollment.id ] }
        student_files = @cohort.cohort_files.ready.where(student_id: enrollments.map(&:user_id))
          .includes(:uploaded_by).order(:folder, :title, :id).group_by(&:student_id)
        {
          class_files: class_files.map { |file| file.file_json(can_manage: true) },
          student_folders: enrollments.map do |enrollment|
            files = student_files.fetch(enrollment.user_id, [])
            {
              student_id: enrollment.user_id, enrollment_id: enrollment.id,
              student_name: enrollment.user.full_name, student_email: enrollment.user.email,
              enrollment_status: enrollment.paused? || enrollment.active? ? enrollment.status : "expired",
              file_count: files.size, files: files.map { |file| file.file_json(can_manage: true) }
            }
          end,
          folders: (class_files + student_files.values.flatten).map(&:folder).uniq.sort,
          storage_configured: S3Service.configured?,
          can_upload_personal: false
        }
      end

      # Students write only while actively enrolled (not paused or expired).
      def student_can_write?
        @enrollment.present? && @enrollment.active?
      end

      def student_manages?(file)
        student_can_write? && file.student_id == current_user.id && file.uploaded_by_id == current_user.id
      end

      # Staff manage every file in the cohort; a student only files they put in their own folder.
      def manageable_files
        return @cohort.cohort_files if current_user.staff?

        @cohort.cohort_files.where(student_id: current_user.id, uploaded_by_id: current_user.id)
      end

      def readable_files
        return @cohort.cohort_files if current_user.staff?

        @cohort.cohort_files.student_visible.where(student_id: [ nil, current_user.id ])
      end

      # The folder an upload goes to: nil for class files (staff only), or the student's id.
      def upload_student_id
        requested = params[:student_id].presence&.to_i
        if current_user.staff?
          return requested if requested.nil? || @cohort.enrollments.exists?(user_id: requested)

          render json: { error: "That student is not enrolled in this cohort" }, status: :unprocessable_entity
          return
        end
        return render_forbidden("Uploads to your folder are paused") unless student_can_write?
        return render_forbidden("You can only upload to your own folder") if requested && requested != current_user.id
        return render_forbidden("Student uploads are always visible to your instructors") if params[:visibility].present? && params[:visibility] != "students"

        current_user.id
      end

      # Validates the copy before touching storage. If the copy or the save
      # fails (even ambiguously, e.g. a timeout after S3 copied), the copied
      # object is removed, or queued for a durable retry.
      def copy_for(source, student_id, folder)
        token = SecureRandom.uuid
        copy = @cohort.cohort_files.new(
          student_id: student_id, uploaded_by: current_user, source_file: source,
          title: source.title, description: source.description, folder: folder, visibility: "students",
          filename: source.filename, content_type: source.content_type, file_size: source.file_size,
          s3_key: "cohort_files/cohort_#{@cohort.id}/student_#{student_id}/#{token}/#{source.filename}",
          upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/#{source.filename}",
          upload_expires_at: Time.current, ready: true
        )
        copy.validate!
        begin
          S3Service.copy_object(source.s3_key, copy.s3_key)
          copy.save!
        rescue ActiveRecord::RecordNotUnique => error
          remove_copied_object(copy.s3_key)
          # Only "this student already has a copy" is a skip; anything else is a real failure.
          raise unless @cohort.cohort_files.exists?(student_id: student_id, source_file_id: source.id)

          Rails.logger.info("[CohortFiles] concurrent_copy_skipped source_id=#{source.id} student_id=#{student_id} #{error.class}")
          return nil
        rescue StandardError
          remove_copied_object(copy.s3_key)
          raise
        end
        copy
      end

      def remove_copied_object(key)
        return unless S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_copy_rolled_back") == :failed

        Rails.logger.error("[CohortFiles] copy_cleanup_queued_for_retry")
      end

      def delete_staging_upload(file)
        return if S3Service.delete_object(file.upload_key)

        Rails.logger.warn("[CohortFiles] staging_cleanup_failed file_id=#{file.id}")
      end

      def storage_unavailable
        render json: { error: "Class file storage is unavailable" }, status: :service_unavailable
      end

      def storage_error(error)
        Rails.logger.error("[CohortFiles] #{error.class}")
        render json: { error: "Class file storage could not complete the request" }, status: :bad_gateway
      end
    end
  end
end
