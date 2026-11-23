require "mail"

# Staff-scoped read-only projection of a cohort's daily lesson-release email
# configuration, upcoming scheduled releases (sharing DailyUnlockNotifications'
# assignment-aware rules), recipient eligibility breakdown, anonymous single-digest
# sample preview, cohort claim history (indexed exact-key lookups), and separate
# school-wide scheduler health without database migrations.
class CohortReleaseCommunications
  MAX_UPCOMING_DATES = 5
  MAX_RECENT_DELIVERIES = 14
  RECENT_LOOKBACK_DAYS = 45
  KEY_LOOKUP_BATCH_SIZE = 1000
  GRADE_PUBLICATION_SEPARATION_NOTE =
    "Lesson release emails announce newly unlocked lessons only. Grades and instructor feedback are published separately when an instructor saves a grade in Learn.".freeze
  CLAIM_RECORDED_NOTE =
    "Digest claim recorded for delivery; per-cohort provider delivery confirmation is not stored.".freeze

  def initialize(cohort:, now: Time.current)
    @cohort = cohort
    @now = now
    @time_zone_name = LearningCalendar.time_zone
    @zone = ActiveSupport::TimeZone[@time_zone_name] || Time.find_zone!(@time_zone_name)
    @today = LearningCalendar.today(at: @now)
    @daily_unlock_hour = ScheduledTick.daily_unlock_hour
    @school_features = FeatureSwitches.school(read_only: true)
  end

  def call
    enrollments = @cohort.enrollments.includes(:user).to_a
    recipient_buckets = classify_recipients(enrollments)
    eligible_enrollments = recipient_buckets[:eligible]
    enrollment_ids = enrollments.map(&:id)
    modules = @cohort.curriculum.modules.ordered.includes(lessons: :content_blocks).to_a
    cohort_lesson_ids = modules.flat_map { |mod| mod.lessons.map(&:id) }.uniq

    digest_rows, lesson_claim_rows = load_recent_attempt_rows(enrollment_ids, eligible_enrollments.map(&:id), cohort_lesson_ids)
    task_run = ScheduledTaskRun.find_by(name: "daily_unlocks")

    upcoming_releases, sample_preview = if daily_unlocks_apply?
      build_upcoming_and_sample(eligible_enrollments, modules, digest_rows, lesson_claim_rows)
    else
      [ [], nil ]
    end

    recent_deliveries = build_recent_deliveries(
      digest_rows: digest_rows,
      lesson_claim_rows: lesson_claim_rows,
      task_run: task_run,
      upcoming_releases: upcoming_releases
    )

    {
      generated_at: @now.iso8601,
      cohort_id: @cohort.id,
      cohort_name: @cohort.name,
      configuration: build_configuration,
      recipients: build_recipient_summary(enrollments.size, recipient_buckets),
      upcoming_releases: upcoming_releases,
      sample_preview: sample_preview,
      recent_deliveries: recent_deliveries,
      scheduler_health: build_scheduler_health(task_run)
    }
  end

  private

  def daily_unlocks_apply?
    %w[program guided].include?(@cohort.course_delivery) &&
      @cohort.learner_pace_weeks.nil? &&
      %w[active upcoming].include?(effective_cohort_status)
  end

  def effective_cohort_status
    return "active" if @cohort.status == "active" || (@cohort.upcoming? && @cohort.start_date.present? && @cohort.start_date <= @today)

    @cohort.status
  end

  def lesson_release_mode
    return "self_paced_open" if @cohort.self_paced?
    return "personal_pace_open" if @cohort.personal_pace?

    "scheduled_daily_unlock"
  end

  def time_zone_label(at = @now)
    SchoolTime.label(TZInfo::Timezone.get(@time_zone_name), at: at)
  end

  def eligibility_reason
    if @cohort.self_paced?
      "Self-paced cohorts open assigned lessons immediately, so scheduled daily unlock emails are skipped."
    elsif @cohort.personal_pace?
      "Personal-pace cohorts open lessons on each learner's own start date, so scheduled daily unlock emails are skipped."
    elsif !%w[active upcoming].include?(effective_cohort_status)
      "Completed and archived cohorts do not send scheduled daily unlock emails."
    elsif effective_cohort_status == "upcoming"
      "Scheduled daily unlock emails will start on #{@cohort.start_date.iso8601} at #{formatted_unlock_hour} #{time_zone_label(scheduled_time_on(@cohort.start_date))}."
    else
      "Active learners receive one daily email digest at #{formatted_unlock_hour} #{@time_zone_name == "Pacific/Guam" ? time_zone_label : "school time"} when lessons unlock (up to #{DailyUnlockNotifications::CATCH_UP_DAYS} school days of catch-up)."
    end
  end

  def formatted_unlock_hour
    format("%02d:00", @daily_unlock_hour)
  end

  def parsed_sender
    raw = SchoolBrand.email_sender.presence
    return { raw: nil, display_name: SchoolBrand.current.sender_name || SchoolBrand.current.product_name, address: nil } unless raw

    parsed = Mail::Address.new(raw)
    {
      raw: raw,
      display_name: parsed.display_name.presence || SchoolBrand.current.sender_name || SchoolBrand.current.product_name,
      address: parsed.address.presence
    }
  rescue Mail::Field::ParseError
    { raw: raw, display_name: SchoolBrand.current.sender_name || SchoolBrand.current.product_name, address: nil }
  end

  def build_configuration
    sender = parsed_sender
    {
      school_time_zone: @time_zone_name,
      school_time_zone_label: time_zone_label,
      daily_unlock_hour: @daily_unlock_hour,
      catch_up_days: DailyUnlockNotifications::CATCH_UP_DAYS,
      channel: "email",
      email_configured: NotificationEmailService.configured?,
      sender_identity: sender[:raw],
      sender_display_name: sender[:display_name],
      sender_address: sender[:address],
      frontend_origin: FrontendUrlResolver.resolve,
      course_delivery: @cohort.course_delivery,
      lesson_release_mode: lesson_release_mode,
      cohort_status: effective_cohort_status,
      daily_unlocks_apply: daily_unlocks_apply?,
      eligibility_reason: eligibility_reason,
      grade_publication_separation_note: GRADE_PUBLICATION_SEPARATION_NOTE
    }
  end

  def classify_recipients(enrollments)
    buckets = {
      eligible: [],
      paused: 0,
      dropped: 0,
      completed: 0,
      expired: 0,
      invite_pending: 0,
      archived_user: 0,
      missing_email: 0
    }

    enrollments.each do |enrollment|
      user = enrollment.user
      if user.nil? || user.archived?
        buckets[:archived_user] += 1
      elsif enrollment.dropped?
        buckets[:dropped] += 1
      elsif enrollment.completed?
        buckets[:completed] += 1
      elsif enrollment.paused?
        buckets[:paused] += 1
      elsif enrollment.access_expires_at.present? && enrollment.access_expires_at <= @now
        buckets[:expired] += 1
      elsif user.invite_pending?
        buckets[:invite_pending] += 1
      elsif user.email.blank?
        buckets[:missing_email] += 1
      else
        buckets[:eligible] << enrollment
      end
    end

    buckets
  end

  def build_recipient_summary(total_enrollments, buckets)
    active_ready = buckets[:eligible].size
    {
      total_enrollments: total_enrollments,
      eligible_active_count: daily_unlocks_apply? ? active_ready : 0,
      excluded: {
        paused: buckets[:paused],
        dropped: buckets[:dropped],
        completed: buckets[:completed],
        expired: buckets[:expired],
        invite_pending: buckets[:invite_pending],
        archived_user: buckets[:archived_user],
        missing_email: buckets[:missing_email],
        opted_out: 0,
        cohort_ineligible: daily_unlocks_apply? ? 0 : active_ready
      }
    }
  end

  # Exact-key indexed lookups against index_scheduled_notification_attempts_on_key
  # over a bounded recent window (RECENT_LOOKBACK_DAYS). Never scans full history.
  def load_recent_attempt_rows(enrollment_ids, eligible_enrollment_ids, cohort_lesson_ids)
    return [ [], [] ] if enrollment_ids.empty?

    recent_dates = ((@today - (RECENT_LOOKBACK_DAYS - 1))..@today).to_a
    digest_keys = enrollment_ids.flat_map { |eid| recent_dates.map { |date| DailyUnlockNotifications.digest_key(eid, date) } }
    digest_rows = fetch_attempts_by_keys(digest_keys)
    return [ digest_rows, [] ] if cohort_lesson_ids.empty?

    matched_enrollment_ids = digest_rows.filter_map { |row| parse_digest_key(row.key).first }
    lesson_lookup_ids = (matched_enrollment_ids | eligible_enrollment_ids).uniq
    return [ digest_rows, [] ] if lesson_lookup_ids.empty?

    lesson_keys = lesson_lookup_ids.flat_map { |eid| cohort_lesson_ids.map { |lid| DailyUnlockNotifications.claim_key(eid, lid) } }
    lesson_claim_rows = fetch_attempts_by_keys(lesson_keys)
    [ digest_rows, lesson_claim_rows ]
  end

  def fetch_attempts_by_keys(keys)
    return [] if keys.empty?

    rows = []
    keys.each_slice(KEY_LOOKUP_BATCH_SIZE) do |slice|
      rows.concat(ScheduledNotificationAttempt.where(key: slice).to_a)
    end
    rows
  end

  def build_upcoming_and_sample(eligible_enrollments, modules, digest_rows, lesson_claim_rows)
    modules_by_id = modules.index_by(&:id)
    lesson_order = build_lesson_order(modules)

    if eligible_enrollments.empty?
      upcoming = build_base_schedule_upcoming(modules)
      return [ upcoming, build_sample_preview(upcoming.first&.dig(:release_date), upcoming.first&.dig(:lessons)) ]
    end

    projections = LearnerProgress.for_all(eligible_enrollments, now: @now, school_features: @school_features)
    today_deliveries = if effective_cohort_status == "active"
      DailyUnlockNotifications.new.candidates_for_enrollments(
        eligible_enrollments,
        now: @now,
        school: @school_features,
        projections: projections
      )
    else
      []
    end

    today_claimed_ids = digest_rows.filter_map do |row|
      enrollment_id, date_str = parse_digest_key(row.key)
      enrollment_id if date_str == @today.iso8601
    end.to_set

    claimed_lesson_keys = lesson_claim_rows.map(&:key).to_set

    # Collect per-date deliveries: date => { enrollment_ids:, lessons_by_id:, sample_lessons: }
    schedule = {}

    if today_deliveries.any?
      sample_lessons = sort_lessons(today_deliveries.first[:lessons], lesson_order)
      all_today_lessons = sort_lessons(today_deliveries.flat_map { |d| d[:lessons] }.uniq(&:id), lesson_order)
      schedule[@today] = {
        recipient_count: today_deliveries.size,
        already_claimed_count: eligible_enrollments.count { |e| today_claimed_ids.include?(e.id) },
        lessons: all_today_lessons,
        sample_lessons: sample_lessons
      }
    end

    future_deliveries_by_date = Hash.new { |h, k| h[k] = [] }
    eligible_enrollments.each do |enrollment|
      progress = projections.fetch(enrollment.id)
      lessons_by_future_date = Hash.new { |h, k| h[k] = [] }

      progress.lessons.each do |lesson|
        ma = progress.content.module_assignments[lesson.module_id]
        la = progress.content.lesson_assignments[lesson.id]
        unlock_on = lesson.assigned_unlock_date(@cohort, ma, la)
        next unless unlock_on && unlock_on > @today
        next if progress.plan && !progress.required?(lesson)
        next if enrollment.access_expires_at.present? && enrollment.access_expires_at <= scheduled_time_on(unlock_on)
        next if claimed_lesson_keys.include?(DailyUnlockNotifications.claim_key(enrollment.id, lesson.id))
        next unless LessonReadAccess.readable?(enrollment, lesson, ma, la, on: unlock_on)

        lessons_by_future_date[unlock_on] << lesson
      end

      lessons_by_future_date.each do |date, lessons|
        future_deliveries_by_date[date] << { enrollment: enrollment, lessons: lessons.uniq(&:id) }
      end
    end

    future_deliveries_by_date.each do |date, deliveries|
      sample_lessons = sort_lessons(deliveries.first[:lessons], lesson_order)
      all_lessons = sort_lessons(deliveries.flat_map { |d| d[:lessons] }.uniq(&:id), lesson_order)
      schedule[date] = {
        recipient_count: deliveries.size,
        already_claimed_count: 0,
        lessons: all_lessons,
        sample_lessons: sample_lessons
      }
    end

    sorted_dates = schedule.keys.sort.first(MAX_UPCOMING_DATES)
    upcoming = sorted_dates.map do |date|
      entry = schedule[date]
      {
        release_date: date.iso8601,
        scheduled_send_at: scheduled_time_on(date).iso8601,
        is_today: date == @today,
        eligible_recipient_count: entry[:recipient_count],
        already_claimed_count: entry[:already_claimed_count],
        lessons: serialize_lessons(entry[:lessons], modules_by_id)
      }
    end

    first_date = sorted_dates.first
    sample_preview = if first_date
      build_sample_preview(first_date.iso8601, serialize_lessons(schedule[first_date][:sample_lessons], modules_by_id))
    end

    [ upcoming, sample_preview ]
  end

  def build_base_schedule_upcoming(modules)
    assigned_modules = if @cohort.content_defaults.nil?
      modules
    else
      allowed = @cohort.content_defaults.filter_map { |id, cfg| id.to_i if cfg.is_a?(Hash) && cfg["assigned"] }.to_set
      modules.select { |mod| allowed.include?(mod.id) }
    end
    modules_by_id = modules.index_by(&:id)
    by_date = Hash.new { |h, k| h[k] = [] }

    assigned_modules.each do |mod|
      mod.lessons.each do |lesson|
        next if lesson.archived?

        lesson.association(:curriculum_module).target = mod
        unlock_on = lesson.unlock_date(@cohort)
        next unless unlock_on && unlock_on >= @today

        by_date[unlock_on] << lesson
      end
    end

    by_date.keys.sort.first(MAX_UPCOMING_DATES).map do |date|
      unique_lessons = by_date[date].uniq(&:id)
      {
        release_date: date.iso8601,
        scheduled_send_at: scheduled_time_on(date).iso8601,
        is_today: date == @today,
        eligible_recipient_count: 0,
        already_claimed_count: 0,
        lessons: serialize_lessons(unique_lessons, modules_by_id)
      }
    end
  end

  def build_lesson_order(modules)
    order = {}
    idx = 0
    modules.each do |mod|
      mod.lessons.each do |lesson|
        order[lesson.id] = idx
        idx += 1
      end
    end
    order
  end

  def sort_lessons(lessons, lesson_order)
    lessons.sort_by { |lesson| [ lesson_order.fetch(lesson.id, Float::INFINITY), lesson.release_day, lesson.position, lesson.id ] }
  end

  def serialize_lessons(lessons, modules_by_id)
    lessons.map do |lesson|
      mod = modules_by_id[lesson.module_id] || lesson.curriculum_module
      {
        id: lesson.id,
        title: lesson.title,
        module_id: lesson.module_id,
        module_name: mod&.name.to_s,
        lesson_type: lesson.lesson_type,
        release_day: lesson.release_day,
        deep_link: NotificationEmailService.daily_unlock_lesson_url(lesson, @cohort)
      }
    end
  end

  def scheduled_time_on(date)
    @zone.local(date.year, date.month, date.day, @daily_unlock_hour, 0, 0)
  end

  def build_sample_preview(release_date, lessons)
    return nil unless release_date && lessons.present?

    count = lessons.size
    {
      release_date: release_date,
      subject: NotificationEmailService.daily_unlock_subject,
      from: SchoolBrand.email_sender.presence,
      headline: "#{count} new lesson#{count > 1 ? 's' : ''} unlocked!",
      intro: "Hey Student, new content is available in #{@cohort.name}:",
      lessons: lessons.map { |lesson| { id: lesson[:id], title: lesson[:title], deep_link: lesson[:deep_link] } },
      cta_label: "Open Learn",
      cta_url: NotificationEmailService.daily_unlock_cta_url(@cohort),
      footer: "#{SchoolBrand.current.product_name} · #{SchoolBrand.current.name} — #{@cohort.name}"
    }
  end

  def build_recent_deliveries(digest_rows:, lesson_claim_rows:, task_run:, upcoming_releases:)
    claims_by_date_and_enrollment = Hash.new(0)
    lesson_claim_rows.each do |row|
      parts = row.key.split("/")
      next unless parts.size == 3

      enrollment_id = parts[1].to_i
      claim_date = LearningCalendar.today(at: row.created_at).iso8601
      claims_by_date_and_enrollment[[ claim_date, enrollment_id ]] += 1
    end

    grouped = {}
    digest_rows.each do |row|
      enrollment_id, date_str = parse_digest_key(row.key)
      next unless enrollment_id && date_str

      entry = grouped[date_str] ||= { enrollment_ids: Set.new, attempted_at: row.created_at }
      entry[:enrollment_ids].add(enrollment_id)
      entry[:attempted_at] = row.created_at if row.created_at > entry[:attempted_at]
    end

    deliveries = grouped.keys.sort.reverse.first(MAX_RECENT_DELIVERIES).map do |date_str|
      entry = grouped[date_str]
      lesson_count = entry[:enrollment_ids].sum { |eid| claims_by_date_and_enrollment[[ date_str, eid ]] }
      {
        date: date_str,
        key: "daily_unlock_digest/cohort/#{@cohort.id}/#{date_str}",
        status: "attempted",
        recipient_count: entry[:enrollment_ids].size,
        lesson_claim_count: lesson_count,
        attempted_at: entry[:attempted_at].iso8601,
        note: CLAIM_RECORDED_NOTE
      }
    end

    # Show skipped status for cohorts where daily unlock emails do not apply.
    if !daily_unlocks_apply? && deliveries.empty? && task_run&.last_school_date.present?
      date_str = task_run.last_school_date.iso8601
      deliveries << {
        date: date_str,
        key: "daily_unlock_digest/cohort/#{@cohort.id}/#{date_str}",
        status: "skipped",
        recipient_count: 0,
        lesson_claim_count: 0,
        attempted_at: (task_run.last_succeeded_at || task_run.last_attempted_at)&.iso8601,
        note: eligibility_reason
      }
    end

    # Show today as pending when remaining unclaimed eligible deliveries exist for today.
    today_release = upcoming_releases.find { |item| item[:is_today] }
    if daily_unlocks_apply? && today_release && today_release[:eligible_recipient_count].positive?
      deliveries.unshift(
        {
          date: @today.iso8601,
          key: "daily_unlock_digest/cohort/#{@cohort.id}/#{@today.iso8601}",
          status: "pending",
          recipient_count: today_release[:eligible_recipient_count],
          lesson_claim_count: today_release[:lessons].size * today_release[:eligible_recipient_count],
          attempted_at: nil,
          note: "Unclaimed deliveries scheduled for #{formatted_unlock_hour} #{time_zone_label(scheduled_time_on(@today))}."
        }
      )
    end

    deliveries.first(MAX_RECENT_DELIVERIES)
  end

  def parse_digest_key(key)
    parts = key.to_s.split("/")
    return [ nil, nil ] unless parts.size == 3 && parts[0] == DailyUnlockNotifications::DIGEST_KEY_PREFIX
    return [ nil, nil ] unless parts[1].match?(/\A[1-9]\d*\z/) && parts[2].match?(/\A\d{4}-\d{2}-\d{2}\z/)

    [ parts[1].to_i, parts[2] ]
  end

  def build_scheduler_health(task_run)
    if task_run.nil?
      return {
        scope: "school_wide",
        task_name: "daily_unlocks",
        status: "never_run",
        last_run_at: nil,
        last_succeeded_at: nil,
        last_school_date: nil,
        error_class: nil,
        note: "No school-wide daily unlock tick has been recorded yet."
      }
    end

    last_result = task_run.last_result || {}
    unresolved_error = task_run.last_attempted_at.present? &&
      last_result["status"] == "error" &&
      (task_run.last_succeeded_at.nil? || task_run.last_attempted_at > task_run.last_succeeded_at)

    status = if unresolved_error
      "error"
    elsif last_result["status"] == "skipped"
      "skipped"
    else
      "healthy"
    end

    error_class = unresolved_error ? last_result["error"].presence : nil
    note = case status
    when "error"
      "School-wide daily unlock tick reported #{error_class || 'an error'} across eligible cohorts. Check server logs to determine which cohort or recipient failed."
    when "skipped"
      "Last school-wide daily unlock tick skipped execution."
    else
      "Last school-wide daily unlock tick completed cleanly across eligible cohorts."
    end

    {
      scope: "school_wide",
      task_name: "daily_unlocks",
      status: status,
      last_run_at: (task_run.last_attempted_at || task_run.last_succeeded_at)&.iso8601,
      last_succeeded_at: task_run.last_succeeded_at&.iso8601,
      last_school_date: task_run.last_school_date&.iso8601,
      error_class: error_class,
      note: note
    }
  end
end
