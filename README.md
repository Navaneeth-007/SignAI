# SignAI - Real-time Sign Language Interpretation

A real-time video calling application with sign language interpretation capabilities.

## Features

- Real-time video calls
- Sign language interpretation
- Text-to-speech output
- User authentication with Firebase
- WebRTC peer-to-peer connections

## Deployment Instructions

### Prerequisites

1. Create a [Render.com](https://render.com) account
2. Install [Git](https://git-scm.com/)
3. Have a [Firebase](https://firebase.google.com/) project set up

### Deployment Steps

1. Push your code to a GitHub repository:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

2. On Render.com:
   - Click "New +"
   - Select "Blueprint"
   - Connect your GitHub repository
   - Click "Connect"

3. Render will automatically detect the `render.yaml` and create two services:
   - `signai-frontend`: Static site hosting the web interface
   - `signai-websocket`: Python service running the WebSocket server

4. Add environment variables in Render dashboard:
   - For frontend service:
     - `VITE_WS_URL`: WebSocket server URL (will be automatically set)
   - For WebSocket service:
     - `PORT`: 10000 (already set in render.yaml)
     - `PYTHON_VERSION`: 3.8.0 (already set in render.yaml)

5. Your app will be deployed to:
   - Frontend: `https://signai-frontend.onrender.com`
   - WebSocket: `wss://signai-websocket.onrender.com`

### Local Development

1. Install dependencies:
```bash
npm install
pip install -r requirements.txt
```

2. Start the frontend:
```bash
npm start
```

3. Start the WebSocket server:
```bash
python server/websocket_server.py
```

4. Access the app at `http://localhost:3000`

## Environment Variables

- `VITE_WS_URL`: WebSocket server URL
- `PORT`: Port for WebSocket server
- `PYTHON_VERSION`: Python version for the server

## Firebase Configuration

Update the Firebase configuration in `call/call.html` with your project details:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

## Support

For issues and support, please create an issue in the GitHub repository. 