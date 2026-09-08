import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/amrutpeth-logo.jpeg';

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
      setError('Invalid username or password / अवैध वापरकर्तानाव किंवा संकेतशब्द');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-orange-600">
      <form onSubmit={submit} className="bg-white rounded shadow p-8 w-full max-w-sm">
        <img src={logo} alt="Amrut Peth" className="h-20 w-20 mx-auto mb-3 object-contain" />
        <h1 className="text-2xl font-bold mb-1 text-orange-700 text-center">
          Amrut Peth <span className="text-base font-normal text-gray-500">(अमृत पेठ)</span>
        </h1>
        <div className="mb-3">
          <label className="text-xs text-gray-500">Username / वापरकर्तानाव</label>
          <input className="w-full border rounded px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-500">Password / संकेतशब्द</label>
          <input type="password" className="w-full border rounded px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button className="w-full bg-orange-600 text-white py-2 rounded hover:bg-orange-700">Log in / लॉग इन करा</button>
      </form>
    </div>
  );
}