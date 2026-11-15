require "test_helper"

class CurriculumReorderTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "a failure after temporary moves rolls back every position" do
    curriculum = Curriculum.create!(name: "Synthetic rollback")
    first = curriculum.modules.create!(name: "First", position: 0)
    second = curriculum.modules.create!(name: "Second", position: 1)
    second.update_columns(schedule_days: "invalid")
    assert_raises(ActiveRecord::RecordInvalid) { curriculum.reorder_modules!([ second.id, first.id ]) }
    assert_equal [ [ first.id, 0 ], [ second.id, 1 ] ], curriculum.modules.reload.pluck(:id, :position)
  ensure
    curriculum&.destroy!
  end

  test "concurrent reorders commit complete permutations without duplicate positions" do
    curriculum = Curriculum.create!(name: "Synthetic reorder")
    ids = 4.times.map { |i| curriculum.modules.create!(name: "Module #{i}", position: i).id }
    ready = Queue.new
    start = Queue.new
    threads = [ ids.reverse, ids.rotate ].map do |order|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          Curriculum.find(curriculum.id).reorder_modules!(order)
        end
      end
    end
    2.times { ready.pop }
    2.times { start << true }
    threads.each(&:value)
    assert_includes [ ids.reverse, ids.rotate ], curriculum.modules.reload.ids
    assert_equal [ 0, 1, 2, 3 ], curriculum.modules.pluck(:position)
  ensure
    threads&.each(&:join)
    curriculum&.destroy!
  end
end
