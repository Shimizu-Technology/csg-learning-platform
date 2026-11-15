# The record a direct message is about: a lesson, a submission or a help
# request (L-1.8). Staff write from that record; the learner sees a link to
# their own view of it, and staff see a link to the staff view.
#
# Only these types can be attached, only to a top-level message in a cohort's
# direct conversation, and only when the author can open the record and every
# learner in the conversation is the person the record belongs to. A learner
# can attach only a lesson the lesson page would open for them
# (LessonReadAccess); staff can attach any live lesson in the cohort's
# curriculum.
class MessageSource
  # What `preload` decided for one viewer; `json` falls back to a fresh check
  # for anything missing.
  Preloaded = Data.define(:viewer, :lesson_access)

  # API name => stored polymorphic type.
  TYPES = {
    "lesson" => "Lesson",
    "submission" => "Submission",
    "help_request" => "HelpRequest"
  }.freeze

  class << self
    def stored_type(api_type)
      TYPES[api_type.to_s]
    end

    def api_type(stored_type)
      TYPES.key(stored_type.to_s)
    end

    # Can `author` attach `source` to a message in `conversation`?
    def attachable?(source, author:, conversation:)
      cohort = conversation&.cohort
      return false unless source && author && cohort

      learners = conversation.users.reject(&:staff?)
      case source
      when Submission
        owner_id = source.user_id
        source.enrollment&.cohort_id == cohort.id &&
          (author.id == owner_id || author.can_teach_cohort?(cohort)) &&
          learners.all? { |learner| learner.id == owner_id }
      when HelpRequest
        owner_id = source.student_id
        source.cohort_id == cohort.id &&
          (author.id == owner_id || author.can_teach_cohort?(cohort)) &&
          learners.all? { |learner| learner.id == owner_id }
      when Lesson
        !source.archived? &&
          source.curriculum_module&.curriculum_id == cohort.curriculum_id &&
          author.can_access_cohort?(cohort) &&
          (author.staff? || LessonReadAccess.allowed?(author, source, cohort_id: cohort.id))
      else
        false
      end
    end

    # Loads what `json` reads for a list of messages, so rendering a window of
    # sourced messages costs a fixed number of queries, and decides the
    # viewer's lesson access per conversation cohort in one batch. Pass the
    # result to `json` (through MessageJson.render) as `preloaded:`.
    def preload(messages, viewer:)
      messages = messages.select(&:source_type)
      ActiveRecord::Associations::Preloader.new(records: messages, associations: :source).call
      sources = messages.filter_map(&:source)
      ActiveRecord::Associations::Preloader.new(records: sources.grep(Submission), associations: [ { content_block: :lesson }, :enrollment ]).call
      ActiveRecord::Associations::Preloader.new(records: messages, associations: :direct_conversation).call

      lesson_access = {}
      if viewer
        lesson_messages = messages.select { |message| message.source.is_a?(Lesson) }
        lesson_messages.group_by { |message| message.direct_conversation&.cohort_id }.each do |cohort_id, group|
          LessonReadAccess.check_many(viewer, group.map(&:source), cohort_id: cohort_id).each do |lesson_id, result|
            lesson_access[[ lesson_id, cohort_id ]] = result.allowed?
          end
        end
      end
      Preloaded.new(viewer: viewer, lesson_access: lesson_access)
    end

    # JSON for MessageJson, or nil when the record no longer exists. A lesson
    # the viewing learner can't open (not assigned or not released for them
    # yet) comes back as an untitled, unlinked lesson so the message never
    # reveals more than the lesson page would.
    def json(message, viewer: nil, preloaded: nil)
      source = message.source
      return nil unless source

      case source
      when Submission
        block = source.content_block
        lesson = block&.lesson
        cohort_id = source.enrollment&.cohort_id
        payload(message, title: lesson&.title || block&.title, lesson_id: lesson&.id, cohort_id: cohort_id,
          learner_path: lesson && lesson_path(lesson.id, cohort_id, block_id: block.id))
      when HelpRequest
        payload(message, title: source.context_label, lesson_id: nil, cohort_id: source.cohort_id,
          learner_path: internal_path(source.context_path))
      when Lesson
        cohort_id = message.direct_conversation&.cohort_id
        allowed = if preloaded&.viewer == viewer && preloaded.lesson_access.key?([ source.id, cohort_id ])
          preloaded.lesson_access[[ source.id, cohort_id ]]
        else
          viewer && LessonReadAccess.allowed?(viewer, source, cohort_id: cohort_id)
        end
        unless allowed
          return payload(message, title: "", lesson_id: nil, cohort_id: cohort_id, learner_path: nil).merge(id: nil)
        end

        payload(message, title: source.title, lesson_id: source.id, cohort_id: cohort_id,
          learner_path: lesson_path(source.id, cohort_id))
      end
    end

    private

    def payload(message, title:, lesson_id:, cohort_id:, learner_path:)
      {
        type: api_type(message.source_type),
        id: message.source_id,
        title: title.to_s,
        lesson_id: lesson_id,
        cohort_id: cohort_id,
        learner_path: learner_path
      }
    end

    def lesson_path(lesson_id, cohort_id, block_id: nil)
      path = "/lessons/#{lesson_id}"
      path += "?cohort_id=#{cohort_id}" if cohort_id
      path += "#block-#{block_id}" if block_id
      path
    end

    # Help request paths are built by the server from the request's context;
    # still, never hand the client anything but a same-site path.
    def internal_path(value)
      path = value.to_s
      return nil unless path.start_with?("/") && !path.start_with?("//") && !path.match?(/[\\\s]/)

      path
    end
  end
end
