require "test_helper"

class Iso8601TimeInputTest < ActiveSupport::TestCase
  test "detects UTC and numeric offsets" do
    assert Iso8601TimeInput.explicit_offset?("2030-07-10T08:00:00Z")
    assert Iso8601TimeInput.explicit_offset?("2030-07-10T18:00:00+10:00")
    assert Iso8601TimeInput.explicit_offset?("2030-07-10T18:00:00+1000")
  end

  test "rejects local wall times and blank values" do
    refute Iso8601TimeInput.explicit_offset?("2030-07-10T18:00:00")
    refute Iso8601TimeInput.explicit_offset?(nil)
    refute Iso8601TimeInput.explicit_offset?("  ")
  end
end
