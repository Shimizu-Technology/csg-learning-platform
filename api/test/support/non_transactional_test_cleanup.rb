# Non-transactional fixtures must be removed after workers have stopped, even
# when a worker raises or a test fails before releasing its queues.
module NonTransactionalTestCleanup
  def finish_test_threads(*threads)
    threads.flatten.compact.each do |thread|
      begin
        thread.join(10)
      rescue StandardError
        # Worker errors are asserted in the test body; never skip fixture cleanup.
      ensure
        thread.kill.join if thread.alive?
      end
    end
  end

  def delete_test_users(*users)
    ids = users.flatten.compact.map(&:id)
    # Authentication can create identities during a request. Remove them before
    # bypassing callbacks so the production last-admin guard remains unchanged.
    ClerkIdentity.where(user_id: ids).delete_all
    User.where(id: ids).delete_all
  end
end
