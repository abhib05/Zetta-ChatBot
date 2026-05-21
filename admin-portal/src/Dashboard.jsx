import React, { useState, useEffect } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';
import { usePendingChanges } from './hooks/usePendingChanges';

export default function Dashboard() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const { addChange } = usePendingChanges();

  const fetchRequests = async () => {
    try {
      const res = await fetch('http://localhost:3000/admin/harvest-requests', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
      });
      const data = await res.json();
      if (res.ok) setRequests(data);
      else setError(data.error);
    } catch (err) {
      setError('Failed to load harvest requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleAction = (id, action) => {
    // Optimistic UI
    setRequests(prev => prev.filter(r => r.request_id !== id));
    
    // Queue change
    addChange({ type: action === 'approve' ? 'APPROVE_HARVEST' : 'REJECT_HARVEST', id });
  };

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Overview</h1>
      
      <div className="glass-panel">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b' }}>
          <AlertCircle size={24} />
          Pending Harvest Authorizations
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Review and approve harvest activities. Approving will clear the plot for the next crop.
        </p>

        {loading ? (
          <p>Loading...</p>
        ) : error ? (
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        ) : requests.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--panel-inner-bg)', borderRadius: '8px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>No pending harvest requests at this time.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date Requested</th>
                  <th>Farm</th>
                  <th>Plot</th>
                  <th>Crop to Harvest</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.request_id}>
                    <td>{new Date(req.requested_at).toLocaleDateString()}</td>
                    <td>{req.farm_plots?.farms?.farm_name}</td>
                    <td>{req.farm_plots?.plot_code}</td>
                    <td><span className="badge badge-warning">{req.crops?.crop_name}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => handleAction(req.request_id, 'approve')} className="btn btn-success" style={{ padding: '0.5rem' }}>
                          <Check size={16} /> Approve
                        </button>
                        <button onClick={() => handleAction(req.request_id, 'reject')} className="btn btn-danger" style={{ padding: '0.5rem' }}>
                          <X size={16} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
