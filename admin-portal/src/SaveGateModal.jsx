import React, { useState, useEffect, useRef } from 'react';

export default function SaveGateModal({ onSave, onDiscard, onCancel }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSave = async () => {
    if (!password) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:3000/admin/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({ password })
      });
      
      const data = await res.json();
      
      if (res.ok && data.valid) {
        onSave(); // Password correct, flush changes and navigate
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setPassword('');
        inputRef.current?.focus();
        
        if (data.locked || newAttempts >= 3) {
          setError('Authorization unsuccessful. Changes discarded.');
          setTimeout(() => {
            onDiscard(); // Navigate away without saving after reading error
          }, 2000);
        } else {
          setError(`Incorrect password (${newAttempts}/3 attempts)`);
        }
      }
    } catch (err) {
      setError('Network error checking authorization.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', background: '#fff', color: '#000', border: '1px solid #ccc' }}>
        <h3 style={{ marginBottom: '1rem', color: '#000' }}>Unsaved Changes</h3>
        <p style={{ marginBottom: '1.5rem', color: '#333' }}>
          Enter your admin password to save and leave, or discard all changes.
        </p>

        {error && (
          <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', marginBottom: '1rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <div className="form-group">
          <input
            type="password"
            ref={inputRef}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            disabled={loading || attempts >= 3}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            style={{ background: '#fff', color: '#000', border: '1px solid #ccc' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button className="btn btn-outline" style={{ color: '#000', borderColor: '#ccc' }} onClick={onCancel} disabled={loading || attempts >= 3}>
            Cancel
          </button>
          <button className="btn btn-warning" onClick={onDiscard} disabled={loading || attempts >= 3}>
            Discard & Leave
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!password || loading || attempts >= 3}>
            {loading ? 'Verifying...' : 'Save & Leave'}
          </button>
        </div>
      </div>
    </div>
  );
}
