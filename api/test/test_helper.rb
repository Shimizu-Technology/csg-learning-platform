ENV["RAILS_ENV"] ||= "test"
# Tests must never inherit developer S3 credentials or make real object-storage calls.
ENV["AWS_S3_BUCKET"] = ""
ENV["AWS_ACCESS_KEY_ID"] = ""
ENV["AWS_SECRET_ACCESS_KEY"] = ""
require_relative "../config/environment"
require "rails/test_help"

class ActiveSupport::TestCase
  parallelize(workers: :number_of_processors)
end
