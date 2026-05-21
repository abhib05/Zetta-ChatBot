import React, { useState, useEffect } from 'react';
import { RouterProvider, createBrowserRouter, Navigate, Link, useLocation, Outlet, useBlocker, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Tractor, LogOut } from 'lucide-react';
import Login from './Login';
import Farms from './Farms';
import Employees from './Employees';
import Dashboard from './Dashboard';
import { PendingChangesProvider } from './context/PendingChangesContext';
import { usePendingChanges } from './hooks/usePendingChanges';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import SaveGateModal from './SaveGateModal';

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('adminToken');
  return token ? children : <Navigate to="/login" />;
};

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    window.location.href = '/login';
  };

  return (
    <div className="sidebar">
      <div style={{ padding: '0 1rem' }}>
        <h2 style={{ color: 'var(--primary)', margin: 0 }}>Zetta Admin</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Farm Management Portal</p>
      </div>

      <div className="sidebar-nav">
        <Link to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </Link>
        <Link to="/farms" className={`nav-item ${location.pathname.startsWith('/farms') ? 'active' : ''}`}>
          <Tractor size={20} />
          <span>Farms & Plots</span>
        </Link>
        <Link to="/employees" className={`nav-item ${location.pathname.startsWith('/employees') ? 'active' : ''}`}>
          <Users size={20} />
          <span>Employees</span>
        </Link>
      </div>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <button onClick={handleLogout} className="nav-item" style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

const AppLayout = () => {
  const { isDirty, flushChanges, clearChanges } = usePendingChanges();
  const [showSaveGate, setShowSaveGate] = useState(false);
  const [blockedLocation, setBlockedLocation] = useState(null);
  const navigate = useNavigate();

  // Handle browser tab close/refresh
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Handle idle timeout
  useIdleTimeout(() => {
    if (isDirty) {
      clearChanges();
      localStorage.removeItem('adminToken');
      window.location.href = '/login?reason=idle';
    }
  });

  // Handle internal navigation blocking
  let blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowSaveGate(true);
      setBlockedLocation(blocker.location);
    }
  }, [blocker.state]);

  const handleSave = async () => {
    const { success } = await flushChanges();
    if (success) {
      setShowSaveGate(false);
      if (blocker.state === 'blocked') {
        blocker.proceed();
      }
    }
  };

  const handleDiscard = () => {
    clearChanges();
    setShowSaveGate(false);
    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
  };

  const handleCancel = () => {
    setShowSaveGate(false);
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
  };

  return (
    <div className="app-container">
      {isDirty && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: '#f59e0b', color: '#fff', textAlign: 'center', padding: '0.25rem', zIndex: 50, fontWeight: 'bold' }}>
          Unsaved changes
        </div>
      )}
      <Sidebar />
      <main className="main-content fade-in" style={{ marginTop: isDirty ? '24px' : '0' }}>
        <Outlet />
      </main>
      {showSaveGate && (
        <SaveGateModal onSave={handleSave} onDiscard={handleDiscard} onCancel={handleCancel} />
      )}
    </div>
  );
};

const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />
  },
  {
    path: '/',
    element: (
      <PrivateRoute>
        <PendingChangesProvider>
          <AppLayout />
        </PendingChangesProvider>
      </PrivateRoute>
    ),
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/farms', element: <Farms /> },
      { path: '/employees', element: <Employees /> }
    ]
  }
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
