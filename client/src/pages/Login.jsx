import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { Wrench, ArrowRight } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); navigate('/'); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--gradient-accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            boxShadow: '0 4px 20px rgba(99,102,241,0.3)'
          }}>
            <Wrench size={28} style={{ color: 'white' }} />
          </div>
        </div>
        <h1 style={{ textAlign: 'center' }}>PSB Maintenance Hub</h1>
        <p style={{ textAlign: 'center' }}>Sign in to manage property maintenance</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8, justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Signing in...' : <>Sign In <ArrowRight size={16} /></>}
          </button>
        </form>
      </div>
    </div>
  );
}
