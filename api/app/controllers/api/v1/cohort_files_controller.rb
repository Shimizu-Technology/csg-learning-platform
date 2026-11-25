module Api
  module V1
    # Shared class files and one private folder per enrolled student. Uploads
    # use the same two-phase S3 flow as course ZIPs: a presigned POST into a
    # staging key, then `complete` checks the object and copies it to the
    # published key. A student only ever sees shared files visible to students
    # and their own folder. Links (kind "link") are saved in one step and
    # need no storage. Uploaded files can gain new versions through the same
    # two-phase flow; older versions stay readable. Learn Docs (kind "doc")
    # are Markdown written in the app, with revision history and no storage.
    # Items in a student's folder carry a review status and a comment thread
    # between that student and staff. Class items can come from the
    # curriculum's template files or another cohort (CohortFileImport), and
    # those marked auto-copy reach every learner's folder (CohortFileCopy).
    # A folder downloads as one ZIP (CohortFileExport).
    class CohortFilesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_cohort
      before_action :authorize_cohort!
      before_action :require_staff!, only: %i[copy_to_students rename_folder import_curriculum copy_from_cohort]
      EXPORT_SCOPES = %w[my_files class student].freeze

      FOLDER_STATUSES = %i[active paused].freeze
      # A learner was paused or lost access while their upload was publishing.
      class WritePaused < StandardError; end
      # Under the lock, the doc turned out not to be one this viewer may edit.
      class NotEditable < StandardError; end
      # Under the lock, the item turned out not to be a student-visible
      # student-folder item (staged staff only, or moved).
      class NotFeedbackTarget < StandardError; end

      def index
        return render json: staff_index if current_user.staff?

        with_read_snapshot { render json: learner_index }
      end

      def create
        kind = params[:kind].presence || "file"
        return create_link if kind == "link"
        return create_doc if kind == "doc"
        return render json: { error: "kind must be file, link or doc" }, status: :unprocessable_entity unless kind == "file"
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
        with_writer_lock(file) do
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
          raise WritePaused unless writer_still_active?

          file.update!(ready: true)
        end
        # Delete staging only once `ready` commits, so a rolled-back publish can retry.
        ActiveRecord.after_all_transactions_commit { delete_staging_upload(file) }
        render json: { file: file.file_json(can_manage: true) }
      rescue WritePaused
        abandon_paused_upload(file)
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
        return no_stored_file(file) unless file.stored_file?

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
        return no_stored_file(file) unless file.stored_file?

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

          if CohortFile.content_matches?(shown.filename, bytes)
            body[:truncated] = shown.file_size > CohortFile::TEXT_PREVIEW_BYTES
            text = bytes.dup.force_encoding(Encoding::UTF_8).scrub("\uFFFD")
            # A cut at the byte limit can split the last character.
            body[:text] = body[:truncated] ? text.sub(/\uFFFD+\z/, "") : text
          else
            # Null bytes or page/script markup past the bytes checked at upload: download only.
            body[:preview_mode] = "download_only"
          end
        end
        response.headers["Cache-Control"] = "no-store"
        render json: body
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Published versions, newest first. Paused learners see only versions
      # published before their pause.
      # `current` marks the version this viewer gets by default: for a paused
      # learner, the newest one published before the pause.
      def versions
        file, shown = readable_target(allow_version: false)
        return if performed?

        versions = file.versions.ready.includes(:uploaded_by).order(version_number: :desc).to_a
        versions = versions.select { |version| @enrollment.file_version_available_for_read?(version) } unless current_user.staff?
        render json: { versions: versions.map { |version| version.version_json(current: version.version_number == shown.version_number) } }
      end

      # Starts a new version of an uploaded file: staff on any ready file,
      # an active student on a ready file they uploaded to their own folder.
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
      # finishes first takes the next number. The first publish archives the
      # original upload as version 1, so history appears with version 2.
      def complete_version
        return storage_unavailable unless S3Service.configured?
        return render_forbidden("Uploads to your folder are paused") unless current_user.staff? || student_can_write?

        file = manageable_files.find(params[:id])
        version = nil
        with_writer_lock(file) do
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
          raise WritePaused unless writer_still_active?

          archive_first_version(file)
          take_next_version_number(file, version)
          version.update!(ready: true, ready_at: Time.current)
          file.update!(version_number: version.version_number, s3_key: version.s3_key, upload_key: version.upload_key, filename: version.filename,
            content_type: version.content_type, file_size: version.file_size, ready_at: version.ready_at)
          if !current_user.staff? && file.review_status == "needs_review"
            notify_after_commit { NotificationDeliveryService.cohort_file_review_requested(file, actor: current_user, new_version: true) }
          end
        end
        ActiveRecord.after_all_transactions_commit { delete_staging_upload(version) }
        render json: { file: file.file_json(can_manage: true), version: version.version_json(current: true) }
      rescue WritePaused
        abandon_paused_upload(file, version_id: params[:version_id])
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
        keys = current_user.staff? ? %i[title description folder visibility external_url auto_copy_to_students] : %i[title description folder external_url]
        changes = params.slice(*keys).permit(*keys).to_h.compact
        if changes.key?("auto_copy_to_students")
          auto_copy = ActiveModel::Type::Boolean.new.cast(changes["auto_copy_to_students"])
          return render json: { errors: [ "auto_copy_to_students must be true or false" ] }, status: :unprocessable_entity if auto_copy.nil?

          changes["auto_copy_to_students"] = auto_copy
        end
        raw_title = changes["title"]
        if raw_title.to_s.include?("\0")
          return render json: { errors: [ "Title cannot contain null characters" ] }, status: :unprocessable_entity
        end
        title = raw_title.to_s.squish
        if file.doc? && title.present? && title != file.title
          # Renaming a doc is a doc save: versioned, conflict-checked and kept in history.
          with_doc_lock(file) do
            return render_doc_conflict(file) unless doc_version_matches?(file)

            file.assign_attributes(changes.except("title"))
            file.save_doc!(content: file.doc_content, title: raw_title, editor: current_user, archive: true)
          end
        else
          file.update!(changes)
        end
        # Turning auto-copy on reaches everyone already enrolled; anyone who
        # enrolls later is copied by Enrollment#copy_auto_copy_files.
        auto_copied = auto_copy_started?(file) ? CohortFileCopy.auto_copy_new_items([ file ], actor: current_user) : 0
        render json: { file: viewer_file_json(file), auto_copied_count: auto_copied }
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
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
          # The file and its versions go in one transaction that also queues
          # every stored key; storage is cleaned after commit (see CohortFile).
          file.destroy!
        end
        head :no_content
      end

      # Copies a shared class file, link or Learn Doc into every active
      # student's folder. Students who already have a copy are skipped, so
      # re-running reaches only new ones. Each recipient's enrollment is
      # locked and rechecked before their copy is made, so a student paused,
      # dropped or expired meanwhile is skipped. Links and docs need no storage.
      def copy_to_students
        source = @cohort.cohort_files.find(params[:id])
        unless source.class_file? && source.ready?
          render json: { error: "Only class files, links and docs can be copied to student folders" }, status: :unprocessable_entity
          return
        end
        if source.staff_only?
          render json: { error: "Share this with students before copying it to their folders" }, status: :unprocessable_entity
          return
        end
        return storage_unavailable if source.stored_file? && !S3Service.configured?

        result = CohortFileCopy.to_active_students(source, actor: current_user, folder: params[:folder])
        render json: { copied_count: result.copies.size, skipped_count: result.skipped, files: result.copies.map { |file| file.file_json(can_manage: true) } }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # A Learn Doc's Markdown for this viewer: for a paused learner, the
      # newest state saved before the pause (read-only).
      def doc
        with_read_snapshot do
          file, = readable_target(allow_version: false)
          return if performed?
          return not_a_doc unless file.doc?

          state = doc_state_for(file)
          return render_forbidden("This doc was not available before your pause") unless state

          response.headers["Cache-Control"] = "no-store"
          render json: doc_json(file, state)
        end
      end

      # Saves a doc. `base_doc_version` is the `doc_version` the editor
      # loaded; when it is missing or the doc was saved since, nothing is
      # saved and 409 returns the latest state. Learners who can't rename the
      # doc (a copy staff put in their folder) keep its title.
      def update_doc
        file = doc_write_target
        return if performed?
        unless params[:doc_content].is_a?(String)
          render json: { error: "doc_content must be text" }, status: :unprocessable_entity
          return
        end

        with_doc_lock(file) do
          raise NotEditable unless can_edit_doc?(file)
          return render_doc_conflict(file) unless doc_version_matches?(file)

          file.save_doc!(content: params[:doc_content], editor: current_user, title: title_editable?(file) ? params[:title] : nil,
            summary: params[:summary], checkpoint: ActiveModel::Type::Boolean.new.cast(params[:save_revision]) || false)
        end
        render json: doc_json(file, file.current_doc_state)
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue NotEditable
        render_forbidden("You can't edit this doc")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # Saved states of a doc, newest first (up to 100). Paused learners see
      # only states saved before their pause.
      def revisions
        with_read_snapshot do
          file, = readable_target(allow_version: false)
          return if performed?
          return not_a_doc unless file.doc?

          list = visible_revisions(file).includes(:edited_by).order(revision_number: :desc).limit(100)
          render json: { revisions: list.map(&:revision_json) }
        end
      end

      def revision
        with_read_snapshot do
          file, = readable_target(allow_version: false)
          return if performed?
          return not_a_doc unless file.doc?

          response.headers["Cache-Control"] = "no-store"
          render json: { revision: visible_revisions(file).includes(:edited_by).find(params[:revision_id]).revision_json(include_content: true) }
        end
      end

      # Makes an earlier revision the current doc, recorded as a new revision.
      # The state it replaces is always kept as a revision first, so no saved
      # draft is lost. Same permissions, locks and `base_doc_version` check as
      # saving; a learner who can't rename the doc gets the content only.
      def restore_revision
        file = doc_write_target
        return if performed?

        with_doc_lock(file) do
          raise NotEditable unless can_edit_doc?(file)
          revision = file.doc_revisions.find(params[:revision_id])
          return render_doc_conflict(file) unless doc_version_matches?(file)

          file.save_doc!(content: revision.content, title: title_editable?(file) ? revision.title : nil, editor: current_user,
            summary: "Restored revision #{revision.revision_number}", checkpoint: true, archive: true)
        end
        render json: doc_json(file, file.current_doc_state)
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue NotEditable
        render_forbidden("You can't edit this doc")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # An active student sends an item in their own folder for review (or
      # withdraws it); staff mark any student-folder item reviewed, needing
      # review or neither.
      def review
        status = params[:review_status].to_s
        unless CohortFile::REVIEW_STATUSES.include?(status)
          render json: { error: "review_status must be none, needs_review or reviewed" }, status: :unprocessable_entity
          return
        end
        file = feedback_target
        return if performed?
        return render_forbidden("Only your instructors can mark a file reviewed") if status == "reviewed" && !current_user.staff?

        with_feedback_lock(file) do
          changed = file.review_status != status
          reviewed = status == "reviewed"
          file.update!(review_status: status, reviewed_by: reviewed ? current_user : nil, reviewed_at: reviewed ? Time.current : nil)
          if changed && status == "needs_review" && !current_user.staff?
            notify_after_commit { NotificationDeliveryService.cohort_file_review_requested(file, actor: current_user) }
          elsif changed && reviewed
            notify_after_commit { NotificationDeliveryService.cohort_file_reviewed(file, actor: current_user) }
          end
        end
        render json: { file: viewer_file_json(file) }
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue NotFeedbackTarget
        no_review_thread
      end

      # The review thread on a student-folder item, oldest first. Paused
      # learners see only comments written before their pause.
      def comments
        with_read_snapshot do
          file, = readable_target(allow_version: false)
          return if performed?
          return no_review_thread unless file.student_folder_item?

          can_write = can_comment?(file)
          list = visible_comments(file).includes(:user).order(:created_at, :id)
          render json: { comments: list.map { |comment| comment.comment_json(viewer: current_user, can_write: can_write) }, can_comment: can_write }
        end
      end

      def create_comment
        file = feedback_target
        return if performed?
        unless params[:body].is_a?(String)
          render json: { error: "body must be text" }, status: :unprocessable_entity
          return
        end

        comment = nil
        with_feedback_lock(file) do
          comment = file.comments.create!(user: current_user, body: params[:body])
          notify_after_commit { NotificationDeliveryService.cohort_file_commented(comment) }
        end
        render json: { comment: comment.comment_json(viewer: current_user, can_write: true) }, status: :created
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue NotFeedbackTarget
        no_review_thread
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # Authors remove their own comments; staff remove any.
      def destroy_comment
        file = feedback_target
        return if performed?

        with_feedback_lock(file) do
          comment = file.comments.lock.find(params[:comment_id])
          return render_forbidden("You can only remove your own comments") unless current_user.staff? || comment.user_id == current_user.id

          comment.destroy!
        end
        head :no_content
      rescue WritePaused
        render_forbidden("Changes to your folder are paused")
      rescue NotFeedbackTarget
        no_review_thread
      end

      # Brings in the curriculum's ready template files this cohort doesn't
      # have yet (all of them were copied when the cohort was created), then
      # copies new auto-copy items to every active learner. Uploads need storage
      # and are skipped without it.
      def import_curriculum
        result = CohortFileImport.from_curriculum(@cohort, actor: current_user)
        render json: import_json(result)
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Copies another cohort's ready class items (never its student folders)
      # into this one. Staff need access to both cohorts.
      def copy_from_cohort
        source = Cohort.find_by(id: params[:source_cohort_id])
        return render json: { error: "Choose the cohort to copy from" }, status: :unprocessable_entity unless source
        return render json: { error: "Choose a different cohort to copy from" }, status: :unprocessable_entity if source.id == @cohort.id
        return render_forbidden("Cannot access that cohort") unless current_user.can_access_cohort?(source)

        result = CohortFileImport.from_cohort(@cohort, source, actor: current_user)
        render json: import_json(result, count_key: :copied_count)
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # A folder as one ZIP. Learners download only their own folder
      # (`scope=my_files`), as they can read it now: a paused learner gets
      # what was there before the pause. Staff download the class files
      # (`scope=class`) or one student's folder (`scope=student&student_id=`).
      # `folder` narrows any of them to one folder.
      def export_zip
        scope = params[:scope].to_s
        return render json: { error: "scope must be my_files, class or student" }, status: :unprocessable_entity unless EXPORT_SCOPES.include?(scope)

        entries = current_user.staff? ? staff_export_entries(scope) : learner_export_entries(scope)
        return if performed?

        body = CohortFileExport.new(entries).build!
        response.headers["Content-Type"] = "application/zip"
        response.headers["Content-Disposition"] = %(attachment; filename="#{export_filename(scope)}")
        response.headers["Content-Length"] = body.size.to_s
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        self.status = :ok
        self.response_body = body
      rescue CohortFileExport::Problem => error
        render json: { error: error.message }, status: error.status
      rescue Aws::S3::Errors::ServiceError, Seahorse::Client::NetworkingError => error
        storage_error(error)
      end

      private

      def import_json(result, count_key: :imported_count)
        {
          count_key => result.files.size, skipped_count: result.skipped, failed_count: result.failed, auto_copied_count: result.auto_copied,
          files: result.files.map { |file| file.file_json(can_manage: true, can_edit_doc: true) }
        }
      end

      def auto_copy_started?(file)
        file.auto_copy_to_students? && file.saved_change_to_auto_copy_to_students?
      end

      def staff_export_entries(scope)
        files = case scope
        when "class" then @cohort.cohort_files.class_files
        when "student"
          @export_student = @cohort.enrollments.includes(:user).find_by(user_id: params[:student_id].presence&.to_i)&.user
          return render json: { error: "That student is not enrolled in this cohort" }, status: :unprocessable_entity unless @export_student

          @cohort.cohort_files.where(student_id: @export_student.id)
        else
          return render json: { error: "Staff download the class files or a student's folder" }, status: :unprocessable_entity
        end
        bounded(export_scope(files).includes(:doc_updated_by)).map { |file| CohortFileExport.entry_for(file) }
      end

      # The learner's own folder as they can read it, in one snapshot with
      # their enrollment (the same rules as `index`).
      def learner_export_entries(scope)
        return render_forbidden("You can only download your own folder") unless scope == "my_files"

        entries = nil
        with_read_snapshot do
          files = export_scope(@cohort.cohort_files.student_visible.where(student_id: current_user.id).where.not(shared_at: nil))
          files = paused_readable_scope(files).includes(:versions) if @enrollment.paused?
          entries = bounded(files).filter_map do |file|
            shown = @enrollment.file_version_for_read(file)
            next unless shown

            doc_state = @enrollment.doc_state_for_read(file) if file.doc?
            CohortFileExport.entry_for(file, shown: shown, doc_state: doc_state) unless file.doc? && doc_state.nil?
          end
        end
        entries
      end

      # Mirrors Enrollment#file_version_for_read and #doc_state_for_read in SQL
      # so items added after a pause never count toward the 100-item export cap.
      def paused_readable_scope(files)
        cutoff = @enrollment.paused_at || @enrollment.read_cutoff_at
        return files.none unless cutoff

        files
          .where("cohort_files.shared_at <= :cutoff AND cohort_files.created_at <= :cutoff", cutoff: cutoff)
          .where(
            "(COALESCE(cohort_files.ready_at, cohort_files.updated_at) <= :cutoff OR " \
            "EXISTS (SELECT 1 FROM cohort_file_versions v WHERE v.cohort_file_id = cohort_files.id AND v.ready = TRUE AND COALESCE(v.ready_at, v.created_at) <= :cutoff))",
            cutoff: cutoff
          )
          .where(
            "(cohort_files.kind <> 'doc' OR COALESCE(cohort_files.doc_updated_at, cohort_files.created_at) <= :cutoff OR " \
            "EXISTS (SELECT 1 FROM cohort_doc_revisions r WHERE r.cohort_file_id = cohort_files.id AND r.created_at <= :cutoff))",
            cutoff: cutoff
          )
      end

      # At most one row past the export limit is loaded; more refuses the export.
      def bounded(files)
        rows = files.limit(CohortFileExport::MAX_ITEMS + 1).to_a
        CohortFileExport.too_many! if rows.size > CohortFileExport::MAX_ITEMS
        rows
      end

      def export_scope(files)
        files = files.ready.order(:folder, :title, :id)
        folder = params[:folder].to_s.squish
        folder.present? ? files.where(folder: folder) : files
      end

      # ASCII only, so the header needs no encoding.
      def export_filename(scope)
        owner = scope == "student" ? @export_student.full_name : scope == "class" ? "class files" : "my files"
        name = [ @cohort.name, owner, params[:folder].to_s.squish.presence ].compact.join(" ").parameterize
        "#{name.presence&.first(120) || 'files'}.zip"
      end

      # A learner's files, read in one snapshot with their enrollment.
      def learner_index
        scope = @cohort.cohort_files.ready.student_visible.includes(:uploaded_by, :reviewed_by, :doc_updated_by)
          .where(student_id: [ nil, current_user.id ]).order(:folder, :title, :id)
        scope = scope.includes(:versions) if @enrollment.paused?
        shown = scope.to_h { |file| [ file, @enrollment.file_version_for_read(file) ] }.compact
        doc_states = shown.keys.select(&:doc?).index_with { |file| @enrollment.doc_state_for_read(file) }
        shown.reject! { |file, _| file.doc? && doc_states[file].nil? }
        files = shown.keys
        counts = comment_counts(files)
        class_files, my_files = files.partition(&:class_file?)
        {
          class_files: class_files.map { |file| file.file_json(shown: shown.fetch(file), doc_state: doc_states[file]) },
          my_files: my_files.map do |file|
            file.file_json(can_manage: student_manages?(file), shown: shown.fetch(file), doc_state: doc_states[file],
              comment_count: counts.fetch(file.id, 0), can_edit_doc: can_edit_doc?(file), review_cutoff: @enrollment.file_read_cutoff)
          end,
          folders: files.map(&:folder).uniq.sort,
          storage_configured: S3Service.configured?,
          can_upload_personal: student_can_write?
        }
      end

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

      # A doc is saved and published in one step and needs no storage. A
      # student's enrollment is locked first, as for every learner write.
      def create_doc
        student_id = upload_student_id
        return if performed?
        unless params[:doc_content].nil? || params[:doc_content].is_a?(String)
          render json: { error: "doc_content must be text" }, status: :unprocessable_entity
          return
        end

        now = Time.current
        file = @cohort.cohort_files.new(
          kind: "doc", student_id: student_id, uploaded_by: current_user,
          title: params[:title].presence || "Untitled doc", description: params[:description], folder: params[:folder],
          visibility: current_user.staff? ? params[:visibility].presence || "students" : "students",
          doc_content: params[:doc_content].to_s, doc_updated_at: now, doc_updated_by: current_user, ready: true
        )
        CohortFile.transaction do
          lock_writer_enrollment! unless current_user.staff?
          file.save!
        end
        render json: { file: viewer_file_json(file) }, status: :created
      rescue WritePaused
        render_forbidden("Uploads to your folder are paused")
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # The site's host, cut to the title limit (a host can be 253 characters).
      def link_title(url)
        URI.parse(url).hostname.to_s.delete_prefix("www.")[0, 160].presence
      rescue URI::InvalidURIError
        nil
      end

      # The file this viewer may read and the version to serve, with the
      # link expiry. Renders 403 (and returns nil) when a paused learner asks
      # for something published after the pause or access has run out.
      def readable_target(allow_version: true)
        file = readable_files.ready.find(params[:id])
        expiry = CohortFile::DOWNLOAD_EXPIRY
        return [ file, (allow_version && requested_version(file)) || file, expiry ] if current_user.staff?

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

      # One transaction for a publish. A student's enrollment is locked
      # first, then the file (the order cohort deletion takes them), so a pause
      # waits for an in-flight publish; a paused, ended or deleted enrollment
      # raises WritePaused. Staff are not limited by enrollment.
      def with_writer_lock(file)
        CohortFile.transaction do
          lock_writer_enrollment! unless current_user.staff?
          file.lock!
          yield
        end
      end

      # A doc write locks, in order: the writer's enrollment (a learner), the
      # enrollments of everyone who can read the doc or be paused into
      # reading it (CohortFile#reader_enrollments), then the doc. A pause
      # locks the enrollment before it stamps paused_at
      # (EnrollmentsController#update), so it lands wholly before or after
      # the save, and the pause snapshot rule in CohortFile#save_doc! always sees it.
      def with_doc_lock(file)
        CohortFile.transaction do
          lock_writer_enrollment! unless current_user.staff?
          file.reader_enrollments.order(:id).lock.pluck(:id)
          file.lock!
          yield
        end
      end

      # Review changes and comments lock the student's enrollment, then the
      # file: a learner's own (which must be active), or for staff the folder
      # owner's whatever its status, so feedback times line up with a
      # concurrent pause. With both held, the item must still be a
      # student-visible student-folder item (a learner's own) and the learner
      # still active, deadline included.
      def with_feedback_lock(file)
        CohortFile.transaction do
          if current_user.staff?
            file.reader_enrollments.order(:id).lock.pluck(:id) if file.student_id
          else
            lock_writer_enrollment!
          end
          file.lock!
          raise NotFeedbackTarget unless file.student_folder_item? && (current_user.staff? || file.student_id == current_user.id)
          raise WritePaused unless current_user.staff? || @enrollment.active?

          yield
        end
      end

      # Learner reads run in one REPEATABLE READ snapshot that re-reads the
      # enrollment first, so a pause committing mid-request can't pair an
      # active enrollment with content saved after the pause. Transactional
      # tests already hold an outer transaction, whose isolation is fixed.
      def with_read_snapshot
        return yield if current_user.staff?

        CohortFile.transaction do
          connection = CohortFile.connection
          connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") if connection.open_transactions == 1
          @enrollment = current_user.enrollments.with_read_access.find_by(id: @enrollment.id)
          next render_forbidden("Not enrolled in this cohort") unless @enrollment

          yield
        end
      end

      def lock_writer_enrollment!
        @enrollment.lock!
        raise WritePaused unless @enrollment.active?
      rescue ActiveRecord::RecordNotFound
        raise WritePaused
      end

      # Rechecks the locked enrollment as the publish commits.
      def writer_still_active?
        current_user.staff? || @enrollment.reload.active?
      rescue ActiveRecord::RecordNotFound
        false
      end

      # The publish rolled back. Under the same locks a publish takes, abandon
      # the pending upload or version, unless a concurrent publish already made
      # it ready; its destroy cleans the staging and copied objects after commit.
      def abandon_paused_upload(file, version_id: nil)
        begin
          file.with_lock do
            record = version_id ? file.versions.lock.find_by(id: version_id) : file
            record.destroy! if record && !record.ready?
          end
        rescue ActiveRecord::RecordNotFound
          # Already deleted; nothing left to abandon.
        end
        render_forbidden("Uploads to your folder are paused")
      end

      # Archives the original upload as version 1 when its second version publishes.
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

      def no_stored_file(file)
        render json: { error: file.doc? ? "Learn Docs open in the app" : "Links open on their own site" }, status: :unprocessable_entity
      end

      def not_a_doc
        render json: { error: "Only Learn Docs have this" }, status: :unprocessable_entity
      end

      def no_review_thread
        render json: { error: "Only files in a student's folder have reviews and comments" }, status: :unprocessable_entity
      end

      # This file as the current viewer sees it right now.
      def viewer_file_json(file, doc_state = nil)
        file.file_json(can_manage: current_user.staff? || student_manages?(file), doc_state: doc_state,
          comment_count: file.student_folder_item? ? visible_comments(file).count : 0, can_edit_doc: can_edit_doc?(file),
          review_cutoff: (@enrollment&.file_read_cutoff unless current_user.staff?))
      end

      def doc_json(file, state)
        {
          file: viewer_file_json(file, state), doc_content: state.content, doc_version: state.version, doc_updated_at: state.updated_at.iso8601(6),
          doc_updated_by_name: state.updated_by_name, can_edit_doc: can_edit_doc?(file), revision_count: visible_revisions(file).count
        }
      end

      def render_doc_conflict(file)
        render json: { error: "This document was updated by someone else. Load the latest version before saving." }
          .merge(doc_json(file, file.current_doc_state)), status: :conflict
      end

      def doc_state_for(file)
        current_user.staff? ? file.current_doc_state : @enrollment.doc_state_for_read(file)
      end

      # Staff edit every doc in the cohort; an active student edits the docs in
      # their own folder, including copies staff put there.
      def can_edit_doc?(file)
        return false unless file.doc?

        current_user.staff? || (student_can_write? && file.student_id == current_user.id && !file.staff_only?)
      end

      def can_comment?(file)
        file.student_folder_item? && (current_user.staff? || (student_can_write? && file.student_id == current_user.id))
      end

      # The doc a save or restore targets, or renders 403/404/422.
      def doc_write_target
        file = current_user.staff? ? @cohort.cohort_files.ready.find(params[:id]) : readable_files.ready.find(params[:id])
        return not_a_doc unless file.doc?
        return render_forbidden("Changes to your folder are paused") unless current_user.staff? || student_can_write?
        return render_forbidden("You can only edit docs in your own folder") unless can_edit_doc?(file)

        file
      end

      # The student-folder item a review change or comment targets, or renders 403/404/422.
      def feedback_target
        file = current_user.staff? ? @cohort.cohort_files.ready.find(params[:id]) : readable_files.ready.find(params[:id])
        return no_review_thread unless file.student_folder_item?
        return file if current_user.staff?
        return render_forbidden("Changes to your folder are paused") unless student_can_write?
        return render_forbidden("You can only do this in your own folder") unless file.student_id == current_user.id

        file
      end

      # Whether the edit was based on the doc's current version. A missing
      # `base_doc_version` never matches, so every save says what it saw.
      def doc_version_matches?(file)
        base = params[:base_doc_version]
        (base.is_a?(Integer) || base.to_s.match?(/\A\d+\z/)) && base.to_i == file.doc_version
      end

      # Staff, and learners on docs they made, may rename a doc; a copy staff
      # put in a learner's folder keeps its title.
      def title_editable?(file)
        current_user.staff? || student_manages?(file)
      end

      def visible_revisions(file)
        cutoff = @enrollment&.file_read_cutoff unless current_user.staff?
        cutoff ? file.doc_revisions.where(created_at: ..cutoff) : file.doc_revisions
      end

      def visible_comments(file)
        cutoff = @enrollment&.file_read_cutoff unless current_user.staff?
        cutoff ? file.comments.where(created_at: ..cutoff) : file.comments
      end

      def comment_counts(files)
        ids = files.select(&:student_folder_item?).map(&:id)
        return {} if ids.empty?

        cutoff = @enrollment&.file_read_cutoff unless current_user.staff?
        scope = CohortFileComment.where(cohort_file_id: ids)
        scope = scope.where(created_at: ..cutoff) if cutoff
        scope.group(:cohort_file_id).count
      end

      # Notifications go out once the write commits and never undo it.
      def notify_after_commit(&delivery)
        ActiveRecord.after_all_transactions_commit do
          delivery.call
        rescue StandardError => error
          Rails.logger.error("[CohortFiles] notification_failed #{error.class}")
        end
      end

      def staff_index
        class_files = @cohort.cohort_files.class_files.ready.includes(:uploaded_by, :doc_updated_by).order(:folder, :title, :id).to_a
        enrollments = @cohort.enrollments.where(status: FOLDER_STATUSES).includes(:user).to_a
          .sort_by { |enrollment| [ enrollment.user.full_name.downcase, enrollment.id ] }
        student_files = @cohort.cohort_files.ready.where(student_id: enrollments.map(&:user_id))
          .includes(:uploaded_by, :reviewed_by, :doc_updated_by).order(:folder, :title, :id).group_by(&:student_id)
        counts = comment_counts(student_files.values.flatten)
        staff_json = ->(file) { file.file_json(can_manage: true, comment_count: counts.fetch(file.id, 0), can_edit_doc: true) }
        {
          class_files: class_files.map(&staff_json),
          student_folders: enrollments.map do |enrollment|
            files = student_files.fetch(enrollment.user_id, [])
            {
              student_id: enrollment.user_id, enrollment_id: enrollment.id,
              student_name: enrollment.user.full_name, student_email: enrollment.user.email,
              enrollment_status: enrollment.paused? || enrollment.active? ? enrollment.status : "expired",
              file_count: files.size, needs_review_count: files.count { |file| file.student_folder_item? && file.review_status == "needs_review" },
              files: files.map(&staff_json)
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
