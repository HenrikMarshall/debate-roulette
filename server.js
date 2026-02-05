const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// ROUTES FIRST - BEFORE express.static()
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/debate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/data-deletion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'data-deletion.html'));
});

// Static files AFTER routes (fallback)
app.use(express.static('public'));

// ============================================
// STATE MANAGEMENT
// ============================================

const waitingUsers = new Set();
const activeDebates = new Map();
const userSockets = new Map();

// ============================================
// API ROUTES - Mount the REST API (after state is declared)
// ============================================

const apiRoutes = require('./api-routes');

// Inject dependencies into API routes
apiRoutes.setDependencies({
    waitingUsers,
    activeDebates,
    userSockets,
    io
});

// Mount API routes with /api prefix
app.use('/api', apiRoutes);

// ============================================
// DEBATE TOPICS
// ============================================

const DEBATE_TOPICS = [
    "Pineapple belongs on pizza",
    "Cats are better than dogs",
    "Morning people are more productive than night owls",
    "Social media does more harm than good",
    "Remote work is better than office work",
    "Video games should be considered a sport",
    "Money can buy happiness",
    "Artificial intelligence will improve humanity",
    "Books are better than movies",
    "Coffee is overrated",
    "Cryptocurrency is the future of money",
    "School should start later in the day",
    "Older music is better than modern music",
    "Marvel is better than DC",
    "iOS is superior to Android",
    "Homework should be abolished",
    "Fast food should be banned",
    "Reality TV is a guilty pleasure worth defending",
    "Texting is ruining communication",
    "Everyone should learn to code",
    "Aliens definitely exist",
    "Time travel would be a disaster",
    "Robots will take all our jobs",
    "Vegetarianism is morally superior",
    "College degrees are becoming worthless",
    "Ads are ruining the internet",
    "TikTok is rotting our brains",
    "Superhero movies are overrated",
    "Influencers aren't real jobs",
    "Cancel culture has gone too far",
    "Democracy is overrated",
    "Capitalism is the best economic system",
    "Climate change is the biggest threat to humanity",
    "Nuclear energy is the solution to climate change",
    "Space exploration is a waste of money",
    "Universal basic income would solve poverty",
    "Standardized testing should be eliminated",
    "College should be free for everyone",
    "The death penalty is justified",
    "Guns should be banned",
    "Marijuana should be legal everywhere",
    "Voting should be mandatory",
    "The internet should be heavily regulated",
    "Zoos are unethical",
    "Hunting is morally wrong",
    "Having children is selfish",
    "Marriage is an outdated institution",
    "Monogamy is unnatural",
    "Gender is a social construct",
    "Cultural appropriation is always wrong",
    "Political correctness is necessary",
    "Free speech has limits",
    "Religion does more harm than good",
    "Science can answer all questions",
    "Art has no objective quality",
    "Modern art is pretentious nonsense",
    "Classical music is superior to pop music",
    "Hollywood is out of ideas",
    "Streaming killed the music industry",
    "Video games are art",
    "Sports are overpaid and overvalued",
    "Professional athletes are overpaid",
    "Esports are legitimate sports",
    "Participation trophies ruin kids",
    "Homeschooling is better than traditional school",
    "Teachers are underpaid and undervalued",
    "Student loan debt should be forgiven",
    "Minimum wage should be $25/hour",
    "Billionaires shouldn't exist",
    "Taxes should be much higher",
    "Healthcare is a human right",
    "Big pharma is evil",
    "Alternative medicine has merit",
    "Plastic surgery is empowering",
    "Beauty standards are oppressive",
    "Fashion is a waste of money",
    "Luxury brands are just expensive marketing",
    "Fast fashion is destroying the planet",
    "Veganism is the only ethical diet",
    "Eating meat is murder",
    "Dairy is cruel and unnecessary",
    "Organic food is a scam",
    "GMOs are safe and necessary",
    "Lab-grown meat is the future",
    "Flying is morally wrong due to climate impact",
    "Cars should be banned in cities",
    "Public transportation should be free",
    "Suburbs are urban planning failures",
    "Skyscrapers are architectural monstrosities",
    "Modern architecture is ugly",
    "Brutalism is beautiful",
    "Graffiti is art, not vandalism",
    "Museums should return stolen artifacts",
    "Historical monuments should stay up",
    "Separate art from the artist",
    "Piracy is a victimless crime",
    "Copyright law stifles creativity",
    "NFTs are worthless scams"
];

