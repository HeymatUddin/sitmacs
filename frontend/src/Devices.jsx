import { useEffect, useState } from 'react'

const emptyForm = {
  device_name: '',
  serial_number: '',
  device_type: '',
}

export default function Devices({ api, user }) {
  const [deviceTab, setDeviceTab] = useState('inventory')
  const [devices, setDevices] = useState([])
  const [employees, setEmployees] = useState([])
  const [selectedEmployees, setSelectedEmployees] = useState({})
  const [form, setForm] = useState({ ...emptyForm })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [historyDevice, setHistoryDevice] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDevices() {
      setLoading(true)
      setError('')

      try {
        const data = await api(
          user.role === 'Employee' ? '/devices/mine' : '/devices'
        )

        if (!cancelled) {
          setDevices(data.devices)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadDevices()

    return () => {
      cancelled = true
    }
  }, [api, reload, user.role])
  useEffect(() => {
    if (user.role !== 'IT Support') return

    let cancelled = false

    async function loadEmployees() {
      try {
        const data = await api('/devices/employees')

        if (!cancelled) {
          setEmployees(data.employees)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
        }
      }
    }

    loadEmployees()

    return () => {
      cancelled = true
    }
  }, [api, user.role, reload])
  function updateForm(event) {
    const { name, value } = event.target

    setForm(previous => ({
      ...previous,
      [name]: value,
    }))
  }

  async function addDevice(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const body = {
      device_name: form.device_name.trim(),
      serial_number: form.serial_number.trim(),
      device_type: form.device_type.trim(),
    }

    if (Object.values(body).some(value => !value)) {
      setError('Complete all three device fields.')
      return
    }

    setSaving(true)

    try {
      const result = await api('/devices', { body })

      setForm({ ...emptyForm })
      setMessage(result.message)
      setReload(value => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  async function assignDevice(deviceId) {
    const employeeId = Number(selectedEmployees[deviceId])

    setError('')
    setMessage('')

    if (!Number.isSafeInteger(employeeId) || employeeId < 1) {
      setError('Select an employee first.')
      return
    }

    setSaving(true)

    try {
      const result = await api(`/devices/${deviceId}/assign`, {
        body: { employee_id: employeeId },
      })

      setSelectedEmployees(previous => {
        const next = { ...previous }
        delete next[deviceId]
        return next
      })

      setMessage(result.message)
      setReload(value => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  async function returnDevice(device) {
    setError('')
    setMessage('')
    setSaving(true)

    try {
      const result = await api(`/devices/${device.id}/return`, {
        body: {
          assignment_id: device.assignment_id,
        },
      })

      setMessage(result.message)
      setReload(value => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  async function showHistory(device) {
    setHistoryDevice(device)
    setHistory([])
    setHistoryError('')
    setHistoryLoading(true)

    try {
      const data = await api(`/devices/${device.id}/history`)
      setHistory(data.history)
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setHistoryLoading(false)
    }
  }
  const isSupport = user.role === 'IT Support'
  const assigning = isSupport && deviceTab === 'assign'
  const visibleDevices = assigning
    ? devices.filter(device => device.device_status === 'available')
    : devices

  return (
    <>
      {isSupport && (
        <nav className="tabs" aria-label="Device sections">
          {[
            ['create', 'Create Device'],
            ['assign', 'Assign Device'],
            ['inventory', 'Device Inventory'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={deviceTab === value ? 'chosen' : ''}
              aria-current={deviceTab === value ? 'page' : undefined}
              disabled={saving || historyLoading}
              onClick={() => {
                setDeviceTab(value)
                setHistoryDevice(null)
                setError('')
                setMessage('')
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {isSupport && deviceTab === 'create' && (
        <section className="panel setup-panel">
          <h2>Create Device</h2>
          <p className="muted">
            Register a device using its manufacturer serial number.
          </p>

          <form onSubmit={addDevice}>
            <label htmlFor="device-name">Device name</label>
            <input
              id="device-name"
              name="device_name"
              value={form.device_name}
              onChange={updateForm}
              maxLength={100}
              placeholder="Office Laptop 01"
              required
              disabled={saving}
            />

            <label htmlFor="device-serial">Serial number</label>
            <input
              id="device-serial"
              name="serial_number"
              value={form.serial_number}
              onChange={updateForm}
              maxLength={100}
              placeholder="Manufacturer serial number"
              required
              disabled={saving}
            />

            <label htmlFor="device-type">Device type</label>
            <input
              id="device-type"
              name="device_type"
              value={form.device_type}
              onChange={updateForm}
              maxLength={50}
              placeholder="Laptop, Desktop, Tablet..."
              required
              disabled={saving}
            />

            <button
              className="primary"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Add device'}
            </button>
          </form>
        </section>
      )}

      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="message success" role="status">
          {message}
        </p>
      )}

      {(!isSupport || deviceTab !== 'create') && (
      <section
        className="panel table-panel"
        style={{ marginTop: 24 }}
      >
        <div className="panel-heading">
          <h2>{user.role === 'Employee' ? 'My devices' : assigning ? 'Assign Device' : 'Device Inventory'}</h2>

          <button
            className="text-button"
            disabled={loading || saving}
            onClick={() => setReload(value => value + 1)}
          >
            Refresh ↻
          </button>
        </div>

        {loading ? (
          <p className="empty" role="status">
            Loading devices…
          </p>
        ) : error ? (
          <p className="empty">
            Resolve the error above, then refresh the inventory.
          </p>
        ) : visibleDevices.length === 0 ? (
          <p className="empty">
            {user.role === 'Employee'
              ? 'No devices are currently assigned to you.'
              : assigning ? 'No available devices to assign.' : 'No devices registered yet.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Registered organisation devices
              </caption>

              <thead>
                <tr>
                  <th>Device name</th>
                  <th>Serial number</th>
                  <th>Type</th>
                  <th>Status</th>
                  {user.role !== 'Employee' && <th>Assigned to</th>}
                  {user.role === 'IT Support' && <th>Action</th>}
                  {!assigning && ['Administrator', 'IT Support'].includes(user.role) && (
                    <th>History</th>
                  )}
                </tr>
              </thead>

              <tbody>
                {visibleDevices.map(device => (
                  <tr key={device.id}>
                    <td>{device.device_name}</td>
                    <td>{device.serial_number}</td>
                    <td>{device.device_type}</td>
                    <td>{device.device_status}</td>

                    {user.role !== 'Employee' && (
                      <td>
                        {device.assigned_user_id
                          ? `${device.assigned_full_name} (${device.assigned_user_id})`
                          : '—'}
                      </td>
                    )}

                    {user.role === 'IT Support' && (
                      <td>
                        {assigning && device.device_status === 'available' ? (
                          <div>
                            <select
                              aria-label={`Select employee for ${device.device_name}`}
                              value={selectedEmployees[device.id] || ''}
                              onChange={event => {
                                const value = event.target.value

                                setSelectedEmployees(previous => ({
                                  ...previous,
                                  [device.id]: value,
                                }))
                              }}
                              disabled={saving || employees.length === 0}
                            >
                              <option value="">
                                {employees.length === 0
                                  ? 'No employees available'
                                  : 'Select employee'}
                              </option>

                              {employees.map(employee => (
                                <option key={employee.id} value={employee.id}>
                                  {employee.full_name} ({employee.user_id})
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              className="primary"
                              disabled={saving || !selectedEmployees[device.id]}
                              onClick={() => assignDevice(device.id)}
                            >
                              {saving ? 'Please wait…' : 'Assign'}
                            </button>
                          </div>
                        ) : !assigning && device.device_status === 'assigned' &&
                          device.assignment_id ? (
                          <button
                            type="button"
                            className="primary"
                            disabled={saving}
                            onClick={() => returnDevice(device)}
                          >
                            {saving ? 'Please wait…' : 'Return'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                    {!assigning && ['Administrator', 'IT Support'].includes(user.role) && (
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          disabled={saving || historyLoading}
                          onClick={() => showHistory(device)}
                        >
                          View history
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
      {historyDevice &&
        ['Administrator', 'IT Support'].includes(user.role) && (
          <section
            className="panel table-panel"
            style={{ marginTop: 24 }}
          >
            <div className="panel-heading">
              <h2>History: {historyDevice.device_name}</h2>

              <button
                type="button"
                className="text-button"
                disabled={historyLoading}
                onClick={() => setHistoryDevice(null)}
              >
                Close
              </button>
            </div>

            {historyLoading ? (
              <p className="empty" role="status">
                Loading history…
              </p>
            ) : historyError ? (
              <p className="message error" role="alert">
                {historyError}
              </p>
            ) : history.length === 0 ? (
              <p className="empty">No assignment history yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    Assignment history for {historyDevice.device_name}
                  </caption>

                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Assigned at</th>
                      <th>Assigned by</th>
                      <th>Returned at</th>
                      <th>Received by</th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          {entry.employee_name} ({entry.employee_user_id})
                        </td>
                        <td>
                          {new Date(entry.assigned_at).toLocaleString()}
                        </td>
                        <td>{entry.assigned_by_user_id}</td>
                        <td>
                          {entry.returned_at
                            ? new Date(entry.returned_at).toLocaleString()
                            : 'Not returned yet'}
                        </td>
                        <td>{entry.returned_by_user_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
    </>
  )
}