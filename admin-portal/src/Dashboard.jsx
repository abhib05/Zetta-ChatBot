/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { FileText, Calendar, User, ChevronDown, ChevronUp } from 'lucide-react';

const API = '/admin';

export default function Dashboard() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedReport, setExpandedReport] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');

  const fetchReports = async () => {
    try {
      const res = await fetch(`${API}/reports`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
      });
      const data = await res.json();
      if (res.ok) setReports(data);
      else {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('adminToken');
          window.location.href = '/login';
          return;
        }
        setError(data.error);
      }
    } catch {
      setError('Failed to load submitted reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const toggleExpand = (id) => {
    setExpandedReport(prev => prev === id ? null : id);
  };

  const filteredReports = selectedDate
    ? reports.filter(report => report.report_date === selectedDate)
    : [];

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Overview & Reports</h1>
      
      <div className="glass-panel">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
          <FileText size={24} />
          Submitted Daily Task Sheets (DTS)
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Real-time view of reports submitted by farmers via WhatsApp.
        </p>

        <div style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--panel-inner-bg)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, width: '250px' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
              Filter by Date
            </label>
            <input 
              type="date" 
              value={selectedDate} 
              onChange={e => setSelectedDate(e.target.value)} 
              style={{ padding: '0.5rem 0.75rem', height: '42px', border: '1px solid var(--border)', borderRadius: '6px' }}
            />
          </div>
          {selectedDate && (
            <button 
              className="btn btn-outline" 
              onClick={() => setSelectedDate('')} 
              style={{ height: '42px', padding: '0 1rem' }}
            >
              Clear Filter
            </button>
          )}
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : error ? (
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        ) : !selectedDate ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--panel-inner-bg)', borderRadius: '8px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Please select a date to view reports.</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--panel-inner-bg)', borderRadius: '8px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>No reports submitted for this date.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredReports.map(report => {
              const isExpanded = expandedReport === report.submission_id;
              const formattedDate = new Date(report.report_date).toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              });
              const submissionTime = new Date(report.submitted_at).toLocaleTimeString();
              const employeeName = report.employees?.employee_name || 'System / Unassigned';
              const employeeCode = report.employees?.employee_code || '-';

              return (
                <div key={report.submission_id} className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--border)', background: 'var(--panel-inner-bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggleExpand(report.submission_id)}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{report.farm_name_snapshot} ({report.farm_code_snapshot})</span>
                        <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <User size={12} /> {employeeName} ({employeeCode})
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Calendar size={12} /> {formattedDate}</span>
                        <span>Time: {submissionTime}</span>
                      </div>
                    </div>
                    <div>
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div className="grid-3" style={{ gap: '1rem' }}>
                        <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Deviation Notes</strong>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{report.deviation_notes || 'None reported'}</p>
                        </div>
                        <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Next Day Plans</strong>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{report.next_day_plans || 'None reported'}</p>
                        </div>
                        <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Agronomy Report</strong>
                          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{report.agronomy_report || 'None reported'}</p>
                        </div>
                      </div>

                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0' }}>Logged Activities</h4>
                        {report.dts_activity_entries && report.dts_activity_entries.length > 0 ? (
                          <div className="table-container">
                            <table style={{ minWidth: '100%' }}>
                              <thead>
                                <tr>
                                  <th>Activity</th>
                                  <th>Plot</th>
                                  <th>Crop</th>
                                  <th>Acres</th>
                                  <th>Labour Count</th>
                                  <th>Duration</th>
                                  <th>Expense</th>
                                  <th>Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.dts_activity_entries.map(act => (
                                  <tr key={act.entry_id}>
                                    <td>
                                      <span className="badge badge-success">
                                        {act.activity_types?.name?.replace(/_/g, ' ')}
                                      </span>
                                    </td>
                                    <td>{act.farm_plots?.plot_code || '-'}</td>
                                    <td>{act.crops?.crop_name || '-'}</td>
                                    <td>{act.acres != null ? `${act.acres} ac` : '-'}</td>
                                    <td>{act.labour_count != null ? act.labour_count : '-'}</td>
                                    <td>{act.duration_minutes != null ? `${act.duration_minutes} min` : '-'}</td>
                                    <td>{act.expense_amount != null ? `₹${act.expense_amount}` : '-'}</td>
                                    <td><span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{act.remarks || '-'}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No activities logged in this report.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
