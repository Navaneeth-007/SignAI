import os
import pickle
import mediapipe as mp
import cv2
import numpy as np
from sklearn.ensemble import RandomForestClassifier

class SignLanguageInterpreter:
    def __init__(self):
        # Initialize mediapipe
        self.mp_hands = mp.solutions.hands
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles
        self.hands = self.mp_hands.Hands(static_image_mode=True, min_detection_confidence=0.3)
        
        # Load or train the model
        self.model = self.load_or_train_model()
        
        # Initialize state variables
        self.sentence = ""
        self.prev_char = ""
        self.count_same_char = 0
        self.char_threshold = 10  # number of frames to wait before accepting a new char

    def load_or_train_model(self):
        """Load existing model or train a new one"""
        model_path = os.path.join(os.path.dirname(__file__), 'model.p')
        
        try:
            if os.path.exists(model_path):
                print("Loading existing model...")
                with open(model_path, 'rb') as f:
                    model_dict = pickle.load(f)
                return model_dict['model']
            else:
                print("Training new model...")
                return self.train_model()
        except Exception as e:
            print(f"Error loading model: {e}")
            return self.train_model()

    def train_model(self):
        """Train a new model"""
        try:
            data_path = os.path.join(os.path.dirname(__file__), 'data.pickle')
            if not os.path.exists(data_path):
                raise FileNotFoundError(f"Training data not found at {data_path}")
            
            print("Loading training data...")
            with open(data_path, 'rb') as f:
                data_dict = pickle.load(f)
            
            # Filter data to ensure consistent length
            expected_length = 42
            filtered_data = []
            filtered_labels = []
            
            for sample, label in zip(data_dict['data'], data_dict['labels']):
                if len(sample) == expected_length:
                    filtered_data.append(sample)
                    filtered_labels.append(label)
            
            if not filtered_data:
                raise ValueError("No valid training samples found")
            
            print(f"Training with {len(filtered_data)} samples...")
            data = np.array(filtered_data, dtype=np.float32)
            labels = np.array(filtered_labels)
            
            # Train model
            model = RandomForestClassifier()
            model.fit(data, labels)
            
            # Save model
            model_path = os.path.join(os.path.dirname(__file__), 'model.p')
            with open(model_path, 'wb') as f:
                pickle.dump({'model': model}, f)
            
            print("Model training completed and saved")
            return model
            
        except Exception as e:
            print(f"Error training model: {e}")
            raise

    def predict(self, frame):
        """Predict sign language from a single frame"""
        try:
            data_aux = []
            x_ = []
            y_ = []
            
            # Convert frame to RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            H, W, _ = frame.shape
            
            # Process frame
            results = self.hands.process(frame_rgb)
            prediction = None
            
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    # Extract coordinates
                    for i in range(len(hand_landmarks.landmark)):
                        x = hand_landmarks.landmark[i].x
                        y = hand_landmarks.landmark[i].y
                        x_.append(x)
                        y_.append(y)
                    
                    # Normalize coordinates
                    for i in range(len(hand_landmarks.landmark)):
                        x = hand_landmarks.landmark[i].x
                        y = hand_landmarks.landmark[i].y
                        data_aux.append(x - min(x_))
                        data_aux.append(y - min(y_))
                
                # Make prediction if data is valid
                if len(data_aux) == 42:  # Expected length for the model
                    prediction = self.model.predict([np.asarray(data_aux)])[0]
                    
                    # Update sentence based on prediction
                    if prediction == self.prev_char:
                        self.count_same_char += 1
                    else:
                        self.count_same_char = 0
                        self.prev_char = prediction
                    
                    if self.count_same_char == self.char_threshold:
                        self.sentence += prediction
                        print(f"Predicted: {prediction}, Sentence: {self.sentence}")
                        self.count_same_char = 0
                        self.prev_char = ""
            
            return self.sentence
            
        except Exception as e:
            print(f"Error in prediction: {e}")
            return None

    def reset_sentence(self):
        """Reset the current sentence"""
        self.sentence = ""
        self.prev_char = ""
        self.count_same_char = 0 