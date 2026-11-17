# Content only. No learner table is read or written. Bulk inserts intentionally
# skip module's alumni enrollment callback and reuse existing media references.
# Caller owns the transaction and curriculum locks (before the tree locks).
class AuthoringContentClone
  attr_reader :module_map, :lesson_map

  def initialize(source:, name:, module_id: nil, destination: nil, position: nil)
    @source, @name, @module_id, @destination, @position = source, name, module_id, destination, position
    @maps = {}
  end

  def call
    mods = @source.modules
    mods = mods.where(id: @module_id) if @module_id
    module_ids = mods.order(:id).lock("FOR SHARE").pluck(:id)
    lesson_ids = Lesson.where(module_id: module_ids).order(:id).lock("FOR SHARE").pluck(:id)
    block_ids = ContentBlock.where(lesson_id: lesson_ids).order(:id).lock("FOR SHARE").pluck(:id)
    destination = @destination || Curriculum.create!(@source.attributes.except("id", "created_at", "updated_at", "course_package_key").merge("name" => @name, "status" => "draft"))
    # Cross-curriculum modules bring their rubric/objective definitions too.
    # Same-curriculum modules safely share those curriculum-level definitions.
    if destination.id != @source.id
      copy(LearningObjective, LearningObjective.where(curriculum_id: @source.id)) do |r|
        r["curriculum_id"] = destination.id
        r["code"] = "#{r['code']}.COPY-#{r['id']}" if @module_id
      end
      copy(Rubric, Rubric.where(curriculum_id: @source.id)) { |r| r["curriculum_id"] = destination.id }
      copy(RubricCriterion, RubricCriterion.where(rubric_id: @maps.fetch(Rubric).keys)) do |r|
        remap(r, "rubric_id", Rubric)
        remap(r, "learning_objective_id", LearningObjective)
      end
    end
    @module_map = copy(CurriculumModule, CurriculumModule.where(id: module_ids)) do |r|
      r["curriculum_id"] = destination.id
      r["course_package_key"] = nil
      if @module_id
        r["name"] = @name
        r["position"] = @position
      end
    end
    @lesson_map = copy(Lesson, Lesson.where(id: lesson_ids)) do |r|
      remap(r, "module_id", CurriculumModule)
      # A module inserted in an active curriculum must not expose its lessons.
      r["archived_at"] = Time.current if @module_id
    end
    allocate(ContentBlock, block_ids)
    copy(ContentBlock, ContentBlock.where(id: block_ids)) do |r|
      remap(r, "lesson_id", Lesson)
      remap(r, "rubric_id", Rubric)
      %w[body solution].each { |key| r[key] = rewrite_links(r[key]) }
    end
    copy(KnowledgeCheck, KnowledgeCheck.where(content_block_id: block_ids)) do |r|
      remap(r, "content_block_id", ContentBlock)
      remap(r, "learning_objective_id", LearningObjective)
    end
    copy(ObjectiveAlignment, ObjectiveAlignment.where(lesson_id: lesson_ids)) do |r|
      remap(r, "lesson_id", Lesson)
      remap(r, "content_block_id", ContentBlock)
      remap(r, "learning_objective_id", LearningObjective)
    end
    unless @module_id
      copy(CurriculumResource, CurriculumResource.where(curriculum_id: @source.id, ready: true)) do |r|
        r["curriculum_id"] = destination.id
        r["upload_key"] = "course_resource_uploads/curriculum_#{destination.id}/#{SecureRandom.uuid}/#{r['filename']}"
      end
    end
    @module_id ? CurriculumModule.find(@module_map.fetch(@module_id)) : destination
  end

  private

  def allocate(model, ids)
    return @maps[model] = {} if ids.empty?

    connection = model.connection
    sequence = connection.select_value("SELECT pg_get_serial_sequence(#{connection.quote(model.table_name)}, 'id')")
    values = connection.select_values("SELECT nextval(#{connection.quote(sequence)}) FROM generate_series(1, #{ids.size.to_i})").map(&:to_i)
    @maps[model] = ids.sort.zip(values).to_h
  end

  def copy(model, scope)
    records = scope.reorder(:id).lock("FOR SHARE").to_a
    map = @maps[model] || allocate(model, records.map(&:id))
    rows = records.map do |record|
      row = record.attributes.merge("id" => map.fetch(record.id), "created_at" => Time.current, "updated_at" => Time.current)
      yield row
      row
    end
    rows.each_slice(500) { |batch| model.insert_all!(batch) }
    map
  end

  def remap(row, column, model)
    row[column] = (@maps[model] || {}).fetch(row[column], row[column])
  end

  def rewrite_links(text)
    return text if text.blank?

    text.gsub(%r{/(lessons|modules)/(\d+)(#block-(\d+))?}) do
      kind, id, anchor, block_id = Regexp.last_match.captures
      map = @maps[kind == "lessons" ? Lesson : CurriculumModule]
      next Regexp.last_match(0) unless map.key?(id.to_i)

      suffix = anchor && "#block-#{@maps.fetch(ContentBlock).fetch(block_id.to_i, block_id)}"
      "/#{kind}/#{map.fetch(id.to_i)}#{suffix}"
    end
  end
end
