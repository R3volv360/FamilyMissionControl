import { NavLink, Outlet } from 'react-router-dom'
import { MODULES } from '../modules/registry'

export function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Mission Control
        </NavLink>
        <nav aria-label="Modules">
          {MODULES.map((m) => (
            <NavLink key={m.path} to={m.path}>
              {m.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export function Home() {
  return (
    <section>
      <h1>Family Mission Control</h1>
      <div className="dashboard">
        {MODULES.map((m) => (
          <section key={m.path} className="card dash-card" aria-label={m.label}>
            <h2>
              <NavLink to={m.path}>{m.label}</NavLink>
            </h2>
            {m.summary}
          </section>
        ))}
      </div>
    </section>
  )
}

export function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <NavLink to="/">Back to home</NavLink>
    </section>
  )
}
