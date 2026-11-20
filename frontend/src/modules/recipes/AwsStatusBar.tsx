/**
 * AWS Access Spec A6/A7, shown on the Sync page: whether the app can reach S3 (and why not, in plain
 * English), and a warning when the server's certificate is close to expiring. Checked when the page opens;
 * it only asks AWS who the app is and peeks at one key, so nothing is synced.
 */
import { useCallback, useEffect, useState } from 'react'
import { errorMessage, recipesApi, type AwsStatus } from './recipesApi'

export function AwsStatusBar() {
  const [status, setStatus] = useState<AwsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  const fetchStatus = useCallback(() => {
    recipesApi
      .awsStatus()
      .then((s) => {
        setStatus(s)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setChecking(false))
  }, [])

  useEffect(fetchStatus, [fetchStatus])

  const check = () => {
    setChecking(true)
    fetchStatus()
  }

  const ok = status?.ok && !error
  return (
    <div className="aws-status" role="status">
      <div className={`aws-line ${checking && !status ? '' : ok ? 'aws-ok' : 'aws-bad'}`}>
        <span className="aws-dot" aria-hidden="true" />
        <span className="aws-message">
          {checking && !status ? 'Checking the connection to S3…' : (error ?? status?.message)}
        </span>
        <button className="link-button" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {status?.cert_warning && <p className="aws-cert-warning">{status.cert_warning}</p>}
    </div>
  )
}
