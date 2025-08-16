import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { generateAvatarColor, getInitials } from '../userutils/userutils';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(true);
  
  const connectedUsersRef = useRef(connectedUsers);
  connectedUsersRef.current = connectedUsers;

  const connectToSession = (userData) => {
    setIsConnecting(true);
    setCurrentUser(userData);
    setShowWelcomeModal(false);
  };

  const addNotification = (message, type) => {
    const id = Date.now();
    const notification = { id, message, type, timestamp: Date.now() };

    setNotifications(prev => [...prev, notification]);

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  // Wake up server function for Render free tier
  const wakeUpServer = async (backendUrl) => {
    try {
      setIsWakingUp(true);
      console.log('🔄 Waking up server...');
      
      const response = await fetch(`${backendUrl}/ping`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Server wake-up response:', data);
        addNotification('Server is ready!', 'join');
      }
    } catch (error) {
      console.log('⏳ Server still waking up...', error.message);
      // Try again in 3 seconds
      setTimeout(() => wakeUpServer(backendUrl), 3000);
    } finally {
      setTimeout(() => setIsWakingUp(false), 2000);
    }
  };

  useEffect(() => {
    if (!currentUser) return;

    const getBackendUrl = () => {
      // Use environment variable from .env file
      if (import.meta.env.VITE_BACKEND_URL) {
        return import.meta.env.VITE_BACKEND_URL;
      }
      
      // Development fallback
      if (import.meta.env.DEV) {
        return 'http://localhost:3001';
      }
      
      // Production - Your actual Render URL
      return 'https://whiteboard-backend-rkls.onrender.com';
    };

    const backendUrl = getBackendUrl();
    console.log('🔗 Connecting to backend:', backendUrl);

    // For production (Render), wake up the server first
    if (!import.meta.env.DEV) {
      wakeUpServer(backendUrl);
    }

    const newSocket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      forceNew: true,
      timeout: 20000, // 20 second timeout for sleeping servers
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to backend with ID:', newSocket.id);
      setIsConnected(true);
      setIsConnecting(false);
      setIsWakingUp(false);

      newSocket.emit('user-info', {
        name: currentUser.name,
        avatarColor: currentUser.avatarColor
      });
    });

    newSocket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from backend:', reason);
      setIsConnected(false);
      
      if (reason === 'io server disconnect') {
        addNotification('Server disconnected', 'error');
      } else {
        addNotification('Connection lost. Reconnecting...', 'error');
      }
    });

    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}`);
      if (attemptNumber === 1) {
        setIsWakingUp(true);
        addNotification('Server may be sleeping. Waking it up...', 'info');
      }
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('✅ Reconnected after', attemptNumber, 'attempts');
      addNotification('Reconnected to server!', 'join');
      setIsWakingUp(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
      if (!isWakingUp) {
        setIsConnecting(false);
        addNotification('Waking up server, please wait...', 'info');
        wakeUpServer(backendUrl);
      }
    });

    // Server event handlers
    newSocket.on('server-status', (status) => {
      console.log('📊 Server status:', status);
    });

    newSocket.on('users-update', (users) => {
      setConnectedUsers(users);
    });

    newSocket.on('user-joined', (user) => {
      if (user.id !== newSocket.id) {
        addNotification(`${user.name} joined the session`, 'join');
      }
    });

    newSocket.on('user-left', (userId) => {
      const currentUsers = connectedUsersRef.current;
      const leftUser = currentUsers.find(u => u.id === userId);
      
      if (leftUser) {
        addNotification(`${leftUser.name} left the session`, 'leave');
      } else {
        addNotification('A user left the session', 'leave');
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
      setSocket(null);
      setIsConnected(false);
      setIsConnecting(false);
      setIsWakingUp(false);
    };
  }, [currentUser]);

  const value = {
    socket,
    isConnected,
    isConnecting,
    isWakingUp,
    connectedUsers,
    notifications,
    currentUser,
    showWelcomeModal,
    connectToSession,
    generateAvatarColor,
    getInitials,
    addNotification
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};