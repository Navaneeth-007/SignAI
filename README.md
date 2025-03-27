# SignLLM - Sign Language Recognition

A real-time sign language recognition application that uses machine learning to interpret sign language gestures and convert them into text and speech.

## Features

- Real-time sign language recognition using webcam
- Text-to-speech conversion of recognized signs
- Automatic spell correction
- Continuous recognition with word building
- Clean and intuitive user interface

## Live Demo

Visit the application at: [https://signllm.onrender.com](https://signllm.onrender.com)

## Technology Stack

- Frontend:
  - HTML/CSS/JavaScript
  - MediaPipe for hand tracking
  - Web Speech API for text-to-speech
  
- Backend:
  - Python/Flask
  - OpenCV for image processing
  - MediaPipe for hand landmark detection
  - Machine Learning model for sign recognition
  - gTTS for high-quality speech synthesis

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/[your-github-username]/SignLlm.git
cd SignLlm
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Run the backend server:
```bash
python backend.py
```

4. Open the frontend in a web browser:
- Navigate to `home/home.html`
- Or serve using a local server (e.g., `python -m http.server`)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 