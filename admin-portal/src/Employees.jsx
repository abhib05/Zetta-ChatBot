import React, { useState, useEffect } from 'react';
import { Plus, UserPlus, X, Link2 } from 'lucide-react';

const API = '/admin';
const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
});

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [farms, setFarms] = useState([]); // This will hold UNASSIGNED farms
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employee_code: '', employee_name: '', phone_number: '' });
  const [error, setError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [assignedFarms, setAssignedFarms] = useState([]);
  const [assignFarmId, setAssignFarmId] = useState('');

  const fetchEmployees = async () => {
    const res = await fetch(`${API}/employees`, { headers: headers() });
    if (res.ok) {
      setEmployees(await res.json());
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  const fetchUnassignedFarms = async () => {
    const res = await fetch(`${API}/farms/unassigned`, { headers: headers() });
    if (res.ok) {
      setFarms(await res.json());
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  const fetchAssignedFarms = async (empId) => {
    const res = await fetch(`${API}/employees/${empId}/farms`, { headers: headers() });
    if (res.ok) {
      setAssignedFarms(await res.json());
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  useEffect(() => { 
    fetchEmployees(); 
    fetchUnassignedFarms(); 
  }, []);

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    if (!newEmployee.employee_code || !newEmployee.employee_name || !newEmployee.phone_number) return;
    setError('');

    try {
      const res = await fetch(`${API}/employees`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(newEmployee)
      });
      const data = await res.json();
      if (res.ok) {
        setEmployees(prev => [...prev, data]);
        setNewEmployee({ employee_code: '', employee_name: '', phone_number: '' });
        setShowNewEmployee(false);
      } else {
        setError(data.error || 'Failed to create employee');
      }
    } catch (err) {
      setError('Network error creating employee');
    }
  };

  const selectEmployee = (emp) => {
    setSelectedEmployee(emp);
    fetchAssignedFarms(emp.employee_id);
    setAssignFarmId('');
  };

  const handleAssignFarm = async () => {
    if (!assignFarmId || !selectedEmployee) return;
    setError('');
    
    const farmToAssign = farms.find(f => f.farm_id === assignFarmId);
    if (!farmToAssign) return;

    try {
      const res = await fetch(`${API}/farm-memberships`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ employee_id: selectedEmployee.employee_id, farm_id: farmToAssign.farm_id })
      });
      const data = await res.json();
      if (res.ok) {
        setAssignedFarms(prev => [...prev, {
          id: data.id,
          role: data.role || 'Member',
          farms: { farm_id: farmToAssign.farm_id, farm_code: farmToAssign.farm_code, farm_name: farmToAssign.farm_name }
        }]);
        setFarms(prev => prev.filter(f => f.farm_id !== assignFarmId));
        setAssignFarmId('');
      } else {
        setError(data.error || 'Failed to assign farm');
      }
    } catch (err) {
      setError('Network error assigning farm');
    }
  };

  const handleUnassignFarm = async (membershipId, farmObj) => {
    setError('');
    try {
      const res = await fetch(`${API}/farm-memberships/${membershipId}`, {
        method: 'DELETE',
        headers: headers()
      });
      if (res.ok) {
        setAssignedFarms(prev => prev.filter(af => af.id !== membershipId));
        setFarms(prev => [...prev, { farm_id: farmObj.farm_id, farm_code: farmObj.farm_code, farm_name: farmObj.farm_name }]);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to unassign farm');
      }
    } catch (err) {
      setError('Network error unassigning farm');
    }
  };

  const handleDeactivateEmployee = async (emp) => {
    setError('');
    try {
      const res = await fetch(`${API}/employees/${emp.employee_id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ active: false, employee_name: emp.employee_name, employee_code: emp.employee_code, phone_number: emp.phone_number })
      });
      const data = await res.json();
      if (res.ok) {
        setEmployees(prev => prev.map(e => e.employee_id === emp.employee_id ? { ...e, active: false } : e));
        
        if (selectedEmployee?.employee_id === emp.employee_id) {
           // All assigned farms become unassigned
           setFarms(prev => [...prev, ...assignedFarms.map(af => af.farms)]);
           setAssignedFarms([]);
        }
      } else {
        setError(data.error || 'Failed to deactivate employee');
      }
    } catch (err) {
      setError('Network error deactivating employee');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--text-primary)' }}>Employee Management</h1>
        <button className="btn btn-primary" onClick={() => setShowNewEmployee(!showNewEmployee)}>
          <UserPlus size={16} /> New Employee
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {showNewEmployee && (
        <div className="glass-panel fade-in" style={{ marginBottom: '1.5rem' }}>
          <h3>Create New Employee</h3>
          <form onSubmit={handleCreateEmployee}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Employee Code</label>
                <input value={newEmployee.employee_code} onChange={e => setNewEmployee({ ...newEmployee, employee_code: e.target.value })} placeholder="e.g. emp 004" required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Employee Name</label>
                <input value={newEmployee.employee_name} onChange={e => setNewEmployee({ ...newEmployee, employee_name: e.target.value })} placeholder="e.g. Rajesh Patil" required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Phone Number (WhatsApp, e.g. 919999999901)</label>
                <input value={newEmployee.phone_number} onChange={e => setNewEmployee({ ...newEmployee, phone_number: e.target.value })} placeholder="e.g. 919999999901" required />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Create Employee</button>
          </form>
        </div>
      )}

      <div className="grid-2">
        <div className="glass-panel">
          <h3>All Employees</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Phone Number</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr
                    key={emp.employee_id}
                    onClick={() => selectEmployee(emp)}
                    style={{
                      cursor: 'pointer',
                      background: selectedEmployee?.employee_id === emp.employee_id ? 'var(--highlight-bg)' : 'transparent'
                    }}
                  >
                    <td style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{emp.employee_code}</td>
                    <td>{emp.employee_name}</td>
                    <td>{emp.phone_number || <span style={{ color: 'var(--text-secondary)' }}>- None</span>}</td>
                    <td>
                      {emp.active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-neutral">Inactive</span>
                      )}
                    </td>
                    <td>
                       {emp.active && (
                         <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleDeactivateEmployee(emp); }}>
                           Deactivate
                         </button>
                       )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel">
          {selectedEmployee ? (
            <>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Link2 size={20} />
                Farm Assignments for {selectedEmployee.employee_name}
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                Code: <code style={{ background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>{selectedEmployee.employee_code}</code>
              </p>

              {selectedEmployee.active ? (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <select value={assignFarmId} onChange={e => setAssignFarmId(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Select an unassigned farm...</option>
                    {farms.map(f => (
                      <option key={f.farm_id} value={f.farm_id}>{f.farm_code} — {f.farm_name}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" onClick={handleAssignFarm} disabled={!assignFarmId}>
                    <Plus size={16} /> Assign
                  </button>
                </div>
              ) : (
                <div style={{ padding: '1rem', background: 'var(--neutral-bg)', borderRadius: '8px', marginBottom: '1.5rem' }}>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>This employee is inactive. All farm assignments have been released.</p>
                </div>
              )}

              {assignedFarms.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                  No farms assigned yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {assignedFarms.map(af => (
                    <div key={af.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--panel-inner-bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div>
                        <strong>{af.farms?.farm_code}</strong>
                        <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>{af.farms?.farm_name}</span>
                      </div>
                      <button className="btn btn-outline" style={{ padding: '0.4rem', color: 'var(--danger)', borderColor: 'var(--danger-border)' }} onClick={() => handleUnassignFarm(af.id, af.farms)}>
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
