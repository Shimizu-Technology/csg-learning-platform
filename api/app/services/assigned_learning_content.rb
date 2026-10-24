# The learner's discoverable content, including explicit lesson-only assignments.
# Availability is evaluated separately; scheduled/locked assigned lessons stay visible.
class AssignedLearningContent
  attr_reader :module_assignments, :lesson_assignments, :modules

  def initialize(enrollment, modules: enrollment.cohort.curriculum.modules)
    @enrollment = enrollment
    modules = modules.to_a
    ActiveRecord::Associations::Preloader.new(records: modules, associations: { lessons: :content_blocks }).call
    @module_assignments = enrollment.module_assignments.index_by(&:module_id)
    @lesson_assignments = enrollment.lesson_assignments.index_by(&:lesson_id)
    @lessons_by_module = modules.each_with_object({}) do |mod, index|
      lessons = mod.lessons.select { |lesson| @module_assignments.key?(mod.id) || @lesson_assignments.key?(lesson.id) }
      index[mod.id] = lessons if @module_assignments.key?(mod.id) || lessons.any?
    end
    @modules = modules.select { |mod| @lessons_by_module.key?(mod.id) }
  end

  def lessons_for(mod)
    @lessons_by_module.fetch(mod.id, [])
  end

  def completion_block_ids(required_only: false)
    modules.flat_map { |mod| lessons_for(mod).select { |lesson| !required_only || @enrollment.lesson_required?(lesson) }.flat_map(&:completion_block_ids) }
  end
end
