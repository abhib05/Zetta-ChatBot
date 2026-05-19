import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Tractor, LogOut } from 'lucide-react';
import Login from './Login';
import Farms from './Farms';
import Employees from './Employees';
import Dashboard from './Dashboard';

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('adminToken');
  return token ? children : <Navigate to="/login" />;
};

const Sidebar = () => {
  const location = useLocation();
  
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

const AppLayout = ({ children }) => (
  <div className="app-container">
    <Sidebar />
    <main className="main-content fade-in">
      {children}
    </main>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={
          <PrivateRoute>
            <AppLayout><Dashboard /></AppLayout>
          </PrivateRoute>
        } />
        
        <Route path="/farms" element={
          <PrivateRoute>
            <AppLayout><Farms /></AppLayout>
          </PrivateRoute>
        } />
        
        <Route path="/employees" element={
          <PrivateRoute>
            <AppLayout><Employees /></AppLayout>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
