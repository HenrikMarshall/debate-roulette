const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./api-routes'); // NEW: API routes for iOS app

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// NEW: API Routes for iOS/mobile apps
app.use('/api', apiRoutes);

// State management for WebSocket connections
const waitingUsers = new Set();
const activeDebates = new Map();
const userSockets = new Map();

// Debate topics
const topics = [
    "Artificial Intelligence will do more harm than good for humanity",
    "Social media should be regulated like tobacco products",
    "Universal Basic Income is necessary for the future economy",
    "Space exploration is a waste of resources",
    "Cryptocurrency is the future of money",
    "Remote work is better than office work",
    "College education is overrated",
    "Animals should have legal rights",
    "Nuclear energy is essential for fighting climate change",
    "Video games cause violence",
    "Privacy is more important than security",
    "Homework should be banned in schools",
    "Self-driving cars will make roads safer",
    "Vegetarianism should be mandatory",
    "Advertising to children should be illegal",
    "Athletes are overpaid",
    "Artificial meat is better than real meat",
    "Democracy is the best form of government",
    "Books are better than movies",
    "Technology makes us more lonely",
    "Climate change is the biggest threat to humanity",
    "Monarchy is an outdated form of government",
    "Parents should be required to take parenting classes",
    "The death penalty should be abolished worldwide",
    "Zoos do more harm than good"
];