// ============================================
// SOCKET.IO LOGIC
// ============================================

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    userSockets.set(socket.id, {
        socketId: socket.id,
        currentDebate: null,
        joinedAt: Date.now()
    });

    socket.on('find-opponent', () => {
        console.log('User looking for opponent:', socket.id);
        
        if (waitingUsers.size > 0) {
            const opponentId = waitingUsers.values().next().value;
            waitingUsers.delete(opponentId);
            
            const topic = DEBATE_TOPICS[Math.floor(Math.random() * DEBATE_TOPICS.length)];
            const debateId = `debate-${Date.now()}`;
            
            const debate = {
                id: debateId,
                user1: opponentId,
                user2: socket.id,
                topic: topic,
                phase: 'opening',
                currentSpeaker: Math.random() < 0.5 ? opponentId : socket.id,
                startedAt: Date.now()
            };
            
            activeDebates.set(debateId, debate);
            
            const user1Data = userSockets.get(opponentId);
            const user2Data = userSockets.get(socket.id);
            if (user1Data) user1Data.currentDebate = debateId;
            if (user2Data) user2Data.currentDebate = debateId;
            
            io.to(opponentId).emit('debate-matched', {
                debateId,
                topic,
                isFirstSpeaker: debate.currentSpeaker === opponentId,
                opponentId: socket.id
            });
            
            socket.emit('debate-matched', {
                debateId,
                topic,
                isFirstSpeaker: debate.currentSpeaker === socket.id,
                opponentId: opponentId
            });
            
            console.log(`Debate started: ${debateId} - ${topic}`);
        } else {
            waitingUsers.add(socket.id);
            console.log('User added to waiting queue:', socket.id);
        }
    });

    socket.on('webrtc-offer', ({ offer, to, debateId }) => {
        console.log(`WebRTC offer from ${socket.id} to ${to || 'unknown'}, debate: ${debateId}`);
        
        // If 'to' is provided, use direct Socket.IO forwarding (old way)
        if (to) {
            io.to(to).emit('webrtc-offer', {
                offer,
                from: socket.id
            });
            return;
        }
        
        // If debateId is provided, look up opponent and forward appropriately
        if (debateId && activeDebates.has(debateId)) {
            const debate = activeDebates.get(debateId);
            
            // Find opponent ID
            let opponentId = null;
            if (debate.user1 === socket.id) {
                opponentId = debate.user2;
            } else if (debate.user2 === socket.id) {
                opponentId = debate.user1;
            } else if (debate.participants) {
                // Check participants array for API matches
                for (const p of debate.participants) {
                    if (p.id !== socket.id && userSockets.has(p.id)) {
                        opponentId = p.id;
                        break;
                    } else if (p.id !== socket.id) {
                        // This is an API user
                        opponentId = p.id;
                        break;
                    }
                }
            }
            
            if (opponentId) {
                // Check if opponent is Socket.IO user or API user
                if (userSockets.has(opponentId)) {
                    // Socket.IO user - forward directly
                    io.to(opponentId).emit('webrtc-offer', {
                        offer,
                        from: socket.id
                    });
                    console.log(`✅ Forwarded offer to Socket.IO user ${opponentId}`);
                } else {
                    // API user - store for polling
                    const apiRoutes = require('./api-routes');
                    apiRoutes.storePendingSignal(opponentId, {
                        type: 'offer',
                        offer,
                        from: socket.id,
                        timestamp: Date.now()
                    });
                    console.log(`✅ Stored offer for API user ${opponentId}`);
                }
            } else {
                console.log(`❌ Could not find opponent for debate ${debateId}`);
            }
        }
    });

    socket.on('webrtc-answer', ({ answer, to }) => {
        console.log(`WebRTC answer from ${socket.id} to ${to}`);
        io.to(to).emit('webrtc-answer', {
            answer,
            from: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', ({ candidate, to }) => {
        io.to(to).emit('webrtc-ice-candidate', {
            candidate,
            from: socket.id
        });
    });

    socket.on('turn-completed', () => {
        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                if (debate.phase === 'opening') {
                    debate.currentSpeaker = debate.currentSpeaker === debate.user1 ? debate.user2 : debate.user1;
                    
                    io.to(debate.user1).emit('turn-change', {
                        isYourTurn: debate.currentSpeaker === debate.user1,
                        phase: 'opening'
                    });
                    io.to(debate.user2).emit('turn-change', {
                        isYourTurn: debate.currentSpeaker === debate.user2,
                        phase: 'opening'
                    });
                    
                    if (debate.currentSpeaker === debate.user1) {
                        debate.phase = 'open-debate';
                        io.to(debate.user1).emit('open-debate');
                        io.to(debate.user2).emit('open-debate');
                    }
                }
            }
        }
    });

    socket.on('cancel-search', () => {
        waitingUsers.delete(socket.id);
        console.log('User cancelled search:', socket.id);
    });

    socket.on('leave-debate', () => {
        handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handleDisconnect(socket);
    });

    function handleDisconnect(socket) {
        waitingUsers.delete(socket.id);
        
        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
                
                io.to(opponentId).emit('opponent-disconnected');

                const opponentData = userSockets.get(opponentId);
                if (opponentData) opponentData.currentDebate = null;

                activeDebates.delete(userData.currentDebate);
            }
        }

        userSockets.delete(socket.id);
    }
});

// ============================================
// API ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        waitingUsers: waitingUsers.size,
        activeDebates: activeDebates.size,
        connectedUsers: userSockets.size
    });
});

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

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Debatr server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});
