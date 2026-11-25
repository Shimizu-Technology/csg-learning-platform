module Api
  module V1
    # Shared class files and one private folder per enrolled student. Uploads
    # use the same two-phase S3 flow as course ZIPs: a presigned POST into a
    # staging key, then `complete` checks the object and copies it to the
    # published key. A student only ever sees shared files visible to students
    # and their own folder. Links (kind "link") are saved in one step and
    # need no storage. Uploaded files can gain new versions through the same
    # two-phase flow; older versions stay readable.
    class CohortFilesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_cohort
      before_action :authorize_cohort!
      before_action :require_staff!, only: %i[copy_to_students rename_folder]

      FOLDER_STATUSES = %i[active paused].freeze

      def index
        return render json: staff_index if current_user.staff?

        scope = @cohort.cohort_files.ready.student_visible.includes(:uploaded_by)
          .where(student_id: [ nil, current_user.id ]).order(:folder, :title, :id)
        scope = scope.includes(:versions) if @enrollment.paused?
        shown = scope.to_h { |file| [ file, @enrollment.file_version_for_read(file) ] }.compact
        files = shown.keys
        class_files, my_files = files.partition(&:class_file?)
        render json: {
          class_files: class_files.map { |file| file.file_json(shown: shown.fetch(file)) },
          my_files: my_files.map { |file| file.file_json(can_manage: student_manages?(file), shown: shown.fetch(file)) },
          folders: files.map(&:folder).uniq.sort,
          storage_configured: S3Service.configured?,
          can_upload_personal: student_can_write?
        }
      end

      def create
        kind = params[:kind].presence || "file"
        return create_link if kind == "link"
        return render json: { error: "kind must be file or link" }, status: :unprocessable_entity unless kind == "file"
        return storage_unavailable unless S3Service.configured?
        unless params[:file_size].is_a?(Integer)
          render json: { error: "file_size must be a whole byte count" }, status: :unprocessable_entity
          return
        end
        student_id = upload_student_id
        return if performed?

        CohortFile.purge_expired_pending!(@cohort.cohort_files)

        filename, content_type = upload_type
        return if performed?

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

      # `version_id` downloads an earlier version of the file.
      def download
        return storage_unavailable unless S3Service.configured?

        file, shown, expiry = readable_target
        return if performed?
        return link_has_no_file unless file.stored_file?

        response.headers["Cache-Control"] = "no-store"
        url = S3Service.generate_presigned_url(shown.s3_key, expires_in: expiry,
          response_content_disposition: "attachment; filename=\"#{shown.filename}\"")
        render json: { url: url, expires_in: expiry, filename: shown.filename }
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # How the app shows a file without downloading it. PDFs, images, audio
      # and video get a short-lived inline link served with their allowlisted
      # type; Markdown, text and CSV are read here (up to 512 KB) and returned
      # as text, so no storage CORS is needed. Office files and ZIPs are
      # download only. Same access and pause rules as `download`.
      def preview
        file, shown, expiry = readable_target
        return if performed?
        return link_has_no_file unless file.stored_file?

        mode = shown.preview_mode
        body = {
          preview_mode: mode, filename: shown.filename, content_type: shown.content_type, file_size: shown.file_size,
          version_number: shown.version_number, version_id: shown.is_a?(CohortFileVersion) ? shown.id : nil,
          url: nil, expires_in: nil, text: nil, truncated: false
        }
        if CohortFile::INLINE_PREVIEW_MODES.include?(mode) || CohortFile::TEXT_PREVIEW_MODES.include?(mode)
          return storage_unavailable unless S3Service.configured?
        end
        if CohortFile::INLINE_PREVIEW_MODES.include?(mode)
          body[:url] = S3Service.generate_presigned_url(shown.s3_key, expires_in: expiry,
            response_content_disposition: "inline; filename=\"#{shown.filename}\"", response_content_type: shown.content_type)
          body[:expires_in] = expiry
        elsif CohortFile::TEXT_PREVIEW_MODES.include?(mode)
          bytes = S3Service.read_prefix(shown.s3_key, bytes: CohortFile::TEXT_PREVIEW_BYTES)
          return render json: { error: "This file is missing from storage" }, status: :not_found if bytes.nil?

          body[:truncated] = shown.file_size > CohortFile::TEXT_PREVIEW_BYTES
          text = bytes.dup.force_encoding(Encoding::UTF_8).scrub("\uFFFD")
          # A cut at the byte limit can split the last character.
          body[:text] = body[:truncated] ? text.sub(/\uFFFD+\z/, "") : text
        end
        response.headers["Cache-Control"] = "no-store"
        render json: body
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Published versions, newest first. Paused learners see only versions
      # published before their pause.
      def versions
        file, = readable_target(allow_version: false)
        return if performed?

        versions = file.versions.ready.includes(:uploaded_by).order(version_number: :desc).to_a
        versions = versions.select { |version| @enrollment.file_version_available_for_read?(version) } unless current_user.staff?
        render json: { versions: versions.map { |version| version.version_json(current: version.version_number == file.version_number) } }
      end

      # Starts a new version of an uploaded file: staff on any ready file,
      # an active student on a ready file they uploaded to their own folder.
      # Version 1 is archived first, so history always starts with it.
      def create_version
        return storage_unavailable unless S3Service.configured?
        return render_forbidden("Uploads to your folder are paused") unless current_user.staff? || student_can_write?
        unless params[:file_size].is_a?(Integer)
          render json: { error: "file_size must be a whole byte count" }, status: :unprocessable_entity
          return
        end

        file = manageable_files.find(params[:id])
        unless file.stored_file? && file.ready?
          render json: { error: "Only published uploaded files can get a new version" }, status: :unprocessable_entity
          return
        end
        CohortFile.purge_expired_pending!(@cohort.cohort_files)
        filename, content_type = upload_type
        return if performed?

        token = SecureRandom.uuid
        owner = file.student_id ? "student_#{file.student_id}" : "shared"
        version = file.with_lock do
          archive_first_version(file)
          file.versions.create!(
            version_number: [ file.version_number, file.versions.maximum(:version_number).to_i ].max + 1,
            uploaded_by: current_user, note: params[:note], filename: filename, content_type: content_type, file_size: params[:file_size],
            s3_key: "cohort_files/cohort_#{@cohort.id}/#{owner}/#{token}/#{filename}",
            upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/#{filename}",
            upload_expires_at: Time.current + S3Service::PRESIGN_EXPIRY
          )
        end
        post = S3Service.generate_presigned_post(version.upload_key, version.content_type, max_size: version.file_size)
        render json: { version: version.version_json(current: false), upload_url: post.url, fields: post.fields }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Publishes a version with the same checks as `complete`, then points the
      # file at it. Versions publish in order, so a later-started upload that
      # finishes first takes the next number.
      def complete_version
        return storage_unavailable unless S3Service.configured?
        return render_forbidden("Uploads to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        version = nil
        file.with_lock do
          version = file.versions.lock.find(params[:version_id])
          if version.ready?
            render json: { file: file.file_json(can_manage: true), version: version.version_json(current: version.version_number == file.version_number) }
            return
          end
          if version.upload_expires_at <= Time.current
            render json: { error: "Upload expired; start a new upload" }, status: :unprocessable_entity
            return
          end
          metadata = S3Service.object_metadata(version.upload_key)
          unless metadata && metadata[:content_type] == version.content_type && metadata[:content_length] == version.file_size
            render json: { error: "Uploaded file is missing or does not match its declared size and type" }, status: :unprocessable_entity
            return
          end
          unless CohortFile.content_matches?(version.filename, S3Service.read_prefix(version.upload_key, if_match: metadata.fetch(:etag)))
            render json: { error: "This file's contents don't match its .#{CohortFile.extension_for(version.filename)} type. Export it again and re-upload." },
              status: :unprocessable_entity
            return
          end
          S3Service.copy_object(version.upload_key, version.s3_key, etag: metadata.fetch(:etag))
          take_next_version_number(file, version)
          version.update!(ready: true, ready_at: Time.current)
          file.update!(version_number: version.version_number, s3_key: version.s3_key, upload_key: version.upload_key, filename: version.filename,
            content_type: version.content_type, file_size: version.file_size, ready_at: version.ready_at)
        end
        ActiveRecord.after_all_transactions_commit { delete_staging_upload(version) }
        render json: { file: file.file_json(can_manage: true), version: version.version_json(current: true) }
      rescue Aws::S3::Errors::PreconditionFailed
        render json: { error: "Upload changed while confirming; try again" }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Renames a class-file folder in one statement. Student folders keep
      # their own folder names.
      def rename_folder
        from = params[:from_folder].to_s.squish
        to = params[:to_folder].to_s.squish
        problem = if from.blank? then "Choose the folder to rename"
        elsif to.blank? then "New folder name can't be blank"
        elsif to.length > 80 then "New folder name is too long (maximum is 80 characters)"
        end
        return render json: { error: problem }, status: :unprocessable_entity if problem

        count = @cohort.cohort_files.class_files.where(folder: from).update_all(folder: to, updated_at: Time.current)
        render json: { updated_count: count, folder: to }
      end

      def update
        return render_forbidden("Changes to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        keys = current_user.staff? ? %i[title description folder visibility external_url] : %i[title description folder external_url]
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
          # Local and demo rows, and links, have no stored objects to clean up.
          # Older versions go first, so a failure leaves the current one intact.
          if S3Service.configured? && !file.stored_keys.all? { |key| S3Service.delete_object(key) }
            render json: { error: "Could not delete the stored file; try again" }, status: :bad_gateway
            return
          end
          file.storage_cleaned = true
          file.destroy!
        end
        head :no_content
      end

      # Copies a ready class file or link into every active student's folder.
      # Students who already have a copy are skipped, so re-running reaches
      # only new ones. Links are copied without storage.
      def copy_to_students
        source = @cohort.cohort_files.find(params[:id])
        unless source.class_file? && source.ready? && (source.stored_file? || source.link?)
          render json: { error: "Only class files and links can be copied to student folders" }, status: :unprocessable_entity
          return
        end
        return storage_unavailable if source.stored_file? && !S3Service.configured?

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

      # A link is saved and published in one step and needs no storage.
      def create_link
        student_id = upload_student_id
        return if performed?

        url = params[:external_url].to_s.strip
        file = @cohort.cohort_files.new(
          kind: "link", student_id: student_id, uploaded_by: current_user, external_url: url,
          title: params[:title].presence || link_title(url), description: params[:description], folder: params[:folder],
          visibility: current_user.staff? ? params[:visibility].presence || "students" : "students", ready: true
        )
        file.save!
        render json: { file: file.file_json(can_manage: true) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def link_title(url)
        URI.parse(url).hostname.to_s.delete_prefix("www.").presence
      rescue URI::InvalidURIError
        nil
      end

      # The file this viewer may read and the version to serve, with the
      # link expiry. Renders 403 (and returns nil) when a paused learner asks
      # for something published after the pause or access has run out.
      def readable_target(allow_version: true)
        file = readable_files.ready.find(params[:id])
        expiry = CohortFile::DOWNLOAD_EXPIRY
        return [ file, requested_version(file) || file, expiry ] if current_user.staff?

        shown = @enrollment.file_version_for_read(file)
        return render_forbidden("This file was not available before your pause") unless shown

        if allow_version && (version = requested_version(file))
          return render_forbidden("This version was not available before your pause") unless @enrollment.file_version_available_for_read?(version)

          shown = version
        end
        if @enrollment.access_expires_at
          expiry = [ expiry, (@enrollment.access_expires_at - Time.current).floor ].min
          return render_forbidden("Course access has expired") unless expiry.positive?
        end
        [ file, shown, expiry ]
      end

      def requested_version(file)
        file.versions.ready.find(params[:version_id]) if params[:version_id].present?
      end

      # Archives the original upload as version 1 the first time a file gets a new version.
      def archive_first_version(file)
        return if file.versions.exists?(version_number: 1)

        file.versions.create!(
          version_number: 1, ready: true, ready_at: file.ready_at || file.created_at, uploaded_by_id: file.uploaded_by_id,
          filename: file.filename, content_type: file.content_type, file_size: file.file_size,
          s3_key: file.s3_key, upload_key: file.upload_key, upload_expires_at: file.upload_expires_at
        )
      end

      # Published versions are numbered 1..n with no gaps. A pending upload
      # holding the next number swaps with this one. Runs under the file lock,
      # which every version create and publish takes.
      def take_next_version_number(file, version)
        target = file.version_number + 1
        return if version.version_number == target

        holder = file.versions.lock.find_by(version_number: target)
        own_number = version.version_number
        if holder
          version.update_column(:version_number, 0)
          holder.update_column(:version_number, own_number)
        end
        version.version_number = target
      end

      # The sanitized filename and stored type of a new upload, or renders 422.
      def upload_type
        filename = CohortFile.sanitize_filename(params[:filename])
        content_type = CohortFile.normalized_content_type(filename, params[:content_type]) if filename
        return [ filename, content_type ] if content_type

        render json: { error: "This file type can't be uploaded. Use a PDF, Office document, spreadsheet, slide deck, text, ZIP, image, audio or MP4 file." },
          status: :unprocessable_entity
        nil
      end

      def link_has_no_file
        render json: { error: "Links open on their own site" }, status: :unprocessable_entity
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
        return copy_link_for(source, student_id, folder) if source.link?

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

      def copy_link_for(source, student_id, folder)
        @cohort.cohort_files.create!(
          kind: "link", student_id: student_id, uploaded_by: current_user, source_file: source,
          title: source.title, description: source.description, folder: folder, visibility: "students",
          external_url: source.external_url, ready: true
        )
      rescue ActiveRecord::RecordNotUnique
        raise unless @cohort.cohort_files.exists?(student_id: student_id, source_file_id: source.id)

        nil
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