function generateDebateId() {
    return `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getRandomTopic() {
    return topics[Math.floor(Math.random() * topics.length)];
}

function getRandomSide() {
    return Math.random() > 0.5 ? 'for' : 'against';
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    // Store user data
    userSockets.set(socket.id, {
        id: socket.id,
        username: null,
        currentDebate: null,
        side: null
    });

    // Handle user identifying themselves
    socket.on('set-username', (username) => {
        const userData = userSockets.get(socket.id);
        if (userData) {
            userData.username = username || `User${socket.id.substr(0, 4)}`;
            console.log(`👤 Username set: ${userData.username}`);
        }
    });

    // Handle finding opponent
    socket.on('find-opponent', () => {
        const userData = userSockets.get(socket.id);
        
        if (!userData) return;
        
        // Check if already in debate
        if (userData.currentDebate) {
            socket.emit('error', { message: 'Already in a debate' });
            return;
        }

        // Check if someone is waiting
        if (waitingUsers.size > 0) {
            // Get the first waiting user
            const opponentId = Array.from(waitingUsers)[0];
            const opponent = userSockets.get(opponentId);

            if (opponent && opponent.id !== socket.id) {
                // Remove opponent from waiting list
                waitingUsers.delete(opponentId);

                // Create debate
                const debateId = generateDebateId();
                const topic = getRandomTopic();
                
                // Randomly assign sides
                const user1Side = getRandomSide();
                const user2Side = user1Side === 'for' ? 'against' : 'for';

                const debate = {
                    id: debateId,
                    topic: topic,
                    user1: {
                        id: opponentId,
                        username: opponent.username,
                        side: user1Side
                    },
                    user2: {
                        id: socket.id,
                        username: userData.username,
                        side: user2Side
                    },
                    currentSpeaker: opponentId, // User1 starts
                    phase: 'speaker1', // speaker1, speaker2, open-debate, voting
                    startedAt: Date.now(),
                    spectators: new Set()
                };

                activeDebates.set(debateId, debate);

                // Update user data
                userData.currentDebate = debateId;
                userData.side = user2Side;
                opponent.currentDebate = debateId;
                opponent.side = user1Side;

                // Create room
                socket.join(debateId);
                io.sockets.sockets.get(opponentId)?.join(debateId);

                // Notify both users
                io.to(debateId).emit('debate-matched', {
                    debateId: debateId,
                    topic: topic,
                    opponent: userData.username,
                    yourSide: user1Side,
                    currentSpeaker: opponentId
                });

                socket.emit('debate-matched', {
                    debateId: debateId,
                    topic: topic,
                    opponent: opponent.username,
                    yourSide: user2Side,
                    currentSpeaker: opponentId
                });

                console.log(`🎭 Debate created: ${debateId}`);
                console.log(`   Topic: ${topic}`);
                console.log(`   ${opponent.username} (${user1Side}) vs ${userData.username} (${user2Side})`);
            }
        } else {
            // Add to waiting list
            waitingUsers.add(socket.id);
            socket.emit('waiting-for-opponent', { 
                message: 'Searching for an opponent...',
                queuePosition: waitingUsers.size 
            });
            console.log(`⏳ ${userData.username} added to waiting queue`);
        }
    });

    // Handle canceling search
    socket.on('cancel-search', () => {
        waitingUsers.delete(socket.id);
        socket.emit('search-cancelled');
        console.log(`❌ ${socket.id} cancelled search`);
    });

    // Handle WebRTC signaling
    socket.on('webrtc-offer', ({ debateId, offer }) => {
        socket.to(debateId).emit('webrtc-offer', { offer, from: socket.id });
    });

    socket.on('webrtc-answer', ({ debateId, answer }) => {
        socket.to(debateId).emit('webrtc-answer', { answer, from: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ debateId, candidate }) => {
        socket.to(debateId).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    });

    // Handle phase changes
    socket.on('advance-phase', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Only allow current speaker to advance
        if (socket.id !== debate.currentSpeaker) return;

        // Advance phase
        if (debate.phase === 'speaker1') {
            debate.phase = 'speaker2';
            debate.currentSpeaker = debate.user2.id;
        } else if (debate.phase === 'speaker2') {
            debate.phase = 'open-debate';
            debate.currentSpeaker = null;
        } else if (debate.phase === 'open-debate') {
            debate.phase = 'voting';
        }

        io.to(debateId).emit('phase-changed', {
            phase: debate.phase,
            currentSpeaker: debate.currentSpeaker
        });
    });

    // Handle mute/unmute
    socket.on('toggle-mute', ({ debateId, muted }) => {
        socket.to(debateId).emit('opponent-mute-changed', { muted });
    });

    // Handle emoji reactions
    socket.on('emoji-reaction', ({ debateId, emoji }) => {
        socket.to(debateId).emit('emoji-reaction', { emoji, from: socket.id });
    });

    // Handle chat messages (for spectators)
    socket.on('chat-message', ({ debateId, message }) => {
        const userData = userSockets.get(socket.id);
        io.to(debateId).emit('chat-message', {
            username: userData?.username || 'Anonymous',
            message: message,
            timestamp: Date.now()
        });
    });

    // Handle next opponent
    socket.on('next-opponent', () => {
        const userData = userSockets.get(socket.id);
        if (!userData) return;

        // Leave current debate
        if (userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                // Notify opponent
                const opponentId = debate.user1.id === socket.id ? debate.user2.id : debate.user1.id;
                io.to(opponentId).emit('opponent-left');
                
                // Clean up opponent's data
                const opponent = userSockets.get(opponentId);
                if (opponent) opponent.currentDebate = null;
            }
            
            socket.leave(userData.currentDebate);
            activeDebates.delete(userData.currentDebate);
            userData.currentDebate = null;
        }

        // Try to find new opponent
        socket.emit('ready-for-next');
    });

    // Handle spectator joining
    socket.on('spectate-debate', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) {
            socket.emit('error', { message: 'Debate not found' });
            return;
        }

        socket.join(debateId);
        debate.spectators.add(socket.id);

        socket.emit('spectating', {
            debateId: debateId,
            topic: debate.topic,
            users: [debate.user1, debate.user2],
            phase: debate.phase,
            spectatorCount: debate.spectators.size
        });

        // Notify others of new spectator count
        io.to(debateId).emit('spectator-count', { count: debate.spectators.size });
    });

    // Handle spectator vote
    socket.on('spectator-vote', ({ debateId, votedFor }) => {
        socket.to(debateId).emit('vote-cast', { votedFor });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);

        // Remove from waiting list
        waitingUsers.delete(socket.id);

        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            
            if (debate) {
                // Notify opponent
                const opponentId = debate.user1.id === socket.id ? debate.user2.id : debate.user1.id;
                
                io.to(opponentId).emit('opponent-disconnected');

                // Clean up opponent's data
                const opponentData = userSockets.get(opponentId);
                if (opponentData) opponentData.currentDebate = null;

                // Remove debate
                activeDebates.delete(userData.currentDebate);
            }
        }

        // Remove user data
        userSockets.delete(socket.id);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        waitingUsers: waitingUsers.size,
        activeDebates: activeDebates.size,
        connectedUsers: userSockets.size
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    res.json({
        waitingUsers: waitingUsers.size,
        activeDebates: activeDebates.size,
        totalConnected: userSockets.size,
        debates: Array.from(activeDebates.values()).map(d => ({
            id: d.id,
            phase: d.phase,
            duration: Date.now() - d.startedAt
        }))
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Debatr server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/stats`);
    console.log(`📱 iOS API available at /api/*`);
});
