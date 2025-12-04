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
const activeDebates = new Map(); // debateId -> { user1, user2, topic, currentSpeaker, timeStarted, spectators: [], votes: {} }
const userSockets = new Map(); // socketId -> userData
const spectatorRooms = new Map(); // socketId -> debateId (for tracking which debate spectator is watching)

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
                startedAt: Date.now(),
                round: 1,
                lastFirstSpeaker: firstSpeaker, // Track who went first to alternate
                spectators: [], // Array of spectator socket IDs
                votes: {}, // { socketId: 'user1' or 'user2' }
                chatMessages: [] // Spectator chat messages
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
                youGoFirst: firstSpeaker === user1Id,
                round: 1
            });

            io.to(user2Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user1Id,
                topic: topic,
                yourSide: user2Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user2Id,
                round: 1
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
        if (!debate) {
            console.log('turn-completed: debate not found:', debateId);
            return;
        }

        console.log(`turn-completed received for ${debateId}, phase: ${debate.phase}`);

        // Prevent duplicate turn-completed within 1 second
        const now = Date.now();
        if (debate.lastTurnCompleted && now - debate.lastTurnCompleted < 1000) {
            console.log('Ignoring duplicate turn-completed');
            return;
        }
        debate.lastTurnCompleted = now;

        if (debate.phase === 'opening') {
            // First person spoke, now second person's turn
            debate.phase = 'response';
            debate.currentSpeaker = debate.currentSpeaker === debate.user1 ? debate.user2 : debate.user1;
            
            console.log(`Switching to response phase, new speaker: ${debate.currentSpeaker}`);
            
            io.to(debateId).emit('turn-change', {
                currentSpeaker: debate.currentSpeaker,
                phase: 'response'
            });
        } else if (debate.phase === 'response') {
            // Both spoke, start open debate
            debate.phase = 'open-debate';
            debate.currentSpeaker = null;
            
            console.log('Starting open debate');
            
            io.to(debateId).emit('open-debate-start');
        }
    });

    // Skip topic
    socket.on('skip-topic', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        const newTopic = getRandomTopic();
        debate.topic = newTopic;
        debate.round = (debate.round || 1) + 1;

        // Reset to opening phase
        debate.phase = 'opening';
        debate.currentSpeaker = Math.random() > 0.5 ? debate.user1 : debate.user2;

        io.to(debate.user1).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user1
        });

        io.to(debate.user2).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user2
        });
    });

    // Request new topic (after open debate ends)
    socket.on('request-new-topic', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Prevent duplicate requests - check if already in voting/transitioning
        if (debate.phase === 'voting' || debate.phase === 'transitioning') {
            console.log('Ignoring duplicate request - already transitioning');
            return;
        }

        // Prevent duplicate requests within 2 seconds
        const now = Date.now();
        if (debate.lastTopicRequest && now - debate.lastTopicRequest < 2000) {
            console.log(`Ignoring duplicate new topic request for debate ${debateId}`);
            return;
        }
        debate.lastTopicRequest = now;

        console.log(`New topic requested for debate ${debateId}, current round: ${debate.round || 1}`);

        // Start voting period for spectators (10 seconds instead of 15)
        if (debate.spectators && debate.spectators.length > 0) {
            debate.phase = 'voting';
            
            // Notify spectators to vote
            debate.spectators.forEach(spectatorId => {
                io.to(spectatorId).emit('voting-start', {
                    round: debate.round,
                    duration: 10
                });
            });

            // Reset votes for new round
            debate.votes = {};

            // Wait 10 seconds for voting, then continue
            setTimeout(() => {
                // Double-check we're still in voting phase (prevent duplicate execution)
                if (debate.phase === 'voting') {
                    proceedToNextTopic(debate, debateId);
                }
            }, 10000);
        } else {
            // No spectators, proceed immediately (but mark as transitioning)
            debate.phase = 'transitioning';
            proceedToNextTopic(debate, debateId);
        }
    });

    function proceedToNextTopic(debate, debateId) {
        // Prevent double execution
        if (debate.phase === 'opening') {
            console.log('Already moved to next topic, skipping');
            return;
        }

        const newTopic = getRandomTopic();
        debate.topic = newTopic;
        debate.round = (debate.round || 1) + 1;

        // ALTERNATE who goes first
        const newFirstSpeaker = debate.lastFirstSpeaker === debate.user1 ? debate.user2 : debate.user1;
        debate.lastFirstSpeaker = newFirstSpeaker;
        debate.currentSpeaker = newFirstSpeaker;

        console.log(`Round ${debate.round}: ${newFirstSpeaker} goes first (alternating)`);

        // Reset to opening phase
        debate.phase = 'opening';

        io.to(debate.user1).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user1
        });

        io.to(debate.user2).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user2
        });

        // Notify spectators of new topic
        if (debate.spectators) {
            debate.spectators.forEach(spectatorId => {
                io.to(spectatorId).emit('spectator-new-topic', {
                    topic: newTopic,
                    round: debate.round
                });
            });
        }
        
        console.log(`New topic assigned for debate ${debateId}, Round ${debate.round}`);
    }

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

    // Spectator Mode - Get list of active debates
    socket.on('get-active-debates', () => {
        const debates = [];
        activeDebates.forEach((debate, debateId) => {
            debates.push({
                id: debateId,
                topic: debate.topic,
                round: debate.round,
                phase: debate.phase,
                spectatorCount: debate.spectators.length,
                startedAt: debate.startedAt
            });
        });
        socket.emit('active-debates-list', debates);
    });

    // Spectator Mode - Join debate as spectator
    socket.on('join-as-spectator', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) {
            socket.emit('spectator-error', { message: 'Debate not found' });
            return;
        }

        // Add to spectators
        if (!debate.spectators.includes(socket.id)) {
            debate.spectators.push(socket.id);
        }
        spectatorRooms.set(socket.id, debateId);

        // Send debate info
        socket.emit('spectator-joined', {
            debateId: debateId,
            topic: debate.topic,
            round: debate.round,
            phase: debate.phase,
            spectatorCount: debate.spectators.length,
            chatMessages: debate.chatMessages || [],
            user1: debate.user1,
            user2: debate.user2
        });

        // Notify debaters that a spectator joined
        io.to(debate.user1).emit('spectator-joined-notify', { spectatorId: socket.id });
        io.to(debate.user2).emit('spectator-joined-notify', { spectatorId: socket.id });

        // Notify all spectators of updated count
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('spectator-count-update', {
                count: debate.spectators.length
            });
        });

        console.log(`Spectator ${socket.id} joined debate ${debateId}`);
    });

    // WebRTC for Spectators - Debaters send offers to spectators
    socket.on('spectator-offer', ({ spectatorId, offer, streamType }) => {
        io.to(spectatorId).emit('spectator-receive-offer', {
            debaterId: socket.id,
            offer: offer,
            streamType: streamType // 'user1' or 'user2'
        });
    });

    // Spectators send answers back to debaters
    socket.on('spectator-answer', ({ debaterId, answer }) => {
        io.to(debaterId).emit('spectator-receive-answer', {
            spectatorId: socket.id,
            answer: answer
        });
    });

    // ICE candidates for spectator connections
    socket.on('spectator-ice-candidate', ({ peerId, candidate }) => {
        io.to(peerId).emit('spectator-receive-ice-candidate', {
            peerId: socket.id,
            candidate: candidate
        });
    });

    // Spectator Chat Message
    socket.on('spectator-chat', ({ debateId, message }) => {
        const debate = activeDebates.get(debateId);
        if (!debate || !debate.spectators.includes(socket.id)) return;

        const chatMessage = {
            id: Date.now() + Math.random(),
            socketId: socket.id,
            message: message,
            timestamp: Date.now()
        };

        debate.chatMessages = debate.chatMessages || [];
        debate.chatMessages.push(chatMessage);

        // Keep only last 50 messages
        if (debate.chatMessages.length > 50) {
            debate.chatMessages = debate.chatMessages.slice(-50);
        }

        // Broadcast to all spectators
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('spectator-chat-message', chatMessage);
        });
    });

    // Spectator Vote
    socket.on('cast-vote', ({ debateId, vote }) => {
        const debate = activeDebates.get(debateId);
        if (!debate || !debate.spectators.includes(socket.id)) return;

        // Record vote (vote is 'user1' or 'user2')
        debate.votes[socket.id] = vote;

        // Send confirmation
        socket.emit('vote-recorded', { vote: vote });

        // Calculate and broadcast vote totals
        const voteTotals = {
            user1: 0,
            user2: 0
        };

        Object.values(debate.votes).forEach(v => {
            if (v === 'user1') voteTotals.user1++;
            if (v === 'user2') voteTotals.user2++;
        });

        // Broadcast to all spectators
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('vote-update', voteTotals);
        });

        console.log(`Vote cast in debate ${debateId}: ${vote}`);
    });

    // Leave spectator mode
    socket.on('leave-spectator', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (debate) {
            debate.spectators = debate.spectators.filter(id => id !== socket.id);
            spectatorRooms.delete(socket.id);

            // Notify remaining spectators
            debate.spectators.forEach(spectatorId => {
                io.to(spectatorId).emit('spectator-count-update', {
                    count: debate.spectators.length
                });
            });
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove from waiting queue
        waitingUsers.delete(socket.id);

        // Remove from spectator rooms
        const spectatingDebateId = spectatorRooms.get(socket.id);
        if (spectatingDebateId) {
            const debate = activeDebates.get(spectatingDebateId);
            if (debate) {
                debate.spectators = debate.spectators.filter(id => id !== socket.id);
                
                // Notify remaining spectators
                debate.spectators.forEach(spectatorId => {
                    io.to(spectatorId).emit('spectator-count-update', {
                        count: debate.spectators.length
                    });
                });
            }
            spectatorRooms.delete(socket.id);
        }

        // Handle active debate
        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
                
                // Notify opponent
                io.to(opponentId).emit('opponent-disconnected');

                // Notify spectators that debate ended
                if (debate.spectators) {
                    debate.spectators.forEach(spectatorId => {
                        io.to(spectatorId).emit('debate-ended-spectator');
                    });
                }

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
