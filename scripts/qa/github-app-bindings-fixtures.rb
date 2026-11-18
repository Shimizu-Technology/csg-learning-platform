require_relative 'boot'
cohort = Cohort.find(1)
SchoolSetting.current.update!(features: SchoolSetting.current.features.merge('github_app' => true))
cohort.update!(settings: cohort.settings.deep_merge('features' => { 'github_app' => true }))
User.find(3).update!(github_username: 'app-learner')
# Cohort 2 stays Off even with a school-wide switch: no implicit cohort rollout.
Cohort.find(2).update!(settings: Cohort.find(2).settings.deep_merge('features' => { 'github_app' => false }))
