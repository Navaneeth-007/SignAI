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
        
        try {
            // Get local stream
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            this.localVideo.srcObject = this.localStream;

            // Create peer connection
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

            // Create call document
            const callsRef = collection(this.db, 'calls');
            this.callDoc = await addDoc(callsRef, {
                initiator: this.auth.currentUser.uid,
                target: targetUserId,
                status: 'pending',
                initiatorRole: this.userRole
            });
            this.callId = this.callDoc.id;

            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = {
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        sdpMid: event.candidate.sdpMid,
                        candidate: event.candidate.candidate
                    };
                    updateDoc(this.callDoc, {
                        [`iceCandidates.${Date.now()}`]: candidate
                    });
                }
            };

            // Listen for remote answer and ICE candidates
            onSnapshot(doc(this.db, 'calls', this.callId), async (snapshot) => {
                const data = snapshot.data();
                if (!this.peerConnection.currentRemoteDescription && data?.answer) {
                    console.log('Setting remote description');
                    const answerDescription = new RTCSessionDescription(data.answer);
                    await this.peerConnection.setRemoteDescription(answerDescription);
                }

                if (data?.iceCandidates) {
                    Object.values(data.iceCandidates).forEach(async (candidate) => {
                        if (candidate && !this.addedCandidates?.has(JSON.stringify(candidate))) {
                            try {
                                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                                this.addedCandidates = this.addedCandidates || new Set();
                                this.addedCandidates.add(JSON.stringify(candidate));
                            } catch (e) {
                                console.warn('Error adding ICE candidate:', e);
                            }
                        }
                    });
                }
            });

            // Create and set local offer
            const offerDescription = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offerDescription);

            await updateDoc(this.callDoc, {
                offer: {
                    type: offerDescription.type,
                    sdp: offerDescription.sdp
                }
            });

            // Connect to WebSocket server
            await this.connectWebSocket();

            return true;
        } catch (error) {
            console.error('Error initializing call:', error);
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
                    console.log('Attempting to connect to WebSocket server...');
                    this.websocket = new WebSocket('ws://localhost:8765');

                    this.websocket.onopen = () => {
                        console.log('Connected to WebSocket server');
                        retryCount = 0;
                        // Send initial role
                        this.websocket.send(JSON.stringify({ role: this.userRole }));
                        resolve();
                    };

                    this.websocket.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        console.log('Received message:', data);

                        if (data.type === 'connection_status') {
                            if (data.status === 'connected') {
                                console.log(`Connected as ${data.role} user`);
                                if (this.userRole === 'accessibility') {
                                    this.startVideoProcessing();
                                } else {
                                    this.startAudioProcessing();
                                }
                            }
                        } else if (data.type === 'interpretation') {
                            this.interpretationText.textContent = data.text;
                            this.aiOutput.classList.add('active');

                            if (data.audio) {
                                this.interpretationAudio.src = `data:audio/mp3;base64,${data.audio}`;
                            }
                        } else if (data.type === 'error') {
                            console.error('Server error:', data.message);
                            alert(`Error: ${data.message}`);
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
                this.websocket.send(JSON.stringify({
                    type: 'video_frame',
                    data: frameData
                }));

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
                if (this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.send(JSON.stringify({
                        type: 'audio',
                        data: base64Audio
                    }));
                }
            };
            reader.readAsDataURL(audioBlob);

            mediaRecorder.start(1000);
        };

        mediaRecorder.start(1000);
        this.mediaRecorder = mediaRecorder;
    }

    async cleanup() {
        if (this.callDoc) {
            await deleteDoc(doc(this.db, 'calls', this.callId));
        }
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