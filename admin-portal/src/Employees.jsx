import React, { useState, useEffect } from 'react';
import { Plus, UserPlus, X, Link2 } from 'lucide-react';
import { usePendingChanges } from './hooks/usePendingChanges';

const API = 'http://localhost:3000/admin';
const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
});

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [farms, setFarms] = useState([]); // This will hold UNASSIGNED farms
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employee_code: '', employee_name: '' });
  const [error, setError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [assignedFarms, setAssignedFarms] = useState([]);
  const [assignFarmId, setAssignFarmId] = useState('');
  
  const { addChange } = usePendingChanges();

  const fetchEmployees = async () => {
    const res = await fetch(`${API}/employees`, { headers: headers() });
    if (res.ok) setEmployees(await res.json());
  };

  const fetchUnassignedFarms = async () => {
    const res = await fetch(`${API}/farms/unassigned`, { headers: headers() });
    if (res.ok) setFarms(await res.json());
  };

  const fetchAssignedFarms = async (empId) => {
    const res = await fetch(`${API}/employees/${empId}/farms`, { headers: headers() });
    if (res.ok) setAssignedFarms(await res.json());
  };

  useEffect(() => { 
    fetchEmployees(); 
    fetchUnassignedFarms(); 
  }, []);

  const handleCreateEmployee = (e) => {
    e.preventDefault();
    if (!newEmployee.employee_code || !newEmployee.employee_name) return;
    
    // Optimistic UI
    const tempId = 'temp-' + Date.now();
    const newEmp = { ...newEmployee, employee_id: tempId, active: true };
    setEmployees(prev => [...prev, newEmp]);
    
    // Queue change
    addChange({ type: 'CREATE_EMPLOYEE', payload: newEmployee });
    
    setNewEmployee({ employee_code: '', employee_name: '' });
    setShowNewEmployee(false);
  };

  const selectEmployee = (emp) => {
    setSelectedEmployee(emp);
    fetchAssignedFarms(emp.employee_id);
    setAssignFarmId('');
  };

  const handleAssignFarm = () => {
    if (!assignFarmId || !selectedEmployee) return;
    
    const farmToAssign = farms.find(f => f.farm_id === assignFarmId);
    if (!farmToAssign) return;

    // Optimistic UI
    const tempMembershipId = 'temp-mem-' + Date.now();
    setAssignedFarms(prev => [...prev, {
      id: tempMembershipId,
      role: 'Member',
      farms: { farm_id: farmToAssign.farm_id, farm_code: farmToAssign.farm_code, farm_name: farmToAssign.farm_name }
    }]);
    setFarms(prev => prev.filter(f => f.farm_id !== assignFarmId));
    setAssignFarmId('');

    // Queue change
    addChange({ type: 'ASSIGN_FARM', employee_id: selectedEmployee.employee_id, farm_id: farmToAssign.farm_id });
  };

  const handleUnassignFarm = (membershipId, farmObj) => {
    // Optimistic UI
    setAssignedFarms(prev => prev.filter(af => af.id !== membershipId));
    setFarms(prev => [...prev, { farm_id: farmObj.farm_id, farm_code: farmObj.farm_code, farm_name: farmObj.farm_name }]);

    // Queue change
    // Only queue DELETE if it's a real ID from the DB
    if (!String(membershipId).startsWith('temp-')) {
      addChange({ type: 'DELETE_MEMBERSHIP', id: membershipId });
    }
  };

  const handleDeactivateEmployee = (emp) => {
    // Optimistic UI
    setEmployees(prev => prev.map(e => e.employee_id === emp.employee_id ? { ...e, active: false } : e));
    
    if (selectedEmployee?.employee_id === emp.employee_id) {
       // All assigned farms become unassigned
       setFarms(prev => [...prev, ...assignedFarms.map(af => af.farms)]);
       setAssignedFarms([]);
    }

    // Queue change
    if (!String(emp.employee_id).startsWith('temp-')) {
       addChange({ type: 'DEACTIVATE_EMPLOYEE', id: emp.employee_id });
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
        <div className="glass-panel">
          <h3>All Employees</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
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
