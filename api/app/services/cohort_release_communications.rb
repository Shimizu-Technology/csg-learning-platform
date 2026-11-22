require "mail"

# Staff-scoped read-only projection of a cohort's daily lesson-release email
# configuration, upcoming scheduled releases (grouped uniquely by school date),
# recipient eligibility breakdown, sample deep-link preview, and recent
# delivery receipts derived from existing durable tables without migrations.
class CohortReleaseCommunications
  MAX_UPCOMING_DATES = 5
  MAX_RECENT_DELIVERIES = 14
  GRADE_PUBLICATION_SEPARATION_NOTE =
    "Lesson release emails announce newly unlocked lessons only. Grades and instructor feedback are published separately when an instructor saves a grade in Learn.".freeze

  def initialize(cohort:, now: Time.current)
    @cohort = cohort
    @now = now
    @time_zone_name = LearningCalendar.time_zone
    @zone = ActiveSupport::TimeZone[@time_zone_name] || Time.find_zone!(@time_zone_name)
    @today = LearningCalendar.today(at: @now)
    @daily_unlock_hour = ScheduledTick.daily_unlock_hour
    @school_features = FeatureSwitches.school(read_only: true)
    @learning_plans_enabled = FeatureSwitches.for(cohort: @cohort, school: @school_features)["learning_plans"]
  end

  def call
    enrollments = @cohort.enrollments.includes(:user, :module_assignments, :lesson_assignments, :learning_plan).to_a
    recipient_buckets = classify_recipients(enrollments)
    eligible_enrollments = recipient_buckets[:eligible]
    enrollment_ids = enrollments.map(&:id)
    digest_rows, lesson_claim_rows = load_attempt_rows(enrollment_ids)
    task_run = ScheduledTaskRun.find_by(name: "daily_unlocks")

    upcoming_releases = daily_unlocks_apply? ? build_upcoming_releases(eligible_enrollments, digest_rows) : []
    recent_deliveries = build_recent_deliveries(
      digest_rows: digest_rows,
      lesson_claim_rows: lesson_claim_rows,
      task_run: task_run,
      upcoming_releases: upcoming_releases,
      eligible_count: eligible_enrollments.size
    )

    {
      generated_at: @now.iso8601,
      cohort_id: @cohort.id,
      cohort_name: @cohort.name,
      configuration: build_configuration,
      recipients: build_recipient_summary(enrollments.size, recipient_buckets),
      upcoming_releases: upcoming_releases,
      sample_preview: build_sample_preview(upcoming_releases.first),
      recent_deliveries: recent_deliveries,
      scheduler: build_scheduler_summary(task_run)
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

  def time_zone_label
    SchoolTime.label(TZInfo::Timezone.get(@time_zone_name), at: @now)
  end

  def eligibility_reason
    if @cohort.self_paced?
      "Self-paced cohorts open assigned lessons immediately, so scheduled daily unlock emails are skipped."
    elsif @cohort.personal_pace?
      "Personal-pace cohorts open lessons on each learner's own start date, so scheduled daily unlock emails are skipped."
    elsif !%w[active upcoming].include?(effective_cohort_status)
      "Completed and archived cohorts do not send scheduled daily unlock emails."
    elsif effective_cohort_status == "upcoming"
      "Scheduled daily unlock emails will start on #{@cohort.start_date.iso8601} at #{formatted_unlock_hour} #{time_zone_label}."
    else
      "Active learners receive one daily email digest at #{formatted_unlock_hour} #{time_zone_label} when lessons unlock (up to #{DailyUnlockNotifications::CATCH_UP_DAYS} school days of catch-up)."
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

  def load_attempt_rows(enrollment_ids)
    return [ [], [] ] if enrollment_ids.empty?

    id_strings = enrollment_ids.map(&:to_s)
    digest_rows = ScheduledNotificationAttempt
      .where("split_part(key, '/', 1) = ? AND split_part(key, '/', 2) IN (?)", DailyUnlockNotifications::DIGEST_KEY_PREFIX, id_strings)
      .order(created_at: :desc)
      .to_a
    return [ [], [] ] if digest_rows.empty?

    lesson_claim_rows = ScheduledNotificationAttempt
      .where("split_part(key, '/', 1) = ? AND split_part(key, '/', 2) IN (?)", DailyUnlockNotifications::LESSON_KEY_PREFIX, id_strings)
      .to_a
    [ digest_rows, lesson_claim_rows ]
  end

  def build_upcoming_releases(eligible_enrollments, digest_rows)
    modules = @cohort.curriculum.modules.ordered.includes(lessons: :content_blocks).to_a
    assigned_modules = select_assigned_modules(modules, eligible_enrollments)
    by_date = Hash.new { |hash, key| hash[key] = [] }

    assigned_modules.each do |mod|
      mod.lessons.each do |lesson|
        next if lesson.archived?

        lesson.association(:curriculum_module).target = mod
        unlock_on = lesson.unlock_date(@cohort)
        next unless unlock_on && unlock_on >= @today

        by_date[unlock_on] << [ mod, lesson ]
      end
    end

    today_claimed_ids = digest_rows.filter_map do |row|
      enrollment_id, date_str = parse_digest_key(row.key)
      enrollment_id if date_str == @today.iso8601
    end.to_set

    by_date.keys.sort.first(MAX_UPCOMING_DATES).map do |date|
      unique_entries = by_date[date].uniq { |(_, lesson)| lesson.id }
      recipient_count = count_recipients_for_release_date(eligible_enrollments, unique_entries, date)
      claimed_today = date == @today ? eligible_enrollments.count { |enrollment| today_claimed_ids.include?(enrollment.id) } : 0

      {
        release_date: date.iso8601,
        scheduled_send_at: scheduled_time_on(date).iso8601,
        is_today: date == @today,
        eligible_recipient_count: recipient_count,
        already_claimed_count: claimed_today,
        lessons: unique_entries.map do |mod, lesson|
          {
            id: lesson.id,
            title: lesson.title,
            module_id: mod.id,
            module_name: mod.name,
            lesson_type: lesson.lesson_type,
            release_day: lesson.release_day,
            deep_link: NotificationEmailService.daily_unlock_lesson_url(lesson, @cohort)
          }
        end
      }
    end
  end

  def select_assigned_modules(modules, eligible_enrollments)
    return modules if @cohort.content_defaults.nil?

    assigned_from_defaults = @cohort.content_defaults.filter_map do |id, config|
      id.to_i if config.is_a?(Hash) && config["assigned"]
    end.to_set
    assigned_from_enrollments = eligible_enrollments.flat_map { |enrollment| enrollment.module_assignments.map(&:module_id) }.to_set
    allowed = assigned_from_defaults | assigned_from_enrollments
    modules.select { |mod| allowed.include?(mod.id) }
  end

  def count_recipients_for_release_date(eligible_enrollments, entries, date)
    return 0 if eligible_enrollments.empty?

    eligible_enrollments.count do |enrollment|
      next false if enrollment.access_expires_at.present? && enrollment.access_expires_at <= scheduled_time_on(date)

      module_assignments = enrollment.module_assignments.index_by(&:module_id)
      lesson_assignments = enrollment.lesson_assignments.index_by(&:lesson_id)
      plan = @learning_plans_enabled && enrollment.learning_plan&.active? ? enrollment.learning_plan : nil

      entries.any? do |mod, lesson|
        ma = module_assignments[mod.id]
        ma&.association(:curriculum_module)&.target = mod
        ma&.association(:enrollment)&.target = enrollment
        la = lesson_assignments[lesson.id]
        next false unless ma.present? || la.present?
        next false if plan && !plan.required?(lesson)

        LessonReadAccess.readable?(enrollment, lesson, ma, la, on: date)
      end
    end
  end

  def scheduled_time_on(date)
    @zone.local(date.year, date.month, date.day, @daily_unlock_hour, 0, 0)
  end

  def build_sample_preview(next_release)
    return nil unless next_release

    lessons = next_release[:lessons]
    count = lessons.size
    {
      release_date: next_release[:release_date],
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

  def build_recent_deliveries(digest_rows:, lesson_claim_rows:, task_run:, upcoming_releases:, eligible_count:)
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

      entry = grouped[date_str] ||= { enrollment_ids: Set.new, attempted_at: row.created_at, sample_key: row.key }
      entry[:enrollment_ids].add(enrollment_id)
      entry[:attempted_at] = row.created_at if row.created_at > entry[:attempted_at]
    end

    error_on_date = active_error_date(task_run)
    task_error_message = task_run&.last_result&.dig("error")

    deliveries = grouped.keys.sort.reverse.first(MAX_RECENT_DELIVERIES).map do |date_str|
      entry = grouped[date_str]
      lesson_count = entry[:enrollment_ids].sum { |eid| claims_by_date_and_enrollment[[ date_str, eid ]] }
      failed_for_date = error_on_date == date_str
      {
        date: date_str,
        key: "daily_unlock_digest/cohort/#{@cohort.id}/#{date_str}",
        status: failed_for_date ? "failed" : "sent",
        recipient_count: entry[:enrollment_ids].size,
        lesson_claim_count: lesson_count,
        attempted_at: entry[:attempted_at].iso8601,
        error_message: failed_for_date ? format_error_message(task_error_message, claims_retained: true) : nil,
        note: nil
      }
    end

    # Surface an unresolved failure on a date where all claims were released (e.g. provider rejection or missing config).
    if daily_unlocks_apply? && error_on_date.present? && !grouped.key?(error_on_date)
      deliveries.unshift(
        {
          date: error_on_date,
          key: "daily_unlock_digest/cohort/#{@cohort.id}/#{error_on_date}",
          status: "failed",
          recipient_count: 0,
          lesson_claim_count: 0,
          attempted_at: task_run.last_attempted_at&.iso8601,
          error_message: format_error_message(task_error_message, claims_retained: false),
          note: nil
        }
      )
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
        error_message: nil,
        note: eligibility_reason
      }
    end

    # Show today as pending when eligible lessons are due today and no digest has been claimed or failed yet.
    today_release = upcoming_releases.find { |item| item[:is_today] }
    if daily_unlocks_apply? && today_release && today_release[:eligible_recipient_count].positive? &&
       !grouped.key?(@today.iso8601) && error_on_date != @today.iso8601 && eligible_count.positive?
      deliveries.unshift(
        {
          date: @today.iso8601,
          key: "daily_unlock_digest/cohort/#{@cohort.id}/#{@today.iso8601}",
          status: "pending",
          recipient_count: today_release[:eligible_recipient_count],
          lesson_claim_count: today_release[:lessons].size * today_release[:eligible_recipient_count],
          attempted_at: nil,
          error_message: nil,
          note: "Scheduled for #{formatted_unlock_hour} #{time_zone_label}."
        }
      )
    end

    deliveries.first(MAX_RECENT_DELIVERIES)
  end

  def active_error_date(task_run)
    return nil unless task_run&.last_attempted_at && task_run.last_result["status"] == "error"
    return nil if task_run.last_succeeded_at && task_run.last_succeeded_at >= task_run.last_attempted_at

    LearningCalendar.today(at: task_run.last_attempted_at).iso8601
  end

  def format_error_message(error_name, claims_retained:)
    detail = error_name.presence || "DailyUnlockNotifications::DeliveryFailed"
    if claims_retained
      "Delivery attempt failed (#{detail}). Claims were retained to avoid duplicate sends."
    else
      "Delivery attempt failed (#{detail}). Rejected claims were released for the next retry."
    end
  end

  def parse_digest_key(key)
    parts = key.to_s.split("/")
    return [ nil, nil ] unless parts.size == 3 && parts[0] == DailyUnlockNotifications::DIGEST_KEY_PREFIX
    return [ nil, nil ] unless parts[1].match?(/\A[1-9]\d*\z/) && parts[2].match?(/\A\d{4}-\d{2}-\d{2}\z/)

    [ parts[1].to_i, parts[2] ]
  end

  def build_scheduler_summary(task_run)
    {
      task_name: "daily_unlocks",
      last_attempted_at: task_run&.last_attempted_at&.iso8601,
      last_succeeded_at: task_run&.last_succeeded_at&.iso8601,
      last_school_date: task_run&.last_school_date&.iso8601,
      last_status: task_run&.last_result&.dig("status"),
      last_error: task_run&.last_result&.dig("error")
    }
  end
end
