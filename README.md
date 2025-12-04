# Debate Roulette 🎙️

A real-time random video debate platform where users are matched with opponents to debate random topics with structured turn-based speaking.

## ✨ Features

- **Random Matching**: Instantly paired with opponents worldwide
- **Structured Debates**: 30-second opening statements for each side
- **Turn-Based Speaking**: Automatic muting system ensures fair debate
- **Real-time Video**: WebRTC peer-to-peer video connections
- **Topic Variety**: 25+ debate topics spanning politics, tech, ethics, and more
- **Side Assignment**: Randomly assigned PRO or CON position
- **Open Debate**: Free discussion after opening statements

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Camera and microphone

### Local Development

1. **Clone & Install**
   ```bash
   cd debate-backend
   npm install
   ```

2. **Start Server**
   ```bash
   npm start
   ```

3. **Open Browser**
   - Navigate to `http://localhost:3000`
   - Open a second tab/window to test matching
   - Allow camera/microphone permissions

## 🌐 Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete instructions.

**Quick Deploy to Railway:**
1. Push code to GitHub
2. Connect Railway to your repo
3. Deploy automatically
4. Get free HTTPS URL

**Cost**: Free tier available, $5/month for production

## 🏗️ Architecture

### Backend (Node.js + Socket.io)
- **WebRTC Signaling**: Coordinates peer connections
- **Matchmaking**: Pairs random users in real-time
- **Turn Management**: Enforces 30-second speaking turns
- **State Management**: Tracks active debates and waiting users

### Frontend (Vanilla HTML/CSS/JS)
- **WebRTC**: Direct peer-to-peer video
- **Socket.io Client**: Real-time communication with server
- **Turn-based UI**: Visual indicators for speaking/muted states
- **Responsive Design**: Works on desktop and mobile

### Flow Diagram
```
User A                    Server                    User B
  |                         |                         |
  |--find-opponent--------->|                         |
  |                         |<------find-opponent-----|
  |                         |                         |
  |<---debate-matched-------|----debate-matched------>|
  |                         |                         |
  |--webrtc-offer---------->|                         |
  |                         |------webrtc-offer------>|
  |                         |                         |
  |                         |<-----webrtc-answer------|
  |<---webrtc-answer--------|                         |
  |                         |                         |
  |====== P2P Video Connection Established =========|
  |                         |                         |
  |--turn-completed-------->|                         |
  |                         |-----turn-change-------->|
```

## 📁 Project Structure

```
debate-backend/
├── server.js              # Main server & signaling logic
├── package.json           # Dependencies
├── public/
│   └── index.html        # Frontend application
├── DEPLOYMENT.md         # Deployment guide
└── README.md            # This file
```

## 🛠️ Technology Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **WebRTC**: Peer-to-peer video/audio
- **Deployment**: Railway, Render, or any Node.js host
- **SSL**: Automatic via hosting platform

## 🎮 How to Use

1. **Find Opponent**: Click "Find Opponent" button
2. **Wait for Match**: Server pairs you with another user
3. **Receive Topic**: Random debate topic assigned
4. **Opening Statement**: First speaker has 30 seconds (other is muted)
5. **Response**: Second speaker gets 30 seconds
6. **Open Debate**: After opening statements, both can speak freely
7. **Skip Topic**: Request new random topic anytime
8. **End Debate**: Disconnect and find new opponent

## 📊 API Endpoints

### Health Check
```
GET /health
Returns: { status, uptime, waitingUsers, activeDebates, connectedUsers }
```

### Stats
```
GET /stats
Returns: { waitingUsers, activeDebates, totalConnected, debates[] }
```

## 🔧 Socket Events

### Client → Server
- `find-opponent`: Request to be matched
- `webrtc-offer`: WebRTC offer for connection
- `webrtc-answer`: WebRTC answer for connection
- `webrtc-ice-candidate`: ICE candidate for connection
- `turn-completed`: Speaker finished their turn
- `skip-topic`: Request new debate topic
- `end-debate`: End current debate session

### Server → Client
- `searching`: Waiting for opponent
- `debate-matched`: Matched with opponent (includes topic, side, first speaker)
- `webrtc-offer`: Forward WebRTC offer
- `webrtc-answer`: Forward WebRTC answer
- `webrtc-ice-candidate`: Forward ICE candidate
- `turn-change`: Next person's turn to speak
- `open-debate-start`: Both opening statements complete
- `topic-changed`: New topic assigned
- `debate-ended`: Debate session ended
- `opponent-disconnected`: Opponent left the debate

## 🔐 Security Considerations

- ✅ HTTPS required for camera/microphone access
- ✅ Peer-to-peer video (not stored on server)
- ✅ CORS configured for security
- ⚠️ Add rate limiting for production
- ⚠️ Add content moderation tools
- ⚠️ Add user reporting system

## 🚧 Roadmap

### V1.0 (Current)
- [x] Random user matching
- [x] WebRTC video chat
- [x] Turn-based speaking
- [x] Topic assignment
- [x] Basic UI

### V1.1 (Next)
- [ ] User accounts
- [ ] Debate history
- [ ] Rating system
- [ ] Topic categories

### V2.0 (Future)
- [ ] Spectator mode
- [ ] Tournament mode
- [ ] Recorded debates
- [ ] Mobile apps
- [ ] Friend challenges

## 🤝 Contributing

This is a personal project, but suggestions are welcome!

## 📄 License

MIT License - feel free to use for your own projects

## 🐛 Known Issues

- **NAT Traversal**: Some users behind strict firewalls may not connect (solution: add TURN servers)
- **Mobile Safari**: Occasional audio issues on iOS (known WebRTC limitation)
- **Connection Quality**: Depends on users' internet connections

## 💡 Tips for Best Experience

- Use wired internet connection if possible
- Close other video applications
- Use modern browser (Chrome recommended)
- Grant camera/microphone permissions promptly
- Test with friend before going live

## 📞 Support

Check [DEPLOYMENT.md](DEPLOYMENT.md) for troubleshooting guide.

---

**Built with ❤️ for meaningful debates**
