import { createContext, useContext, useState } from 'react';
import api from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('foodmart_user');
    return raw ? JSON.parse(raw) : null;
  });

  async function login(username, password) {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('foodmart_token', data.token);
    localStorage.setItem('foodmart_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('foodmart_token');
    localStorage.removeItem('foodmart_user');
    setUser(null);
  }

  // Doesn't touch the current session — the existing token stays valid
  // (it doesn't encode the password), so the user isn't logged out just
  // for changing it. Throws on failure (wrong current password, etc.) so
  // the caller's own form can show the error.
  async function changePassword(currentPassword, newPassword) {
    await api.patch('/auth/change-password', { currentPassword, newPassword });
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
