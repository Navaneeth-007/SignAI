import { collection, doc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js";

// Get WebSocket URL based on environment
const WS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `ws://${window.location.hostname}:10000`
    : `wss://${window.location.hostname.replace('signai-frontend', 'signai-websocket')}.onrender.com`;

console.log('WebSocket URL:', WS_URL); // Add logging to verify URL

class CallConnection {
    constructor(firestore, auth, localVideo, remoteVideo, aiOutput) {
        this.db = firestore;
        this.auth = auth;
        this.localVideo = localVideo;
        this.remoteVideo = remoteVideo;
        this.aiOutput = aiOutput;
        this.interpretationText = aiOutput.querySelector('.interpretation-text');
        this.interpretationAudio = document.getElementById('interpretationAudio');

        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.websocket = null;
        this.userRole = null;
        this.targetUserId = null;

        // WebRTC configuration
        this.servers = {
            iceServers: [
                {
                    urls: [
                        'stun:stun1.l.google.com:19302',
                        'stun:stun2.l.google.com:19302',
                    ],
                },
            ],
            iceCandidatePoolSize: 10,
        };
    }

    async initializeCall(userRole, targetUserId) {
        this.userRole = userRole;
        this.targetUserId = targetUserId;
        
        try {
            // Get local stream
            console.log('Requesting media permissions...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            console.log('Media permissions granted, setting up local video');
            this.localVideo.srcObject = this.localStream;

            // Create peer connection
            console.log('Creating peer connection...');
            this.peerConnection = new RTCPeerConnection(this.servers);
            
            // Add local tracks to peer connection
            this.localStream.getTracks().forEach((track) => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event.track.kind);
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                    this.remoteVideo.srcObject = this.remoteStream;
                }
                this.remoteStream.addTrack(event.track);
            };

            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('New ICE candidate:', event.candidate);
                    this.sendWebSocketMessage({
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            // Handle connection state changes
            this.peerConnection.onconnectionstatechange = () => {
                console.log('Peer connection state:', this.peerConnection.connectionState);
                if (this.peerConnection.connectionState === 'failed') {
                    console.log('Connection failed, cleaning up...');
                    this.cleanup();
                }
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            };

            // Connect to WebSocket server
            console.log('Connecting to WebSocket server...');
            await this.connectWebSocket();

            return true;
        } catch (error) {
            console.error('Error initializing call:', error);
            await this.cleanup();
            throw error;
        }
    }

    async connectWebSocket() {
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 2000;

        const connect = () => {
            return new Promise((resolve, reject) => {
                try {
                    console.log('Attempting to connect to WebSocket server at:', WS_URL);
                    this.websocket = new WebSocket(WS_URL);

                    this.websocket.onopen = () => {
                        console.log('Connected to WebSocket server');
                        // Join call with user IDs to create a unique call ID
                        const callId = [this.auth.currentUser.uid, this.targetUserId].sort().join('_');
                        this.sendWebSocketMessage({
                            type: 'join',
                            userId: this.auth.currentUser.uid,
                            callId: callId,
                            role: this.userRole
                        });
                        resolve();
                    };

                    this.websocket.onmessage = async (event) => {
                        const data = JSON.parse(event.data);
                        console.log('Received message:', data);

                        switch (data.type) {
                            case 'connected':
                                console.log(`Connected to call as ${data.role}`);
                                if (data.isCallReady) {
                                    await this.createAndSendOffer();
                                }
                                break;

                            case 'user_joined':
                                console.log('Other user joined:', data.role);
                                break;

                            case 'user_left':
                                console.log('Other user left');
                                this.remoteStream = null;
                                this.remoteVideo.srcObject = null;
                                break;

                            case 'offer':
                                console.log('Received offer');
                                await this.handleOffer(data);
                                break;

                            case 'answer':
                                console.log('Received answer');
                                await this.handleAnswer(data);
                                break;

                            case 'ice-candidate':
                                console.log('Received ICE candidate');
                                await this.handleIceCandidate(data);
                                break;

                            case 'interpretation':
                                this.handleInterpretation(data);
                                break;

                            case 'error':
                                console.error('Server error:', data.message);
                                alert(`Error: ${data.message}`);
                                break;
                        }
                    };

                    this.websocket.onerror = (error) => {
                        console.error('WebSocket error:', error);
                        reject(error);
                    };

                    this.websocket.onclose = () => {
                        console.log('WebSocket connection closed');
                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
                            setTimeout(() => connect().catch(reject), retryDelay);
                        } else {
                            reject(new Error('Failed to connect after multiple attempts'));
                        }
                    };

                } catch (error) {
                    reject(error);
                }
            });
        };

        return connect();
    }

    async createAndSendOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.sendWebSocketMessage({
                type: 'offer',
                sdp: this.peerConnection.localDescription
            });
        } catch (error) {
            console.error('Error creating offer:', error);
            throw error;
        }
    }

    async handleOffer(data) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendWebSocketMessage({
                type: 'answer',
                sdp: this.peerConnection.localDescription
            });
        } catch (error) {
            console.error('Error handling offer:', error);
            throw error;
        }
    }

    async handleAnswer(data) {
        try {
            const answerDescription = new RTCSessionDescription(data.sdp);
            await this.peerConnection.setRemoteDescription(answerDescription);
        } catch (error) {
            console.error('Error handling answer:', error);
            throw error;
        }
    }

    async handleIceCandidate(data) {
        try {
            if (data.candidate) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
            throw error;
        }
    }

    handleInterpretation(data) {
        this.interpretationText.textContent = data.text;
        this.aiOutput.classList.add('active');
        if (data.audio) {
            this.interpretationAudio.src = `data:audio/mp3;base64,${data.audio}`;
        }
    }

    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        } else {
            console.error('WebSocket is not connected');
        }
    }

    async cleanup() {
        if (this.websocket) {
            this.websocket.close();
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.peerConnection) {
            this.peerConnection.close();
        }
    }
}

export default CallConnection; 