# What a lesson is to a learner, read from its blocks (U-5.6): exercise,
# project, video, recording, checkpoint or reading. The stored `lesson_type`
# can't be trusted for this: course imports store `exercise` for nearly every
# lesson, including readings and recordings, so Learn showed "Exercise" on
# every row. Learn, Today and the native app read the kind from here.
#
# - Work the learner hands in or marks done makes an exercise (a project when
#   the author typed the lesson as one): a code challenge, a checkpoint with a
#   reviewed submission, or an exercise block with an explicit submission
#   type, starter file or solution. Imported instructions with none of these
#   are reading, not work.
# - Otherwise media decides: a class recording, then a video.
# - Otherwise a checkpoint (a retrieval check or a manual check step).
# - Everything else is reading.
#
# Reads only loaded block columns (no knowledge check or submission rows), so
# a whole outline costs no queries beyond loading its blocks.
module LessonKind
  EXERCISE = "exercise".freeze
  PROJECT = "project".freeze
  VIDEO = "video".freeze
  RECORDING = "recording".freeze
  CHECKPOINT = "checkpoint".freeze
  READING = "reading".freeze
  ALL = [ EXERCISE, PROJECT, VIDEO, RECORDING, CHECKPOINT, READING ].freeze

  module_function

  def for(lesson)
    blocks = lesson.content_blocks.to_a
    return lesson.project? ? PROJECT : EXERCISE if blocks.any? { |block| work?(block) }
    return RECORDING if blocks.any?(&:recording?)
    return VIDEO if blocks.any?(&:video?)
    return CHECKPOINT if blocks.any?(&:checkpoint?)

    READING
  end

  def work?(block)
    return true if block.code_challenge? || block.submission_checkpoint?
    return false unless block.exercise?

    block.submission_type.present? || block.filename.present? || block.solution.present?
  end
end
