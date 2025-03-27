let localStream = null;
let isRecognizing = false;
let retryCount = 0;
let isSpeechEnabled = true;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
let frameProcessing = false;
let lastFrameTime = 0;
const FRAME_INTERVAL = 100; // Process frames every 100ms

// Create canvas once and reuse
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
canvas.width = 640;
canvas.height = 480;

// Get DOM elements
const videoElement = document.getElementById('localVideo');
const startButton = document.getElementById('startRecognition');
const stopButton = document.getElementById('stopRecognition');
const recognizedText = document.getElementById('recognizedText');
const statusText = document.getElementById('statusText');
const sentenceText = document.getElementById('sentenceText');

// Create audio element for playing speech
const audioElement = new Audio();

// Speech synthesis setup
const speechSynthesis = window.speechSynthesis;
let currentUtterance = null;

// API URL based on environment
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : `https://${window.location.hostname}:8000`;

let lastPrediction = '';
let predictionCount = 0;
let predictionBuffer = [];
const PREDICTION_THRESHOLD = 2; // Number of consecutive predictions needed
const BUFFER_SIZE = 3; // Small buffer size for faster response
const MIN_CONFIDENCE = 0.3; // Lowered confidence threshold to match backend

let currentWord = '';

// Initialize speech synthesis
function initSpeechSynthesis() {
    // Some browsers need a little push to initialize speech synthesis
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(utterance);
}

