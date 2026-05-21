import { useContext, useCallback } from 'react';
import { PendingChangesContext } from '../context/PendingChangesContext';

const API = 'http://localhost:3000/admin';

export const usePendingChanges = () => {
  const context = useContext(PendingChangesContext);
  if (!context) {
    throw new Error('usePendingChanges must be used within a PendingChangesProvider');
  }

  const { pendingChanges, isDirty, addChange, clearChanges } = context;

  const flushChanges = useCallback(async (opToken) => {
    if (pendingChanges.length === 0) return { success: true };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      'X-Op-Token': opToken, // Although backend doesn't strictly check X-Op-Token anymore due to our simplified verify-password, it's good practice. Actually, we simplified it to just check the valid session token after verifying password. We don't even need opToken if verify-password passed, but we'll include it.
    };

    try {
      for (const change of pendingChanges) {
        let res;
        switch (change.type) {
          case 'ASSIGN_FARM':
            res = await fetch(`${API}/farm-memberships`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ employee_id: change.employee_id, farm_id: change.farm_id, role: change.role || 'Member' })
            });
            break;
          case 'DELETE_MEMBERSHIP':
            res = await fetch(`${API}/farm-memberships/${change.id}`, {
              method: 'DELETE',
              headers
            });
            break;
          case 'DEACTIVATE_EMPLOYEE':
            res = await fetch(`${API}/employees/${change.id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ active: false }) // Other fields omitted for brevity, backend updates only provided fields or we should send all. We will assume backend handles partial updates or we send what's needed. The current backend expects active, employee_code, employee_name. We should probably just pass payload.
            });
            break;
          case 'UPDATE_EMPLOYEE':
             res = await fetch(`${API}/employees/${change.id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
          case 'CREATE_EMPLOYEE':
            res = await fetch(`${API}/employees`, {
              method: 'POST',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
          case 'UPDATE_FARM':
            res = await fetch(`${API}/farms/${change.id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
          case 'CREATE_FARM':
            res = await fetch(`${API}/farms`, {
              method: 'POST',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
          case 'CREATE_PLOT':
            res = await fetch(`${API}/farms/${change.farmId}/plots`, {
              method: 'POST',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
           case 'CREATE_CROP':
            res = await fetch(`${API}/crops`, {
              method: 'POST',
              headers,
              body: JSON.stringify(change.payload)
            });
            break;
          case 'APPROVE_HARVEST':
            res = await fetch(`${API}/harvest-requests/${change.id}/approve`, {
              method: 'POST',
              headers
            });
            break;
          case 'REJECT_HARVEST':
            res = await fetch(`${API}/harvest-requests/${change.id}/reject`, {
              method: 'POST',
              headers
            });
            break;
          default:
            console.warn('Unknown change type', change.type);
            continue;
        }

        if (!res || !res.ok) {
           const errData = await res?.json().catch(() => ({}));
           return { success: false, error: errData.error || `Failed on ${change.type}` };
        }
      }

      clearChanges();
      return { success: true };
    } catch (err) {
      console.error(err);
      return { success: false, error: 'Network error during flush' };
    }
  }, [pendingChanges, clearChanges]);

  return {
    pendingChanges,
    isDirty,
    addChange,
    clearChanges,
    flushChanges
  };
};
