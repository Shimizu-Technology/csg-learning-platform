class ScheduledTickJob < ApplicationJob
  def perform
    raise "Scheduled tick failed" unless ScheduledTick.new.call
  end
end
