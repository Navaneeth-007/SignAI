import { collection, doc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Get WebSocket URL based on environment
const WS_URL = window.location.hostname === 'localhost' 
    ? 'ws://localhost:8765'
    : `wss://${window.location.hostname.replace('signai-frontend', 'signai-websocket')}.onrender.com`;

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
        this.callDoc = null;
        this.callId = null;
        this.userRole = null;
        this.roomId = null;

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
        this.roomId = `${this.auth.currentUser.uid}_${targetUserId}`.split('').sort().join('');
        console.log(`Initializing call as ${userRole} in room ${this.roomId}`);
        
        try {
            // Get local stream
            console.log('Requesting media permissions...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            }).catch(error => {
                console.error('Media permission error:', error.name, error.message);
                throw new Error(`Failed to get camera/microphone access: ${error.message}`);
            });
            
            console.log('Media permissions granted, setting up local video');
            this.localVideo.srcObject = this.localStream;

            // Create peer connection
            console.log('Creating peer connection...');
            this.peerConnection = new RTCPeerConnection(this.servers);
            
            // Add local tracks to peer connection
            console.log('Adding local tracks to peer connection...');
            this.localStream.getTracks().forEach((track) => {
                console.log(`Adding ${track.kind} track to peer connection`);
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event.track.kind);
                if (!this.remoteStream) {
                    console.log('Creating new remote stream');
                    this.remoteStream = new MediaStream();
                    this.remoteVideo.srcObject = this.remoteStream;
                }
                console.log('Adding track to remote stream');
                this.remoteStream.addTrack(event.track);
            };

            // Handle connection state changes
            this.peerConnection.onconnectionstatechange = () => {
                console.log('Peer connection state:', this.peerConnection.connectionState);
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            };

            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('New ICE candidate:', event.candidate.type);
                    this.sendWebSocketMessage({
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            // Connect to WebSocket server and join room
            console.log('Connecting to WebSocket server...');
            await this.connectWebSocket();

            return true;
        } catch (error) {
            console.error('Error initializing call:', error);
            await this.cleanup();
            throw new Error(`Call initialization failed: ${error.message}`);
        }
    }

    async connectWebSocket() {
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 2000;

        const connect = () => {
            return new Promise((resolve, reject) => {
                try {
                    console.log('Attempting to connect to WebSocket server...');
                    this.websocket = new WebSocket(WS_URL);

                    this.websocket.onopen = () => {
                        console.log('Connected to WebSocket server, joining room:', this.roomId);
                        // Join room
                        this.sendWebSocketMessage({
                            type: 'join',
                            roomId: this.roomId,
                            role: this.userRole
                        });
                        resolve();
                    };

                    this.websocket.onmessage = async (event) => {
                        const data = JSON.parse(event.data);
                        console.log('Received message:', data);

                        switch (data.type) {
                            case 'connected':
                                console.log(`Connected to room as ${data.role}`);
                                if (data.clients === 2) {
                                    // Create and send offer if we're the second client
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
                                console.log('Received offer, creating answer');
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

                    this.websocket.onclose = async (event) => {
                        console.log('WebSocket connection closed:', event.code, event.reason);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
                            setTimeout(() => {
                                connect().catch(reject);
                            }, retryDelay);
                        } else {
                            reject(new Error('Failed to connect to WebSocket server after multiple attempts'));
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
        }
    }

    async handleAnswer(data) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(data) {
        try {
            if (data.candidate) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        } else {
            console.error('WebSocket is not connected');
        }
    }

    startVideoProcessing() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        let isProcessingFrame = false;

        const processFrame = () => {
            if (!isProcessingFrame && this.websocket.readyState === WebSocket.OPEN) {
                isProcessingFrame = true;

                canvas.width = this.localVideo.videoWidth;
                canvas.height = this.localVideo.videoHeight;
                context.drawImage(this.localVideo, 0, 0, canvas.width, canvas.height);

                const frameData = canvas.toDataURL('image/jpeg', 0.8);
                this.sendWebSocketMessage({
                    type: 'video_frame',
                    data: frameData
                });

                isProcessingFrame = false;
            }
            requestAnimationFrame(processFrame);
        };

        processFrame();
    }

    startAudioProcessing() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }

        const audioTrack = this.localStream.getAudioTracks()[0];
        const audioStream = new MediaStream([audioTrack]);
        const mediaRecorder = new MediaRecorder(audioStream);
        let audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            audioChunks = [];

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Audio = reader.result.split(',')[1];
                this.sendWebSocketMessage({
                    type: 'audio',
                    data: base64Audio
                });
            };
            reader.readAsDataURL(audioBlob);

            mediaRecorder.start(1000);
        };

        mediaRecorder.start(1000);
        this.mediaRecorder = mediaRecorder;
    }

    async cleanup() {
        if (this.websocket) {
            this.websocket.close();
        }
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
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