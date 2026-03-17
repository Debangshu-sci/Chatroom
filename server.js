const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory objects
const users = {}; // socket.id -> {username, roomCode}
const rooms = {}; // roomCode -> { isPersistent: boolean, history: [{username, text, timestamp}] }

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join', ({ username, roomCode, isPersistent }) => {
        const roomClients = io.sockets.adapter.rooms.get(roomCode);
        const numClients = roomClients ? roomClients.size : 0;

        if (numClients >= 2) {
            socket.emit('room full', roomCode);
            return;
        }

        if (!rooms[roomCode]) {
            rooms[roomCode] = { isPersistent: isPersistent, history: [] };
        } else if (numClients === 0 && rooms[roomCode].history.length === 0) {
            rooms[roomCode].isPersistent = isPersistent;
        }

        socket.join(roomCode);
        users[socket.id] = { username, roomCode };
        
        socket.emit('join success', { 
            roomCode: roomCode, 
            isPersistent: rooms[roomCode].isPersistent 
        });

        if (rooms[roomCode].isPersistent && rooms[roomCode].history.length > 0) {
            socket.emit('chat history', rooms[roomCode].history);
        }

        socket.to(roomCode).emit('notification', `${username} has joined the chat`);
    });

    // Handle typing status
    socket.on('typing', (isTyping) => {
        const user = users[socket.id];
        if (user) {
            socket.to(user.roomCode).emit('typing', { username: user.username, isTyping });
        }
    });

    socket.on('chat message', (msg) => {
        const user = users[socket.id];
        if (user) {
            // Add a timestamp to the message data
            const messageData = { 
                username: user.username, 
                text: msg,
                timestamp: new Date().toISOString()
            };
            
            if (rooms[user.roomCode] && rooms[user.roomCode].isPersistent) {
                rooms[user.roomCode].history.push(messageData);
            }

            io.to(user.roomCode).emit('chat message', messageData);
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const roomCode = user.roomCode;
            const roomData = rooms[roomCode];
            
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
                delete rooms[roomCode]; 
            } 
            else {
                socket.to(roomCode).emit('notification', `${user.username} went offline.`);
            }

            delete users[socket.id];
        }
        console.log('A user disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running! Open http://localhost:${PORT} in your browser.`);
});
