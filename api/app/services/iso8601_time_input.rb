class Iso8601TimeInput
  OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})\z/i
  private_constant :OFFSET_PATTERN

  def self.explicit_offset?(value)
    value.to_s.strip.match?(OFFSET_PATTERN)
  end
end
