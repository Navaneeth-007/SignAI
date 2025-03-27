// Import Firebase (make sure to include Firebase SDK in your HTML)
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyB9xPOobDKznWSxkWxTngBarSEOqdjRr74",
    authDomain: "signai-ea820.firebaseapp.com",
    projectId: "signai-ea820",
    // other config details
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// DOM Elements
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signLanguageModeToggle = document.getElementById('sign-language-mode');
const highContrastToggle = document.getElementById('high-contrast');

// Login Form Submit Handler
loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const email = emailInput.value;
    const password = passwordInput.value;
    
    try {
        // Firebase Authentication
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Store user preferences
        const userPreferences = {
            signLanguageMode: signLanguageModeToggle.checked,
            highContrast: highContrastToggle.checked
        };
        
        // Save preferences to local storage
        localStorage.setItem('signai_user_preferences', JSON.stringify(userPreferences));
        
        // Redirect to dashboard or video call page
        window.location.href = '/dashboard.html';
    } catch (error) {
        // Handle login errors
        console.error('Login Error:', error);
        
        // Display user-friendly error message
        let errorMessage = 'Login failed. Please check your credentials.';
        
        switch(error.code) {
            case 'auth/invalid-email':
                errorMessage = 'Invalid email format.';
                break;
            case 'auth/user-not-found':
                errorMessage = 'No user found with this email.';
                break;
            case 'auth/wrong-password':
                errorMessage = 'Incorrect password.';
                break;
        }
        
        // Show error (you might want to replace this with a more user-friendly method)
        alert(errorMessage);
    }
});

// High Contrast Mode Toggle
highContrastToggle.addEventListener('change', function() {
    document.body.classList.toggle('high-contrast', this.checked);
    
    // Optional: Save high contrast preference
    localStorage.setItem('signai_high_contrast', this.checked);
});

// Sign Language Mode Toggle
signLanguageModeToggle.addEventListener('change', function() {
    // Placeholder for sign language mode functionality
    if (this.checked) {
        // Enable sign language specific features
        console.log('Sign Language Mode Enabled');
        // You would implement sign language detection/translation logic here
    } else {
        // Disable sign language specific features
        console.log('Sign Language Mode Disabled');
    }
});

// Restore user preferences on page load
document.addEventListener('DOMContentLoaded', () => {
    // Restore high contrast mode
    const savedHighContrast = localStorage.getItem('signai_high_contrast') === 'true';
    highContrastToggle.checked = savedHighContrast;
    document.body.classList.toggle('high-contrast', savedHighContrast);
    
    // Restore sign language mode toggle (if needed)
    const savedPreferences = JSON.parse(localStorage.getItem('signai_user_preferences'));
    if (savedPreferences) {
        signLanguageModeToggle.checked = savedPreferences.signLanguageMode;
    }
});

document.addEventListener('DOMContentLoaded', function() {
    // Regular login form handler
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        // Handle regular login
        console.log('Regular login attempt:', email);
    });

    // Google Sign-In handler
    const googleSignInBtn = document.querySelector('.google-signin-btn');
    googleSignInBtn.addEventListener('click', function() {
        // Initialize Google Sign-In
        // Note: You'll need to replace YOUR_CLIENT_ID with your actual Google OAuth client ID
        const googleAuth = {
            client_id: 'YOUR_CLIENT_ID',
            scope: 'email profile',
        };
        
        // Redirect to Google Sign-In
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${googleAuth.client_id}` +
            `&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/google/callback')}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent(googleAuth.scope)}`;
    });
});