// Verify all DOM elements are found
function verifyElements() {
    const elements = {
        videoElement,
        startButton,
        stopButton,
        recognizedText,
        statusText,
        sentenceText
    };

    for (const [name, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Element not found: ${name}`);
            return false;
        }
    }
    return true;
}

function updateRecognizedText(text, confidence) {
    if (!text) return;
    
    // Only skip if explicitly "No hands detected" with very low confidence
    if (text === 'No hands detected' && confidence < 0.1) return;
    
    // Update the current prediction immediately
    if (recognizedText) {
        recognizedText.textContent = text;
    }
}

function updateSentence(sentence, currentPrediction) {
    if (sentenceText) {
        // Show both the accumulated sentence and current prediction
        let displayText = sentence || '';
        if (currentPrediction && currentPrediction !== 'No hands detected' && currentPrediction !== 'SPACE') {
            displayText += (displayText ? ' ' : '') + currentPrediction;
        }
        sentenceText.textContent = displayText;
    }
}

function speakSentence(sentence) {
    if (!sentence || typeof sentence !== 'string') {
        console.log('Invalid sentence provided:', sentence);
        return;
    }
    
    console.log('Attempting to speak sentence:', sentence);
    
    // Cancel any ongoing speech
    if (speechSynthesis.speaking) {
        console.log('Cancelling ongoing speech');
        speechSynthesis.cancel();
    }
    
    // Create new utterance
    const utterance = new SpeechSynthesisUtterance(sentence);
    
    // Configure speech properties
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';
    
    // Event handlers
    utterance.onstart = () => {
        console.log('Speech started:', sentence);
        currentUtterance = utterance;
    };
    
    utterance.onend = () => {
        console.log('Speech ended');
        currentUtterance = null;
    };
    
    utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        currentUtterance = null;
        
        // Retry once after error
        setTimeout(() => {
            if (!speechSynthesis.speaking) {
                console.log('Retrying speech after error');
                speechSynthesis.speak(utterance);
            }
        }, 100);
    };
    
    // Speak the sentence
    try {
        console.log('Starting speech synthesis');
        speechSynthesis.speak(utterance);
        
        // Ensure speech synthesis is working
        setTimeout(() => {
            if (!speechSynthesis.speaking && sentence === utterance.text) {
                console.log('Speech may have failed silently, retrying...');
                speechSynthesis.cancel(); // Clear any pending speech
                speechSynthesis.speak(utterance);
            }
        }, 250);
    } catch (error) {
        console.error('Error in speech synthesis:', error);
    }
}

function playAudio(audioBase64) {
    if (!audioBase64) {
        console.log('No audio data provided');
        return;
    }
    
    try {
        console.log('Playing audio...');
        audioElement.src = `data:audio/mp3;base64,${audioBase64}`;
        audioElement.play().catch(error => {
            console.error('Error playing audio:', error);
        });
    } catch (error) {
        console.error('Error setting up audio playback:', error);
    }
}

async function checkServerHealth() {
    try {
        console.log('Checking server health...');
        const response = await fetch(`${API_URL}/health`);
        if (!response.ok) {
            throw new Error('Server health check failed');
        }
        const health = await response.json();
        console.log('Server health response:', health);
        
        if (!health.model_loaded) {
            throw new Error('Sign language model not loaded');
        }
        return true;
    } catch (error) {
        console.error('Server health check failed:', error);
        return false;
    }
}

async function initializeVideo() {
    try {
        console.log('Initializing video...');
        
        // Stop any existing stream
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Request video with specific constraints
        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user',
                frameRate: { ideal: 30 }
            },
            audio: false
        };
        
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Got media stream:', localStream);
        
        // Set the video source
        videoElement.srcObject = localStream;
        videoElement.playsInline = true;
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                console.log('Video metadata loaded');
                resolve();
            };
        });
        
        // Start playing
        await videoElement.play();
        console.log('Video playback started');
        
        // Enable start button
        startButton.disabled = false;
        stopButton.disabled = true;
        
        updateStatus('Camera initialized successfully');
    } catch (error) {
        console.error('Error accessing camera:', error);
        updateStatus(`Error accessing camera: ${error.message}`, true);
        alert('Error accessing camera. Please ensure you have granted camera permissions.');
    }
}

function updateStatus(message, isError = false) {
    console.log(`Status update: ${message} (${isError ? 'error' : 'info'})`);
    if (statusText) {
        statusText.textContent = message;
        statusText.className = isError ? 'status-text error' : 'status-text success';
    }
}

function updateInterpretation(text) {
    if (sentenceText) {
        sentenceText.textContent = text || 'Listening for signs...';
    }
}

async function processFrame() {
    if (!isRecognizing || !videoElement || !localStream) return;

    const currentTime = Date.now();
    if (currentTime - lastFrameTime < FRAME_INTERVAL) {
        requestAnimationFrame(processFrame);
        return;
    }

    try {
        if (frameProcessing || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
            requestAnimationFrame(processFrame);
            return;
        }

        frameProcessing = true;
        lastFrameTime = currentTime;

        // Draw the video frame to canvas
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL('image/jpeg', 0.8);

        const response = await fetch(`${API_URL}/process_frame`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frame })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.prediction) {
                console.log('Received prediction:', result.prediction, 'confidence:', result.confidence);
                
                // Update the current recognition immediately
                updateRecognizedText(result.prediction, result.confidence);
                
                // Handle sentence building and speech
                if (result.sentence) {
                    // Update the sentence display
                    updateSentence(result.sentence, result.prediction);
                    
                    // Speak the word if a space was detected and we have a word to speak
                    if (result.should_speak && result.current_word) {
                        console.log('Speaking word:', result.current_word);
                        speakSentence(result.current_word);
                    }
                }
            }
        } else {
            console.error('Frame processing failed:', await response.text());
        }

    } catch (error) {
        console.error('Error processing frame:', error);
    } finally {
        frameProcessing = false;
        if (isRecognizing) {
            requestAnimationFrame(processFrame);
        }
    }
}

async function startRecognition() {
    console.log('Starting recognition...');
    
    if (!localStream || !videoElement.srcObject) {
        console.log('Video not ready, reinitializing...');
        await initializeVideo();
    }

    try {
        // Check server health and start recognition
        const healthResponse = await fetch(`${API_URL}/health`);
        if (!healthResponse.ok) {
            throw new Error('Recognition server not responding');
        }
        const health = await healthResponse.json();
        console.log('Server health:', health);

        if (!health.model_loaded) {
            throw new Error('Sign language model not loaded');
        }

        const response = await fetch(`${API_URL}/start_recognition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to start recognition');
        }

        // Reset states
        isRecognizing = true;
        currentWord = '';
        frameProcessing = false;
        lastFrameTime = 0;
        
        // Update UI
        startButton.disabled = true;
        stopButton.disabled = false;
        updateStatus('Recognition started');
        updateInterpretation('Listening for signs...');
        recognizedText.textContent = 'Waiting for signs...';
        updateSentence('');

        // Start processing frames
        processFrame();
    } catch (error) {
        console.error('Error starting recognition:', error);
        updateStatus(`Error: ${error.message}`, true);
        isRecognizing = false;
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

async function stopRecognition() {
    console.log('Stopping recognition...');
    
    if (!isRecognizing) {
        console.log('Recognition already stopped');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/stop_recognition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to stop recognition');
        }

        const result = await response.json();
        
        // Update the sentence display with both original and corrected sentences
        if (sentenceText) {
            let displayText = '';
            if (result.final_sentence) {
                displayText += `<div class="original">Original: ${result.final_sentence}</div>`;
            }
            if (result.corrected_sentence) {
                displayText += `<div class="corrected">Corrected: ${result.corrected_sentence}</div>`;
                
                // Play the audio if available
                if (result.audio) {
                    console.log('Playing corrected sentence audio');
                    playAudio(result.audio);
                } else {
                    console.log('No audio received for corrected sentence');
                }
            }
            sentenceText.innerHTML = displayText;
        }

    } catch (error) {
        console.error('Error stopping recognition:', error);
        updateStatus(`Error: ${error.message}`, true);
    } finally {
        isRecognizing = false;
        startButton.disabled = false;
        stopButton.disabled = true;
        updateStatus('Recognition stopped');
        updateRecognizedText('Recognition stopped');
    }
}

// Clean up function
async function cleanup() {
    // Stop recognition if active
    if (isRecognizing) {
        await stopRecognition();
    }
    
    // Stop all video tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Cancel any ongoing speech
    if (currentUtterance) {
        speechSynthesis.cancel();
    }
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Page loaded, initializing...');
    
    // Initialize speech synthesis
    initSpeechSynthesis();
    
    // Verify all elements are present
    if (!verifyElements()) {
        console.error('Missing required DOM elements');
        return;
    }

    try {
        // Check if browser supports getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support camera access');
        }

        // Initialize video
        await initializeVideo();
        
        // Check server health
        if (await checkServerHealth()) {
            updateStatus('Ready to start recognition');
        } else {
            updateStatus('Warning: Recognition server not available', true);
        }
    } catch (error) {
        console.error('Initialization error:', error);
        updateStatus(`Error: ${error.message}`, true);
    }
});

// Event listeners for buttons
if (startButton && stopButton) {
    startButton.addEventListener('click', startRecognition);
    stopButton.addEventListener('click', stopRecognition);
}

// Clean up when leaving the page
window.addEventListener('beforeunload', cleanup);

// Add cleanup to navigation button
document.querySelector('.nav-button').addEventListener('click', async (e) => {
    e.preventDefault(); // Prevent immediate navigation
    await cleanup();
    window.location.href = '../home/home.html';
}); 