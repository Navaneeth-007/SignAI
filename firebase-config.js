// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyB9xPOobDKznWSxkWxTngBarSEOqdjRr74",
    authDomain: "signai-ea820.firebaseapp.com",
    projectId: "signai-ea820",
    storageBucket: "signai-ea820.firebasestorage.app",
    messagingSenderId: "88913376198",
    appId: "1:88913376198:web:bd13282673a2a8415fb8c7",
    measurementId: "G-7W3MJTFNSR"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Export auth for use in other files
window.auth = auth; 