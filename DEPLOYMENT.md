# Debate Roulette - Complete Deployment Guide

## 🚀 Quick Deploy to Railway (Recommended)

Railway is the easiest way to deploy Node.js apps with automatic HTTPS and scaling.

### Step 1: Prepare Your Code

1. **Install Git** (if not already installed)
   - Windows: Download from https://git-scm.com/
   - Mac: `brew install git`
   - Linux: `sudo apt install git`

2. **Initialize Git Repository**
   ```bash
   cd debate-backend
   git init
   git add .
   git commit -m "Initial commit"
   ```

3. **Push to GitHub**
   - Go to https://github.com and create new repository
   - Name it: `debate-roulette`
   - Don't initialize with README
   
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/debate-roulette.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy to Railway

1. **Sign Up for Railway**
   - Go to https://railway.app
   - Click "Login" → "Login with GitHub"
   - Authorize Railway to access your repositories

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `debate-roulette` repository
   - Railway will automatically detect Node.js and deploy

3. **Wait for Deployment**
   - Takes 2-3 minutes
   - Watch the build logs in real-time
   - When complete, you'll see "Success" ✅

4. **Get Your URL**
   - Click "Settings" tab
   - Scroll to "Domains"
   - Click "Generate Domain"
   - Your app is now live at: `https://your-app-name.up.railway.app`

### Step 3: Test Your Deployment

1. Visit your Railway URL
2. Allow camera/microphone when prompted
3. Click "Find Opponent"
4. Open another browser tab (or incognito window) to your URL
5. Click "Find Opponent" in second tab
6. You should be matched with yourself!

---

## 🌐 Custom Domain Setup (Optional)

### Buy a Domain
- **Namecheap**: $8-15/year - https://namecheap.com
- **Porkbun**: $8-12/year - https://porkbun.com
- **Google Domains**: $12/year - https://domains.google

### Connect Domain to Railway

1. **In Railway Dashboard:**
   - Go to your project → Settings → Domains
   - Click "Custom Domain"
   - Enter your domain: `debateroulette.com`
   - Copy the CNAME target provided

2. **In Your Domain Registrar:**
   
   **For Root Domain (debateroulette.com):**
   ```
   Type: CNAME
   Name: @
   Value: [your-app].up.railway.app
   TTL: 3600
   ```
   
   **For www subdomain:**
   ```
   Type: CNAME
   Name: www
   Value: [your-app].up.railway.app
   TTL: 3600
   ```

3. **Wait for DNS Propagation**
   - Usually takes 5-30 minutes
   - Check status: https://dnschecker.org
   - Railway automatically provisions SSL certificate

---

## 💰 Cost Breakdown

### Railway Pricing
- **Free Tier**: $5 of free usage per month
  - Enough for ~100-200 hours of runtime
  - Good for 500-1,000 monthly active users
  - Perfect for testing and early growth

- **Paid Plan**: $5/month for starter plan
  - Unlimited runtime
  - Better performance
  - Can handle thousands of concurrent users

### Domain Cost
- $8-15/year (one-time annual payment)

### Total First Year Cost
- **Option 1 (Free)**: $10 (domain only)
- **Option 2 (Paid)**: $70 (domain + Railway subscription)

---

## 🔧 Alternative: Deploy to Render

If Railway doesn't work for you, try Render (also free tier available):

1. **Sign up at** https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: debate-roulette
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click "Create Web Service"
6. Wait 3-5 minutes for deployment
7. Your URL: `https://debate-roulette.onrender.com`

**Note:** Render's free tier spins down after 15 minutes of inactivity (Railway doesn't do this).

---

## 🧪 Local Testing Instructions

### Test Backend Locally

1. **Install Dependencies**
   ```bash
   cd debate-backend
   npm install
   ```

2. **Start Server**
   ```bash
   npm start
   ```
   
   Server runs at: `http://localhost:3000`

3. **Test in Browser**
   - Open: `http://localhost:3000`
   - Open second tab/window: `http://localhost:3000`
   - Click "Find Opponent" in both
   - Should connect and match

