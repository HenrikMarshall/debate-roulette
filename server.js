const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

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

// State management
const waitingUsers = new Set();
const activeDebates = new Map(); // debateId -> { user1, user2, topic, currentSpeaker, timeStarted }
const userSockets = new Map(); // socketId -> userData

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

// Generate random debate ID
function generateDebateId() {
    return `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get random topic
function getRandomTopic() {
    return topics[Math.floor(Math.random() * topics.length)];
}

// Get random side
function getRandomSide() {
    return Math.random() > 0.5 ? 'PRO' : 'CON';
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Store user info
    userSockets.set(socket.id, {
        socketId: socket.id,
        connectedAt: Date.now(),
        currentDebate: null
    });

    // User requests to find opponent
    socket.on('find-opponent', () => {
        console.log(`${socket.id} is looking for opponent`);

        // Check if already in queue
        if (waitingUsers.has(socket.id)) {
            socket.emit('error', { message: 'Already in queue' });
            return;
        }

        // Check if already in debate
        const userData = userSockets.get(socket.id);
        if (userData.currentDebate) {
            socket.emit('error', { message: 'Already in a debate' });
            return;
        }

        // Add to waiting queue
        waitingUsers.add(socket.id);

        // Try to match with another waiting user
        if (waitingUsers.size >= 2) {
            // Get two users from queue
            const usersArray = Array.from(waitingUsers);
            const user1Id = usersArray[0];
            const user2Id = usersArray[1];

            // Remove from queue
            waitingUsers.delete(user1Id);
            waitingUsers.delete(user2Id);

            // Create debate
            const debateId = generateDebateId();
            const topic = getRandomTopic();
            const user1Side = getRandomSide();
            const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
            const firstSpeaker = Math.random() > 0.5 ? user1Id : user2Id;

            const debate = {
                id: debateId,
                user1: user1Id,
                user2: user2Id,
                topic: topic,
                user1Side: user1Side,
                user2Side: user2Side,
                currentSpeaker: firstSpeaker,
                phase: 'opening', // 'opening', 'response', 'open-debate'
                startedAt: Date.now()
            };

            activeDebates.set(debateId, debate);

            // Update user data
            userSockets.get(user1Id).currentDebate = debateId;
            userSockets.get(user2Id).currentDebate = debateId;

            // Join both users to a room
            io.sockets.sockets.get(user1Id)?.join(debateId);
            io.sockets.sockets.get(user2Id)?.join(debateId);

            // Notify both users
            io.to(user1Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user2Id,
                topic: topic,
                yourSide: user1Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user1Id
            });

            io.to(user2Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user1Id,
                topic: topic,
                yourSide: user2Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user2Id
            });

            console.log(`Debate created: ${debateId} - ${user1Id} vs ${user2Id}`);
        } else {
            socket.emit('searching', { message: 'Searching for opponent...' });
        }
    });

    // WebRTC signaling
    socket.on('webrtc-offer', ({ debateId, offer }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward offer to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-offer', { offer, from: socket.id });
    });

    socket.on('webrtc-answer', ({ debateId, answer }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward answer to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-answer', { answer, from: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ debateId, candidate }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward ICE candidate to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    });

    // Turn completed
    socket.on('turn-completed', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        if (debate.phase === 'opening') {
            // First person spoke, now second person's turn
            debate.phase = 'response';
            debate.currentSpeaker = debate.currentSpeaker === debate.user1 ? debate.user2 : debate.user1;
            
            io.to(debateId).emit('turn-change', {
                currentSpeaker: debate.currentSpeaker,
                phase: 'response'
            });
        } else if (debate.phase === 'response') {
            // Both spoke, start open debate
            debate.phase = 'open-debate';
            debate.currentSpeaker = null;
            
            io.to(debateId).emit('open-debate-start');
        }
    });

    // Skip topic
    socket.on('skip-topic', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        const newTopic = getRandomTopic();
        debate.topic = newTopic;

        // Re-assign sides
        const user1Side = getRandomSide();
        const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
        debate.user1Side = user1Side;
        debate.user2Side = user2Side;

        // Reset to opening phase
        debate.phase = 'opening';
        debate.currentSpeaker = Math.random() > 0.5 ? debate.user1 : debate.user2;

        io.to(debate.user1).emit('topic-changed', {
            topic: newTopic,
            yourSide: user1Side,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user1
        });

        io.to(debate.user2).emit('topic-changed', {
            topic: newTopic,
            yourSide: user2Side,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user2
        });
    });

    // End debate
    socket.on('end-debate', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Notify both users
        io.to(debateId).emit('debate-ended');

        // Clean up
        const user1Data = userSockets.get(debate.user1);
        const user2Data = userSockets.get(debate.user2);
        
        if (user1Data) user1Data.currentDebate = null;
        if (user2Data) user2Data.currentDebate = null;

        activeDebates.delete(debateId);
        console.log(`Debate ended: ${debateId}`);
    });

    // Emoji reactions
    socket.on('send-emoji', ({ debateId, emoji }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward emoji to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('emoji-received', { 
            emoji: emoji,
            from: socket.id 
        });
        
        console.log(`Emoji ${emoji} sent in debate ${debateId}`);
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove from waiting queue
        waitingUsers.delete(socket.id);

        // Handle active debate
        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
                
                // Notify opponent
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
    console.log(`🚀 Debate Roulette server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});
