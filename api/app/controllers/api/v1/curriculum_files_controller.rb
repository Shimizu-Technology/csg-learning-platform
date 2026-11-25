module Api
  module V1
    # Template files on a curriculum (see CurriculumFile). Admins add and edit
    # them on draft and active curricula; instructors teaching a cohort on the
    # curriculum can read, preview and download them. Uploads use the same
    # two-phase S3 flow and checks as cohort files. Learners never read
    # templates directly: their cohort's class copies are what they see.
    #
    # Writes hold the curriculum FOR SHARE (lock order level 1, see
    # Curriculum.lock_for_content!) before the template row, so archiving or
    # deleting the curriculum waits for them.
    class CurriculumFilesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_curriculum
      before_action :authorize_curriculum!
      before_action :require_admin!, except: %i[index doc download preview]
      before_action :require_editable_curriculum!, except: %i[index doc download preview]

      # Under the locks, the curriculum turned out to be archived or gone.
      class NotEditable < StandardError; end

      def index
        files = @curriculum.curriculum_files.ready.includes(:uploaded_by, :doc_updated_by).order(:folder, :title, :id).to_a
        render json: {
          files: files.map { |file| file.template_json(can_manage: can_manage?) },
          folders: files.map(&:folder).uniq.sort,
          storage_configured: S3Service.configured?,
          can_manage: can_manage?
        }
      end

      # Starts an upload: a presigned POST into a staging key.
      def create
        return storage_unavailable unless S3Service.configured?
        unless params[:file_size].is_a?(Integer)
          render json: { error: "file_size must be a whole byte count" }, status: :unprocessable_entity
          return
        end
        filename = CohortFile.sanitize_filename(params[:filename])
        content_type = CohortFile.normalized_content_type(filename, params[:content_type]) if filename
        unless content_type
          render json: { error: "This file type can't be uploaded. Use a PDF, Office document, spreadsheet, slide deck, text, ZIP, image, audio or MP4 file." },
            status: :unprocessable_entity
          return
        end
        CurriculumFile.purge_expired_pending!(@curriculum.curriculum_files)

        token = SecureRandom.uuid
        file = @curriculum.curriculum_files.new(template_attributes.merge(
          kind: "file", uploaded_by: current_user,
          title: params[:title].presence || File.basename(filename, File.extname(filename)),
          filename: filename, content_type: content_type, file_size: params[:file_size],
          s3_key: "curriculum_files/curriculum_#{@curriculum.id}/#{token}/#{filename}",
          upload_key: "curriculum_file_uploads/curriculum_#{@curriculum.id}/#{token}/#{filename}",
          upload_expires_at: Time.current + S3Service::PRESIGN_EXPIRY
        ))
        with_content_lock { file.save! }
        post = S3Service.generate_presigned_post(file.upload_key, file.content_type, max_size: file.file_size)
        render json: { file: file.template_json(can_manage: true), upload_url: post.url, fields: post.fields }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue NotEditable
        not_editable
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # Checks the staged object (declared size and type, then its first bytes,
      # bound to the HEAD etag) and copies it to the published key. The copy
      # runs with no transaction open; publishing then rechecks the row under
      # the locks. If the upload was abandoned meanwhile, the copy is removed.
      def complete
        return storage_unavailable unless S3Service.configured?

        file = @curriculum.curriculum_files.find(params[:id])
        return render json: { file: file.template_json(can_manage: true) } if file.ready?
        return render json: { error: "Upload expired; start a new upload" }, status: :unprocessable_entity if file.upload_expires_at <= Time.current

        metadata = S3Service.object_metadata(file.upload_key)
        unless metadata && metadata[:content_type] == file.content_type && metadata[:content_length] == file.file_size
          render json: { error: "Uploaded file is missing or does not match its declared size and type" }, status: :unprocessable_entity
          return
        end
        unless CohortFile.content_matches?(file.filename, S3Service.read_prefix(file.upload_key, if_match: metadata.fetch(:etag)))
          render json: { error: "This file's contents don't match its .#{CohortFile.extension_for(file.filename)} type. Export it again and re-upload." },
            status: :unprocessable_entity
          return
        end
        S3Service.copy_object(file.upload_key, file.s3_key, etag: metadata.fetch(:etag))
        published = begin
          with_content_lock do
            locked = CurriculumFile.lock.find_by(id: file.id)
            next nil unless locked

            locked.update!(ready: true) unless locked.ready?
            locked
          end
        rescue NotEditable
          # Archived or deleted while the copy ran. A deletion already drained
          # this upload's queued keys, so the new copy is removed here (it is
          # kept while a pending row still names it).
          S3ObjectCleanup.delete_or_enqueue(file.s3_key, reason: "curriculum_file_publish_abandoned")
          raise
        end
        unless published
          S3ObjectCleanup.delete_or_enqueue(file.s3_key, reason: "curriculum_file_publish_abandoned")
          return render json: { error: "This upload was removed; start a new upload" }, status: :not_found
        end
        delete_staging_upload(published)
        render json: { file: published.template_json(can_manage: true) }
      rescue NotEditable
        not_editable
      rescue Aws::S3::Errors::PreconditionFailed
        render json: { error: "Upload changed while confirming; try again" }, status: :unprocessable_entity
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      def create_link
        url = params[:external_url].to_s.strip
        file = @curriculum.curriculum_files.new(template_attributes.merge(
          kind: "link", uploaded_by: current_user, external_url: url, ready: true,
          title: params[:title].presence || link_title(url)
        ))
        with_content_lock { file.save! }
        render json: { file: file.template_json(can_manage: true) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue NotEditable
        not_editable
      end

      def create_doc
        unless params[:doc_content].nil? || params[:doc_content].is_a?(String)
          render json: { error: "doc_content must be text" }, status: :unprocessable_entity
          return
        end

        file = @curriculum.curriculum_files.new(template_attributes.merge(
          kind: "doc", uploaded_by: current_user, title: params[:title].presence || "Untitled doc",
          doc_content: params[:doc_content].to_s, doc_updated_at: Time.current, doc_updated_by: current_user, ready: true
        ))
        with_content_lock { file.save! }
        render json: { file: file.template_json(can_manage: true) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue NotEditable
        not_editable
      end

      # Details, sharing and auto-copy for any template; a doc's Markdown too.
      # Changing a doc's content or title needs `base_doc_version` (the
      # `doc_version` the editor loaded); a stale or missing one saves nothing
      # and returns 409 with the latest doc.
      def update
        keys = %i[title description folder visibility external_url auto_copy_to_students]
        changes = params.slice(*keys).permit(*keys).to_h.compact
        if changes.key?("auto_copy_to_students")
          changes["auto_copy_to_students"] = ActiveModel::Type::Boolean.new.cast(changes["auto_copy_to_students"])
          return render json: { errors: [ "auto_copy_to_students must be true or false" ] }, status: :unprocessable_entity if changes["auto_copy_to_students"].nil?
        end
        return render json: { errors: [ "Title cannot contain null characters" ] }, status: :unprocessable_entity if changes["title"].to_s.include?("\0")
        unless params[:doc_content].nil? || params[:doc_content].is_a?(String)
          return render json: { error: "doc_content must be text" }, status: :unprocessable_entity
        end

        file = nil
        conflict = false
        with_content_lock do
          file = @curriculum.curriculum_files.lock.find(params[:id])
          content_change = file.doc? && (!params[:doc_content].nil? || (changes["title"].present? && changes["title"].squish != file.title))
          next conflict = true if content_change && !doc_version_matches?(file)

          if content_change
            file.assign_attributes(changes.except("title"))
            file.save_doc!(content: params[:doc_content].nil? ? file.doc_content : params[:doc_content], title: changes["title"], editor: current_user)
            file.save! if file.changed?
          else
            file.update!(changes)
          end
        end
        return render json: { error: "This document was updated by someone else. Load the latest version before saving." }.merge(doc_json(file.reload)), status: :conflict if conflict

        render json: { file: file.template_json(can_manage: true) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue NotEditable
        not_editable
      end

      # `pending_only` abandons an unfinished upload and never removes a
      # published template, so a client retrying after a lost `complete` is
      # safe. Every stored key is queued in the deleting transaction and
      # removed after it commits (CurriculumFile#queue_stored_objects).
      def destroy
        with_content_lock do
          file = @curriculum.curriculum_files.lock.find(params[:id])
          if ActiveModel::Type::Boolean.new.cast(params[:pending_only]) && file.ready?
            render json: { error: "This file was already published" }, status: :unprocessable_entity
            next
          end
          file.destroy!
        end
        head :no_content unless performed?
      rescue NotEditable
        not_editable
      end

      def doc
        file = @curriculum.curriculum_files.ready.find(params[:id])
        return render json: { error: "Only Learn Docs have this" }, status: :unprocessable_entity unless file.doc?

        response.headers["Cache-Control"] = "no-store"
        render json: doc_json(file)
      end

      def download
        return storage_unavailable unless S3Service.configured?

        file = stored_template
        return if performed?

        response.headers["Cache-Control"] = "no-store"
        url = S3Service.generate_presigned_url(file.s3_key, expires_in: CohortFile::DOWNLOAD_EXPIRY,
          response_content_disposition: "attachment; filename=\"#{file.filename}\"")
        render json: { url: url, expires_in: CohortFile::DOWNLOAD_EXPIRY, filename: file.filename }
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      # The same preview modes as cohort files: an inline link for PDFs,
      # images, audio and video; text read here for Markdown, text and CSV.
      def preview
        file = stored_template
        return if performed?

        mode = file.preview_mode
        body = {
          preview_mode: mode, filename: file.filename, content_type: file.content_type, file_size: file.file_size,
          version_number: 1, version_id: nil, url: nil, expires_in: nil, text: nil, truncated: false
        }
        inline = CohortFile::INLINE_PREVIEW_MODES.include?(mode)
        text = CohortFile::TEXT_PREVIEW_MODES.include?(mode)
        return storage_unavailable if (inline || text) && !S3Service.configured?

        if inline
          body[:url] = S3Service.generate_presigned_url(file.s3_key, expires_in: CohortFile::DOWNLOAD_EXPIRY,
            response_content_disposition: "inline; filename=\"#{file.filename}\"", response_content_type: file.content_type)
          body[:expires_in] = CohortFile::DOWNLOAD_EXPIRY
        elsif text
          bytes = S3Service.read_prefix(file.s3_key, bytes: CohortFile::TEXT_PREVIEW_BYTES)
          return render json: { error: "This file is missing from storage" }, status: :not_found if bytes.nil?

          if CohortFile.content_matches?(file.filename, bytes)
            body[:truncated] = file.file_size > CohortFile::TEXT_PREVIEW_BYTES
            decoded = bytes.dup.force_encoding(Encoding::UTF_8).scrub("�")
            body[:text] = body[:truncated] ? decoded.sub(/�+\z/, "") : decoded
          else
            body[:preview_mode] = "download_only"
          end
        end
        response.headers["Cache-Control"] = "no-store"
        render json: body
      rescue Aws::S3::Errors::ServiceError => error
        storage_error(error)
      end

      private

      def set_curriculum
        @curriculum = Curriculum.find(params[:curricula_id])
      end

      # Admins, and instructors teaching a cohort on this curriculum.
      def authorize_curriculum!
        allowed = current_user.admin? || (current_user.instructor? && current_user.accessible_cohorts.exists?(curriculum_id: @curriculum.id))
        render_forbidden("No access to this curriculum's template files") unless allowed
      end

      def can_manage?
        current_user.admin? && !@curriculum.archived?
      end

      def require_editable_curriculum!
        not_editable if @curriculum.archived?
      end

      def not_editable
        render json: { error: "Archived curricula can't be changed" }, status: :unprocessable_entity
      end

      # The curriculum FOR SHARE (still there and not archived), then the block.
      def with_content_lock
        CurriculumFile.transaction do
          Curriculum.lock_for_content!(@curriculum.id)
          raise NotEditable if Curriculum.where(id: @curriculum.id, status: Curriculum.statuses.fetch("archived")).exists?

          yield
        end
      rescue ActiveRecord::RecordNotFound => error
        raise NotEditable if error.model == "Curriculum"

        raise
      end

      def template_attributes
        attributes = params.permit(:folder, :description, :visibility).to_h.symbolize_keys
        attributes[:visibility] = attributes[:visibility].presence || "students"
        attributes[:auto_copy_to_students] = ActiveModel::Type::Boolean.new.cast(params[:auto_copy_to_students]) || false
        attributes
      end

      def stored_template
        file = @curriculum.curriculum_files.ready.find(params[:id])
        return file if file.stored_file?

        render json: { error: file.doc? ? "Learn Docs open in the app" : "Links open on their own site" }, status: :unprocessable_entity
        nil
      end

      def doc_json(file)
        {
          file: file.template_json(can_manage: can_manage?), doc_content: file.doc_content.to_s, doc_version: file.doc_version,
          doc_updated_at: (file.doc_updated_at || file.created_at).iso8601(6), doc_updated_by_name: file.doc_updated_by&.full_name,
          can_edit_doc: can_manage?
        }
      end

      def doc_version_matches?(file)
        base = params[:base_doc_version]
        (base.is_a?(Integer) || base.to_s.match?(/\A\d+\z/)) && base.to_i == file.doc_version
      end

      def link_title(url)
        URI.parse(url).hostname.to_s.delete_prefix("www.")[0, 160].presence
      rescue URI::InvalidURIError
        nil
      end

      def delete_staging_upload(file)
        return if S3Service.delete_object(file.upload_key)

        Rails.logger.warn("[CurriculumFiles] staging_cleanup_failed file_id=#{file.id}")
      end

      def storage_unavailable
        render json: { error: "Course file storage is unavailable" }, status: :service_unavailable
      end

      def storage_error(error)
        Rails.logger.error("[CurriculumFiles] #{error.class}")
        render json: { error: "Course file storage could not complete the request" }, status: :bad_gateway
      end
    end
  end
end
