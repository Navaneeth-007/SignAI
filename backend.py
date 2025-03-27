from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import os
import logging
import numpy as np
import cv2
import base64
import mediapipe as mp
from threading import Lock
import pickle
from textblob import Word
from gtts import gTTS
import tempfile

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Enable CORS with specific settings
CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:5000", 
                   "http://127.0.0.1:5000", 
                   "http://localhost:8000", 
                   "http://127.0.0.1:8000",
                   "https://signllm.onrender.com"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
hands = mp_hands.Hands(
    static_image_mode=True,
    min_detection_confidence=0.3
)

# Global variables for recognition state
recognition_active = False
recognition_lock = Lock()
model = None

# Variables for sentence building
sentence = ""
prev_char = ""
count_same_char = 0
char_threshold = 10  # number of frames to wait before accepting a new char

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

def load_model():
    """Load the model with multiple approaches."""
    global model
    try:
        model_dict = pickle.load(open('./model.p', 'rb'))
        model = model_dict['model']
        logger.info("Model loaded successfully from pickle")
        return True
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        return False

# Try to load the model
if not load_model():
    logger.error("Failed to load model")
    model = None

def process_frame(frame_data):
    """Process a single frame and return hand landmarks."""
    try:
        # Decode base64 image
        encoded_data = frame_data.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Convert to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process the frame with MediaPipe
        results = hands.process(frame_rgb)
        
        if results.multi_hand_landmarks:
            # Initialize data for hand landmarks
            data_aux = []
            x_ = []
            y_ = []
            
            # Get landmarks from the first detected hand
            hand_landmarks = results.multi_hand_landmarks[0]
            
            # First pass: collect x, y coordinates
            for landmark in hand_landmarks.landmark:
                x_.append(landmark.x)
                y_.append(landmark.y)
            
            # Second pass: normalize coordinates
            for landmark in hand_landmarks.landmark:
                # Normalize coordinates relative to the hand's bounding box
                x = landmark.x - min(x_)
                y = landmark.y - min(y_)
                data_aux.append(x)
                data_aux.append(y)
            
            # Check if we have the correct number of features
            if len(data_aux) > 42:  # Same check as in Streamlit code
                return None
                
            return np.asarray(data_aux, dtype=np.float32)
        else:
            logger.debug("No hands detected in frame")
            return None
    except Exception as e:
        logger.error(f"Error processing frame: {str(e)}")
        return None

@app.route("/process_frame", methods=["POST"])
def process_video_frame():
    global sentence, prev_char, count_same_char
    
    if not recognition_active:
        return jsonify({"status": "Recognition is not active"}), 400
    
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503
    
    try:
        data = request.json
        if not data or "frame" not in data:
            return jsonify({"error": "No frame data provided"}), 400
        
        # Process the frame
        landmarks = process_frame(data["frame"])
        if landmarks is None:
            return jsonify({"prediction": "No hands detected", "confidence": 0.0})
        
        try:
            # Make prediction using the model
            prediction = model.predict([landmarks])[0]
            
            # Update sentence based on prediction consistency
            if prediction == prev_char:
                count_same_char += 1
            else:
                count_same_char = 0
                prev_char = prediction
            
            # If the same character has been predicted for enough frames
            if count_same_char == char_threshold:
                # Add a space if SPACE is detected, otherwise add the prediction
                if prediction == "SPACE":
                    sentence += " "
                    # Get the last word and correct it
                    words = sentence.strip().split()
                    if words:
                        last_word = words[-1].lower()  # Convert to lowercase for better correction
                        try:
                            # Use Word for basic spell correction
                            corrected_word = Word(last_word).correct()
                            # Replace the last word with the corrected version
                            words[-1] = str(corrected_word)
                            sentence = " ".join(words) + " "
                        except Exception as e:
                            logger.warning(f"Spell correction failed for word '{last_word}': {str(e)}")
                else:
                    sentence += prediction
                count_same_char = 0  # reset counter after accepting
                prev_char = ""  # reset previous character to wait for next
            
            # Get prediction confidence if available
            confidence = 1.0
            if hasattr(model, 'predict_proba'):
                probabilities = model.predict_proba([landmarks])[0]
                confidence = float(probabilities.max())
            
            # Get the current word being built
            current_word = sentence.strip().split()[-1] if sentence.strip() else ""
            
            logger.info(f"Predicted character: {prediction}, Confidence: {confidence:.4f}")
            logger.info(f"Current sentence: {sentence}")
            logger.info(f"Current word: {current_word}")
            
            return jsonify({
                "prediction": prediction,
                "confidence": confidence,
                "sentence": sentence,
                "current_word": current_word,
                "should_speak": prediction == "SPACE" and current_word
            })
            
        except Exception as e:
            logger.error(f"Error during prediction: {str(e)}")
            logger.error(f"Landmarks shape: {landmarks.shape}")
            logger.error(f"Model type: {type(model)}")
            return jsonify({"prediction": "No hands detected", "confidence": 0.0})
    
    except Exception as e:
        logger.error(f"Error during frame processing: {str(e)}")
        return jsonify({"prediction": "No hands detected", "confidence": 0.0})

