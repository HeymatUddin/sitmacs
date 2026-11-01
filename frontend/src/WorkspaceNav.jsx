export default function WorkspaceNav({
  user,
  view,
  onNavigate,
  onboarding = false,
}) {
  if (onboarding) {
    return (
      <nav aria-label="Workspace navigation">
        <div className="nav-item active">Account setup</div>
      </nav>
    )
  }

  const items = [
    { id: 'overview', label: 'Overview' },
    { id: 'profile', label: 'Profile' },
    { id: 'files', label: 'Files' },
  ]

  if (['Administrator', 'IT Support', 'Employee'].includes(user.role)) {
    items.push({
      id: 'devices',
      label: user.role === 'Employee' ? 'My devices' : 'Devices',
    })
  }

  if (user.role === 'IT Support') {
    items.push({ id: 'create', label: 'Create user' })
  }

  if (user.role === 'Administrator') {
    items.push({ id: 'users', label: 'User management' })
    items.push({ id: 'software', label: 'Software permissions' })
  }

  if (['Administrator', 'IT Security Officer'].includes(user.role)) {
    items.push({ id: 'audit', label: 'Audit activity' })
  }
  if (['Employee', 'IT Support', 'IT Security Officer'].includes(user.role)) {
    items.push({ id: 'software', label: 'Software permissions' })
  }
  return (
    <nav className="workspace-nav" aria-label="Workspace navigation">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={`nav-item ${view === item.id ? 'active' : ''}`}
          aria-current={view === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}