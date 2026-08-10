import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError('Invalid username or password');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-900">
      <form onSubmit={submit} className="bg-white rounded shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1 text-emerald-900">FoodMart</h1>
        <p className="text-sm text-gray-500 mb-6">Dealer / Retailer / Admin login</p>
        <div className="mb-3">
          <label className="text-xs text-gray-500">Username</label>
          <input className="w-full border rounded px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-500">Password</label>
          <input type="password" className="w-full border rounded px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button className="w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800">Log in</button>
        <p className="text-xs text-gray-400 mt-4">
          Demo logins (after seeding): admin/admin123, dealer1/dealer123, retailer1/retailer123
        </p>
      </form>
    </div>
  );
}