@app.route("/start_recognition", methods=["POST", "OPTIONS"])
def start_recognition():
    if request.method == "OPTIONS":
        return jsonify({"status": "OK"}), 200

    try:
        global recognition_active, sentence, prev_char, count_same_char
        with recognition_lock:
            if recognition_active:
                return jsonify({"status": "Recognition already active"}), 200
            
            if model is None:
                return jsonify({"error": "Model not loaded"}), 503
            
            # Reset sentence building variables
            sentence = ""
            prev_char = ""
            count_same_char = 0
            
            recognition_active = True
            logger.info("Recognition started successfully")
            return jsonify({
                "status": "Recognition started",
                "model_type": str(type(model))
            })
    except Exception as e:
        logger.error(f"Error starting recognition: {str(e)}")
        return jsonify({"error": f"Failed to start recognition: {str(e)}"}), 500

def generate_speech(text):
    """Generate speech using gTTS and return base64 encoded audio."""
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            # Generate speech
            tts = gTTS(text=text, lang='en', slow=False)
            tts.save(temp_file.name)
            
            # Read the generated audio file
            with open(temp_file.name, 'rb') as audio_file:
                audio_data = audio_file.read()
                
            # Delete the temporary file
            os.unlink(temp_file.name)
            
            # Encode audio data to base64
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            return audio_base64
    except Exception as e:
        logger.error(f"Error generating speech: {str(e)}")
        return None

@app.route("/stop_recognition", methods=["POST", "OPTIONS"])
def stop_recognition():
    if request.method == "OPTIONS":
        return jsonify({"status": "OK"}), 200

    try:
        global recognition_active, sentence
        with recognition_lock:
            recognition_active = False
            
            # Correct the entire sentence
            corrected_sentence = sentence
            if sentence.strip():
                try:
                    # Split sentence into words and correct each word
                    words = sentence.strip().split()
                    corrected_words = []
                    for word in words:
                        if word.strip():  # Skip empty strings
                            try:
                                corrected_word = str(Word(word.lower()).correct())
                                corrected_words.append(corrected_word)
                            except Exception as e:
                                logger.warning(f"Failed to correct word '{word}': {str(e)}")
                                corrected_words.append(word)
                    
                    corrected_sentence = " ".join(corrected_words)
                    logger.info(f"Original sentence: {sentence}")
                    logger.info(f"Corrected sentence: {corrected_sentence}")
                    
                    # Generate audio for the corrected sentence
                    audio_base64 = generate_speech(corrected_sentence)
                except Exception as e:
                    logger.error(f"Error correcting sentence: {str(e)}")
                    audio_base64 = None
            else:
                audio_base64 = None
            
            return jsonify({
                "status": "Recognition stopped",
                "final_sentence": sentence,
                "corrected_sentence": corrected_sentence,
                "audio": audio_base64
            })
    except Exception as e:
        logger.error(f"Error stopping recognition: {str(e)}")
        return jsonify({"error": f"Failed to stop recognition: {str(e)}"}), 500

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "recognition_active": recognition_active,
        "model_type": str(type(model)) if model is not None else None
    })

if __name__ == "__main__":
    # Load the model when the application starts
    if not load_model():
        logger.error("Failed to load model")
        model = None
    
    # Get port from environment variable
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
