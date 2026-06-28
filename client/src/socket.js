import { io } from 'socket.io-client';

// In production (served by the Node backend), it will automatically connect to the current host
export const socket = io({
  autoConnect: false,
});

