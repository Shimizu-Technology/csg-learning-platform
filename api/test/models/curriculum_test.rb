require_relative "../support/model_coverage"

class CurriculumTest < ModelCoverageTestCase
  test "name is required cohorts and resources restrict deletion but owned content is destroyed" do
    assert_invalid curriculum, :name, ""
    course
    assert_not curriculum.destroy
    assert Curriculum.exists?(curriculum.id)
    empty = Curriculum.create!(name: "Disposable")
    child = CurriculumModule.create!(curriculum: empty, name: "Child", position: 0)
    empty.destroy!
    assert_not CurriculumModule.exists?(child.id)
    assert_not curriculum.update(status: :archived)
    course.update!(status: :completed)
    curriculum.update!(status: :archived)
    assert curriculum.reload.archived?
  end
end
