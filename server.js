const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server);

// Serve the static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory objects
const users = {}; // socket.id -> {username, roomCode}
const rooms = {}; // roomCode -> { isPersistent: boolean, history: [{username, text}] }

// Handle real-time connections
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Handle a user joining a specific chat room
    socket.on('join', ({ username, roomCode, isPersistent }) => {
        const roomClients = io.sockets.adapter.rooms.get(roomCode);
        const numClients = roomClients ? roomClients.size : 0;

        // Enforce the 2-member limit
        if (numClients >= 2) {
            socket.emit('room full', roomCode);
            return;
        }

        // Initialize the room if it doesn't exist
        if (!rooms[roomCode]) {
            rooms[roomCode] = { isPersistent: isPersistent, history: [] };
        } else if (numClients === 0 && rooms[roomCode].history.length === 0) {
            // If the room is empty and has no history, allow changing its type
            rooms[roomCode].isPersistent = isPersistent;
        }

        // Join the room and save user data
        socket.join(roomCode);
        users[socket.id] = { username, roomCode };
        
        // Tell the user they successfully joined and inform them of the room's actual mode
        socket.emit('join success', { 
            roomCode: roomCode, 
            isPersistent: rooms[roomCode].isPersistent 
        });

        // If it's a persistent room with history, send the history to the joining user
        if (rooms[roomCode].isPersistent && rooms[roomCode].history.length > 0) {
            socket.emit('chat history', rooms[roomCode].history);
        }

        // Broadcast a notification to the other person in the room
        socket.to(roomCode).emit('notification', `${username} has joined the chat`);
    });

    // 2. Handle incoming chat messages
    socket.on('chat message', (msg) => {
        const user = users[socket.id];
        if (user) {
            const messageData = { username: user.username, text: msg };
            
            // If the room is persistent, save the message to history
            if (rooms[user.roomCode] && rooms[user.roomCode].isPersistent) {
                rooms[user.roomCode].history.push(messageData);
            }

            // Broadcast the message ONLY to people in this specific room
            io.to(user.roomCode).emit('chat message', messageData);
        }
    });

    // 3. Handle a user disconnecting
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const roomCode = user.roomCode;
            const roomData = rooms[roomCode];
            
            // If the room is EPHEMERAL, completely destroy it and kick remaining users
            if (!roomData || !roomData.isPersistent) {
                socket.to(roomCode).emit('room closed', `${user.username} has left. The ephemeral room is now closed.`);
                
                const roomClients = io.sockets.adapter.rooms.get(roomCode);
                if (roomClients) {
                    for (const clientId of Array.from(roomClients)) {
                        const clientSocket = io.sockets.sockets.get(clientId);
                        if (clientSocket) clientSocket.leave(roomCode);
                        delete users[clientId];
                    }
                }
                delete rooms[roomCode]; // Delete the room completely
            } 
            // If the room is PERSISTENT, just notify that they left (history is kept)
            else {
                socket.to(roomCode).emit('notification', `${user.username} went offline.`);
            }

            // Clean up the disconnected user's reference
            delete users[socket.id];
        }
        console.log('A user disconnected:', socket.id);
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running! Open http://localhost:${PORT} in your browser.`);
});