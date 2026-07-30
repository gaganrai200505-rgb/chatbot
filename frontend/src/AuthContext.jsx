import React, { createContext, useState, useContext, useEffect } from 'react';
import { logoutUser } from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  // On mount, check if a token already exists (persist login across refreshes)
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const storedUser = localStorage.getItem('username');
    if (token && storedUser) {
      setUser({ username: storedUser });
    }
  }, []);

  const login = (username) => {
    localStorage.setItem('username', username);
    setUser({ username });
  };

  const logout = async () => {
    await logoutUser();
    localStorage.removeItem('username');
    setUser(null);
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
