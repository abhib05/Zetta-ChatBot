import React, { useState, useEffect } from 'react';
import { Plus, ChevronDown, ChevronRight, Lock, Edit2 } from 'lucide-react';

const API = '/admin';
const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
});

export default function Farms() {
  const [farms, setFarms] = useState([]);
  const [crops, setCrops] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [plots, setPlots] = useState({});
  const [showNewFarm, setShowNewFarm] = useState(false);
  const [showNewPlot, setShowNewPlot] = useState(null);
  const [showNewCrop, setShowNewCrop] = useState(false);
  const [editFarm, setEditFarm] = useState(null);
  const [error, setError] = useState('');

  const [newFarm, setNewFarm] = useState({ farm_code: '', farm_name: '', total_acres: '' });
  const [newPlot, setNewPlot] = useState({ plot_code: '', acres: '' });
  const [newCrop, setNewCrop] = useState({ crop_name: '' });
  const [editForm, setEditForm] = useState({ farm_name: '', total_acres: '' });

  const fetchFarms = async () => {
    const res = await fetch(`${API}/farms`, { headers: headers() });
    if (res.ok) {
      setFarms(await res.json());
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  const fetchCrops = async () => {
    const res = await fetch(`${API}/crops`, { headers: headers() });
    if (res.ok) {
      setCrops(await res.json());
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  const fetchPlots = async (farmId) => {
    const res = await fetch(`${API}/farms/${farmId}/plots`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      setPlots(prev => ({ ...prev, [farmId]: data }));
    } else if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
  };

  useEffect(() => { fetchFarms(); fetchCrops(); }, []);

  const toggleFarm = (farmId) => {
    if (expanded === farmId) {
      setExpanded(null);
    } else {
      setExpanded(farmId);
      if (!plots[farmId]) fetchPlots(farmId);
    }
  };

  const handleCreateFarm = async (e) => {
    e.preventDefault();
    setError('');
    const payload = { ...newFarm, total_acres: parseFloat(newFarm.total_acres) || null };
    
    try {
      const res = await fetch(`${API}/farms`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setFarms(prev => [{ ...data, employee_id: null, employee_name: null, employee_code: null }, ...prev]);
        setNewFarm({ farm_code: '', farm_name: '', total_acres: '' });
        setShowNewFarm(false);
      } else {
        setError(data.error || 'Failed to create farm');
      }
    } catch (err) {
      setError('Network error creating farm');
    }
  };

  const handleUpdateFarm = async (farmId) => {
    setError('');
    const payload = { farm_name: editForm.farm_name, total_acres: parseFloat(editForm.total_acres) || null };
    
    try {
      const res = await fetch(`${API}/farms/${farmId}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setFarms(prev => prev.map(f => f.farm_id === farmId ? { ...f, ...data } : f));
        setEditFarm(null);
      } else {
        setError(data.error || 'Failed to update farm');
      }
    } catch (err) {
      setError('Network error updating farm');
    }
  };

  const handleCreatePlot = async (e, farmId) => {
    e.preventDefault();
    setError('');
    const payload = { plot_code: newPlot.plot_code, acres: parseFloat(newPlot.acres) || null };
    
    try {
      const res = await fetch(`${API}/farms/${farmId}/plots`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        const farmObj = farms.find(f => f.farm_id === farmId);
        setPlots(prev => ({
          ...prev,
          [farmId]: [...(prev[farmId] || []), { ...data, assigned_employee: farmObj?.employee_name }]
        }));
        setNewPlot({ plot_code: '', acres: '' });
        setShowNewPlot(null);
      } else {
        setError(data.error || 'Failed to create plot');
      }
    } catch (err) {
      setError('Network error creating plot');
    }
  };

  const handleCreateCrop = async (e) => {
    e.preventDefault();
    setError('');
    const payload = { crop_name: newCrop.crop_name };
    
    try {
      const res = await fetch(`${API}/crops`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setCrops(prev => [...prev, data]);
        setNewCrop({ crop_name: '' });
        setShowNewCrop(false);
      } else {
        setError(data.error || 'Failed to create crop');
      }
    } catch (err) {
      setError('Network error creating crop');
    }
  };

  const startEdit = (farm) => {
    setEditFarm(farm.farm_id);
    setEditForm({ farm_name: farm.farm_name || '', total_acres: farm.total_acres || '' });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Farms and Plots</h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-outline" onClick={() => setShowNewCrop(!showNewCrop)}>
            <Plus size={16} /> New Crop
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewFarm(!showNewFarm)}>
            <Plus size={16} /> New Farm
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {showNewCrop && (
        <div className="glass-panel fade-in" style={{ marginBottom: '1.5rem' }}>
          <h3>Add New Crop</h3>
          <form onSubmit={handleCreateCrop} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Crop Name</label>
              <input value={newCrop.crop_name} onChange={e => setNewCrop({ crop_name: e.target.value })} placeholder="e.g. Sugarcane" required />
            </div>
            <button type="submit" className="btn btn-primary" style={{ height: '45px' }}>Add Crop</button>
          </form>
          {crops.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {crops.map(c => (
                <span key={c.crop_id} className="badge badge-success">{c.crop_name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {showNewFarm && (
        <div className="glass-panel fade-in" style={{ marginBottom: '1.5rem' }}>
          <h3>Create New Farm</h3>
          <form onSubmit={handleCreateFarm}>
            <div className="grid-2">
              <div className="form-group">
                <label>Farm Code</label>
                <input value={newFarm.farm_code} onChange={e => setNewFarm({ ...newFarm, farm_code: e.target.value })} placeholder="e.g. ZF-004" required />
              </div>
              <div className="form-group">
                <label>Farm Name</label>
                <input value={newFarm.farm_name} onChange={e => setNewFarm({ ...newFarm, farm_name: e.target.value })} placeholder="e.g. Sunrise Agro Farm" required />
              </div>
            </div>
            <div className="form-group">
              <label>Total Acres</label>
              <input type="number" step="0.01" value={newFarm.total_acres} onChange={e => setNewFarm({ ...newFarm, total_acres: e.target.value })} placeholder="e.g. 45.50" />
            </div>
            <button type="submit" className="btn btn-primary">Create Farm</button>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {farms.map(farm => (
          <div key={farm.farm_id} className="glass-panel fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggleFarm(farm.farm_id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {expanded === farm.farm_id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0 }}>{farm.farm_name || 'Unnamed Farm'}</h3>
                    {farm.employee_name ? (
                       <span className="badge badge-info">Assigned: {farm.employee_name}</span>
                    ) : (
                       <span className="badge badge-neutral">Unassigned</span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0, marginTop: '0.25rem' }}>
                    {farm.farm_code} {farm.total_acres ? `| ${farm.total_acres} acres` : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }} onClick={e => e.stopPropagation()}>
                {editFarm === farm.farm_id ? (
                  <>
                    <input style={{ width: '150px' }} value={editForm.farm_name} onChange={e => setEditForm({ ...editForm, farm_name: e.target.value })} placeholder="Farm Name" />
                    <input style={{ width: '100px' }} type="number" value={editForm.total_acres} onChange={e => setEditForm({ ...editForm, total_acres: e.target.value })} placeholder="Acres" />
                    <button className="btn btn-success" style={{ padding: '0.5rem' }} onClick={() => handleUpdateFarm(farm.farm_id)}>Save</button>
                    <button className="btn btn-outline" style={{ padding: '0.5rem' }} onClick={() => setEditFarm(null)}>Cancel</button>
                  </>
                ) : (
                  <button className="btn btn-outline" style={{ padding: '0.5rem' }} onClick={() => startEdit(farm)}>
                    <Edit2 size={16} />
                  </button>
                )}
              </div>
            </div>

            {expanded === farm.farm_id && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>Plots</h3>
                  <button className="btn btn-outline" style={{ padding: '0.5rem 1rem' }} onClick={() => setShowNewPlot(showNewPlot === farm.farm_id ? null : farm.farm_id)}>
                    <Plus size={16} /> Add Plot
                  </button>
                </div>

                {showNewPlot === farm.farm_id && (
                  <form onSubmit={(e) => handleCreatePlot(e, farm.farm_id)} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem', padding: '1rem', background: 'var(--panel-inner-bg)', borderRadius: '8px' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Plot Code</label>
                      <input value={newPlot.plot_code} onChange={e => setNewPlot({ ...newPlot, plot_code: e.target.value })} placeholder="e.g. A1" required />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Acres</label>
                      <input type="number" step="0.01" value={newPlot.acres} onChange={e => setNewPlot({ ...newPlot, acres: e.target.value })} placeholder="e.g. 10" />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ height: '45px' }}>Add</button>
                  </form>
                )}

                {plots[farm.farm_id] && plots[farm.farm_id].length > 0 ? (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Plot Code</th>
                          <th>Acres</th>
                          <th>Current Crop</th>
                          <th>Status</th>
                          <th>Assigned To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plots[farm.farm_id].map(plot => (
                          <tr key={plot.plot_id}>
                            <td>{plot.plot_code}</td>
                            <td>{plot.acres || '-'}</td>
                            <td>{plot.crops?.crop_name || '-'}</td>
                            <td>
                              {plot.current_crop_id ? (
                                <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Lock size={12} /> Locked
                                </span>
                              ) : (
                                <span className="badge badge-success">Available</span>
                              )}
                            </td>
                            <td>
                               {plot.assigned_employee ? plot.assigned_employee : <span style={{ color: 'var(--text-secondary)' }}>- Unassigned</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>
                    No plots yet. Add one above.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