### Development Mode (Auto-restart on changes)
```bash
npm run dev
```

---

## 🐛 Troubleshooting

### "Can't connect to server"
- **Check**: Is the backend running?
- **Fix**: Make sure Railway deployment succeeded
- **Test**: Visit `https://your-app.up.railway.app/health`
- Should return: `{"status":"ok",...}`

### "Camera/microphone not working"
- **Check**: Are you on HTTPS?
- **Fix**: Railway provides automatic HTTPS
- **Note**: Camera only works on HTTPS (not HTTP)

### "Can't find opponent"
- **Check**: Are two users actually connected?
- **Test**: Open two separate browser windows
- **Debug**: Check Railway logs for connection issues

### "Video not showing"
- **Check**: WebRTC connection established?
- **Fix**: This usually means firewall/NAT issues
- **Solution**: Add TURN servers (see Advanced Setup)

### Check Server Logs
```bash
# In Railway dashboard
Click "Deployments" → Click latest deployment → "View Logs"
```

---

## 🚀 Advanced: Adding TURN Servers

For better connection reliability (especially behind corporate firewalls):

### Option 1: Twilio (Recommended)

1. **Sign up**: https://www.twilio.com/console
2. **Get credentials**: Navigate to TURN servers in console
3. **Update frontend** `public/index.html`:

```javascript
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { 
            urls: 'turn:global.turn.twilio.com:3478',
            username: 'your-twilio-username',
            credential: 'your-twilio-credential'
        }
    ]
};
```

**Cost**: $0.0004 per minute per participant (~$0.024/hour per user)

### Option 2: Open Relay Project (Free)

```javascript
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};
```

**Note**: Free but shared infrastructure (may be slower)

---

## 📊 Monitoring & Analytics

### Railway Built-in Metrics
- Go to project → "Metrics" tab
- See: CPU usage, memory, network traffic
- Set up alerts for downtime

### Add Custom Analytics

Add to `server.js`:
```javascript
// Log debate metrics
socket.on('debate-ended', ({ debateId }) => {
    const debate = activeDebates.get(debateId);
    if (debate) {
        const duration = Date.now() - debate.startedAt;
        console.log(`[ANALYTICS] Debate ${debateId} lasted ${duration}ms`);
        // Send to analytics service (Google Analytics, Mixpanel, etc.)
    }
});
```

---

## 🔐 Security Checklist

✅ **HTTPS enabled** (Railway does this automatically)
✅ **CORS configured** (already in code)
✅ **Rate limiting** (TODO: add if needed)
✅ **User input validation** (already sanitized)
⚠️ **Add moderation tools** (report/ban features)
⚠️ **Add user authentication** (for v2)

---

## 🎯 Next Features to Add

### Phase 1 (Week 1-2)
- [ ] User accounts (email/password)
- [ ] Debate history tracking
- [ ] Basic reporting system

### Phase 2 (Week 3-4)
- [ ] Rating/ranking system
- [ ] Topic categories/preferences
- [ ] Spectator mode

### Phase 3 (Month 2)
- [ ] Friend challenges
- [ ] Tournament mode
- [ ] Debate recordings

---

## 📱 Mobile App Considerations

Your current web app works on mobile browsers, but for native apps:

**Option 1: Progressive Web App (PWA)**
- Add manifest.json
- Add service worker
- Users can "install" to home screen
- Cost: $0, works on existing backend

**Option 2: React Native**
- Build iOS/Android apps
- Use same backend/WebRTC code
- Cost: $99/year Apple Developer + $25 Google Play

---

## 🤝 Need Help?

**Common Issues:**
- Check Railway logs first
- Test `/health` endpoint
- Verify WebRTC connections in browser console

**Resources:**
- Railway Docs: https://docs.railway.app
- Socket.io Docs: https://socket.io/docs
- WebRTC Guide: https://webrtc.org/getting-started/overview

---

## 📝 Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Railway account created
- [ ] Project deployed to Railway
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] Tested with 2+ users
- [ ] Health check endpoint working
- [ ] Logs accessible in dashboard

**You're live! 🎉**

Share your URL and start getting feedback from real users.
