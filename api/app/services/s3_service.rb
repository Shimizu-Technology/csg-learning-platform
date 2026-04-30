class S3Service
  MAX_UPLOAD_SIZE = 5.gigabytes
  PRESIGN_EXPIRY = 3600 # 1 hour
  MULTIPART_PRESIGN_EXPIRY = 24.hours.to_i

  class << self
    def configured?
      bucket_name.present? &&
        ENV["AWS_ACCESS_KEY_ID"].present? &&
        ENV["AWS_SECRET_ACCESS_KEY"].present?
    end

    def generate_presigned_post(key, content_type, max_size: MAX_UPLOAD_SIZE)
      bucket = s3_resource.bucket(bucket_name)

      bucket.presigned_post(
        key: key,
        content_type: content_type,
        success_action_status: "201",
        expires: Time.current + PRESIGN_EXPIRY
      ).tap do |post|
        post.content_length_range(1..max_size)
      end
    end

    def generate_presigned_url(key, expires_in: PRESIGN_EXPIRY)
      presigner = Aws::S3::Presigner.new(client: s3_client)
      presigner.presigned_url(
        :get_object,
        bucket: bucket_name,
        key: key,
        expires_in: expires_in
      )
    end

    def create_multipart_upload(key, content_type)
      s3_client.create_multipart_upload(
        bucket: bucket_name,
        key: key,
        content_type: content_type
      ).upload_id
    end

    def generate_presigned_upload_part_url(key, upload_id, part_number, expires_in: MULTIPART_PRESIGN_EXPIRY)
      presigner = Aws::S3::Presigner.new(client: s3_client)
      presigner.presigned_url(
        :upload_part,
        bucket: bucket_name,
        key: key,
        upload_id: upload_id,
        part_number: part_number,
        expires_in: expires_in
      )
    end

    def complete_multipart_upload(key, upload_id, parts)
      s3_client.complete_multipart_upload(
        bucket: bucket_name,
        key: key,
        upload_id: upload_id,
        multipart_upload: {
          parts: parts
            .sort_by { |part| part.fetch(:part_number).to_i }
            .map { |part| { part_number: part.fetch(:part_number).to_i, etag: part.fetch(:etag).to_s } }
        }
      )
      true
    end

    def abort_multipart_upload(key, upload_id)
      s3_client.abort_multipart_upload(
        bucket: bucket_name,
        key: key,
        upload_id: upload_id
      )
      true
    rescue Aws::S3::Errors::NoSuchUpload
      true
    rescue Aws::S3::Errors::ServiceError => e
      Rails.logger.error("[S3Service] multipart abort error: #{e.message}")
      false
    end

    def delete_object(key)
      s3_resource.bucket(bucket_name).object(key).delete
      true
    rescue Aws::S3::Errors::NoSuchKey
      true
    rescue Aws::S3::Errors::ServiceError => e
      Rails.logger.error("[S3Service] delete error: #{e.message}")
      false
    end

    def object_exists?(key)
      s3_client.head_object(bucket: bucket_name, key: key)
      true
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      false
    end

    def object_metadata(key)
      resp = s3_client.head_object(bucket: bucket_name, key: key)
      {
        content_type: resp.content_type,
        content_length: resp.content_length,
        last_modified: resp.last_modified
      }
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      nil
    end

    private

    def bucket_name
      ENV.fetch("AWS_S3_BUCKET", "")
    end

    def region
      ENV.fetch("AWS_REGION", "us-east-1")
    end

    def s3_client
      # Use the same accessor style as `configured?` so a missing env var causes
      # `configured?` to return false rather than `s3_client` raising KeyError.
      # Memoization is intentional, but only kicks in once credentials are
      # actually present.
      @s3_client ||= Aws::S3::Client.new(
        region: region,
        access_key_id: ENV["AWS_ACCESS_KEY_ID"],
        secret_access_key: ENV["AWS_SECRET_ACCESS_KEY"]
      )
    end

    def s3_resource
      @s3_resource ||= Aws::S3::Resource.new(client: s3_client)
    end
  end
end
