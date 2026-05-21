import React, { useState, useEffect } from 'react';
import { Plus, UserPlus, X, Link2 } from 'lucide-react';

const API = 'http://localhost:3000/admin';
const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
});

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [farms, setFarms] = useState([]);
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employee_code: '', employee_name: '' });
  const [error, setError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [assignedFarms, setAssignedFarms] = useState([]);
  const [assignFarmId, setAssignFarmId] = useState('');

  const fetchEmployees = async () => {
    const res = await fetch(`${API}/employees`, { headers: headers() });
    if (res.ok) setEmployees(await res.json());
  };

  const fetchFarms = async () => {
    const res = await fetch(`${API}/farms`, { headers: headers() });
    if (res.ok) setFarms(await res.json());
  };

  const fetchAssignedFarms = async (empId) => {
    const res = await fetch(`${API}/employees/${empId}/farms`, { headers: headers() });
    if (res.ok) setAssignedFarms(await res.json());
  };

  useEffect(() => { fetchEmployees(); fetchFarms(); }, []);

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`${API}/employees`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify(newEmployee)
    });
    if (res.ok) {
      setNewEmployee({ employee_code: '', employee_name: '' });
      setShowNewEmployee(false);
      fetchEmployees();
    } else {
      const data = await res.json();
      setError(data.error);
    }
  };

  const selectEmployee = (emp) => {
    setSelectedEmployee(emp);
    fetchAssignedFarms(emp.employee_id);
    setAssignFarmId('');
  };

  const handleAssignFarm = async () => {
    if (!assignFarmId) return;
    setError('');
    const res = await fetch(`${API}/farm-memberships`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ employee_id: selectedEmployee.employee_id, farm_id: assignFarmId, role: 'Member' })
    });
    if (res.ok) {
      setAssignFarmId('');
      fetchAssignedFarms(selectedEmployee.employee_id);
    } else {
      const data = await res.json();
      setError(data.error);
    }
  };

  const handleUnassignFarm = async (membershipId) => {
    const res = await fetch(`${API}/farm-memberships/${membershipId}`, {
      method: 'DELETE', headers: headers()
    });
    if (res.ok) {
      fetchAssignedFarms(selectedEmployee.employee_id);
    }
  };

  // Get farm IDs that are already assigned
  const assignedFarmIds = assignedFarms.map(af => af.farms?.farm_id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Employee Management</h1>
        <button className="btn btn-primary" onClick={() => setShowNewEmployee(!showNewEmployee)}>
          <UserPlus size={16} /> New Employee
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* New Employee Form */}
      {showNewEmployee && (
        <div className="glass-panel fade-in" style={{ marginBottom: '1.5rem' }}>
          <h3>Create New Employee</h3>
          <form onSubmit={handleCreateEmployee}>
            <div className="grid-2">
              <div className="form-group">
                <label>Employee Code</label>
                <input value={newEmployee.employee_code} onChange={e => setNewEmployee({ ...newEmployee, employee_code: e.target.value })} placeholder="e.g. emp 004" required />
              </div>
              <div className="form-group">
                <label>Employee Name</label>
                <input value={newEmployee.employee_name} onChange={e => setNewEmployee({ ...newEmployee, employee_name: e.target.value })} placeholder="e.g. Rajesh Patil" required />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Create Employee</button>
          </form>
        </div>
      )}

      <div className="grid-2">
        {/* Left: Employee List */}
        <div className="glass-panel">
          <h3>All Employees</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr
                    key={emp.employee_id}
                    onClick={() => selectEmployee(emp)}
                    style={{
                      cursor: 'pointer',
                      background: selectedEmployee?.employee_id === emp.employee_id ? 'rgba(16, 185, 129, 0.1)' : 'transparent'
                    }}
                  >
                    <td style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{emp.employee_code}</td>
                    <td>{emp.employee_name}</td>
                    <td>
                      {emp.active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-error">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Farm Assignments */}
        <div className="glass-panel">
          {selectedEmployee ? (
            <>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Link2 size={20} />
                Farm Assignments for {selectedEmployee.employee_name}
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                Code: <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{selectedEmployee.employee_code}</code>
              </p>

              {/* Assign new farm */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <select value={assignFarmId} onChange={e => setAssignFarmId(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Select a farm to assign...</option>
                  {farms.filter(f => !assignedFarmIds.includes(f.farm_id)).map(f => (
                    <option key={f.farm_id} value={f.farm_id}>{f.farm_code} — {f.farm_name}</option>
                  ))}
                </select>
                <button className="btn btn-primary" onClick={handleAssignFarm} disabled={!assignFarmId}>
                  <Plus size={16} /> Assign
                </button>
              </div>

              {/* Assigned farms list */}
              {assignedFarms.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                  No farms assigned yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {assignedFarms.map(af => (
                    <div key={af.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div>
                        <strong>{af.farms?.farm_code}</strong>
                        <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>{af.farms?.farm_name}</span>
                      </div>
                      <button className="btn btn-outline" style={{ padding: '0.4rem', color: 'var(--danger)' }} onClick={() => handleUnassignFarm(af.id)}>
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-secondary)' }}>
              <p>Select an employee to manage farm assignments</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
