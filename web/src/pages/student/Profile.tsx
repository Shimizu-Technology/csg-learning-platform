import { useEffect, useState } from 'react'
import { Github, Save, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

interface ProfileData {
  user: {
    id: number
    email: string
    first_name: string
    last_name: string
    full_name: string
    github_username: string | null
    avatar_url: string | null
  }
  enrollments: Array<{
    id: number
    cohort_name: string
    curriculum_name: string
    status: string
    enrolled_at: string
  }>
}

export function Profile() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [githubUsername, setGithubUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getProfile().then((res) => {
      if (res.data) {
        setData(res.data)
        setGithubUsername(res.data.user.github_username || '')
      }
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const res = await api.updateProfile({ github_username: githubUsername })
    if (!res.error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  if (loading) return <LoadingSpinner message="Loading profile..." />
  if (!data) return null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Profile</h1>

      {/* User info */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xl font-bold">
            {data.user.first_name?.[0]}{data.user.last_name?.[0]}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{data.user.full_name}</h2>
            <p className="text-sm text-slate-500">{data.user.email}</p>
          </div>
        </div>

        {/* GitHub username */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            <Github className="inline h-4 w-4 mr-1" />
            GitHub Username
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={githubUsername}
              onChange={(e) => setGithubUsername(e.target.value)}
              placeholder="Enter your GitHub username"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Enrollments */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Enrollments</h3>
        {data.enrollments.length === 0 ? (
          <p className="text-sm text-slate-500">No enrollments yet.</p>
        ) : (
          <div className="space-y-3">
            {data.enrollments.map((enrollment) => (
              <div key={enrollment.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{enrollment.cohort_name}</p>
                  <p className="text-xs text-slate-500">{enrollment.curriculum_name}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  enrollment.status === 'active' ? 'bg-success-100 text-success-700' :
                  enrollment.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {enrollment.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
