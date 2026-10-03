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
        package = params.require(:package)
        raise CoursePackageImporter::InvalidPackage, "Package must be an object" unless package.is_a?(ActionController::Parameters)
        CoursePackageImporter.new(package.to_unsafe_h)
      end
    end
  end
end
