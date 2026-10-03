require "base64"

module Api
  module V1
    class CoursePackagesController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!

      def preview
        render json: { preview: importer.preview }
      rescue CoursePackageImporter::InvalidPackage, ActionController::ParameterMissing => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end

      def create
        render json: { import: importer.call }, status: :created
      rescue CoursePackageImporter::InvalidPackage, ActionController::ParameterMissing => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end

      private

      def importer
        return CoursePackageImporter.new(decoded_package) if params.key?(:package_base64)

        package = params.require(:package)
        raise CoursePackageImporter::InvalidPackage, "Package must be an object" unless package.is_a?(ActionController::Parameters)
        CoursePackageImporter.new(package.to_unsafe_h)
      end

      def decoded_package
        raise CoursePackageImporter::InvalidPackage, "Choose one package format" if params.key?(:package)
        encoded = params[:package_base64]
        max_encoded_bytes = ((CoursePackageImporter::MAX_BYTES + 2) / 3) * 4
        unless encoded.is_a?(String) && encoded.bytesize <= max_encoded_bytes
          raise CoursePackageImporter::InvalidPackage, "Encoded package is invalid or exceeds 2 MB"
        end
        decoded = Base64.strict_decode64(encoded).force_encoding(Encoding::UTF_8)
        if decoded.bytesize > CoursePackageImporter::MAX_BYTES || !decoded.valid_encoding?
          raise CoursePackageImporter::InvalidPackage, "Package is invalid UTF-8 or exceeds 2 MB"
        end
        package = JSON.parse(decoded)
        raise CoursePackageImporter::InvalidPackage, "Package must be an object" unless package.is_a?(Hash)
        package
      rescue ArgumentError, JSON::ParserError
        raise CoursePackageImporter::InvalidPackage, "Package must contain valid base64-encoded UTF-8 JSON"
      end
    end
  end
end
