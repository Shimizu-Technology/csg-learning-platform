require "digest"

# Each request and its durable receipt commit together. The request lock is
# scoped to the actor, so simultaneous retries cannot insert duplicate trees.
class AuthoringCloneService
  class Invalid < StandardError; end
  class Conflict < StandardError; end
  Result = Data.define(:record, :replayed)

  def initialize(user:, kind:, source_id:, attributes:)
    @user, @kind, @source_id = user, kind, source_id.to_i
    @attributes = attributes.to_h.stringify_keys
  end

  def call
    request_id = @attributes["client_request_id"].to_s
    raise Invalid, "client_request_id must be 8–64 letters, digits, hyphens or underscores" unless request_id.match?(/\A[a-zA-Z0-9_-]{8,64}\z/)

    fingerprint = Digest::SHA256.hexdigest([ @kind, @source_id, @attributes.sort ].to_json)
    ApplicationRecord.transaction do
      connection = ApplicationRecord.connection
      connection.execute("SET LOCAL lock_timeout = '5s'")
      connection.execute("SET LOCAL statement_timeout = '30s'")
      connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(#{connection.quote("authoring-clone:#{@user.id}:#{request_id}")}, 0))")
      if (receipt = AuthoringClone.find_by(user: @user, client_request_id: request_id))
        raise Conflict, "This request ID was already used with different clone options" unless receipt.fingerprint == fingerprint

        model = { "Curriculum" => Curriculum, "CurriculumModule" => CurriculumModule, "Cohort" => Cohort }.fetch(receipt.record_type)
        return Result.new(record: model.find(receipt.record_id), replayed: true)
      end
      raise Invalid, "Name is required" if @attributes["name"].to_s.strip.blank?

      source = { "curriculum" => Curriculum, "module" => CurriculumModule, "cohort" => Cohort }.fetch(@kind).find(@source_id)
      curriculum_id = @kind == "curriculum" ? source.id : source.curriculum_id
      destination_id = @kind == "module" ? integer!("curriculum_id") : curriculum_id
      # Storage locks precede row locks, as in LessonDuplicate. One SQL call
      # locks all distinct keys; object checks are storage requests, not SQL.
      keys = video_keys(curriculum_id)
      if keys.any? && S3Service.configured?
        sql = ApplicationRecord.sanitize_sql_array([
          "SELECT pg_advisory_xact_lock(hashtextextended(key, 0)) FROM unnest(ARRAY[?]::text[]) AS keys(key) ORDER BY key", keys
        ])
        connection.execute(sql)
        keys.each do |key|
          raise Invalid, "A hosted video could not be verified in storage" unless S3ObjectCleanup.managed_key?(key) && S3Service.object_exists?(key)
        end
      end
      [ curriculum_id, destination_id ].uniq.sort.each { |id| Curriculum.lock_for_content!(id, "FOR UPDATE") }
      raise Conflict, "Content changed during the clone. Try again." unless (video_keys(curriculum_id) - keys).empty?

      source.reload
      raise Conflict, "The source moved to another curriculum. Reload and try again." if @kind != "curriculum" && source.curriculum_id != curriculum_id

      record = case @kind
      when "curriculum"
        AuthoringContentClone.new(source: source, name: @attributes["name"].strip).call
      when "module"
        destination = Curriculum.find(destination_id)
        position = integer!("position")
        position_modules!(destination, position)
        AuthoringContentClone.new(source: source.curriculum, name: @attributes["name"].strip, module_id: source.id, destination: destination, position: position).call
      when "cohort"
        # Also blocks child-config FK inserts while its shape is copied.
        source.lock!("FOR UPDATE")
        clone_cohort(source)
      end
      AuthoringClone.create!(user: @user, client_request_id: request_id, fingerprint: fingerprint, record_type: record.class.name, record_id: record.id)
      Result.new(record: record, replayed: false)
    end
  rescue ActiveRecord::LockWaitTimeout, ActiveRecord::QueryCanceled, ActiveRecord::Deadlocked
    raise Conflict, "Someone is saving changes. Nothing was cloned. Try again."
  end

  private

  # Existing positions can have gaps or ties. Treat the requested position as
  # an outline index and normalize the remaining modules in one UPDATE.
  def position_modules!(destination, position)
    ids = destination.modules.reorder(:position, :id).pluck(:id)
    raise Invalid, "Position must be between 0 and the number of modules" unless position.between?(0, ids.size)
    return if ids.empty?

    positions = ids.each_index.map { |index| index >= position ? index + 1 : index }
    connection = ApplicationRecord.connection
    connection.update("UPDATE modules SET position = ordering.position, updated_at = #{connection.quote(Time.current)} " \
      "FROM unnest(ARRAY[#{ids.join(',')}]::bigint[], ARRAY[#{positions.join(',')}]::integer[]) AS ordering(id, position) WHERE modules.id = ordering.id")
  end

  def integer!(key)
    value = Integer(@attributes[key].to_s, 10, exception: false)
    raise Invalid, "#{key.humanize} must be an integer" unless value

    value
  end

  def video_keys(curriculum_id)
    ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: curriculum_id })
      .where.not(s3_video_key: [ nil, "" ]).distinct.order(:s3_video_key).pluck(:s3_video_key)
  end

  def clone_cohort(source)
    start_date = Date.iso8601(@attributes["start_date"].to_s)
    raise Invalid, "Choose a future start date" unless start_date > LearningCalendar.today
    raise Invalid, "clone_curriculum must be true or false" unless [ true, false ].include?(@attributes["clone_curriculum"])

    days = (start_date - source.start_date).to_i
    tree = if @attributes["clone_curriculum"]
      AuthoringContentClone.new(source: source.curriculum, name: "#{@attributes['name'].strip} curriculum")
    end
    curriculum = tree ? tree.call : source.curriculum
    map = tree&.module_map || {}
    settings = source.settings.deep_dup
    # Class recordings and class-resource history belong to the old cohort.
    settings.except!("recordings", "class_resources", "announcements")
    settings["module_github_config"] = remap_keys(settings["module_github_config"], map) if settings["module_github_config"].is_a?(Hash)
    defaults = remap_keys(source.content_defaults, map)
    defaults&.each_value do |value|
      value["unlock_date_override"] = (Date.iso8601(value["unlock_date_override"]) + days).iso8601 if value["unlock_date_override"].present?
    end
    attributes = source.attributes.except("id", "created_at", "updated_at", "public_slug")
      .merge("name" => @attributes["name"].strip, "start_date" => start_date, "status" => "upcoming",
        "curriculum_id" => curriculum.id, "settings" => settings, "content_defaults" => defaults, "public_checkout_enabled" => false)
    %w[end_date guided_access_ends_on guided_support_ends_on].each { |key| attributes[key] = source[key] && source[key] + days }
    cohort = Cohort.create!(attributes)
    [ CohortModuleSchedule, CohortModuleSubmissionWindow, OfficeHour, PrivateMeetingConfig ].each do |model|
      rows = model.where(cohort_id: source.id).order(:id).map do |record|
        row = record.attributes.except("id").merge("cohort_id" => cohort.id, "created_at" => Time.current, "updated_at" => Time.current)
        row["module_id"] = map.fetch(row["module_id"], row["module_id"]) if row.key?("module_id")
        row["start_date"] += days if row["start_date"]
        %w[starts_at ends_at submissions_close_at].each { |key| row[key] = shift_time(row[key], days, row["timezone"]) if row[key] }
        row
      end
      rows.each_slice(500) { |batch| model.insert_all!(batch) }
    end
    cohort
  rescue Date::Error
    raise Invalid, "Choose a valid start date"
  end

  def remap_keys(value, map)
    value&.deep_dup&.to_h { |key, item| [ map.fetch(key.to_i, key).to_s, item ] }
  end

  # Preserve local wall time across a daylight-saving boundary.
  def shift_time(value, days, timezone)
    value.in_time_zone(timezone.presence || Rails.application.config.x.school.time_zone).advance(days: days)
  end
end
